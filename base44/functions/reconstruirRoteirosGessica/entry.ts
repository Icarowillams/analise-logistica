import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Reconstroi os roteiros de segunda a sabado da vendedora Gessica.
// Junta todos os clientes ativos dela, deduplica, e distribui uniformemente
// entre os 6 dias. Preserva roteiros existentes quando possivel.

const DIAS = ['segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado'];
const VENDEDOR_ID = '69ff70a75fbcb49b6597113f';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Apenas admins' }, { status: 403 });

    // 1. Buscar vendedora
    const vendedor = await base44.asServiceRole.entities.Vendedor.get(VENDEDOR_ID);
    if (!vendedor) return Response.json({ error: 'Vendedora nao encontrada' }, { status: 404 });

    // 2. Buscar todos os clientes ativos da Gessica
    const todosClientes = await base44.asServiceRole.entities.Cliente.list();
    const clientesAtivos = todosClientes.filter(c =>
      c.vendedor_id === VENDEDOR_ID &&
      c.status === 'ativo'
    );

    // 3. Buscar roteiros existentes para preservar clientes ja vinculados
    const todosRoteiros = await base44.asServiceRole.entities.Roteiro.list();
    const roteirosExistentes = todosRoteiros.filter(r => r.vendedor_id === VENDEDOR_ID);

    // 4. Coletar todos os IDs de clientes ja nos roteiros existentes
    const idsJaNosRoteiros = new Set();
    const clientesJaDetalhados = new Map(); // cliente_id -> detalhe
    roteirosExistentes.forEach(r => {
      (r.clientes_ids || []).forEach(id => idsJaNosRoteiros.add(id));
      (r.clientes_detalhes || []).forEach(d => {
        if (d.cliente_id && !clientesJaDetalhados.has(d.cliente_id)) {
          clientesJaDetalhados.set(d.cliente_id, d);
        }
      });
    });

    // 5. Juntar TODOS os clientes (dos roteiros + novos da base)
    const todosIds = new Set([...idsJaNosRoteiros]);
    clientesAtivos.forEach(c => todosIds.add(c.id));

    const clientesUnicos = [];
    for (const id of todosIds) {
      const c = clientesAtivos.find(x => x.id === id);
      if (c) {
        clientesUnicos.push(c);
      }
    }

    // 6. Distribuir clientes entre os 6 dias (round-robin)
    const distribuicao = {};
    DIAS.forEach(d => { distribuicao[d] = []; });

    clientesUnicos.forEach((c, i) => {
      const dia = DIAS[i % 6];
      distribuicao[dia].push(c);
    });

    // 7. Criar/atualizar roteiros
    const resultado = [];

    for (const dia of DIAS) {
      const clientesDoDia = distribuicao[dia];
      const idsDoDia = clientesDoDia.map(c => c.id);

      // Construir detalhes preservando os existentes ou criando novos
      const detalhesDoDia = clientesDoDia.map((c, i) => {
        const existente = clientesJaDetalhados.get(c.id);
        return {
          cliente_id: c.id,
          cliente_nome: existente?.cliente_nome || c.razao_social || '',
          nome_fantasia: existente?.nome_fantasia || c.nome_fantasia || '',
          cliente_codigo: existente?.cliente_codigo || String(c.codigo_interno || ''),
          cliente_cidade: existente?.cliente_cidade || c.cidade || '',
          cliente_bairro: existente?.cliente_bairro || c.bairro || '',
          cliente_endereco: existente?.cliente_endereco || c.endereco || '',
          cliente_telefone: existente?.cliente_telefone || c.telefone || '',
          ordem: i + 1
        };
      });

      // Buscar roteiro existente para este dia
      let roteiro = roteirosExistentes.find(r => r.dia_semana === dia);

      if (roteiro) {
        // Atualizar roteiro existente
        await base44.asServiceRole.entities.Roteiro.update(roteiro.id, {
          clientes_ids: idsDoDia,
          clientes_detalhes: detalhesDoDia,
          status: 'ativo',
          ativo: true
        });
        resultado.push({ dia, acao: 'atualizado', roteiro_id: roteiro.id, clientes: idsDoDia.length });
      } else {
        // Criar novo roteiro
        const novo = await base44.asServiceRole.entities.Roteiro.create({
          vendedor_id: VENDEDOR_ID,
          vendedor_nome: vendedor.nome || 'GESSICA EDVANIA DE SOUSA',
          dia_semana: dia,
          clientes_ids: idsDoDia,
          clientes_detalhes: detalhesDoDia,
          status: 'ativo',
          ativo: true
        });
        resultado.push({ dia, acao: 'criado', roteiro_id: novo.id, clientes: idsDoDia.length });
      }
    }

    return Response.json({
      sucesso: true,
      vendedor: { id: vendedor.id, nome: vendedor.nome },
      total_clientes: clientesUnicos.length,
      resultado
    });

  } catch (error) {
    console.error('[reconstruirRoteirosGessica] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});