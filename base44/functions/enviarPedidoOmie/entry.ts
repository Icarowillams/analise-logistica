import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = Deno.env.get('OMIE_APP_KEY') || cfg?.app_key || '';
  let appSecret = Deno.env.get('OMIE_APP_SECRET') || cfg?.app_secret || '';
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
      let data = await res.json();
      // Omie às vezes retorna o erro como ARRAY [{CODIGO, MENSAGEM, ORIGEM}] com HTTP 200 — normalizar para faultstring
      if (Array.isArray(data) && data[0] && (data[0].MENSAGEM || data[0].CODIGO !== undefined)) {
        const e0 = data[0];
        data = { faultstring: String(e0.MENSAGEM || `Omie CODIGO ${e0.CODIGO}`), faultcode: String(e0.CODIGO ?? '') };
      }
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          // Extrair tempo real que o Omie informou (ex: "1798 segundos"); se não informou, NÃO bloqueia
          const secsMatch = String(data.faultstring).match(/(\d+)\s*segundo/i);
          const secs = secsMatch ? Math.min(Number(secsMatch[1]), 1800) : 0;
          { const _cbId = '6a1e06a9aa62ceab7b3b6d97'; const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh && secs > 0) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + secs * 1000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null); }
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId, payload_enviado: (() => { try { return JSON.stringify(param).slice(0, 8000); } catch { return ''; } })(), payload_resposta: (() => { try { return JSON.stringify(data).slice(0, 4000); } catch { return ''; } })() }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update('6a1e06a9aa62ceab7b3b6d97', { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (e: any) {
      lastErr = e.message;
      const isTimeoutOuRede = e.name === 'AbortError' || /network|fetch failed|connection|econn|socket/i.test(e.message || '');
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      // ESCRITA + timeout/erro de rede: o Omie PODE já ter criado o registro mas a resposta
      // não voltou. NUNCA reenviar cegamente (gera pedido duplicado). Lança erro marcado para
      // o caller verificar idempotência (ConsultarPedido por codigo_pedido_integracao) antes de recriar.
      if (options.isWrite && isTimeoutOuRede) {
        const err: any = new Error(lastErr);
        err.timeoutEscrita = true;
        throw err;
      }
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";
const OMIE_CLIENTES_URL = "https://app.omie.com.br/api/v1/geral/clientes/";
const OMIE_CC_URL = "https://app.omie.com.br/api/v1/geral/contacorrente/";
const CONTA_CORRENTE_PADRAO = 11464371392; // Centralizado em constantes.ts

// ============================================================
// HELPER OMIE — rate-limit aware (240 req/min, 4 concurrent, redundância 60s, 425 = bloqueio 30min)
// ============================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Log de debug: grava em console + entidade LogIntegracaoOmie (transparência do fluxo)
function debugLog(base44, mensagem, extra = {}) {
  console.log(mensagem);
  // FIRE-AND-FORGET: não usa await para não bloquear o envio do pedido
  base44.asServiceRole.entities.LogIntegracaoOmie.create({
    endpoint: 'enviarPedidoOmie:debug',
    payload_envio: JSON.stringify(extra).slice(0, 2000),
    payload_resposta: mensagem.slice(0, 2000),
    sucesso: !extra.erro,
    erro: extra.erro || null,
    created_date: new Date().toISOString()
  }).catch(() => {});
}

let _contaCorrenteCache = null; // TTL: vida do worker (máx 30s no _shared)
let _unidadesCache = null;
async function resolverContaCorrentePadrao(base44) {
    if (_contaCorrenteCache) return _contaCorrenteCache;
    try {
        const cc = await omieCall(base44, "geral/contacorrente/", { pagina: 1, registros_por_pagina: 50 }, { call: 'ListarContasCorrentes', operation: 'ListarContasCorrentes', skipLog: true });
        const lista = cc?.ListarContasCorrentes || cc?.conta_corrente_lista || [];
        if (lista.length > 0) {
            const padrao = lista.find(c => c.cPadrao === "S" || c.padrao === "S") || lista[0];
            _contaCorrenteCache = padrao.nCodCC || padrao.codigo || CONTA_CORRENTE_PADRAO;
            return _contaCorrenteCache;
        }
    } catch { /* ignore */ }
    _contaCorrenteCache = CONTA_CORRENTE_PADRAO;
    return _contaCorrenteCache;
}

// Formata data DD/MM/YYYY (sem deslocamento de timezone)
function formatDateOmie(dateStr) {
    if (!dateStr) {
        return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Recife' });
    }
    const s = String(dateStr).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [y, m, d] = s.split('T')[0].split('-');
        return `${d}/${m}/${y}`;
    }
    return s;
}

// ============================================================
// DADOS ADICIONAIS DA NF (rodapé "Informações Complementares")
// Formato legado: Fantasia - Cob. - Cod.Cliente - Num.Pedido - Vendedor - <BLOCO CARGA>
// ============================================================

// Mapa de COBRANÇA derivado do PLANO DE PAGAMENTO do cliente.
// AJUSTE AQUI se a regra mudar. Regra:
//   "A VISTA" → PIX ; "N DIAS" (a prazo) → Boleto.
const COBRANCA_PADRAO_AVISTA = 'PIX';      // plano à vista
const COBRANCA_PADRAO_PRAZO = 'Boleto';    // plano a prazo (N dias)

function resolverCobranca(planoNome) {
    const nome = String(planoNome || '').trim().toUpperCase();
    if (!nome) return '';
    // À vista (qualquer variação que contenha "VISTA") → PIX
    if (nome.includes('VISTA')) return COBRANCA_PADRAO_AVISTA;
    // A prazo: "N DIAS", "DD/DD", etc. → Boleto
    if (/\d/.test(nome)) return COBRANCA_PADRAO_PRAZO;
    // Fallback conservador: não inferimos → vazio (não quebra a NF)
    return '';
}

// Remove zeros à esquerda do número do pedido (ex: "0001234" → "1234")
function numeroPedidoSemZeros(numero) {
    const s = String(numero || '').trim();
    if (!s) return '';
    const limpo = s.replace(/^0+/, '');
    return limpo || s;
}

// Monta o BLOCO DA CARGA respeitando a regra de transferência (NÃO inverter rótulos):
//   - Sem transferência concluída → "Carga: <numero_carga>"
//   - Com transferência concluída → duas linhas:
//        "CARGA FATURAMENTO: <carga_origem_numero>"   (carga onde gerou a NF)
//        "CARGA ORIGEM: <carga_destino_numero>"        (carga atual, p/ onde foi entregue)
async function montarBlocoCarga(base44, pedido) {
    // Carga de faturamento = onde a NF foi gerada. Preferimos o campo imutável gravado no faturamento.
    const cargaFaturamento = pedido.carga_faturamento_numero || pedido.numero_carga || '';

    // Buscar transferência concluída mais recente do pedido (por código Omie)
    let transferencia = null;
    const codOmie = pedido.omie_codigo_pedido ? String(pedido.omie_codigo_pedido) : '';
    if (codOmie) {
        const transfs = await base44.asServiceRole.entities.Transferencia
            .filter({ pedido_codigo_omie: codOmie, status: 'concluida' }, '-updated_date', 1)
            .catch(() => []);
        transferencia = transfs?.[0] || null;
    }

    if (transferencia) {
        // Mapeamento EXATO (não inverter):
        //   CARGA FATURAMENTO ← carga_origem_numero (de onde saiu = gerou a NF)
        //   CARGA ORIGEM      ← carga_destino_numero (p/ onde foi transferido/entregue)
        const fat = pedido.carga_faturamento_numero || transferencia.carga_origem_numero || cargaFaturamento || '';
        const origem = transferencia.carga_destino_numero || '';
        const linhas = [];
        if (fat) linhas.push(`CARGA FATURAMENTO: ${fat}`);
        if (origem) linhas.push(`CARGA ORIGEM: ${origem}`);
        return linhas.join(' - ');
    }

    return cargaFaturamento ? `Carga: ${cargaFaturamento}` : '';
}

// Helper central — usada por todo o envio/emissão. Texto corrido separado por " - ".
// FISCAL: nenhum dado faltante pode quebrar a emissão — partes vazias são simplesmente omitidas.
async function montarDadosAdicionaisNf(base44, pedido) {
    const partes = [];
    const fantasia = pedido.cliente_nome_fantasia || pedido.cliente_nome || '';
    if (fantasia) partes.push(`Fantasia: ${fantasia}`);

    const cobranca = resolverCobranca(pedido.plano_pagamento_nome);
    if (cobranca) partes.push(`Cob.: ${cobranca}`);

    if (pedido.cliente_codigo) partes.push(`Cod.Cliente: ${pedido.cliente_codigo}`);

    const numPed = numeroPedidoSemZeros(pedido.numero_pedido);
    if (numPed) partes.push(`Num.Pedido: ${numPed}`);

    if (pedido.vendedor_nome) partes.push(`Vendedor: ${pedido.vendedor_nome}`);

    const blocoCarga = await montarBlocoCarga(base44, pedido).catch(() => '');
    if (blocoCarga) partes.push(blocoCarga);

    return partes.join(' - ');
}

function gerarParcelas(plano, valorTotal) {
    const numParcelas = plano?.numero_parcelas || 1;
    const diasPrimeira = plano?.dias_primeira_parcela || 30;
    const valorParcela = Math.round((valorTotal / numParcelas) * 100) / 100;
    const parcelas = [];
    // dataBase = hoje em America/Recife → constrói via toLocaleDateString pra evitar UTC shift
    const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Recife' }); // YYYY-MM-DD
    const [yy, mm, dd] = hojeStr.split('-').map(Number);
    for (let i = 0; i < numParcelas; i++) {
        const diasOffset = diasPrimeira + (i * 30);
        const dataVenc = new Date(Date.UTC(yy, mm - 1, dd));
        dataVenc.setUTCDate(dataVenc.getUTCDate() + diasOffset);
        const d = String(dataVenc.getUTCDate()).padStart(2, '0');
        const m = String(dataVenc.getUTCMonth() + 1).padStart(2, '0');
        const y = dataVenc.getUTCFullYear();
        let valor = valorParcela;
        if (i === numParcelas - 1) {
            const totalAnterior = parcelas.reduce((s, p) => s + p.valor, 0);
            valor = Math.round((valorTotal - totalAnterior) * 100) / 100;
        }
        parcelas.push({
            numero_parcela: i + 1,
            data_vencimento: `${d}/${m}/${y}`,
            percentual: Math.round((100 / numParcelas) * 100) / 100,
            valor
        });
    }
    return parcelas;
}

// ============================================================
// RESOLUÇÃO DE CLIENTE — caminho feliz: 0 chamadas Omie
// ============================================================
async function resolverClienteOmie(base44, pedido, clienteBase44) {
    // 1. Caminho feliz: cliente local tem codigo_omie → confiamos no codigo_cliente_integracao que já existe
    //    O Omie aceita codigo_cliente_integracao OU codigo_cliente_omie no IncluirPedido. Vamos preferir codigo_cliente_omie quando temos.
    if (clienteBase44?.codigo_omie) {
        return {
            ok: true,
            payload: { codigo_cliente: Number(clienteBase44.codigo_omie) },
            fonte: 'local_codigo_omie'
        };
    }

    // 2. Sem codigo_omie → usar SEMPRE o id Base44 como codigo_cliente_integracao.
    //    O id Base44 é o código de integração REAL registrado no Omie (cCodInt).
    //    NUNCA usar pedido.cliente_codigo (codigo_interno, ex: 28948) — o Omie não o
    //    reconhece como código de integração → erro 1050 "Cliente não cadastrado".
    const codIntegracao = clienteBase44?.id || pedido.cliente_id;
    if (codIntegracao) {
        return {
            ok: true,
            payload: { codigo_cliente_integracao: String(codIntegracao) },
            fonte: 'local_codigo_integracao',
            precisaValidar: !clienteBase44?.codigo_omie // se nunca foi validado, vale fallback no erro
        };
    }

    return { ok: false, erro: 'Cliente sem identificação para o Omie' };
}

// Fallback: cliente não existe no Omie → exportar e tentar de novo
async function exportarClienteSeNecessario(base44, clienteBase44) {
    if (!clienteBase44) return { ok: false, erro: 'Cliente Base44 inexistente' };
    if (clienteBase44.tipo_nota === 'D1') {
        return { ok: false, erro: 'Cliente marcado como D1 (sem NF)' };
    }
    const r = await base44.asServiceRole.functions.invoke('enviarClienteOmie', {
        event: { type: 'auto_pedido', entity_id: clienteBase44.id },
        data: clienteBase44
    });
    const d = r?.data || r;
    if (!d?.sucesso) return { ok: false, erro: d?.erro || 'Falha exportando cliente' };
    return { ok: true, codigo_omie: d.codigo_omie };
}

// ============================================================
// MONTAGEM DO PAYLOAD
// ============================================================
function montarPayloadPedido({ pedido, items, produtosMap, unidadesMap, plano, clientePayload, contaCorrente, dadosAdicNf }) {
    const dataPrevisao = formatDateOmie(pedido.data_previsao_entrega);

    const det = items.map((item) => {
        const prod = produtosMap[item.produto_id] || {};
        const unidade = prod.unidade_medida_id ? unidadesMap[prod.unidade_medida_id] : null;
        const unidadeStr = unidade?.nome || 'UN';
        const infAdic = {
            peso_bruto: (prod.peso || 0) * item.quantidade,
            peso_liquido: (prod.peso || 0) * item.quantidade
        };
        if (pedido.numero_pedido_compra) {
            infAdic.numero_pedido_compra = pedido.numero_pedido_compra;
            infAdic.dados_adicionais_item = `Pedido de Compra: ${pedido.numero_pedido_compra}`;
        }
        const produtoRef = prod.codigo_omie
            ? { codigo_produto: Number(prod.codigo_omie) }
            : { codigo_produto_integracao: item.produto_id };
        const produtoPayload = {
            ...produtoRef,
            descricao: item.produto_nome || prod.nome || '',
            ncm: prod.ncm || '',
            quantidade: item.quantidade,
            valor_unitario: item.valor_unitario,
            tipo_desconto: "V",
            valor_desconto: 0,
            unidade: unidadeStr
        };
        // Troca: forçar CFOP 5949 (outra saída de mercadoria não especificada)
        if (pedido.tipo === 'troca') {
            produtoPayload.cfop = "5.949";
        }
        return {
            ide: { codigo_item_integracao: item.id },
            inf_adic: infAdic,
            produto: produtoPayload
        };
    });

    // Bonificação e Troca: faturadas no Omie mas NÃO geram financeiro (sem parcelas)
    const semFinanceiro = pedido.tipo === 'bonificacao' || pedido.tipo === 'troca';
    const parcelas = semFinanceiro ? [] : gerarParcelas(plano, pedido.valor_total || 0);

    // dados_adicionais_nf: texto montado pela helper central montarDadosAdicionaisNf (formato legado).
    // Recebido pronto via parâmetro — fallback para o que já estiver gravado no pedido.
    const dadosAdicNfFinal = dadosAdicNf || pedido.dados_adicionais_nf || '';

    const cabecalho = {
        codigo_pedido_integracao: pedido.id,
        ...clientePayload, // codigo_cliente OU codigo_cliente_integracao
        data_previsao: dataPrevisao,
        etapa: "10",
        codigo_parcela: "999",
        quantidade_itens: items.length
    };
    if (pedido.cenario_fiscal_codigo && !isNaN(Number(pedido.cenario_fiscal_codigo)) && Number(pedido.cenario_fiscal_codigo) > 0) {
        cabecalho.codigo_cenario_impostos = String(pedido.cenario_fiscal_codigo);
    }

    const payload = {
        cabecalho,
        det,
        frete: { modalidade: "9" },
        informacoes_adicionais: {
            codigo_categoria: "1.01.01",
            consumidor_final: "S",
            enviar_email: "N",
            codigo_conta_corrente: contaCorrente,
            ...(pedido.numero_pedido_compra ? { numero_pedido_cliente: pedido.numero_pedido_compra } : {}),
            ...(dadosAdicNfFinal ? { dados_adicionais_nf: dadosAdicNfFinal } : {})
        }
    };
    if (parcelas.length > 0) {
        payload.lista_parcelas = { parcela: parcelas };
    }
    return payload;
}

// Consulta idempotente: o pedido já foi criado no Omie? (busca por codigo_pedido_integracao = id Base44)
// Retorna { codigo_pedido, numero_pedido } se existe, ou null se não existe.
async function consultarPedidoCriado(base44, pedidoIdBase44) {
    try {
        const consulta = await omieCall(base44, "produtos/pedido/", { codigo_pedido_integracao: String(pedidoIdBase44) }, { call: 'ConsultarPedido', operation: 'ConsultarPedido', skipLog: true, timeoutMs: 20000 });
        const cab = consulta?.pedido_venda_produto?.cabecalho;
        if (cab?.codigo_pedido) {
            return { codigo_pedido: cab.codigo_pedido, numero_pedido: cab.numero_pedido };
        }
    } catch { /* não existe ou consulta falhou → trata como não criado */ }
    return null;
}

// IncluirPedido com proteção anti-duplicata: em timeout/erro de rede (escrita), NÃO reenvia cego.
// Verifica via ConsultarPedido(codigo_pedido_integracao) se o Omie já criou o pedido e reaproveita.
async function incluirPedidoIdempotente(base44, payload, pedido_id) {
    try {
        return await omieCall(base44, "produtos/pedido/", payload, { call: 'IncluirPedido', operation: 'IncluirPedido', entityType: 'Pedido', entityId: pedido_id, isWrite: true, timeoutMs: 40000 });
    } catch (e) {
        if (e.timeoutEscrita) {
            debugLog(base44, `[enviarPedidoOmie] Timeout no IncluirPedido — verificando se o pedido já foi criado no Omie antes de reenviar`, { pedido_id, erro: e.message });
            const existente = await consultarPedidoCriado(base44, pedido_id);
            if (existente) {
                debugLog(base44, `[enviarPedidoOmie] Pedido JÁ criado no Omie (codigo ${existente.codigo_pedido}) — reaproveitando, sem recriar`, { pedido_id, codigo_omie: existente.codigo_pedido });
                return { codigo_pedido: existente.codigo_pedido, numero_pedido: existente.numero_pedido };
            }
            // Confirmado que NÃO existe → reenviar UMA vez (agora é seguro)
            debugLog(base44, `[enviarPedidoOmie] Pedido NÃO encontrado no Omie após timeout — reenviando uma vez`, { pedido_id });
            return await omieCall(base44, "produtos/pedido/", payload, { call: 'IncluirPedido', operation: 'IncluirPedido', entityType: 'Pedido', entityId: pedido_id, isWrite: true, timeoutMs: 40000 });
        }
        throw e;
    }
}

// ============================================================
// CORE: envia 1 pedido
// ============================================================
async function enviarUmPedido(base44, pedido_id, ctx = {}) {
    const t0 = Date.now();

    // Buscar pedido
    let pedido;
    try {
        pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
    } catch (e) {
        if (/not found/i.test(e.message)) return { sucesso: false, erro: 'Pedido não encontrado', pedido_id };
        throw e;
    }
    if (!pedido) return { sucesso: false, erro: 'Pedido não encontrado', pedido_id };

    debugLog(base44, `[enviarPedidoOmie] Iniciando envio do pedido ID: ${pedido_id}, modelo_nota: ${pedido.modelo_nota}, tipo: ${pedido.tipo}`, { pedido_id, modelo_nota: pedido.modelo_nota, tipo: pedido.tipo, cliente_id: pedido.cliente_id, status: pedido.status });

    // Pedido CANCELADO nunca é reenviado (mesmo com status inconsistente, ex: 'liberado' mas com data_cancelamento)
    if (pedido.status === 'cancelado' || pedido.data_cancelamento) {
        return { sucesso: false, erro: 'Pedido cancelado — não enviado', pedido_id };
    }

    if (!['pendente', 'enviado', 'liberado'].includes(pedido.status)) {
        return { sucesso: false, erro: 'Status inválido para envio', pedido_id };
    }

    // Idempotência: já enviado — MAS valida que o código existe de verdade no Omie.
    // Caso "código órfão": envio anterior gravou omie_codigo_pedido mas o pedido nunca
    // foi criado no Omie (falha no meio). ConsultarPedido retorna "Pedido não cadastrado"
    // (faultcode 105/107 ou HTTP 500 com faultstring "não cadastrado"). Nesse caso LIMPAMOS
    // o código e seguimos para recriar via IncluirPedido. Se existir de verdade, mantém o curto-circuito.
    if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
        let codigoOrfao = false;
        try {
            const consulta = await omieCall(base44, "produtos/pedido/", { codigo_pedido: Number(pedido.omie_codigo_pedido) }, { call: 'ConsultarPedido', operation: 'ConsultarPedido', skipLog: true });
            if (consulta?.faultstring && /não.*cadastrad|nao.*cadastrad|não.*localizad|nao.*localizad/i.test(consulta.faultstring)) {
                codigoOrfao = true;
            }
        } catch (e) {
            // Omie manda HTTP 500 (não 404) para pedido inexistente → faultstring "não cadastrado"
            if (/não.*cadastrad|nao.*cadastrad|não.*localizad|nao.*localizad|faultcode.*10[57]/i.test(e.message || '')) {
                codigoOrfao = true;
            } else {
                // Erro transitório (rate limit/timeout) — preserva o comportamento idempotente atual
                throw e;
            }
        }
        if (codigoOrfao) {
            debugLog(base44, `[enviarPedidoOmie] Código órfão detectado (${pedido.omie_codigo_pedido}) — limpando e recriando no Omie`, { pedido_id, codigo_orfao: pedido.omie_codigo_pedido });
            await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_codigo_pedido: null, omie_enviado: false, numero_pedido: null });
            pedido.omie_codigo_pedido = null;
            pedido.omie_enviado = false;
            pedido.numero_pedido = null;
        } else {
            return {
                sucesso: true,
                pedido_id,
                codigo_pedido_omie: pedido.omie_codigo_pedido,
                numero_pedido_omie: pedido.numero_pedido,
                mensagem: 'Pedido já estava enviado ao Omie'
            };
        }
    }

    if (!pedido.data_previsao_entrega) {
        return { sucesso: false, erro: 'Data de Previsão de Entrega é obrigatória', pedido_id };
    }
    // 🛡️ BLINDAGEM D1/TROCA — simétrica ao processarFilaEnvioPedidoOmie.
    // Troca e D1 são INTERNOS: NUNCA vão ao Omie e NUNCA recebem omie_codigo_pedido.
    if (pedido.tipo === 'troca') {
        debugLog(base44, `[enviarPedidoOmie] Pedido tratado como interno — abortando envio ao Omie. Motivo: tipo === 'troca'`, { pedido_id, motivo: 'troca' });
        return { sucesso: true, pedido_id, codigo_pedido_omie: null, mensagem: 'Troca não gera venda no Omie' };
    }
    if (pedido.modelo_nota === 'd1') {
        debugLog(base44, `[enviarPedidoOmie] Pedido tratado como interno — abortando envio ao Omie. Motivo: modelo_nota === 'd1'`, { pedido_id, motivo: 'd1' });
        return { sucesso: false, erro: 'Pedido modelo D1 não é enviado ao Omie (venda interna)', pedido_id };
    }

    // Itens
    const items = ctx.itemsPorPedido?.[pedido_id]
        || await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id });
    if (items.length === 0) return { sucesso: false, erro: 'Pedido sem itens', pedido_id };

    // Cliente
    let clienteBase44 = ctx.clientesPorId?.[pedido.cliente_id] || null;
    if (!clienteBase44 && pedido.cliente_id) {
        try { clienteBase44 = await base44.asServiceRole.entities.Cliente.get(pedido.cliente_id); } catch { /* ignore */ }
    }

    debugLog(base44, `[enviarPedidoOmie] Cliente ID: ${pedido.cliente_id}, tipo_nota: ${clienteBase44?.tipo_nota}`, { cliente_id: pedido.cliente_id, tipo_nota: clienteBase44?.tipo_nota, codigo_omie: clienteBase44?.codigo_omie });

    if (clienteBase44?.tipo_nota === 'D1') {
        debugLog(base44, `[enviarPedidoOmie] Pedido tratado como interno — abortando envio ao Omie. Motivo: cliente tipo_nota === 'D1'`, { pedido_id, motivo: 'cliente_d1' });
        await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: 'Cliente marcado como D1 (sem NF) — não enviado ao Omie', omie_enviado: false });
        return { sucesso: false, erro: 'Cliente marcado como D1 (sem NF) — não enviado ao Omie', pedido_id };
    }

    // Plano
    let plano = ctx.planosPorId?.[pedido.plano_pagamento_id] || null;
    if (!plano && pedido.plano_pagamento_id) {
        try { plano = await base44.asServiceRole.entities.PlanoPagamento.get(pedido.plano_pagamento_id); } catch { /* ignore */ }
    }

    // Produtos — busca em paralelo (Promise.all ao invés de loop síncrono)
    const produtosMap = ctx.produtosMap || {};
    if (!ctx.produtosMap) {
        const produtoIds = [...new Set(items.map(i => i.produto_id))];
        const produtos = await Promise.all(
            produtoIds.map(pid => base44.asServiceRole.entities.Produto.get(pid).catch(() => null))
        );
        produtos.forEach(p => { if (p) produtosMap[p.id] = p; });
    }
    // Unidades — cache global por execução
    const unidadesMap = ctx.unidadesMap || {};
    if (!ctx.unidadesMap) {
        if (!_unidadesCache) {
            _unidadesCache = await base44.asServiceRole.entities.UnidadeMedida.list();
        }
        _unidadesCache.forEach(u => { unidadesMap[u.id] = u; });
    }

    // Resolver cliente (caminho feliz: 0 chamadas Omie)
    let res = await resolverClienteOmie(base44, pedido, clienteBase44);
    if (!res.ok) return { sucesso: false, erro: res.erro, pedido_id };
    let clientePayload = res.payload;

    // Conta corrente padrão resolvida uma única vez por execução/lote
    const contaCorrente = ctx.contaCorrentePadrao || await resolverContaCorrentePadrao(base44);

    // ROBUSTEZ TRANSFERÊNCIA: grava a carga de faturamento no pedido (imutável) se ainda não tiver.
    // Assim a transferência futura não apaga a "CARGA FATURAMENTO" do rodapé da NF.
    if (!pedido.carga_faturamento_numero && pedido.numero_carga) {
        pedido.carga_faturamento_numero = pedido.numero_carga;
        await base44.asServiceRole.entities.Pedido.update(pedido_id, { carga_faturamento_numero: pedido.numero_carga }).catch(() => {});
    }

    // Texto do rodapé "Informações Complementares" (helper central). FISCAL: nunca quebra o envio.
    const dadosAdicNf = await montarDadosAdicionaisNf(base44, pedido).catch(() => pedido.dados_adicionais_nf || '');

    // ENVIAR
    const payload = montarPayloadPedido({ pedido, items, produtosMap, unidadesMap, plano, clientePayload, contaCorrente, dadosAdicNf });
    let resultado = await incluirPedidoIdempotente(base44, payload, pedido_id);

    // Se cliente não existe no Omie → exportar e tentar UMA VEZ MAIS
    const erroClienteNaoExiste = resultado?.faultstring && /cliente.*(não.*(localizado|encontrado|cadastrado)|invalid)/i.test(resultado.faultstring);
    if (erroClienteNaoExiste && clienteBase44) {
        const exp = await exportarClienteSeNecessario(base44, clienteBase44);
        if (exp.ok) {
            await sleep(1500); // Omie indexar
            clientePayload = { codigo_cliente_integracao: String(clienteBase44.id) };
            const payload2 = montarPayloadPedido({ pedido, items, produtosMap, unidadesMap, plano, clientePayload, contaCorrente, dadosAdicNf });
            resultado = await incluirPedidoIdempotente(base44, payload2, pedido_id);
        } else {
            await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: `Cliente não estava no Omie: ${exp.erro}`, omie_enviado: false });
            return { sucesso: false, erro: `Cliente não estava no Omie: ${exp.erro}`, pedido_id };
        }
    }

    // Idempotência otimizada: se já existe, altera direto sem consulta preventiva
    if (resultado?.faultstring && /(já cadastrado|já existe|código.*cadastrado|codigo.*cadastrado)/i.test(resultado.faultstring)) {
        resultado = await omieCall(base44, "produtos/pedido/", payload, { call: 'AlterarPedidoVenda', operation: 'AlterarPedidoVenda', entityType: 'Pedido', entityId: pedido_id });
    }

    // REDUNDANT: Omie retorna erro de "consumo redundante" quando a mesma chamada
    // é feita em intervalo curto. Se isso acontece, o pedido PODE já ter sido criado
    // com sucesso na tentativa anterior. Consultar no Omie antes de marcar como erro.
    if (resultado?.faultstring && /redundan/i.test(resultado.faultstring)) {
        debugLog(base44, `[enviarPedidoOmie] REDUNDANT detectado — consultando Omie para verificar se pedido foi criado`, { pedido_id });
        try {
            const consulta = await omieCall(base44, "produtos/pedido/", {
                codigo_pedido_integracao: pedido.id
            }, { call: 'ConsultarPedido', operation: 'ConsultarPedido', skipLog: true });
            if (consulta?.pedido_venda_produto?.cabecalho?.codigo_pedido) {
                // Pedido existe no Omie — tratar como sucesso
                resultado = {
                    codigo_pedido: consulta.pedido_venda_produto.cabecalho.codigo_pedido,
                    numero_pedido: consulta.pedido_venda_produto.cabecalho.numero_pedido
                };
                debugLog(base44, `[enviarPedidoOmie] REDUNDANT resolvido: pedido encontrado no Omie com código ${resultado.codigo_pedido}`, { pedido_id, codigo_omie: resultado.codigo_pedido });
            }
        } catch (consultaErr) {
            debugLog(base44, `[enviarPedidoOmie] Falha ao consultar pedido após REDUNDANT: ${consultaErr.message}`, { pedido_id, erro: consultaErr.message });
            // Se a consulta falhou, manter o erro original mas verificar se o pedido
            // já tem código Omie salvo localmente (de tentativa anterior)
            const pedidoAtual = await base44.asServiceRole.entities.Pedido.get(pedido_id).catch(() => null);
            if (pedidoAtual?.omie_codigo_pedido) {
                resultado = {
                    codigo_pedido: pedidoAtual.omie_codigo_pedido,
                    numero_pedido: pedidoAtual.numero_pedido
                };
                debugLog(base44, `[enviarPedidoOmie] REDUNDANT resolvido via registro local: código Omie ${resultado.codigo_pedido}`, { pedido_id });
            }
        }
    }

    if (resultado?.faultstring) {
        debugLog(base44, `[enviarPedidoOmie] Erro Omie: ${resultado.faultstring}`, { pedido_id, erro: resultado.faultstring, faultcode: resultado.faultcode });
        // Se o pedido já tem código Omie salvo, não marcar omie_enviado como false
        const pedidoAtual = await base44.asServiceRole.entities.Pedido.get(pedido_id).catch(() => null);
        if (pedidoAtual?.omie_codigo_pedido) {
            await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: resultado.faultstring, omie_enviado: true });
            return { sucesso: true, pedido_id, codigo_pedido_omie: pedidoAtual.omie_codigo_pedido, numero_pedido_omie: pedidoAtual.numero_pedido, mensagem: `Pedido já existia no Omie (erro ignorado: ${resultado.faultstring})`, duracao_ms: Date.now() - t0 };
        }
        await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: resultado.faultstring, omie_enviado: false });
        return { sucesso: false, erro: resultado.faultstring, pedido_id, duracao_ms: Date.now() - t0 };
    }

    const codigoOmie = resultado.codigo_pedido || resultado.codigo_pedido_omie || null;
    const numeroPedidoOmie = resultado.numero_pedido || resultado.numero_pedido_omie || null;

    // 🛡️ GUARDA ANTI-CRUZAMENTO: confere que o pedido devolvido pelo Omie pertence a ESTE pedido local.
    // Se o resultado veio de uma consulta (REDUNDANT/timeout) e o codigo_pedido_integracao não bate
    // com pedido.id, NÃO grava — evita herdar a venda de outro cliente por colisão de código.
    const integracaoRetorno = resultado.codigo_pedido_integracao ?? resultado.cabecalho?.codigo_pedido_integracao ?? null;
    if (integracaoRetorno && String(integracaoRetorno) !== String(pedido.id)) {
        const msgCruz = `Anti-cruzamento: codigo_pedido_integracao retornado (${integracaoRetorno}) ≠ pedido.id (${pedido.id}). Código Omie ${codigoOmie} NÃO gravado.`;
        debugLog(base44, `[enviarPedidoOmie] ${msgCruz}`, { pedido_id, erro: msgCruz });
        await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: msgCruz, omie_enviado: false }).catch(() => {});
        return { sucesso: false, erro: msgCruz, pedido_id, duracao_ms: Date.now() - t0 };
    }

    const updateData = {
        omie_codigo_pedido: codigoOmie != null ? String(codigoOmie) : null,
        omie_enviado: true,
        omie_erro: null,
        status: pedido.status === 'pendente' ? 'enviado' : pedido.status,
        data_envio: pedido.data_envio || new Date().toISOString()
    };
    if (numeroPedidoOmie) {
        updateData.numero_pedido = String(numeroPedidoOmie);
        // Reconstrói o texto legado local já com o número do pedido recém-recebido (Num.Pedido).
        // Sem chamada extra ao Omie — mantém o local consistente com o que foi enviado.
        pedido.numero_pedido = String(numeroPedidoOmie);
        updateData.dados_adicionais_nf = await montarDadosAdicionaisNf(base44, pedido).catch(() => dadosAdicNf);
    }
    await base44.asServiceRole.entities.Pedido.update(pedido_id, updateData);

    // Reconcilia o espelho local (PedidoLiberadoOmie) para o "Sem espelho" sumir na hora.
    // Upsert direto da linha do espelho com os dados que já temos (sem chamada extra ao Omie).
    if (codigoOmie) {
        try {
            const cli = clienteBase44 || {};
            const registroEspelho = {
                codigo_pedido: String(codigoOmie),
                codigo_pedido_integracao: pedido.id,
                numero_pedido: numeroPedidoOmie ? String(numeroPedidoOmie) : '',
                etapa: '10',
                status_real: null,
                status_label: 'Pendente',
                numero_nf: '',
                codigo_cliente: String(cli.codigo_omie || ''),
                codigo_cliente_integracao: cli.codigo_integracao || cli.codigo || pedido.cliente_codigo || '',
                codigo_cliente_cod: String(cli.codigo_interno || cli.codigo || pedido.cliente_codigo || ''),
                cnpj_cpf_cliente: cli.cnpj_cpf || pedido.cliente_cpf_cnpj || '',
                cliente_id: cli.id || pedido.cliente_id || null,
                nome_cliente: cli.razao_social || pedido.cliente_nome || '',
                nome_fantasia: cli.nome_fantasia || pedido.cliente_nome_fantasia || '',
                cidade: cli.cidade || pedido.cliente_cidade || '',
                tipo_nota: cli.tipo_nota || '55',
                rota_id: cli.rota_id || pedido.rota_id || null,
                rota_nome: pedido.rota_nome || 'Sem Rota',
                vendedor_id: cli.vendedor_id || pedido.vendedor_id || null,
                vendedor_nome: pedido.vendedor_nome || '',
                data_previsao: pedido.data_previsao_entrega || '',
                quantidade_itens: items.length,
                valor_total_pedido: pedido.valor_total || 0,
                pedido_id: pedido.id,
                sincronizado_em: new Date().toISOString(),
                origem_sync: 'envio'
            };
            // 🛡️ UPSERT IDEMPOTENTE por codigo_pedido — NUNCA INSERT cego.
            // Busca TODOS os registros (não só 1). Atualiza o principal, deleta duplicatas.
            // Preserva produtos: este registro pós-envio vem com produtos vazio (etapa 20, antes do
            // ConsultarPedido). Se já existe um espelho COM produtos, não os zera.
            const existentes = await base44.asServiceRole.entities.PedidoLiberadoOmie
                .filter({ codigo_pedido: String(codigoOmie) }, '-sincronizado_em', 50).catch(() => []);
            if (existentes.length) {
                // Mantém o que TEM produtos (preferência), depois o mais recente.
                const peso = (r) => ((r.produtos || []).length > 0 ? 1e15 : 0) + new Date(r.sincronizado_em || 0).getTime();
                existentes.sort((a, b) => peso(b) - peso(a));
                const principal = existentes[0];
                const dadosUpsert = { ...registroEspelho };
                // Se a nova lista de produtos vier vazia e o registro já tinha produtos, preserva.
                if ((!registroEspelho.produtos || registroEspelho.produtos.length === 0) && (principal.produtos || []).length > 0) {
                    delete dadosUpsert.produtos;
                    if (!registroEspelho.quantidade_itens) delete dadosUpsert.quantidade_itens;
                }
                await base44.asServiceRole.entities.PedidoLiberadoOmie.update(principal.id, dadosUpsert).catch(() => {});
                for (const dup of existentes.slice(1)) {
                    await base44.asServiceRole.entities.PedidoLiberadoOmie.delete(dup.id).catch(() => {});
                }
            } else {
                await base44.asServiceRole.entities.PedidoLiberadoOmie.create(registroEspelho);
            }
        } catch (e) { console.error('[enviarPedidoOmie] reconciliar espelho:', e.message); }
    }

    debugLog(base44, `[enviarPedidoOmie] Pedido enviado com sucesso, omie_id: ${codigoOmie}`, { pedido_id, omie_id: codigoOmie, numero_pedido_omie: numeroPedidoOmie });

    console.log(`[PERF] Pedido ${pedido_id}: ${Date.now() - t0}ms | sucesso: true`);
    return { sucesso: true, pedido_id, codigo_pedido_omie: codigoOmie, numero_pedido_omie: numeroPedidoOmie, duracao_ms: Date.now() - t0 };
}

