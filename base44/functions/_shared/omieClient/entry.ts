type Base44Client = any;

type OmieCallOptions = {
  call?: string;
  skipLog?: boolean;
  cacheTtlMs?: number;
  cacheMinutes?: number;
  timeoutMs?: number;
  timeout?: number;
  operation?: string;
  entityType?: string;
  entityId?: string;
};

type MemoryCacheEntry = {
  value: unknown;
  expiresAt: number;
};

type CircuitBreakerStatus = {
  blocked: boolean;
  blockedUntil?: string;
  lastError?: string;
};

const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const memoryCache = new Map<string, MemoryCacheEntry>();

// ── Regras oficiais Omie: 240 req/min. Mantemos margem segura de 3 req/s por método. ──
const THROTTLE_MIN_INTERVAL_MS = 334; // ~3 req/s
const lastCallAt = new Map<string, number>(); // método → timestamp da última chamada

// ── Rate limiter GLOBAL por app_key ──
// Todas as funções compartilham o mesmo app_key Omie. Para evitar que múltiplas
// funções rodando em paralelo estourem o limite, persistimos no banco o timestamp
// da última chamada e garantimos no mínimo GLOBAL_MIN_INTERVAL_MS entre chamadas.
const GLOBAL_MIN_INTERVAL_MS = 1_500; // no máx ~1 chamada a cada 1,5s globalmente
const GLOBAL_RATE_KEY = 'rate_limit_global';
const SLOT_LOCK_MS = 4_000;     // validade do mutex curto da reserva de slot (auto-release)
const SLOT_WAIT_CAP_MS = 30_000; // teto de espera por slot (segurança contra slot longe demais)

// Garante UM único registro 'rate_limit_global' (mantém o mais antigo, remove duplicados)
// e devolve seu id — corrige o acúmulo dos 22 duplicados que renovava o bloqueio em loop.
async function getSlotRow(base44: Base44Client): Promise<{ id: string; atualizado_em?: string; worker_lock_ate?: string } | null> {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: GLOBAL_RATE_KEY }, 'created_date', 50).catch(() => []);
  if (!rows?.[0]?.id) {
    const created = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create({ chave: GLOBAL_RATE_KEY, atualizado_em: new Date().toISOString() }).catch(() => null);
    return created?.id ? created : null;
  }
  for (const extra of rows.slice(1)) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.delete(extra.id).catch(() => null);
  }
  return rows[0];
}

// ── Throttle global ATÔMICO por reserva de slot ──
// O problema do read-then-write antigo: N instâncias liam o MESMO 'atualizado_em', calculavam
// o MESMO wait e disparavam juntas (não serializava entre processos).
//
// Solução: 'atualizado_em' do registro 'rate_limit_global' guarda o PRÓXIMO SLOT reservado
// (timestamp futuro). Cada instância:
//   1. Adquire um mutex curto (worker_lock_ate) sobre a seção de reserva.
//   2. slot = max(agora, proximo_slot); grava proximo_slot = slot + intervalo; libera o lock.
//   3. Dorme até o SEU slot.
// Assim 2 instâncias pegam slots distintos (agora+1,5s, agora+3,0s, ...) e não disparam juntas.
async function throttleGlobal(base44: Base44Client): Promise<void> {
  try {
    const row = await getSlotRow(base44);
    if (!row?.id) return; // sem registro → não trava a chamada

    // 1) Mutex curto: tenta adquirir o lock da seção de reserva, com pequenas esperas.
    const lockId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let gotLock = false;
    for (let i = 0; i < 12; i++) {
      const fresh = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: row.id }, '-created_date', 1).catch(() => []);
      const cur = fresh?.[0];
      const lockedUntil = cur?.worker_lock_ate ? new Date(cur.worker_lock_ate).getTime() : 0;
      if (!lockedUntil || lockedUntil <= Date.now()) {
        await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(row.id, {
          worker_lock_ate: new Date(Date.now() + SLOT_LOCK_MS).toISOString(),
          ultimo_erro: lockId // marca o dono do lock para confirmar na releitura
        }).catch(() => null);
        const confirm = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: row.id }, '-created_date', 1).catch(() => []);
        if (confirm?.[0]?.ultimo_erro === lockId) { gotLock = true; break; }
      }
      await sleep(200 + Math.floor(Math.random() * 200)); // jitter para evitar lockstep
    }

    // 2) Reserva atômica do slot (dentro do lock; se não pegou lock, faz reserva best-effort).
    const fresh = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: row.id }, '-created_date', 1).catch(() => []);
    const cur = fresh?.[0] || row;
    const proximoSlot = cur?.atualizado_em ? new Date(cur.atualizado_em).getTime() : 0;
    const now = Date.now();
    const meuSlot = Math.max(now, proximoSlot);
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(row.id, {
      atualizado_em: new Date(meuSlot + GLOBAL_MIN_INTERVAL_MS).toISOString(),
      ...(gotLock ? { worker_lock_ate: null } : {}) // libera o lock se o detínhamos
    }).catch(() => null);

    // 3) Dorme até o meu slot.
    const espera = Math.min(meuSlot - now, SLOT_WAIT_CAP_MS);
    if (espera > 0) await sleep(espera);
  } catch {
    // Em caso de falha no rate limiter, não bloqueia a chamada — apenas segue.
  }
}

