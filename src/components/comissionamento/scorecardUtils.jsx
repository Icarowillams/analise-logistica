// Utilitários puros do módulo de Comissionamento & Gamificação

export function brl(v) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function competenciaAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function competenciaLabel(competencia) {
  if (!competencia) return '';
  const [ano, mes] = competencia.split('-');
  const idx = parseInt(mes, 10) - 1;
  return `${MESES[idx] || mes}/${ano}`;
}

const BLOCOS = ['FATURAMENTO', 'COBERTURA', 'MIX', 'QUALIDADE'];

// Agrupa as linhas de ScorecardApuracao (1 por bloco) num objeto por usuário.
export function agruparPorUsuario(apuracoes = []) {
  const mapa = {};

  for (const a of apuracoes) {
    if (!a.usuario_id) continue;
    if (!mapa[a.usuario_id]) {
      mapa[a.usuario_id] = {
        usuario_id: a.usuario_id,
        usuario_nome: a.usuario_nome || '—',
        perfil: a.perfil || 'VENDEDOR',
        competencia: a.competencia,
        blocos: {},
        pontos: 0,
        comissao_oficial: 0,
        comissao_experimental: 0,
        faturamento: 0
      };
    }
    const u = mapa[a.usuario_id];
    u.blocos[a.bloco] = a;
    u.pontos += a.pontos_ranking || 0;

    if (a.status_apuracao === 'EXPERIMENTAL') {
      u.comissao_experimental += a.valor_comissao_bloco || 0;
    } else {
      u.comissao_oficial += a.valor_comissao_bloco || 0;
    }

    if (a.bloco === 'FATURAMENTO') {
      u.faturamento = a.faturamento_base || 0;
    }
  }

  return Object.values(mapa).sort((x, y) => y.comissao_oficial - x.comissao_oficial);
}

export const ORDEM_BLOCOS = BLOCOS;

export const LABEL_BLOCO = {
  FATURAMENTO: 'Faturamento',
  COBERTURA: 'Cobertura',
  MIX: 'Mix',
  QUALIDADE: 'Qualidade'
};

export const COR_NIVEL = {
  ZERADO: 'bg-rose-100 text-rose-700 border-rose-200',
  PADRAO: 'bg-sky-100 text-sky-700 border-sky-200',
  EXCELENCIA: 'bg-emerald-100 text-emerald-700 border-emerald-200'
};

export const LABEL_NIVEL = {
  ZERADO: 'Zerado',
  PADRAO: 'Padrão',
  EXCELENCIA: 'Excelência'
};