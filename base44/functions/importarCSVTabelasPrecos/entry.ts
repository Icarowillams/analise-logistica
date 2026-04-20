import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Importa tabelas de preço e preços por produto a partir do CSV (delimitador ;)
// Religação feita pelo PRODUTO_CODIGO (não ID). Produtos sem correspondência são ignorados.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
    }

    const { csv_url } = await req.json();
    if (!csv_url) return Response.json({ error: 'csv_url obrigatório' }, { status: 400 });

    // Baixar CSV
    const res = await fetch(csv_url);
    const text = await res.text();
    const linhas = text.split(/\r?\n/).filter(l => l.trim());
    linhas.shift(); // header

    // Parse CSV simples: campos entre aspas separados por ;
    const parseRow = (linha) => {
      const out = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < linha.length; i++) {
        const c = linha[i];
        if (c === '"') { inQ = !inQ; continue; }
        if (c === ';' && !inQ) { out.push(cur); cur = ''; continue; }
        cur += c;
      }
      out.push(cur);
      return out;
    };

    // Buscar produtos existentes (mapa codigo → id)
    const produtos = await base44.asServiceRole.entities.Produto.list('', 10000);
    const mapaProdutoPorCodigo = new Map();
    for (const p of produtos) mapaProdutoPorCodigo.set(String(p.codigo), p.id);

    // Buscar tabelas existentes (mapa nome → id)
    const tabelasExistentes = await base44.asServiceRole.entities.TabelaPreco.list('', 1000);
    const mapaTabelaPorNome = new Map();
    for (const t of tabelasExistentes) mapaTabelaPorNome.set(t.nome.trim().toUpperCase(), t.id);

    // Agrupar linhas do CSV por tabela (nome)
    const tabelasCSV = new Map(); // nome -> { status, precos: [{codigo, valor_unitario, valor_acao, ativacao_acao, periodo_acao_fim}] }
    let linhasIgnoradasProdutoInexistente = 0;
    let linhasInvalidas = 0;

    for (const linha of linhas) {
      const cols = parseRow(linha);
      if (cols.length < 20) { linhasInvalidas++; continue; }

      const [, tabela_nome, tabela_status, , , , , , produto_codigo, , , , , , ,
             valor_unitario, valor_acao, , ativacao_acao, periodo_acao_fim] = cols;

      const nomeTab = (tabela_nome || '').trim();
      const codProd = String(produto_codigo || '').trim();
      if (!nomeTab || !codProd) { linhasInvalidas++; continue; }

      if (!mapaProdutoPorCodigo.has(codProd)) {
        linhasIgnoradasProdutoInexistente++;
        continue;
      }

      if (!tabelasCSV.has(nomeTab)) {
        tabelasCSV.set(nomeTab, { status: tabela_status || 'ativo', precos: [] });
      }
      tabelasCSV.get(nomeTab).precos.push({
        produto_id: mapaProdutoPorCodigo.get(codProd),
        valor_unitario: parseFloat(valor_unitario || 0) || 0,
        valor_acao: parseFloat(valor_acao || 0) || 0,
        ativacao_acao: (ativacao_acao || 'nao').toLowerCase() === 'sim',
        periodo_acao_fim: periodo_acao_fim || undefined
      });
    }

    // Criar/atualizar tabelas e seus preços
    let tabelasCriadas = 0, tabelasJaExistiam = 0, precosCriados = 0;

    for (const [nomeTab, info] of tabelasCSV.entries()) {
      let tabelaId = mapaTabelaPorNome.get(nomeTab.toUpperCase());

      if (!tabelaId) {
        const nova = await base44.asServiceRole.entities.TabelaPreco.create({
          nome: nomeTab,
          status: info.status === 'inativo' ? 'inativo' : 'ativo'
        });
        tabelaId = nova.id;
        tabelasCriadas++;
      } else {
        tabelasJaExistiam++;
      }

      // Criar preços em lote (bulkCreate em chunks de 50)
      const dadosPrecos = info.precos.map(p => ({
        tabela_id: tabelaId,
        produto_id: p.produto_id,
        valor_unitario: p.valor_unitario,
        valor_acao: p.valor_acao,
        ativacao_acao: p.ativacao_acao,
        ...(p.periodo_acao_fim ? { periodo_acao_fim: p.periodo_acao_fim } : {}),
        omie_sincronizado: false
      }));

      const chunkSize = 50;
      for (let i = 0; i < dadosPrecos.length; i += chunkSize) {
        const chunk = dadosPrecos.slice(i, i + chunkSize);
        await base44.asServiceRole.entities.PrecoProduto.bulkCreate(chunk);
        precosCriados += chunk.length;
      }
    }

    return Response.json({
      sucesso: true,
      tabelas_criadas: tabelasCriadas,
      tabelas_ja_existiam: tabelasJaExistiam,
      precos_criados: precosCriados,
      linhas_csv_total: linhas.length,
      linhas_ignoradas_produto_inexistente: linhasIgnoradasProdutoInexistente,
      linhas_invalidas: linhasInvalidas
    });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err.message }, { status: 500 });
  }
});