// Métodos de ESCRITA: nunca cacheados e (para os críticos) executados 1 por vez (fila sequencial).
const WRITE_METHODS = new Set([
  'IncluirPedido', 'AlterarPedidoVenda', 'AlterarPedido', 'ExcluirPedido',
  'FaturarPedidoVenda', 'EmitirNFS', 'EmitirNF', 'CancelarNF', 'CancelarPedidoVenda',
  'CancelarPedido', 'DevolverPedido', 'TrocarEtapaPedido', 'AlterarEtapaPedido',
  'UpsertCliente', 'IncluirCliente', 'AlterarCliente', 'ExcluirCliente',
  'UpsertProduto', 'IncluirProduto', 'AlterarProduto', 'ExcluirProduto',
  'AlterarPrecoItem', 'IncluirContaCorrente', 'IncluirBoleto', 'GerarBoleto'
]);

// Métodos que SÓ aceitam 1 requisição por vez (Omie rejeita paralelismo) → fila sequencial global.
const SEQUENTIAL_METHODS = new Set([
  'IncluirPedido', 'AlterarPedidoVenda', 'FaturarPedidoVenda',
  'EmitirNFS', 'EmitirNF', 'CancelarNF', 'CancelarPedidoVenda', 'CancelarPedido',
  'UpsertCliente'
]);

function isWriteMethod(call: string): boolean {
  return WRITE_METHODS.has(call) || /^(Incluir|Alterar|Excluir|Cancelar|Emitir|Faturar|Devolver|Upsert|Gerar|Trocar)/.test(call);
}

// Fila sequencial: garante 1 execução por vez para métodos críticos de escrita.
let sequentialChain: Promise<unknown> = Promise.resolve();
function runSequential<T>(task: () => Promise<T>): Promise<T> {
  const result = sequentialChain.then(task, task);
  sequentialChain = result.catch(() => undefined);
  return result;
}

// Throttle por método: respeita o intervalo mínimo entre chamadas do mesmo método.
async function throttleByMethod(call: string): Promise<void> {
  const last = lastCallAt.get(call) || 0;
  const wait = THROTTLE_MIN_INTERVAL_MS - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  lastCallAt.set(call, Date.now());
}

function resolveUrl(endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ID fixo do único registro de circuit breaker — NUNCA criar novos
const CB_FIXED_ID = '6a1e06a9aa62ceab7b3b6d97';

// Extrai segundos de bloqueio da mensagem Omie (ex: "Tente novamente em 1798 segundos.")
function extrairSegundosBloqueio(msg: string): number {
  const match = String(msg).match(/(\d+)\s*segundo/i);
  if (match) return Math.min(Number(match[1]) + 10, 1800); // +10s margem, cap 30min
  return 0; // sem tempo informado = não bloqueia
}

async function setCircuitBreakerBlocked(base44: Base44Client, errorMessage: string): Promise<void> {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
    .filter({ id: CB_FIXED_ID }, '-created_date', 1).catch(() => []);
  const ctrl = rows?.[0];
  const erros = Number(ctrl?.erros_consecutivos || 0) + 1;
  const threshold = Number(ctrl?.threshold_erros ?? 3);
  const payload: Record<string, unknown> = {
    erros_consecutivos: erros,
    ultimo_erro: errorMessage.slice(0, 500),
    atualizado_em: new Date().toISOString()
  };
  if (erros >= threshold) {
    const segs = extrairSegundosBloqueio(errorMessage);
    if (segs > 0) {
      payload.bloqueado = true;
      payload.bloqueado_ate = new Date(Date.now() + segs * 1000).toISOString();
    }
  }
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_FIXED_ID, payload)
    .catch((err) => { console.error('[omieClient] Falha ao atualizar circuit breaker:', err?.message); });
}

