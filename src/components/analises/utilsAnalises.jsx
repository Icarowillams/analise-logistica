// Normaliza datas DD/MM/YYYY (Omie) para YYYY-MM-DD
export const normalizarData = (dataStr) => {
  const s = String(dataStr || '');
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};

// Chave de mês YYYY-MM, tolerante a formato brasileiro
export const mesKey = (dataStr) => normalizarData(dataStr).slice(0, 7);

export const dentroPeriodo = (dataStr, inicio, fim) => {
  if (!dataStr) return false;
  const d = new Date(normalizarData(dataStr)).getTime();
  if (inicio && d < new Date(inicio).getTime()) return false;
  if (fim && d > new Date(fim).getTime() + 86400000) return false;
  return true;
};

// Arredonda para 2 casas eliminando lixo de ponto flutuante (ex: 237.40000000000003 -> 237.4)
export const arredondar2 = (v) => Math.round(((Number(v) || 0) + Number.EPSILON) * 100) / 100;

export const formatarMoeda = (v) => `R$ ${arredondar2(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const formatarNumero = (v) => (Number(v) || 0).toLocaleString('pt-BR');

// Valor numérico para CSV no padrão brasileiro: 2 casas, vírgula decimal, sem separador de milhar
export const valorCSV = (v) => arredondar2(v).toFixed(2).replace('.', ',');

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