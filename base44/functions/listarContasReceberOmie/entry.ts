// v4 — Fase 1 — chamadas Omie passam pelo omieClient com throttle/circuit breaker global compartilhado (mesma tabela ControleCircuitBreakerOmie)
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const OMIE_ENDPOINT_CR = 'financas/contareceber/';

// ═══ omieClient inline — espelha o _shared/omieClient: circuit breaker pelo ID fixo + throttle GLOBAL persistido ═══
const CB_FIXED_ID = '6a1e06a9aa62ceab7b3b6d97';
const GLOBAL_RATE_KEY = 'rate_limit_global';
const GLOBAL_MIN_INTERVAL_MS = 1500;

async function omieCheckCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_FIXED_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_FIXED_ID, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

// Throttle GLOBAL ATÔMICO compartilhado (reserva de slot) — espelha _shared/omieClient.
// 'atualizado_em' do registro 'rate_limit_global' guarda o PRÓXIMO SLOT reservado (timestamp futuro);
// worker_lock_ate é o mutex curto da seção de reserva. Duas instâncias pegam slots distintos.
const SLOT_LOCK_MS = 4000;
const SLOT_WAIT_CAP_MS = 30000;
const _sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getSlotRow(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: GLOBAL_RATE_KEY }, 'created_date', 50).catch(() => []);
  if (!rows?.[0]?.id) {
    return await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create({ chave: GLOBAL_RATE_KEY, atualizado_em: new Date().toISOString() }).catch(() => null);
  }
  for (const extra of rows.slice(1)) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.delete(extra.id).catch(() => null);
  return rows[0];
}

async function omieThrottleGlobal(base44: any) {
  try {
    const row = await getSlotRow(base44);
    if (!row?.id) return;
    const lockId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let gotLock = false;
    for (let i = 0; i < 12; i++) {
      const fresh = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: row.id }, '-created_date', 1).catch(() => []);
      const cur = fresh?.[0];
      const lockedUntil = cur?.worker_lock_ate ? new Date(cur.worker_lock_ate).getTime() : 0;
      if (!lockedUntil || lockedUntil <= Date.now()) {
        await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(row.id, { worker_lock_ate: new Date(Date.now() + SLOT_LOCK_MS).toISOString(), ultimo_erro: lockId }).catch(() => null);
        const confirm = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: row.id }, '-created_date', 1).catch(() => []);
        if (confirm?.[0]?.ultimo_erro === lockId) { gotLock = true; break; }
      }
      await _sleep(200 + Math.floor(Math.random() * 200));
    }
    const fresh = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: row.id }, '-created_date', 1).catch(() => []);
    const cur = fresh?.[0] || row;
    const proximoSlot = cur?.atualizado_em ? new Date(cur.atualizado_em).getTime() : 0;
    const now = Date.now();
    const meuSlot = Math.max(now, proximoSlot);
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(row.id, { atualizado_em: new Date(meuSlot + GLOBAL_MIN_INTERVAL_MS).toISOString(), ...(gotLock ? { worker_lock_ate: null } : {}) }).catch(() => null);
    const espera = Math.min(meuSlot - now, SLOT_WAIT_CAP_MS);
    if (espera > 0) await _sleep(espera);
  } catch { /* falha no rate limiter não bloqueia a chamada */ }
}

async function omieCall(base44: any, call: string, param: any, options: any = {}) {
  const creds = options.creds || await resolverCredsOmie(base44);
  if (!creds.app_key || !creds.app_secret) throw new Error('Credenciais Omie não configuradas.');
  const cb = await omieCheckCircuitBreaker(base44);
  if (cb.blocked) { const err: any = new Error(`API Omie bloqueada até ${cb.blockedUntil}`); err.omie_bloqueada = true; throw err; }
  await omieThrottleGlobal(base44);
  const url = OMIE_BASE_URL + OMIE_ENDPOINT_CR;
  const body = { call, app_key: creds.app_key, app_secret: creds.app_secret, param: [param] };
  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.status === 429 || res.status >= 500) {
        await res.text().catch(() => '');
        if (attempt < 2) { await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt))); continue; }
        throw new Error(`HTTP ${res.status} Omie — tentativas esgotadas`);
      }
      if (res.status === 425) {
        const corpo = await res.text().catch(() => '');
        if (attempt < 2) { await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt))); continue; }
        throw new Error(`HTTP 425 — consumo indevido${corpo ? ': ' + corpo.slice(0, 200) : ''}`);
      }
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        const concorrencia = msg.includes('redundant') || msg.includes('código 6') || msg.includes('codigo 6') ||
          msg.includes('já em execução') || msg.includes('ja em execucao') || msg.includes('aguarde') || msg.includes('1880');
        if (concorrencia && attempt < 2) { await new Promise(r => setTimeout(r, 1500 * Math.pow(2, attempt))); continue; }
        throw new Error(data.faultstring);
      }
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}
// ═══ fim omieClient inline ═══