// ── LGPD: mascara CPF (11 díg) e CNPJ (14 díg) em qualquer texto de log ──
// Mantém os 3 primeiros e 2 últimos dígitos para rastreabilidade, oculta o miolo.
// Cobre tanto a forma só-dígitos quanto a formatada (com . - /).
function mascararPII(texto: string): string {
  if (!texto) return texto;
  return texto
    // CNPJ formatado: 00.000.000/0000-00
    .replace(/\b(\d{2})\.?\d{3}\.?\d{3}\/?\d{4}-?(\d{2})\b/g, '$1.***.***/****-$2')
    // CPF formatado: 000.000.000-00
    .replace(/\b(\d{3})\.?\d{3}\.?\d{3}-?(\d{2})\b/g, '$1.***.***-$2');
}

async function writeLog(base44: Base44Client, data: Record<string, unknown>): Promise<void> {
  await base44.asServiceRole.entities.LogIntegracaoOmie.create({
    endpoint: String(data.endpoint || ''),
    call: String(data.call || ''),
    operacao: String(data.operacao || 'omie_call'),
    entidade_tipo: data.entidade_tipo ? String(data.entidade_tipo) : undefined,
    entidade_id: data.entidade_id ? String(data.entidade_id) : undefined,
    status: String(data.status || 'sucesso'),
    codigo_erro: data.codigo_erro ? String(data.codigo_erro) : undefined,
    mensagem_erro: data.mensagem_erro ? String(data.mensagem_erro).slice(0, 1000) : undefined,
    erro_detalhado: data.erro_detalhado ? mascararPII(String(data.erro_detalhado)).slice(0, 3000) : undefined,
    payload_enviado: data.payload_enviado ? mascararPII(String(data.payload_enviado)).slice(0, 3000) : undefined,
    payload_resposta: data.payload_resposta ? mascararPII(String(data.payload_resposta)).slice(0, 3000) : undefined,
    duracao_ms: Number(data.duracao_ms || 0),
    tentativas: Number(data.tentativas || 1)
  }).catch(() => null);
}

async function readPersistentCache(base44: Base44Client, cacheKey: string): Promise<unknown | null> {
  const rows = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave: cacheKey }, '-created_date', 1).catch(() => []);
  const entry = rows?.[0];
  if (!entry?.valor || !entry?.expira_em) return null;
  if (new Date(entry.expira_em).getTime() <= Date.now()) return null;
  memoryCache.set(cacheKey, { value: entry.valor, expiresAt: new Date(entry.expira_em).getTime() });
  return entry.valor;
}

async function writePersistentCache(base44: Base44Client, cacheKey: string, endpoint: string, call: string, value: unknown, ttlMs: number): Promise<void> {
  const payload = {
    chave: cacheKey,
    valor: value,
    tipo: call || endpoint,
    expira_em: new Date(Date.now() + ttlMs).toISOString(),
    criado_em: new Date().toISOString()
  };

  const rows = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave: cacheKey }, '-created_date', 1).catch(() => []);
  if (rows?.[0]?.id) await base44.asServiceRole.entities.CacheOmieConsulta.update(rows[0].id, payload).catch(() => null);
  else await base44.asServiceRole.entities.CacheOmieConsulta.create(payload).catch(() => null);
}

/**
 * Verifica o circuit breaker persistente da Omie antes de chamadas à API.
 * Retorna o status atual e desbloqueia automaticamente quando o prazo expirou.
 */
export async function checkCircuitBreaker(base44: Base44Client): Promise<CircuitBreakerStatus> {
  // Busca DIRETO pelo ID fixo — nunca por filter genérico (que pode pegar duplicados)
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_FIXED_ID }, '-created_date', 1).catch(() => []);
  const control = rows?.[0];
  if (!control?.bloqueado) return { blocked: false };

  const blockedUntil = control.bloqueado_ate ? new Date(control.bloqueado_ate).getTime() : 0;
  if (blockedUntil && blockedUntil <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(control.id, {
      bloqueado: false,
      atualizado_em: new Date().toISOString()
    }).catch(() => null);
    return { blocked: false };
  }

  return {
    blocked: true,
    blockedUntil: control.bloqueado_ate,
    lastError: control.ultimo_erro
  };
}

/**
 * Limpa o cache em memória das consultas Omie.
 * Útil para testes e para forçar nova consulta sem aguardar o TTL de 30 segundos.
 */
export function clearOmieMemoryCache(): void {
  memoryCache.clear();
}

// Cache curto das credenciais por isolate (evita ler a entidade a cada chamada Omie).
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;
const CREDS_CACHE_TTL_MS = 30_000;