async function processarLotePedidos(base44, pedidosInput) {
    const t0 = Date.now();
    const pedidoIds = pedidosInput
        .map(p => typeof p === 'string' ? p : (p?.id || p?.pedido_id))
        .filter(Boolean);

    const resultados = [];
    const contaCorrentePadrao = await resolverContaCorrentePadrao(base44);

    // IncluirPedido é método de ESCRITA — a Omie aceita apenas 1 por vez.
    // Envio SEQUENCIAL (nunca paralelo) com throttle entre pedidos para respeitar o rate limit.
    let bloqueio425 = null;
    for (const pedido_id of pedidoIds) {
        if (bloqueio425) break;
        try {
            const r = await enviarUmPedido(base44, pedido_id, { contaCorrentePadrao });
            resultados.push(r);
        } catch (err) {
            if (err.code === 'OMIE_425') {
                bloqueio425 = err; // para o lote — API bloqueada
                resultados.push({ sucesso: false, erro: err.message, pedido_id, omie_bloqueada: true });
                break;
            }
            resultados.push({ sucesso: false, erro: err.message, pedido_id });
        }
        await sleep(400); // ~2,5 req/s entre pedidos (margem segura sob 240 req/min)
    }
    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => !r.sucesso).length;

    console.log(`[PERF] Lote concluído: ${pedidoIds.length} pedidos em ${Date.now() - t0}ms. Sucessos: ${sucessos}. Erros: ${erros}.`);

    return {
        sucesso: true,
        total: pedidoIds.length,
        sucessos,
        erros,
        omie_bloqueada: !!bloqueio425,
        bloqueado_ate: bloqueio425?.bloqueado_ate || null,
        resultados
    };
}

