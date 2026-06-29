// Classificação VISUAL (somente leitura) dos itens da FilaCargaOmie.
// NÃO reescreve nenhum registro nem chama o Omie — apenas interpreta status + erro_log
// para dar rótulo/cor coerentes ao operador.
//
// Categorias derivadas:
//  - sucesso        → concluído OK (inclui "já faturado etapa 60", que é SUCESSO)
//  - aguardando     → transitório (rate limit / consumo redundante / aguardando ação humana)
//  - erro_real      → falha terminal acionável (dados inválidos, SEFAZ, cliente bloqueado)
//  - pendente       → ainda na fila, sem erro
//  - processando    → sendo processado agora

const RE_JA_FATURADO = /j[áa]\s*faturad|etapa\s*60/i;
const RE_RATE_LIMIT = /consumo\s*redundante|consumo\s*indevido|rate\s*limit|425|aguard.*omie/i;

// "carga excluída/cancelada" são órfãos legítimos — tratados separadamente pelo botão próprio,
// então não entram nem em erro_real nem em aguardando.
const RE_CARGA_EXCLUIDA = /carga\s*exclu[íi]da|carga\s*cancelada|cancelado:\s*carga/i;

export function classificarItemFila(item) {
  const status = item?.status;
  const log = String(item?.erro_log || '');

  // Concluído que na verdade é "já faturado etapa 60" → SUCESSO explícito (verde, não vermelho).
  if (status === 'concluido') {
    return RE_JA_FATURADO.test(log) ? 'sucesso_ja_faturado' : 'sucesso';
  }

  if (status === 'processando') return 'processando';

  // aguardando_acao_humana é um status próprio da entidade — transitório, não é erro.
  if (status === 'aguardando_acao_humana') return 'aguardando';

  if (status === 'pendente') {
    // pendente aguardando janela do Omie (proxima_tentativa_em futura) = aguardando
    if (item?.proxima_tentativa_em && new Date(item.proxima_tentativa_em).getTime() > Date.now()) {
      return 'aguardando';
    }
    return RE_RATE_LIMIT.test(log) ? 'aguardando' : 'pendente';
  }

  if (status === 'erro') {
    if (RE_CARGA_EXCLUIDA.test(log)) return 'orfao';        // tratado pelo botão de órfãos
    if (RE_RATE_LIMIT.test(log)) return 'aguardando';        // rate limit transitório → não é erro real
    if (RE_JA_FATURADO.test(log)) return 'sucesso_ja_faturado'; // erro gravado que é, na prática, sucesso
    return 'erro_real';
  }

  return 'pendente';
}

// True se a mensagem deve ser exibida como sucesso (verde), não erro.
export function ehJaFaturado(item) {
  return RE_JA_FATURADO.test(String(item?.erro_log || ''));
}

export function ehRateLimit(item) {
  return RE_RATE_LIMIT.test(String(item?.erro_log || ''));
}