/**
 * Resolve as credenciais Omie ativas.
 * Fonte primária: Secrets do backend (OMIE_APP_KEY/OMIE_APP_SECRET) — o app_secret
 * NUNCA é lido do banco em texto plano. Só cai na entidade ConfiguracaoOmie quando
 * algum Secret estiver ausente (compatibilidade).
 */
export async function getOmieCredentials(base44: Base44Client): Promise<{ appKey: string; appSecret: string }> {
  if (_credsCache && Date.now() - _credsCache.at < CREDS_CACHE_TTL_MS) {
    return { appKey: _credsCache.appKey, appSecret: _credsCache.appSecret };
  }
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) {
    _credsCache = { appKey: envKey, appSecret: envSecret, at: Date.now() };
    return { appKey: envKey, appSecret: envSecret };
  }
  console.warn('[omieClient] Secrets OMIE_APP_KEY/OMIE_APP_SECRET ausentes — caindo no banco ConfiguracaoOmie.');
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  const appKey = envKey || String(ativo?.app_key || '').trim();
  const appSecret = envSecret || String(ativo?.app_secret || '').trim();
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

/**
 * Executa uma chamada centralizada à API Omie com credenciais do ambiente, timeout,
 * retry exponencial para HTTP 429, circuit breaker, cache de 30 segundos e log automático.
 *
 * @param base44 Instância Base44 criada dentro da function via createClientFromRequest(req).
 * @param endpoint Endpoint Omie relativo ou URL completa, ex: "produtos/pedido/".
 * @param param Array ou objeto enviado no campo param do payload Omie.
 * @param options Opções da chamada; informe options.call com o método Omie, ex: "ConsultarPedido".
 */