// ============================================================
// ENTRY POINT HTTP — pedido único ou lote { pedidos: [...] }
// ============================================================
Deno.serve(async (req) => {
    let base44 = null;
    let pedido_id = null;
    try {
        base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        if (user.role !== 'admin') {
            const allVendedores = await base44.asServiceRole.entities.Vendedor.list();
            const vendedor = allVendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
            if (vendedor) {
                const permissoes = await base44.asServiceRole.entities.Permissao.filter({ vendedor_id: vendedor.id });
                const perm = permissoes[0];
                if (!perm?.permissoes_pedidos?.enviar_pedido) {
                    return Response.json({ error: 'Sem permissão para enviar pedidos' }, { status: 403 });
                }
            } else {
                return Response.json({ error: 'Funcionário não encontrado' }, { status: 403 });
            }
        }

        const body = await req.json();
        if (Array.isArray(body.pedidos)) {
            if (body.pedidos.length === 0) return Response.json({ error: 'pedidos vazio' }, { status: 400 });
            const r = await processarLotePedidos(base44, body.pedidos);
            return Response.json(r);
        }

        pedido_id = body.pedido_id;
        if (!pedido_id) return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });

        // Aceita ctx pré-carregado do processarFilaEnvioPedidoOmie (evita buscas individuais)
        const ctx = body.ctx || {};
        const r = await enviarUmPedido(base44, pedido_id, ctx);
        return Response.json(r);
    } catch (error) {
        console.error('[enviarPedidoOmie] Erro geral:', error.message);
        const bloqueada = error?.code === 'OMIE_425';
        if (base44 && pedido_id) {
            try {
                // Nunca forçar omie_enviado=false se o pedido já tem código Omie
                const pedCheck = await base44.asServiceRole.entities.Pedido.get(pedido_id).catch(() => null);
                const jaTemCodigo = !!pedCheck?.omie_codigo_pedido;
                await base44.asServiceRole.entities.Pedido.update(pedido_id, {
                    omie_erro: bloqueada ? error.message : `Erro interno: ${error.message}`,
                    omie_enviado: jaTemCodigo ? true : false
                });
            } catch { /* ignore */ }
        }
        return Response.json({ sucesso: false, erro: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
    }
});