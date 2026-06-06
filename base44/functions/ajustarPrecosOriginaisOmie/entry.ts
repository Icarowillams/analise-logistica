import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.omie_app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.omie_app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
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
          const until = new Date(Date.now() + 30 * 60000).toISOString();
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create({ chave: 'principal', bloqueado: true, bloqueado_ate: until, ultimo_erro: data.faultstring, atualizado_em: new Date().toISOString() }).catch(() => null);
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
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
const OMIE_URL_PRODUTO = "https://app.omie.com.br/api/v1/geral/produtos/";
const OMIE_URL_TABELA = "https://app.omie.com.br/api/v1/produtos/tabelaprecos/";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Verifica circuit breaker antes de iniciar o lote — aborta cedo se a API Omie estiver bloqueada (425).
async function checarBloqueioOmie(base44) {
  const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
    const err = new Error(`API Omie temporariamente bloqueada por consumo indevido. Desbloqueio previsto: ${new Date(controle.bloqueado_ate).toLocaleString('pt-BR')}.`);
    err.code = 'OMIE_425';
    err.bloqueado_ate = controle.bloqueado_ate;
    throw err;
  }
  return controle;
}

// Registra bloqueio 30min quando o Omie retorna 425/consumo indevido.
async function registrarBloqueio425(base44, controle, faultstring) {
  const bloqueadoAte = new Date(Date.now() + 30 * 60000).toISOString();
  const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: bloqueadoAte, ultimo_erro: faultstring || 'HTTP 425 consumo indevido', atualizado_em: new Date().toISOString() };
  if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {});
  else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
  await base44.asServiceRole.entities.LogIntegracaoOmie.create({
    endpoint: 'ajustarPrecosOriginaisOmie', call: 'AlterarPrecoItem', operacao: 'ajustar_precos', status: 'erro', codigo_erro: '425',
    mensagem_erro: faultstring || 'HTTP 425 — consumo indevido'
  }).catch(() => {});
  const err = new Error(`API Omie bloqueada por consumo indevido (HTTP 425). Desbloqueio previsto: ${new Date(bloqueadoAte).toLocaleString('pt-BR')}.`);
  err.code = 'OMIE_425';
  err.bloqueado_ate = bloqueadoAte;
  return err;
}