// Converte data Omie (dd/mm/aaaa) → número AAAAMMDD para comparação por DIA (ignora horas).
// Retorna null se a data não existir/for inválida.
function diaNumOmie(s: any): number | null {
  const m = String(s || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]);
}

let _credsCache: any = null;
async function resolverCredsOmie(base44: any) {
  if (_credsCache && _credsCache.app_key && _credsCache.app_secret && Date.now() - _credsCache.at < 30000) return _credsCache;
  // Fonte primária: registro ativo de ConfiguracaoOmie (campos app_key/app_secret — NÃO os antigos omie_*).
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  if (ativo?.app_key && ativo?.app_secret) {
    _credsCache = { app_key: String(ativo.app_key), app_secret: String(ativo.app_secret), at: Date.now() };
    return _credsCache;
  }
  // Fallback (último recurso): Secrets de ambiente. NÃO cacheia se vier vazio.
  const envKey = Deno.env.get('OMIE_APP_KEY') || '';
  const envSecret = Deno.env.get('OMIE_APP_SECRET') || '';
  if (envKey && envSecret) {
    _credsCache = { app_key: envKey, app_secret: envSecret, at: Date.now() };
    return _credsCache;
  }
  return { app_key: '', app_secret: '', at: 0 };
}

// Carrega clientes em bulk (uma única chamada) e indexa por codigo_omie e CNPJ
let _clientesCache: { map: Map<string, any>; cnpjMap: Map<string, any>; at: number } | null = null;
const CLIENTES_CACHE_TTL = 60_000; // 1 min

