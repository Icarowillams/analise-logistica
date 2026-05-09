export const DIAS_SEMANA = [
  { key: 'segunda-feira', label: 'Segunda' },
  { key: 'terca-feira', label: 'Terça' },
  { key: 'quarta-feira', label: 'Quarta' },
  { key: 'quinta-feira', label: 'Quinta' },
  { key: 'sexta-feira', label: 'Sexta' },
  { key: 'sabado', label: 'Sábado' },
  { key: 'domingo', label: 'Domingo' }
];

export const normalizarDia = (dia) => {
  const mapa = {
    segunda: 'segunda-feira',
    terca: 'terca-feira',
    terça: 'terca-feira',
    quarta: 'quarta-feira',
    quinta: 'quinta-feira',
    sexta: 'sexta-feira'
  };
  return mapa[dia] || dia;
};

export const hojeISO = () => new Date().toISOString().slice(0, 10);

export const visitaDoCliente = (visitas, roteiroId, clienteId) =>
  visitas.find(v => v.roteiro_id === roteiroId && v.cliente_id === clienteId);

export const statusVisitaClasses = {
  planejada: 'bg-slate-100 text-slate-700 border-slate-200',
  em_andamento: 'bg-blue-100 text-blue-700 border-blue-200',
  visitado: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  nao_visitado: 'bg-red-100 text-red-700 border-red-200',
  reagendado: 'bg-amber-100 text-amber-700 border-amber-200'
};

export const formatarStatus = (status) => ({
  planejada: 'Planejada',
  em_andamento: 'Em andamento',
  visitado: 'Visitado',
  nao_visitado: 'Não visitado',
  reagendado: 'Reagendado'
}[status] || status || 'Planejada');