export async function omieCall(base44: Base44Client, endpoint: string, param: unknown, options: OmieCallOptions = {}): Promise<unknown> {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || (typeof param === 'object' && param && 'call' in (param as Record<string, unknown>) ? String((param as Record<string, unknown>).call) : '');

  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas: OMIE_APP_KEY/OMIE_APP_SECRET.');
  if (!call) throw new Error('Informe options.call com o método Omie da chamada.');
  console.log(`[omieClient] Conectando ao Omie com APP_KEY: ...${String(appKey).slice(-4)} | método: ${call}`);

  const breaker = await checkCircuitBreaker(base44);
  if (breaker.blocked) {
    throw new Error(`API Omie temporariamente bloqueada pelo circuit breaker até ${breaker.blockedUntil || 'prazo indefinido'}. Último erro: ${breaker.lastError || 'não informado'}`);
  }

  const ttlMs = options.cacheTtlMs ?? (options.cacheMinutes ? options.cacheMinutes * 60_000 : DEFAULT_CACHE_TTL_MS);
  const timeoutMs = options.timeoutMs ?? options.timeout ?? DEFAULT_TIMEOUT_MS;
  const url = resolveUrl(endpoint);
  const writeMethod = isWriteMethod(call);
  const cacheKey = stableStringify({ endpoint, call, param });

  // Cache só para LEITURA (escrita nunca é cacheada).
  if (!writeMethod) {
    const cached = memoryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const persistentCached = await readPersistentCache(base44, cacheKey);
    if (persistentCached !== null) return persistentCached;
  }

  // Métodos críticos de escrita: fila sequencial (1 por vez). Demais: apenas throttle por método.
  if (SEQUENTIAL_METHODS.has(call)) {
    return runSequential(() => executeOmieCall());
  }
  return executeOmieCall();

  async function executeOmieCall(): Promise<unknown> {
  await throttleByMethod(call);
  await throttleGlobal(base44);
  const startedAt = Date.now();
  let attempts = 0;
  let lastError: Error | null = null;
  const payload = { call, app_key: appKey, app_secret: appSecret, param: Array.isArray(param) ? param : [param] };

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    attempts = attempt + 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (response.status === 429) {
        lastError = new Error('Rate limit Omie (HTTP 429).');
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        await setCircuitBreakerBlocked(base44, lastError.message);
        throw lastError;
      }

      const text = await response.text();
      const data = text ? JSON.parse(text) : {};

      if (!response.ok || data?.faultstring || data?.faultcode) {
        const message = data?.faultstring || `Erro HTTP ${response.status} na API Omie.`;
        const faultcode = data?.faultcode || '';
        lastError = new Error(message);
        const lower = message.toLowerCase();
        const faultLower = String(faultcode).toLowerCase();

        // MISUSE_API_PROCESS → bloqueio imediato de 30min, sem retry
        if (faultLower.includes('misuse_api_process') || faultLower.includes('misuse') ||
            lower.includes('consumo indevido') || lower.includes('misuse')) {
          console.error(`[omieClient] MISUSE_API_PROCESS detectado! Bloqueando por 30 min.`);
          await setCircuitBreakerBlocked(base44, `MISUSE_API_PROCESS: ${message}`);
          throw lastError;
        }

        // CÓDIGO 6: "Consumo redundante detectado. Aguarde X segundos"
        // Retry com o tempo exato informado pelo Omie, até 4 tentativas extras
        const isCodigo6 = lower.includes('redundante') || (lower.includes('aguarde') && /\d+\s*segundo/i.test(message));
        if (isCodigo6) {
          const segs = extrairSegundosBloqueio(message);
          const waitMs = segs > 0 ? segs * 1000 : 5000;
          const MAX_COD6 = 4;
          if (attempt < MAX_COD6) {
            console.log(`[omieClient] Código 6 detectado (${call}) → aguardando ${waitMs}ms (tentativa ${attempt + 1}/${MAX_COD6})`);
            await sleep(waitMs);
            continue;
          }
          console.error(`[omieClient] Código 6 esgotou ${MAX_COD6} tentativas (${call}).`);
          await setCircuitBreakerBlocked(base44, message);
          throw lastError;
        }

        // CHAVE DE ACESSO INVÁLIDA: anti-flood severo do Omie (bloqueia a chave
        // temporariamente após rajada). NÃO é credencial errada — as outras chamadas
        // recentes passaram. Tratar como temporário: retry com espera + circuit breaker.
        const isChaveBloqueada = lower.includes('chave de acesso') || lower.includes('chave inválid') ||
            lower.includes('chave invalid') || lower.includes('acesso está inválid') ||
            lower.includes('acesso esta invalid');
        if (isChaveBloqueada) {
          const MAX_CHAVE = 3;
          if (attempt < MAX_CHAVE) {
            const waitMs = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
            console.log(`[omieClient] Chave de acesso bloqueada temporariamente (${call}) → retry em ${waitMs}ms (tentativa ${attempt + 1}/${MAX_CHAVE})`);
            await sleep(waitMs);
            continue;
          }
          console.error(`[omieClient] Chave de acesso bloqueada esgotou ${MAX_CHAVE} tentativas (${call}).`);
          await setCircuitBreakerBlocked(base44, message);
          throw lastError;
        }

        // Bloqueio genérico por rate limit / suspensão
        if (lower.includes('cota') || lower.includes('limite') || lower.includes('aguarde') ||
            lower.includes('bloque') || lower.includes('suspended') || lower.includes('suspens') ||
            response.status === 403 || response.status === 425) {
          await setCircuitBreakerBlocked(base44, message);
        }
        throw lastError;
      }

      if (!writeMethod) {
        memoryCache.set(cacheKey, { value: data, expiresAt: Date.now() + ttlMs });
        await writePersistentCache(base44, cacheKey, endpoint, call, data, ttlMs);
      }

      if (!options.skipLog) {
        await writeLog(base44, {
          endpoint,
          call,
          operacao: options.operation || 'omie_call',
          entidade_tipo: options.entityType,
          entidade_id: options.entityId,
          status: 'sucesso',
          payload_enviado: JSON.stringify({ endpoint, call, param }),
          payload_resposta: JSON.stringify(data),
          duracao_ms: Date.now() - startedAt,
          tentativas: attempts
        });
      }

      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_FIXED_ID, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (error) {
      clearTimeout(timer);
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.name === 'AbortError') lastError = new Error(`Timeout de ${timeoutMs}ms ao chamar a API Omie.`);
      if (attempt < RETRY_DELAYS_MS.length && lastError.message.includes('HTTP 429')) continue;
      break;
    }
  }

  if (!options.skipLog) {
    await writeLog(base44, {
      endpoint,
      call,
      operacao: options.operation || 'omie_call',
      status: 'erro',
      mensagem_erro: lastError?.message || 'Erro desconhecido na API Omie',
      erro_detalhado: lastError?.stack || lastError?.message || '',
      payload_enviado: JSON.stringify({ endpoint, call, param }),
      duracao_ms: Date.now() - startedAt,
      tentativas: attempts
    });
  }

  throw lastError || new Error('Erro desconhecido na API Omie.');
  }
}

if (import.meta.main) {
  Deno.serve(() => Response.json({
    arquivo: 'Cliente Omie centralizado compartilhado',
    funcoes_exportadas: ['omieCall', 'checkCircuitBreaker', 'clearOmieMemoryCache', 'getOmieCredentials']
  }));
}