async function buscarProdutoOmie(base44, controle, codigoIntegracao) {
    const result = await omieCall(base44, controle, OMIE_URL_PRODUTO, "ConsultarProduto", {
        codigo_produto_integracao: codigoIntegracao
    });
    if (result.faultstring) return null;
    return result;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
        }

        const body = await req.json();
        const { acao, tabela_ids, lote_inicio = 0, lote_tamanho = 5 } = body;

        // Circuit breaker — aborta o lote se a API estiver bloqueada por consumo indevido (425)
        const controle = await checarBloqueioOmie(base44);

        // ======================================================
        // AÇÃO 1: Definir Preço Original = R$ 1,00 para todos
        // ======================================================
        if (acao === "definir_preco_original") {
            const { produto_ids } = body;

            if (!produto_ids || produto_ids.length === 0) {
                return Response.json({ error: 'Informe os IDs dos produtos' }, { status: 400 });
            }

            const produtos = await base44.asServiceRole.entities.Produto.list();
            const lote = produto_ids.slice(lote_inicio, lote_inicio + lote_tamanho);

            if (lote.length === 0) {
                return Response.json({ concluido: true, resultados: [] });
            }

            const resultados = [];

            for (const prodId of lote) {
                const produto = produtos.find(p => p.id === prodId);
                if (!produto) {
                    resultados.push({ produto_id: prodId, sucesso: false, mensagem: "Produto não encontrado no sistema" });
                    continue;
                }

                // Buscar produto no Omie
                const prodOmie = await buscarProdutoOmie(base44, controle, produto.id);
                await delay(1500);

                if (!prodOmie) {
                    resultados.push({ 
                        produto_id: produto.id, produto_nome: produto.nome,
                        sucesso: false, mensagem: "Produto não encontrado no Omie" 
                    });
                    continue;
                }

                // Alterar o valor_unitario (preço original) para 1.00
                const alterResult = await omieCall(base44, controle, OMIE_URL_PRODUTO, "AlterarProduto", {
                    codigo_produto: prodOmie.codigo_produto,
                    codigo_produto_integracao: produto.id,
                    codigo: prodOmie.codigo,
                    descricao: prodOmie.descricao,
                    unidade: prodOmie.unidade || "UN",
                    ncm: prodOmie.ncm || "19059090",
                    valor_unitario: 1.00
                });
                await delay(2000);

                if (alterResult.faultstring) {
                    resultados.push({
                        produto_id: produto.id, produto_nome: produto.nome,
                        sucesso: false, mensagem: alterResult.faultstring
                    });
                } else {
                    resultados.push({
                        produto_id: produto.id, produto_nome: produto.nome,
                        sucesso: true, mensagem: "Preço original definido como R$ 1,00"
                    });
                }
            }

            const proximoLote = lote_inicio + lote_tamanho;
            const concluido = proximoLote >= produto_ids.length;

            return Response.json({
                concluido,
                proximo_lote: concluido ? null : proximoLote,
                total: produto_ids.length,
                processados: Math.min(proximoLote, produto_ids.length),
                resultados
            });
        }

        // ======================================================
        // AÇÃO 2: Exportar preços das tabelas usando % acréscimo
        // Preço Original = R$ 1,00
        // Preço Tabela desejado = valor_unitario do Base44
        // % Acréscimo = (valor_desejado - 1) * 100
        // Ex: quero R$ 5,00 → acréscimo = 400%
        // ======================================================
        if (acao === "exportar_precos_percentual") {
            if (!tabela_ids || tabela_ids.length === 0) {
                return Response.json({ error: 'Informe os IDs das tabelas' }, { status: 400 });
            }

            const [tabelas, precos, produtos] = await Promise.all([
                base44.asServiceRole.entities.TabelaPreco.list(),
                base44.asServiceRole.entities.PrecoProduto.list(),
                base44.asServiceRole.entities.Produto.list()
            ]);

            const tabelasParaExportar = tabelas.filter(t => tabela_ids.includes(t.id));
            const resultados = [];

            // Processar 1 tabela por vez
            const tabela = tabelasParaExportar[lote_inicio];
            if (!tabela) {
                return Response.json({ concluido: true, resultados: [] });
            }

            if (!tabela.omie_id) {
                return Response.json({
                    concluido: false,
                    proximo_lote: lote_inicio + 1,
                    total_tabelas: tabelasParaExportar.length,
                    resultados: [{
                        tabela_id: tabela.id, tabela_nome: tabela.nome,
                        sucesso: false, mensagem: "Tabela não vinculada ao Omie. Exporte a tabela primeiro.",
                        itens: []
                    }]
                });
            }

            const precosTabela = precos.filter(p => p.tabela_id === tabela.id);
            const itensResultados = [];

            for (const preco of precosTabela) {
                const produto = produtos.find(p => p.id === preco.produto_id);
                if (!produto) continue;

                // Buscar nCodProd no Omie
                const prodOmie = await buscarProdutoOmie(base44, controle, produto.id);
                await delay(1500);

                if (!prodOmie) {
                    itensResultados.push({
                        produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
                        sucesso: false, mensagem: "Produto não encontrado no Omie"
                    });
                    continue;
                }

                const nCodProd = prodOmie.codigo_produto;

                // Determinar o valor desejado na tabela
                const valorDesejado = (preco.ativacao_acao && preco.valor_acao > 0) 
                    ? preco.valor_acao 
                    : (preco.valor_unitario || 0);

                if (valorDesejado <= 0) {
                    itensResultados.push({
                        produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
                        sucesso: false, mensagem: "Preço zero ou negativo, ignorado."
                    });
                    continue;
                }

                // Calcular % de acréscimo: preço original = R$ 1,00
                // valorDesejado = 1 * (1 + percAcrescimo/100)
                // percAcrescimo = (valorDesejado - 1) * 100
                const percAcrescimo = Number(((valorDesejado - 1) * 100).toFixed(4));

                // AlterarPrecoItem com nPercAcrescimo em vez de nValorTabela
                const itemResult = await omieCall(base44, controle, OMIE_URL_TABELA, "AlterarPrecoItem", {
                    nCodTabPreco: tabela.omie_id,
                    nCodProd: nCodProd,
                    nPercAcrescimo: percAcrescimo
                });
                await delay(2000);

                const sucesso = !itemResult.faultstring;

                if (sucesso) {
                    await base44.asServiceRole.entities.PrecoProduto.update(preco.id, { omie_sincronizado: true });
                }

                itensResultados.push({
                    produto_id: produto.id, produto_nome: produto.nome, produto_codigo: produto.codigo,
                    valor_desejado: valorDesejado, perc_acrescimo: percAcrescimo,
                    sucesso, mensagem: itemResult.faultstring || `Preço R$ ${valorDesejado.toFixed(2)} (acréscimo ${percAcrescimo.toFixed(2)}%)`
                });
            }

            const itensOk = itensResultados.filter(i => i.sucesso).length;
            const itensErro = itensResultados.filter(i => !i.sucesso).length;

            resultados.push({
                tabela_id: tabela.id, tabela_nome: tabela.nome,
                sucesso: true,
                mensagem: `${itensOk} preços atualizados, ${itensErro} erros.`,
                itens: itensResultados
            });

            const proximoLote = lote_inicio + 1;
            const concluido = proximoLote >= tabelasParaExportar.length;

            return Response.json({
                concluido,
                proximo_lote: concluido ? null : proximoLote,
                total_tabelas: tabelasParaExportar.length,
                resultados
            });
        }

        return Response.json({ error: `Ação "${acao}" não reconhecida` }, { status: 400 });

    } catch (error) {
        const bloqueada = error?.code === 'OMIE_425';
        return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
    }
});