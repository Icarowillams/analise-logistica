// Utilitários e constantes compartilhados do módulo de Comissionamento (Scorecard v2.0).

export const BLOCOS = ['FATURAMENTO', 'COBERTURA', 'MIX', 'QUALIDADE'];

export const BLOCO_LABEL = {
  FATURAMENTO: 'Faturamento',
  COBERTURA: 'Cobertura',
  MIX: 'Mix',
  QUALIDADE: 'Qualidade'
};

export const NIVEL_CONFIG = {
  ZERADO: { label: 'Zerado', pct: 0, cls: 'bg-red-50 text-red-600 border-red-200', bar: 'bg-red-400' },
  PADRAO: { label: 'Padrão', pct: 50, cls: 'bg-blue-50 text-blue-600 border-blue-200', bar: 'bg-blue-500' },
  EXCELENCIA: { label: 'Excelência', pct: 100, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500' }
};

export function brl(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function competenciaAtual() {
  return new Date().toISOString().slice(0, 7);
}

export function competenciaLabel(c) {
  if (!c) return '';
  const [ano, mes] = c.split('-');
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${nomes[Number(mes) - 1]}/${ano}`;
}

// Agrupa as linhas de ScorecardApuracao (uma por bloco) em um objeto por usuário,
// separando comissão OFICIAL de EXPERIMENTAL.
export function agruparPorUsuario(apuracoes) {
  const map = new Map();
  for (const a of apuracoes) {
    if (!map.has(a.usuario_id)) {
      map.set(a.usuario_id, {
        usuario_id: a.usuario_id,
        usuario_nome: a.usuario_nome,
        perfil: a.perfil,
        blocos: {},
        comissao_oficial: 0,
        comissao_experimental: 0,
        pontos: 0
      });
    }
    const u = map.get(a.usuario_id);
    u.blocos[a.bloco] = a;
    u.pontos += Number(a.pontos_ranking) || 0;
    const comissao = Number(a.valor_comissao_bloco) || 0;
    if (a.status_apuracao === 'EXPERIMENTAL') u.comissao_experimental += comissao;
    else u.comissao_oficial += comissao;
  }
  return Array.from(map.values());
}