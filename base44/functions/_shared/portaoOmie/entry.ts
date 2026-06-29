// ═══════════════════════════════════════════════════════════════════════════
// PORTÃO ÚNICO SERIALIZADO (mutex global) para chamadas ao Omie.
//
// PROBLEMA QUE RESOLVE: cada worker (Fila Envio, Fila Carga, Fila Webhook) tinha
// seu PRÓPRIO lock dedicado (worker_envio_pedido, worker_carga, ...). Esses locks
// são independentes entre si → os três podiam acordar no mesmo minuto, quando o
// breaker liberava, e bater no Omie EM PARALELO → rajada → re-bloqueio "consumo
// indevido". Este portão é um lock ÚNICO que TODOS compartilham: enquanto uma
// operação o detém, qualquer outra ABORTA cedo (sem tocar o Omie) e tenta de novo
// no próximo ciclo. Só UMA operação por vez toca o Omie.
//
// Reusa a entidade ControleCircuitBreakerOmie com a chave dedicada abaixo —
// campos worker_rodando + worker_lock_ate (TTL de auto-release) + ultimo_erro
// (guarda o "dono" atual para confirmar a aquisição atômica).
// ═══════════════════════════════════════════════════════════════════════════

export const CHAVE_PORTAO = 'portao_global_omie';
// TTL ÚNICO para TODOS os workers (envio/carga/webhook). 160s = folga mínima acima do teto
// de 150s do envio (maior teto entre os workers). Encurtado de 180s para reduzir a janela em
// que um portão zombie (isolate morto por 502/timeout, sem passar pelo finally) trava TODOS
// os workers. Auto-libera ao expirar.
export const PORTAO_TTL_MS = 160 * 1000;

// Chaves dos locks das filas de OPERAÇÃO (prioritárias). Usadas só para a regra de
// prioridade (rotinas de leitura cedem a vez quando há trabalho de operação pendente).
const STATUS_PENDENTE = 'pendente';

function novoDonoId(nome) {
  return `${nome || 'op'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getRegistroPortao(base44) {
  // BLINDAGEM CONTRA REGRESSÃO DE DUPLICATA:
  // 1) Distingue "filter FALHOU" (rede/429) de "filter vazio de verdade". Sob 429 o filter
  //    lançava, o .catch devolvia [] e a função CRIAVA um 2º registro → foi assim que o
  //    órfão reapareceu. Agora: se o filter falhar, RETORNAMOS null (não criamos nada).
  // 2) Só cria registro quando a leitura teve SUCESSO e veio realmente vazia.
  // 3) Dedupe SEMPRE que há mais de um: mantém o CANÔNICO (mais antigo) e apaga os extras.
  //    O canônico determinístico evita que adquirir/liberar batam em registros diferentes.
  let rows;
  try {
    rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
      .filter({ chave: CHAVE_PORTAO }, 'created_date', 20);
  } catch {
    return null; // leitura falhou — NUNCA cria duplicata; tenta de novo no próximo ciclo
  }
  if (!rows?.length) {
    const created = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
      .create({ chave: CHAVE_PORTAO, worker_rodando: false, atualizado_em: new Date().toISOString() })
      .catch(() => null);
    return created?.id ? created : null;
  }
  // Mantém o mais antigo (canônico) e apaga TODOS os extras, sempre.
  for (const extra of rows.slice(1)) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.delete(extra.id).catch(() => null);
  }
  return rows[0];
}

/**
 * Tenta adquirir o portão único. Aquisição ATÔMICA por marca-e-confirma:
 * grava o donoId em ultimo_erro e relê — só assume o lock se o donoId persistiu
 * (vence a corrida entre instâncias). Retorna { adquirido, donoId } ou { adquirido:false }.
 */
export async function adquirirPortao(base44, nomeOperacao, ttlMs = PORTAO_TTL_MS) {
  const reg = await getRegistroPortao(base44);
  if (!reg?.id) return { adquirido: false };

  const agora = Date.now();
  const lockAtivo = reg.worker_rodando && reg.worker_lock_ate && new Date(reg.worker_lock_ate).getTime() > agora;
  if (lockAtivo) return { adquirido: false, ocupadoPor: reg.ultimo_erro || 'desconhecido', bloqueado_ate: reg.worker_lock_ate };

  const donoId = novoDonoId(nomeOperacao);
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(reg.id, {
    worker_rodando: true,
    worker_lock_ate: new Date(agora + ttlMs).toISOString(),
    ultimo_erro: donoId,
    atualizado_em: new Date().toISOString()
  }).catch(() => null);

  // Confirma a posse (vence corridas): relê e só assume se o donoId persistiu.
  const confirm = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
    .filter({ id: reg.id }, '-created_date', 1).catch(() => []);
  if (confirm?.[0]?.ultimo_erro !== donoId) {
    return { adquirido: false, ocupadoPor: confirm?.[0]?.ultimo_erro || 'concorrente' };
  }
  return { adquirido: true, donoId, regId: reg.id };
}

/** Libera o portão (só se ainda formos o dono — evita liberar lock de outra instância). */
export async function liberarPortao(base44, donoId) {
  const reg = await getRegistroPortao(base44);
  if (!reg?.id) return;
  if (donoId && reg.ultimo_erro && reg.ultimo_erro !== donoId) return; // não é nosso — não libera
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(reg.id, {
    worker_rodando: false, worker_lock_ate: null, ultimo_erro: null, atualizado_em: new Date().toISOString()
  }).catch(() => null);
}

/**
 * PRIORIDADE: indica se há trabalho de OPERAÇÃO pendente (Fila Envio ou Fila Carga).
 * As rotinas de LEITURA/limpeza (Corrigir Espelho, reconciliações) chamam isto e CEDEM
 * a vez (abortam) quando retorna true — operação na frente, limpeza atrás.
 */
export async function temTrabalhoOperacaoPendente(base44) {
  const [envio, carga] = await Promise.all([
    base44.asServiceRole.entities.FilaEnvioPedidoOmie.filter({ status: STATUS_PENDENTE }, 'created_date', 1).catch(() => []),
    base44.asServiceRole.entities.FilaCargaOmie.filter({ status: STATUS_PENDENTE }, 'created_date', 1).catch(() => [])
  ]);
  return (envio?.length > 0) || (carga?.length > 0);
}

if (import.meta.main) {
  Deno.serve(() => Response.json({
    arquivo: 'Portão único serializado do Omie (mutex global compartilhado)',
    funcoes: ['adquirirPortao', 'liberarPortao', 'temTrabalhoOperacaoPendente'],
    chave_lock: CHAVE_PORTAO
  }));
}