async function carregarClientesBulk(base44: any) {
  if (_clientesCache && Date.now() - _clientesCache.at < CLIENTES_CACHE_TTL) return _clientesCache;

  const porCodigo = new Map<string, any>();
  const porCnpj = new Map<string, any>();

  let skip = 0;
  const limit = 500;
  let hasMore = true;

  while (hasMore) {
    const batch = await base44.asServiceRole.entities.Cliente.list('-created_date', limit, skip);
    if (!batch || batch.length === 0) break;
    for (const c of batch) {
      // Indexar por todos os códigos possíveis
      for (const campo of [c.codigo_omie, c.codigo_cliente_omie]) {
        const key = String(campo || '').trim();
        if (key) porCodigo.set(key, c);
      }
      const cnpj = String(c.cnpj_cpf || '').replace(/\D/g, '');
      if (cnpj) porCnpj.set(cnpj, c);
    }
    skip += limit;
    hasMore = batch.length === limit;
  }

  _clientesCache = { map: porCodigo, cnpjMap: porCnpj, at: Date.now() };
  console.log(`[listarContasReceber] Cache de clientes: ${porCodigo.size} por código, ${porCnpj.size} por CNPJ`);
  return _clientesCache;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const creds = await resolverCredsOmie(base44);
    if (!creds.app_key || !creds.app_secret) {
      return Response.json({ error: 'Credenciais Omie não configuradas.' }, { status: 500 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      data_de, data_ate,
      filtrar_por_data = 'E',
      cnpj_cpf,
      pagina,
      registros_por_pagina = 100,
      apenas_pendentes = true,
      bypassCache = false,
      cacheMinutes
    } = body;
    // Se o chamador NÃO especificar página, a função pagina por completo (todas as páginas).
    // Se especificar (pagina: N), retorna só aquela página (compatibilidade com chamadas antigas).
    const paginarTudo = pagina == null;

    // bypassCache (ou cacheMinutes: 0) força dados frescos — útil logo após emitir boletos,
    // quando o cache de clientes/Omie ainda reflete boleto.cGerado = "N".
    const _cacheMin = typeof cacheMinutes === 'number' ? cacheMinutes : (bypassCache ? 0 : null);
    if (_cacheMin === 0) {
      _clientesCache = null;
      _credsCache = null;
    }

    const montarParam = (pag: number): any => {
      const p: any = {
        pagina: pag,
        registros_por_pagina: Math.min(registros_por_pagina, 100),
        apenas_importado_api: 'N',
        exibir_obs: 'S'
      };
      if (filtrar_por_data === 'E') {
        if (data_de) p.filtrar_por_emissao_de = data_de;
        if (data_ate) p.filtrar_por_emissao_ate = data_ate;
      } else {
        if (data_de) p.filtrar_por_data_de = data_de;
        if (data_ate) p.filtrar_por_data_ate = data_ate;
      }
      if (cnpj_cpf) p.filtrar_por_cpf_cnpj = cnpj_cpf;
      if (apenas_pendentes) p.filtrar_apenas_titulos_em_aberto = 'S';
      return p;
    };

    const t0 = Date.now();
    // Paginação: se o chamador pediu uma página específica, busca só ela.
    // Caso contrário, itera total_de_paginas, concatenando, com espaçamento entre páginas (anti rate-limit).
    let registrosBrutos: any[] = [];
    let infoPagina = { pagina: paginarTudo ? 1 : pagina, total_de_paginas: 1, total_de_registros: 0 };
    {
      const primeira = await omieCall(base44, 'ListarContasReceber', montarParam(paginarTudo ? 1 : pagina), { creds });
      registrosBrutos = registrosBrutos.concat(primeira.conta_receber_cadastro || []);
      const totalPag = Number(primeira.total_de_paginas || 1);
      infoPagina = { pagina: primeira.pagina, total_de_paginas: totalPag, total_de_registros: primeira.total_de_registros };
      if (paginarTudo && totalPag > 1) {
        for (let pag = 2; pag <= totalPag; pag++) {
          await new Promise(r => setTimeout(r, 700)); // espaça ~700ms p/ não estourar rate-limit do Omie
          const prox = await omieCall(base44, 'ListarContasReceber', montarParam(pag), { creds });
          registrosBrutos = registrosBrutos.concat(prox.conta_receber_cadastro || []);
        }
      }
    }
    const duracao = Date.now() - t0;

    // Dedup por codigo_lancamento_omie (idempotência entre páginas)
    registrosBrutos = registrosBrutos.filter((t: any, i: number, arr: any[]) =>
      arr.findIndex((x: any) => x.codigo_lancamento_omie === t.codigo_lancamento_omie) === i
    );

    const STATUS_EXCLUIR = new Set(['LIQUIDADO', 'PAGO', 'CANCELADO', 'RECEBIDO']);
    const titulosRaw = registrosBrutos.filter((t: any) => {
      if (apenas_pendentes && t.status_titulo && STATUS_EXCLUIR.has(t.status_titulo.toUpperCase())) return false;
      return true;
    });

    // Mapeamento inicial
    let titulos = titulosRaw.map((t: any) => ({
      codigo_lancamento: t.codigo_lancamento_omie,
      codigo_lancamento_integracao: t.codigo_lancamento_integracao,
      codigo_cliente: t.codigo_cliente_fornecedor,
      numero_documento: t.numero_documento,
      // Parcela: Omie envia em cNumParcela/numero_parcela ("001/001"). Empresa emite quase
      // tudo em parcela única → fallback "001/001" para nunca exibir/gravar vazio.
      numero_parcela: String(t.cNumParcela || t.numero_parcela || '').trim() || '001/001',
      data_emissao: t.data_emissao,
      data_vencimento: t.data_vencimento,
      valor_documento: t.valor_documento,
      valor_pago: t.valor_pago || 0,
      status_titulo: t.status_titulo || 'ABERTO',
      cnpj_cpf: t.cpf_cnpj_cliente,
      nome_cliente: t.nome_cliente || '',
      nome_fantasia: t.nome_fantasia || '',
      id_conta_corrente: t.id_conta_corrente,
      boleto_gerado: t.boleto?.cGerado === 'S',
      numero_boleto: t.boleto?.cNumBoleto || t.numero_boleto || '',
      numero_bancario: t.boleto?.cNumBancario || t.numero_bancario || '',
      data_emissao_boleto: t.boleto?.dDtEmBol || '',
      observacao: t.observacao,
      codigo_barras: t.boleto?.cCodBarras || t.codigo_barras || '',
      linha_digitavel: t.boleto?.dLinhaDig || '',
      url_boleto: t.boleto?.cLinkBoleto || '',
      // nCodPedido é o vínculo confiável título↔pedido (Omie DEVOLVE este campo no topo do título).
      codigo_pedido_omie: t.nCodPedido != null ? String(t.nCodPedido) : '',
      numero_pedido_vinculado:
        t.numero_pedido || t.cNumPedido || t.pedido?.numero_pedido || t.pedido_venda?.numero_pedido || ''
    }));

    // 🛡️ REDE DE SEGURANÇA — refiltra por data sobre os títulos retornados.
    // O Omie às vezes devolve títulos fora do range pedido; aqui garantimos o range.
    // 'E' → compara data_emissao; 'V' (ou qualquer outro) → data_vencimento. Inclusivo nos extremos,
    // por DIA (horas zeradas). Título sem a data escolhida → descartado.
    {
      const deNum = diaNumOmie(data_de);
      const ateNum = diaNumOmie(data_ate);
      if (deNum != null || ateNum != null) {
        const campo = filtrar_por_data === 'E' ? 'data_emissao' : 'data_vencimento';
        const antes = titulos.length;
        titulos = titulos.filter((t: any) => {
          const d = diaNumOmie(t[campo]);
          if (d == null) return false; // sem a data escolhida → descarta
          if (deNum != null && d < deNum) return false;
          if (ateNum != null && d > ateNum) return false;
          return true;
        });
        if (antes !== titulos.length) {
          console.log(`[listarContasReceber] filtro de data (${campo}) descartou ${antes - titulos.length} título(s) fora do range ${data_de || '-'}..${data_ate || '-'}`);
        }
      }
    }

    // ✅ ENRIQUECIMENTO BULK — carrega todos os clientes em 1 chamada, faz lookup local.
    // REGRA ESTRITA: o nome SEMPRE vem do título do Omie quando presente. Quando o Omie
    // não retornou nome, casa SOMENTE por codigo_cliente exato OU cnpj_cpf exato do PRÓPRIO título.
    // NUNCA chutar outro cliente — sem match exato, mantém o que veio do Omie (evita troca de identidade).
    try {
      const { map: clientesPorCodigo, cnpjMap: clientesPorCnpj } = await carregarClientesBulk(base44);

      let enriquecidos = 0;
      const semNomeNemMatch: string[] = [];
      titulos = titulos.map((t: any) => {
        if (t.nome_cliente && t.nome_cliente.trim()) return t; // Omie já retornou nome → fonte da verdade

        const enr = { ...t };
        const codTitulo = String(enr.codigo_cliente || '').trim();
        const cnpjTitulo = String(enr.cnpj_cpf || '').replace(/\D/g, '');

        // Match EXATO: 1º por código do próprio título, 2º por CNPJ do próprio título.
        const c = (codTitulo && clientesPorCodigo.get(codTitulo)) ||
                  (cnpjTitulo && clientesPorCnpj.get(cnpjTitulo)) || null;

        if (c) {
          enr.nome_cliente = c.razao_social || c.nome_fantasia || '';
          enr.nome_fantasia = c.nome_fantasia || '';
          if (!enr.cnpj_cpf) enr.cnpj_cpf = c.cnpj_cpf;
          enriquecidos++;
        } else {
          // Sem match exato — mantém como veio do Omie (não atribui outro cliente).
          semNomeNemMatch.push(`cod=${codTitulo || '-'} cnpj=${cnpjTitulo || '-'} doc=${enr.numero_documento || '-'}`);
        }
        return enr;
      });
      console.log(`[listarContasReceber] ${enriquecidos}/${titulos.length} títulos enriquecidos com nome do cliente`);
      if (semNomeNemMatch.length) {
        console.warn(`[listarContasReceber] ${semNomeNemMatch.length} título(s) sem nome do Omie e sem match exato: ${semNomeNemMatch.join(' | ')}`);
      }
    } catch (e: any) {
      console.warn('[listarContasReceber] enriquecimento falhou:', e.message);
    }

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'financas/contareceber',
      call: 'ListarContasReceber',
      operacao: 'listar_contas_receber',
      status: 'sucesso',
      duracao_ms: duracao,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({
      sucesso: true,
      titulos,
      pagina: infoPagina.pagina,
      total_de_paginas: infoPagina.total_de_paginas,
      total_de_registros: infoPagina.total_de_registros
    });
  } catch (error: any) {
    // Circuit breaker compartilhado ativo → não joga erro vermelho na tela.
    // Retorna resultado vazio sinalizando o bloqueio; a aba continua funcionando.
    if (error?.omie_bloqueada || String(error?.message || '').toLowerCase().includes('bloqueada')) {
      return Response.json({
        sucesso: true,
        titulos: [],
        pagina: 1,
        total_de_paginas: 1,
        total_de_registros: 0,
        omie_bloqueada: true,
        aviso: 'API Omie temporariamente em controle de ritmo — tente novamente em instantes.'
      });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
});