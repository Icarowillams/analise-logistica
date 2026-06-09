import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [1000, 2000, 4000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || options.timeout || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          { const _cbId = '6a1e06a9aa62ceab7b3b6d97'; const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null); }
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update('6a1e06a9aa62ceab7b3b6d97', { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (e: any) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL_TABELA = "https://app.omie.com.br/api/v1/produtos/tabelaprecos/";
const OMIE_URL_PRODUTO = "https://app.omie.com.br/api/v1/geral/produtos/";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function logOmie(base44, payload) {
  try { await base44.asServiceRole.entities.LogIntegracaoOmie.create(payload); } catch (_) {}
}


async function listarTabelasOmie(base44) {
  const todasTabelas = [];
  let pagina = 1;
  let totalPaginas = 1;
  while (pagina <= totalPaginas) {
    const data = await omieCall(base44, 'produtos/tabelaprecos/', {
      nPagina: pagina, nRegPorPagina: 50
    }, { call: 'ListarTabelasPreco' });
    await delay(1000);
    if (data.faultstring) throw new Error(`Erro ao listar tabelas Omie: ${data.faultstring}`);
    totalPaginas = data.nTotPaginas || 1;
    if (data.listaTabelasPreco) todasTabelas.push(...data.listaTabelasPreco);
    pagina++;
  }
  return todasTabelas;
}

async function listarItensTabela(base44, nCodTabPreco, cCodIntTabPreco) {
  const todosItens = [];
  let pagina = 1;
  let totalPaginas = 1;
  while (pagina <= totalPaginas) {
    const param = { nPagina: pagina, nRegPorPagina: 50 };
    if (nCodTabPreco) param.nCodTabPreco = nCodTabPreco;
    if (cCodIntTabPreco) param.cCodIntTabPreco = cCodIntTabPreco;
    const data = await omieCall(base44, 'produtos/tabelaprecos/', param, { call: 'ListarTabelaItens' });
    await delay(1000);
    if (data.faultstring) {
      if (/nenhum/i.test(data.faultstring)) return [];
      throw new Error(`Erro ao listar itens: ${data.faultstring}`);
    }
    totalPaginas = data.nTotPaginas || 1;
    if (data.itensTabela) todosItens.push(...data.itensTabela);
    pagina++;
  }
  return todosItens;
}

async function consultarProdutoOmiePorId(base44, nCodProd) {
  const data = await omieCall(base44, 'geral/produtos/', { codigo_produto: nCodProd }, { call: 'ConsultarProduto' });
  if (data.faultstring) return null;
  return data;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
    }

    const body = await req.json();
    const { acao } = body;

    // ==========================================
    // IMPORTAR TABELAS DO OMIE → BASE44
    // ==========================================
    if (acao === "importar_tabelas") {
      const tabelasOmie = await listarTabelasOmie(base44);
      const tabelasBase44 = await base44.asServiceRole.entities.TabelaPreco.list();
      const resultados = [];
      let criadas = 0, atualizadas = 0;

      for (const tOmie of tabelasOmie) {
        const omieId = tOmie.nCodTabPreco;
        const codInt = tOmie.cCodIntTabPreco || "";
        const nome = tOmie.cNome || "";
        const ativo = tOmie.cAtiva === "S";

        let existente = tabelasBase44.find(t => t.omie_id === omieId || (t.omie_cod_int && t.omie_cod_int === codInt));
        if (!existente) {
          existente = tabelasBase44.find(t => t.nome?.trim().toUpperCase() === nome.trim().toUpperCase() && !t.omie_id);
        }

        if (existente) {
          await base44.asServiceRole.entities.TabelaPreco.update(existente.id, {
            nome, status: ativo ? "ativo" : "inativo", omie_id: omieId, omie_cod_int: codInt
          });
          atualizadas++;
          resultados.push({ nome, omie_id: omieId, status: "atualizada" });
        } else {
          await base44.asServiceRole.entities.TabelaPreco.create({
            nome, status: ativo ? "ativo" : "inativo", omie_id: omieId, omie_cod_int: codInt
          });
          criadas++;
          resultados.push({ nome, omie_id: omieId, status: "criada" });
        }
        await delay(200);
      }

      await logOmie(base44, {
        endpoint: 'produtos/tabelaprecos', call: 'ListarTabelasPreco',
        operacao: 'importar_tabelas', status: 'sucesso',
        mensagem_erro: `${criadas} criadas, ${atualizadas} atualizadas, ${tabelasOmie.length} total`,
        usuario_email: user.email
      });

      return Response.json({
        sucesso: true, mensagem: `${criadas} tabelas criadas, ${atualizadas} atualizadas.`,
        total_omie: tabelasOmie.length, resultados
      });
    }

    // ==========================================
    // EXPORTAR TABELA DO BASE44 → OMIE (cabeçalho)
    // ==========================================
    if (acao === "exportar_tabela") {
      const { tabela_id } = body;
      if (!tabela_id) return Response.json({ error: "tabela_id obrigatório" }, { status: 400 });

      const tabelas = await base44.asServiceRole.entities.TabelaPreco.list();
      const tabela = tabelas.find(t => t.id === tabela_id);
      if (!tabela) return Response.json({ error: "Tabela não encontrada" }, { status: 404 });

      const codInt = (tabela.omie_cod_int || `TP${tabela.id}`).substring(0, 20);
      let nCodTabPreco = tabela.omie_id || null;

      // Verificar se já existe no Omie
      if (!nCodTabPreco) {
        const consulta = await omieCall(base44, 'produtos/tabelaprecos/', { cCodIntTabPreco: codInt }, { call: 'ConsultarTabelaPreco' });
        await delay(1000);
        if (!consulta.faultstring) nCodTabPreco = consulta.nCodTabPreco;
      }

      const payload = {
        cCodIntTabPreco: codInt,
        cNome: tabela.nome,
        cCodigo: tabela.nome.substring(0, 20).toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
        cOrigem: "CMC",
        produtos: { cTodosProdutos: "S" },
        clientes: { cTodosClientes: "S" },
        outrasInfo: { nCodOrigTab: 0, nPercAcrescimo: 0, nPercDesconto: 0 },
        caracteristicas: { cTemValidade: "N", cTemDesconto: "N", cArredPreco: "N" }
      };
      if (nCodTabPreco) payload.nCodTabPreco = nCodTabPreco;

      const callUsada = nCodTabPreco ? "AlterarTabelaPreco" : "IncluirTabelaPreco";
      const t0_tab = Date.now();
      let tabelaResult = await omieCall(base44, 'produtos/tabelaprecos/', payload, { call: callUsada });
      let duracao_ms = Date.now() - t0_tab;
      await delay(1500);

      // Tabela obsoleta no Omie — recriar
      if (tabelaResult.faultstring && nCodTabPreco &&
          /não cadastrada|nao cadastrada/i.test(tabelaResult.faultstring)) {
        delete payload.nCodTabPreco;
        tabelaResult = await omieCall(base44, 'produtos/tabelaprecos/', payload, { call: 'IncluirTabelaPreco' });
        await delay(1500);
        nCodTabPreco = null;
      }

      // Já cadastrada — buscar ID
      if (tabelaResult.faultstring && /já cadastrad/i.test(tabelaResult.faultstring)) {
        const c = await omieCall(base44, 'produtos/tabelaprecos/', { cCodIntTabPreco: codInt }, { call: 'ConsultarTabelaPreco' });
        await delay(1000);
        if (!c.faultstring) {
          nCodTabPreco = c.nCodTabPreco;
        } else {
          await logOmie(base44, {
            endpoint: 'produtos/tabelaprecos', call: callUsada, operacao: 'exportar_tabela',
            entidade_tipo: 'TabelaPreco', entidade_id: tabela.id, status: 'erro',
            codigo_erro: tabelaResult.faultcode, mensagem_erro: tabelaResult.faultstring,
            payload_enviado: JSON.stringify(payload).slice(0, 3000), duracao_ms,
            usuario_email: user.email
          });
          return Response.json({ sucesso: false, erro: tabelaResult.faultstring });
        }
      } else if (tabelaResult.faultstring) {
        await logOmie(base44, {
          endpoint: 'produtos/tabelaprecos', call: callUsada, operacao: 'exportar_tabela',
          entidade_tipo: 'TabelaPreco', entidade_id: tabela.id, status: 'erro',
          codigo_erro: tabelaResult.faultcode, mensagem_erro: tabelaResult.faultstring,
          payload_enviado: JSON.stringify(payload).slice(0, 3000), duracao_ms,
          usuario_email: user.email
        });
        return Response.json({ sucesso: false, erro: tabelaResult.faultstring });
      } else {
        nCodTabPreco = tabelaResult.nCodTabPreco || nCodTabPreco;
      }

      const omieIdFinal = nCodTabPreco;

      // Salvar vínculo
      await base44.asServiceRole.entities.TabelaPreco.update(tabela.id, {
        omie_id: omieIdFinal, omie_cod_int: codInt
      });

      // Popular produtos padrão e ativar
      await omieCall(base44, 'produtos/tabelaprecos/', { nCodTabPreco: omieIdFinal, cCodIntTabPreco: codInt }, { call: 'AtualizarProdutos' });
      await delay(3000);
      await omieCall(base44, 'produtos/tabelaprecos/', { nCodTabPreco: omieIdFinal, cCodIntTabPreco: codInt }, { call: 'AtivarTabelaPreco' });
      await delay(2000);

      await logOmie(base44, {
        endpoint: 'produtos/tabelaprecos', call: callUsada, operacao: 'exportar_tabela',
        entidade_tipo: 'TabelaPreco', entidade_id: tabela.id, status: 'sucesso',
        payload_enviado: JSON.stringify(payload).slice(0, 3000), duracao_ms,
        usuario_email: user.email
      });

      return Response.json({
        sucesso: true, omie_id: omieIdFinal, omie_cod_int: codInt,
        mensagem: "Tabela exportada/atualizada no Omie"
      });
    }

    // ==========================================
    // EXPORTAR PREÇOS DE UMA TABELA → OMIE (em lotes)
    // ==========================================
    if (acao === "exportar_precos") {
      const { tabela_id, lote_inicio = 0, lote_tamanho = 5, omie_id_override } = body;
      if (!tabela_id) return Response.json({ error: "tabela_id obrigatório" }, { status: 400 });

      const tabelas = await base44.asServiceRole.entities.TabelaPreco.list();
      const tabela = tabelas.find(t => t.id === tabela_id);
      const omieIdTabela = omie_id_override || tabela?.omie_id;

      if (!tabela || !omieIdTabela) {
        return Response.json({ error: "Tabela não vinculada ao Omie" }, { status: 400 });
      }

      const [precos, produtos] = await Promise.all([
        base44.asServiceRole.entities.PrecoProduto.filter({ tabela_id: tabela.id }),
        base44.asServiceRole.entities.Produto.list()
      ]);

      const lote = precos.slice(lote_inicio, lote_inicio + lote_tamanho);
      const itensResultados = [];
      const isAuxiliar = tabela?.nome?.toUpperCase().includes('TABELA AUXILIAR');

      for (const preco of lote) {
        const produto = produtos.find(p => p.id === preco.produto_id);
        if (!produto) {
          itensResultados.push({ produto_id: preco.produto_id, sucesso: false, mensagem: "Produto não encontrado no sistema" });
          continue;
        }

        // Usar codigo_omie já gravado (muito mais rápido que ConsultarProduto)
        const nCodProd = produto.codigo_omie ? Number(produto.codigo_omie) : null;
        if (!nCodProd) {
          itensResultados.push({
            produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
            sucesso: false, mensagem: "Produto sem codigo_omie. Sincronize os produtos primeiro."
          });
          continue;
        }

        let valorAtual = (preco.ativacao_acao && preco.valor_acao > 0) ? preco.valor_acao : (preco.valor_unitario || 0);

        // Preço zero ignorado (exceto TABELA AUXILIAR — usa R$0,01 para cadastrar)
        if (valorAtual <= 0 && !isAuxiliar) {
          itensResultados.push({
            produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
            sucesso: false, mensagem: "Preço zero, ignorado."
          });
          continue;
        }
        if (valorAtual <= 0 && isAuxiliar) valorAtual = 0.01;

        // Tentar AlterarPrecoItem
        let itemResult = await omieCall(base44, 'produtos/tabelaprecos/', {
             nCodTabPreco: omieIdTabela, nCodProd, nValorTabela: Number(valorAtual.toFixed(2))
          }, { call: 'AlterarPrecoItem' });
        await delay(1200);

        // Se produto não está na tabela, incluir e tentar novamente
        if (itemResult.faultstring &&
            /não encontrado|não localizado|nao encontrado|não cadastrado na Tabela|nao cadastrado na Tabela/i.test(itemResult.faultstring)) {

          const inclResult = await omieCall(base44, 'produtos/tabelaprecos/', {
            nCodTabPreco: omieIdTabela, nCodProd
          }, { call: 'IncluirProdutoTabPreco' });
          await delay(1500);

          if (inclResult.faultstring && !/já cadastrad/i.test(inclResult.faultstring)) {
            // Fallback: AtualizarProdutos (re-sincroniza toda a tabela)
            const codIntTabela = (tabela.omie_cod_int || `TP${tabela.id}`).substring(0, 20);
            await omieCall(base44, 'produtos/tabelaprecos/', {
              nCodTabPreco: omieIdTabela, cCodIntTabPreco: codIntTabela
            }, { call: 'AtualizarProdutos' });
            await delay(2500);
          }

          itemResult = await omieCall(base44, 'produtos/tabelaprecos/', {
            nCodTabPreco: omieIdTabela, nCodProd, nValorTabela: Number(valorAtual.toFixed(2))
          }, { call: 'AlterarPrecoItem' });
          await delay(1500);
        }

        const sucesso = !itemResult.faultstring;
        try {
          await base44.asServiceRole.entities.PrecoProduto.update(preco.id, {
            preco_omie_sincronizado: sucesso ? 'sim' : 'nao'
          });
        } catch (_) {}

        itensResultados.push({
          produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
          valor: valorAtual, sucesso, mensagem: itemResult.faultstring || "Preço atualizado no Omie"
        });
      }

      const proximoLote = lote_inicio + lote_tamanho;
      const concluido = proximoLote >= precos.length;

      return Response.json({
        sucesso: true, concluido,
        proximo_lote: concluido ? null : proximoLote,
        total_precos: precos.length,
        processados: Math.min(proximoLote, precos.length),
        itens: itensResultados
      });
    }

    // ==========================================
    // EXCLUIR TABELA DO OMIE
    // ==========================================
    if (acao === "excluir_tabela") {
      const { tabela_id } = body;
      if (!tabela_id) return Response.json({ error: "tabela_id obrigatório" }, { status: 400 });

      const tabelas = await base44.asServiceRole.entities.TabelaPreco.list();
      const tabela = tabelas.find(t => t.id === tabela_id);
      if (!tabela) return Response.json({ error: "Tabela não encontrada" }, { status: 404 });
      if (!tabela.omie_id && !tabela.omie_cod_int) {
        return Response.json({ error: "Tabela não está vinculada ao Omie" }, { status: 400 });
      }

      const param = {};
      if (tabela.omie_id) param.nCodTabPreco = tabela.omie_id;
      if (tabela.omie_cod_int) param.cCodIntTabPreco = tabela.omie_cod_int;

      const t0_excl = Date.now();
      const result = await omieCall(base44, 'produtos/tabelaprecos/', param, { call: 'ExcluirTabelaPreco' });
      const duracao_ms_excl = Date.now() - t0_excl;
      await delay(1000);

      await logOmie(base44, {
        endpoint: 'produtos/tabelaprecos', call: 'ExcluirTabelaPreco',
        operacao: 'excluir_tabela', entidade_tipo: 'TabelaPreco', entidade_id: tabela.id,
        status: result.faultstring ? 'erro' : 'sucesso',
        codigo_erro: result.faultcode, mensagem_erro: result.faultstring,
        duracao_ms: duracao_ms_excl, usuario_email: user.email
      });

      if (result.faultstring) return Response.json({ sucesso: false, erro: result.faultstring });

      await base44.asServiceRole.entities.TabelaPreco.update(tabela.id, {
        omie_id: null, omie_cod_int: null
      });

      return Response.json({ sucesso: true, mensagem: `Tabela "${tabela.nome}" excluída do Omie` });
    }

    // ==========================================
    // IMPORTAR PREÇOS DO OMIE → BASE44
    // ==========================================
    if (acao === "importar_precos") {
      const { tabela_id } = body;
      if (!tabela_id) return Response.json({ error: "tabela_id obrigatório" }, { status: 400 });

      const tabelas = await base44.asServiceRole.entities.TabelaPreco.list();
      const tabela = tabelas.find(t => t.id === tabela_id);
      if (!tabela || !tabela.omie_id) {
        return Response.json({ error: "Tabela não vinculada ao Omie" }, { status: 400 });
      }

      const itensOmie = await listarItensTabela(base44, tabela.omie_id, tabela.omie_cod_int);
      const [precosBase44, produtos] = await Promise.all([
        base44.asServiceRole.entities.PrecoProduto.filter({ tabela_id: tabela.id }),
        base44.asServiceRole.entities.Produto.list()
      ]);

      let criados = 0, atualizados = 0, naoEncontrados = 0;
      const erros = [];

      for (const item of itensOmie) {
        const nCodProd = item.nCodProd;
        const valorTabela = item.nValorTabela || 0;
        if (valorTabela <= 0) continue;

        // Buscar produto local por codigo_omie gravado
        let produtoBase44 = produtos.find(p => p.codigo_omie && Number(p.codigo_omie) === Number(nCodProd));

        // Fallback: consultar Omie para pegar codigo_produto_integracao
        if (!produtoBase44) {
          const prodOmie = await consultarProdutoOmiePorId(base44, nCodProd);
          await delay(800);
          if (prodOmie?.codigo_produto_integracao) {
            produtoBase44 = produtos.find(p => p.id === prodOmie.codigo_produto_integracao);
          }
          if (!produtoBase44 && prodOmie?.codigo) {
            produtoBase44 = produtos.find(p => p.codigo === prodOmie.codigo);
          }
        }

        if (!produtoBase44) {
          naoEncontrados++;
          erros.push({ nCodProd, valor: valorTabela, erro: "Produto não encontrado no Base44" });
          continue;
        }

        const precoExistente = precosBase44.find(p => p.produto_id === produtoBase44.id);
        if (precoExistente) {
          await base44.asServiceRole.entities.PrecoProduto.update(precoExistente.id, {
            valor_unitario: valorTabela, preco_omie_sincronizado: 'sim'
          });
          atualizados++;
        } else {
          await base44.asServiceRole.entities.PrecoProduto.create({
            produto_id: produtoBase44.id, tabela_id: tabela.id,
            valor_unitario: valorTabela, valor_acao: 0, ativacao_acao: false,
            preco_omie_sincronizado: 'sim'
          });
          criados++;
        }
        await delay(200);
      }

      return Response.json({
        sucesso: true,
        mensagem: `${criados} preços criados, ${atualizados} atualizados, ${naoEncontrados} produtos não encontrados.`,
        total_itens_omie: itensOmie.length, criados, atualizados, nao_encontrados: naoEncontrados, erros
      });
    }

    return Response.json({ error: `Ação "${acao}" não reconhecida.` }, { status: 400 });
  } catch (error) {
    console.error(`[FATAL] ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});