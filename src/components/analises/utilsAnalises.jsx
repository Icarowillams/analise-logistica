export const dentroPeriodo = (dataStr, inicio, fim) => {
  if (!dataStr) return false;
  const d = new Date(dataStr).getTime();
  if (inicio && d < new Date(inicio).getTime()) return false;
  if (fim && d > new Date(fim).getTime() + 86400000) return false;
  return true;
};

export const formatarMoeda = (v) => `R$ ${(Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatarNumero = (v) => (Number(v) || 0).toLocaleString('pt-BR');

export const exportarCSV = (nome, headers, linhas) => {
  const csv = [headers.join(';'), ...linhas.map(l => l.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${nome}_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
};

export const agruparPorMes = (items, campoData) => {
  const grupo = {};
  items.forEach(i => {
    const data = i[campoData];
    if (!data) return;
    const k = String(data).slice(0, 7);
    grupo[k] = (grupo[k] || 0) + 1;
  });
  return Object.entries(grupo).sort(([a], [b]) => a.localeCompare(b)).map(([mes, qtd]) => ({ mes, qtd }));
};

export const duracaoMin = (inicio, fim) => {
  if (!inicio || !fim) return 0;
  const ms = new Date(fim).getTime() - new Date(inicio).getTime();
  return ms > 0 ? Math.round(ms / 60000) : 0;
};