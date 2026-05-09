export const DIAS_SEMANA = [
  { key: 'segunda-feira', curto: 'Seg', alias: ['segunda', 'segunda-feira', 'monday'] },
  { key: 'terca-feira', curto: 'Ter', alias: ['terca', 'terça', 'terca-feira', 'terça-feira', 'tuesday'] },
  { key: 'quarta-feira', curto: 'Qua', alias: ['quarta', 'quarta-feira', 'wednesday'] },
  { key: 'quinta-feira', curto: 'Qui', alias: ['quinta', 'quinta-feira', 'thursday'] },
  { key: 'sexta-feira', curto: 'Sex', alias: ['sexta', 'sexta-feira', 'friday'] },
  { key: 'sabado', curto: 'Sáb', alias: ['sabado', 'sábado', 'saturday'] },
  { key: 'domingo', curto: 'Dom', alias: ['domingo', 'sunday'] }
];

export const diaParaKey = (dia) => {
  if (!dia) return '';
  const d = String(dia).toLowerCase().trim();
  const found = DIAS_SEMANA.find(x => x.alias.includes(d));
  return found?.key || d;
};

export const diaAtualKey = () => DIAS_SEMANA[(new Date().getDay() + 6) % 7].key;

export const hojeISO = () => new Date().toISOString().slice(0, 10);

export const STATUS_VISITA = {
  pendente: { label: 'Pendente', cor: 'bg-amber-100 text-amber-800 border-amber-300' },
  planejada: { label: 'Planejada', cor: 'bg-slate-100 text-slate-700 border-slate-200' },
  em_andamento: { label: 'Em Andamento', cor: 'bg-blue-100 text-blue-700 border-blue-300' },
  concluida: { label: 'Concluída', cor: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  nao_atendimento: { label: 'Não Atendimento', cor: 'bg-red-100 text-red-700 border-red-300' },
  reagendada: { label: 'Reagendada', cor: 'bg-purple-100 text-purple-700 border-purple-300' }
};

export const calcularDuracao = (inicio, fim) => {
  if (!inicio || !fim) return 0;
  const ms = new Date(fim).getTime() - new Date(inicio).getTime();
  return ms > 0 ? Math.round(ms / 60000) : 0;
};

export const formatarData = (data) => {
  if (!data) return '-';
  return new Date(data).toLocaleDateString('pt-BR');
};

export const exportarCSV = (nome, headers, linhas) => {
  const csv = [headers.join(';'), ...linhas.map(l => l.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${nome}_${hojeISO()}.csv`;
  link.click();
};

export const formatarMoeda = (v) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const formatarNumero = (v) => (Number(v) || 0).toLocaleString('pt-BR');