import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

// Environment-First SEM cache: Deno.env é atômico e sem TTL — nunca serve chave velha durante
// troca de credencial. ConfiguracaoOmie é só fallback.
async function getOmieCredentials(base44: any) {
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { appKey: envKey, appSecret: envSecret };
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  return { appKey: envKey || String(cfg?.app_key || '').trim(), appSecret: envSecret || String(cfg?.app_secret || '').trim() };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
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
      // Tratamento de status HTTP ANTES de res.json() — num 5xx/429 o corpo não costuma ser JSON.
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        const corpo = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
        if (res.status === 425) {
          const _cbId = '6a1e06a9aa62ceab7b3b6d97';
          const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []);
          const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
          const _p: any = { erros_consecutivos: _erros, ultimo_erro: lastErr.slice(0, 500), atualizado_em: new Date().toISOString() };
          if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null);
          throw new Error(lastErr);
        }
        if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        throw new Error(lastErr);
      }
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

const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
const OMIE_URL_TABELA = "https://app.omie.com.br/api/v1/produtos/tabelaprecos/";
const OMIE_URL_PRODUTO = "https://app.omie.com.br/api/v1/geral/produtos/";

const delay = (ms) => new Promise(r => setTimeout(r, ms));


// Lista produtos do Omie com paginação
async function listarProdutosOmie(base44) {
  const todos = [];
  let pagina = 1, total = 1;
  while (pagina <= total) {
    const data = await omieCall(base44, 'geral/produtos/', {
      pagina, registros_por_pagina: 50, apenas_importado_api: "N", filtrar_apenas_omiepdv: "N"
    }, { call: 'ListarProdutos' });
    await delay(1100);
    if (data.faultstring) throw new Error(`ListarProdutos: ${data.faultstring}`);
    total = data.total_de_paginas || 1;
    if (data.produto_servico_cadastro) todos.push(...data.produto_servico_cadastro);
    pagina++;
  }
  return todos;
}

async function listarTabelasOmie(base44) {
  const todas = [];
  let pagina = 1, total = 1;
  while (pagina <= total) {
    const data = await omieCall(base44, 'produtos/tabelaprecos/', { nPagina: pagina, nRegPorPagina: 50 }, { call: 'ListarTabelasPreco' });
    await delay(1100);
    if (data.faultstring) throw new Error(`ListarTabelasPreco: ${data.faultstring}`);
    total = data.nTotPaginas || 1;
    if (data.listaTabelasPreco) todas.push(...data.listaTabelasPreco);
    pagina++;
  }
  return todas;
}

