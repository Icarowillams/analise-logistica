// ─────────────────────────────────────────────────────────────────────────────
// Helper CENTRAL de EXIBIÇÃO do número do boleto.
// O Omie devolve o número curto (cNumBoleto, ex "0000001135") com zeros à esquerda
// e, separadamente, o número bancário longo (cNumBancario, ex "35130540000001342").
// Para a UI ficar legível, SEMPRE exibimos o número curto sem zeros à esquerda.
//
// ⚠️ USO EXCLUSIVO DE EXIBIÇÃO (label). NUNCA usar o retorno como chave de seleção,
// dedup, filtro/busca ou payload enviado ao Omie/backend — o dado bruto salvo
// permanece intocado para rastreio.
//
// Regra:
//  - Prioriza o número curto (numeroBoleto) quando disponível.
//  - Número puramente numérico: remove zeros à esquerda (0000001135 → 1135).
//  - Formato bancário longo (17+ dígitos): só usado como fallback se não houver curto.
//  - null/undefined/vazio em ambos: retorna '—'.
//
// Aceita:
//  - formatarNumeroBoleto(numeroBancario, numeroBoleto)
//  - formatarNumeroBoleto(numeroBoleto)
// ─────────────────────────────────────────────────────────────────────────────
function limpar(valor) {
  const s = String(valor ?? '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return s.replace(/^0+/, '') || s;
  return s;
}

export function formatarNumeroBoleto(numeroBancario, numeroBoleto) {
  // Chamada com um único argumento (só o número do boleto)
  if (arguments.length === 1) {
    return limpar(numeroBancario) || '—';
  }

  const curto = limpar(numeroBoleto);
  if (curto) return curto;

  const bancario = limpar(numeroBancario);
  return bancario || '—';
}