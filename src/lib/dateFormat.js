// Helpers centrais de data/hora — sempre exibir em horário de Brasília (America/Sao_Paulo).
// Datas no banco são salvas em UTC; formatamos para BRT na exibição.

const BR_TZ = 'America/Sao_Paulo';

export function fmtDataHora(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: BR_TZ });
  } catch {
    return '-';
  }
}

export function fmtData(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { timeZone: BR_TZ });
  } catch {
    return '-';
  }
}

export function fmtHora(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: BR_TZ });
  } catch {
    return '-';
  }
}