async function listarItensTabela(base44, nCodTabPreco) {
  const todos = [];
  let pagina = 1, total = 1;
  while (pagina <= total) {
    const data = await omieCall(base44, 'produtos/tabelaprecos/', {
      nPagina: pagina, nRegPorPagina: 50, nCodTabPreco
    }, { call: 'ListarTabelaItens' });
    await delay(1100);
    if (data.faultstring) {
      if (/nenhum/i.test(data.faultstring)) return [];
      throw new Error(`ListarTabelaItens: ${data.faultstring}`);
    }
    total = data.nTotPaginas || 1;
    // Resposta real: listaTabelaPreco.itensTabela (não itensTabela direto)
    const itens = data.listaTabelaPreco?.itensTabela || data.itensTabela || [];
    if (itens.length) todos.push(...itens);
    pagina++;
  }
  return todos;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { etapa } = body; // "produtos" | "tabelas" | "precos"

    // ============================================================
    // ETAPA 1: Vincular produtos (grava codigo_omie nos Produtos)
    // ============================================================
    if (etapa === "produtos") {
      const produtosOmie = await listarProdutosOmie(base44);
      const produtosBase44 = await base44.asServiceRole.entities.Produto.list('', 10000);

      let vinculados = 0, naoEncontrados = 0;
      const naoEncontradosList = [];

      for (const pOmie of produtosOmie) {
        const codigo = String(pOmie.codigo || '').trim();
        if (!codigo) continue;
        const local = produtosBase44.find(p => String(p.codigo).trim() === codigo);
        if (!local) {
          naoEncontrados++;
          naoEncontradosList.push({ codigo, descricao: pOmie.descricao });
          continue;
        }
        await base44.asServiceRole.entities.Produto.update(local.id, {
          codigo_omie: String(pOmie.codigo_produto)
        });
        vinculados++;
      }

      return Response.json({
        sucesso: true,
        total_omie: produtosOmie.length,
        vinculados,
        nao_encontrados: naoEncontrados,
        nao_encontrados_amostra: naoEncontradosList.slice(0, 10)
      });
    }

    // ============================================================
    // ETAPA 2: Vincular tabelas (grava omie_id nas TabelaPreco)
    // ============================================================
    if (etapa === "tabelas") {
      const tabelasOmie = await listarTabelasOmie(base44);
      const tabelasBase44 = await base44.asServiceRole.entities.TabelaPreco.list('', 1000);

      let vinculadas = 0, criadas = 0;
      for (const tOmie of tabelasOmie) {
        const nome = (tOmie.cNome || '').trim();
        const omieId = tOmie.nCodTabPreco;
        const codInt = tOmie.cCodIntTabPreco || '';
        const ativo = tOmie.cAtiva === 'S';

        let existente = tabelasBase44.find(t => t.omie_id === omieId);
        if (!existente) {
          existente = tabelasBase44.find(t => (t.nome || '').trim().toUpperCase() === nome.toUpperCase());
        }

        if (existente) {
          await base44.asServiceRole.entities.TabelaPreco.update(existente.id, {
            nome, status: ativo ? 'ativo' : 'inativo', omie_id: omieId, omie_cod_int: codInt
          });
          vinculadas++;
        } else {
          const nova = await base44.asServiceRole.entities.TabelaPreco.create({
            nome, status: ativo ? 'ativo' : 'inativo', omie_id: omieId, omie_cod_int: codInt
          });
          tabelasBase44.push({ ...nova, omie_id: omieId });
          criadas++;
        }
      }

      return Response.json({
        sucesso: true,
        total_omie: tabelasOmie.length,
        vinculadas,
        criadas
      });
    }

    // ============================================================
    // ETAPA 3: Importar preços de TODAS as tabelas vinculadas
    // ============================================================
    if (etapa === "precos") {
      // Processa APENAS as tabelas passadas em tabela_ids (ou lote a partir do índice)
      const { tabela_ids, inicio = 0, quantidade = 5, limpar_antes = false } = body;

      const tabelas = await base44.asServiceRole.entities.TabelaPreco.list('', 1000);
      let tabelasVinculadas = tabelas.filter(t => t.omie_id);

      if (tabela_ids && tabela_ids.length > 0) {
        tabelasVinculadas = tabelasVinculadas.filter(t => tabela_ids.includes(t.id));
      } else {
        tabelasVinculadas = tabelasVinculadas.slice(inicio, inicio + quantidade);
      }

      const produtos = await base44.asServiceRole.entities.Produto.list('', 10000);
      const mapaProdutoPorCodigo = new Map();
      for (const p of produtos) {
        if (p.codigo) mapaProdutoPorCodigo.set(String(p.codigo).trim(), p.id);
      }

      const resumo = [];
      let totalCriados = 0, totalAtualizados = 0, totalIgnorados = 0;

      for (const tabela of tabelasVinculadas) {
        const itens = await listarItensTabela(base44, tabela.omie_id);

        // Opcional: limpar preços antigos desta tabela (para espelhar 100% o Omie)
        if (limpar_antes) {
          const antigos = await base44.asServiceRole.entities.PrecoProduto.filter({ tabela_id: tabela.id });
          for (const a of antigos) await base44.asServiceRole.entities.PrecoProduto.delete(a.id);
        }

        const precosExistentes = limpar_antes ? [] : await base44.asServiceRole.entities.PrecoProduto.filter({ tabela_id: tabela.id });
        const mapaPrecoPorProduto = new Map();
        for (const pe of precosExistentes) mapaPrecoPorProduto.set(pe.produto_id, pe);

        let criados = 0, atualizados = 0, ignorados = 0;
        const novos = [];

        for (const item of itens) {
          const codigoInterno = String(item.cCodigoProduto || '').trim();
          const valor = Number(item.nValorTabela || 0);
          const produtoId = mapaProdutoPorCodigo.get(codigoInterno);
          if (!produtoId) { ignorados++; continue; }

          const existente = mapaPrecoPorProduto.get(produtoId);
          if (existente) {
            await base44.asServiceRole.entities.PrecoProduto.update(existente.id, {
              valor_unitario: valor, omie_sincronizado: true
            });
            atualizados++;
          } else {
            novos.push({
              produto_id: produtoId,
              tabela_id: tabela.id,
              valor_unitario: valor,
              valor_acao: 0,
              ativacao_acao: false,
              omie_sincronizado: true
            });
            criados++;
          }
        }

        if (novos.length > 0) {
          const chunkSize = 50;
          for (let i = 0; i < novos.length; i += chunkSize) {
            await base44.asServiceRole.entities.PrecoProduto.bulkCreate(novos.slice(i, i + chunkSize));
          }
        }

        totalCriados += criados;
        totalAtualizados += atualizados;
        totalIgnorados += ignorados;
        resumo.push({ tabela: tabela.nome, itens_omie: itens.length, criados, atualizados, ignorados });
      }

      const totalTabelasVinculadas = tabelas.filter(t => t.omie_id).length;
      const proximoInicio = inicio + quantidade;
      const concluido = tabela_ids ? true : proximoInicio >= totalTabelasVinculadas;

      return Response.json({
        sucesso: true,
        tabelas_processadas: tabelasVinculadas.length,
        total_criados: totalCriados,
        total_atualizados: totalAtualizados,
        total_ignorados: totalIgnorados,
        concluido,
        proximo_inicio: concluido ? null : proximoInicio,
        total_tabelas: totalTabelasVinculadas,
        resumo
      });
    }

    return Response.json({ error: 'etapa inválida. Use: produtos | tabelas | precos' }, { status: 400 });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err.message }, { status: 500 });
  }
});