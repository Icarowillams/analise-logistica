export const DIAS_SEMANA = [
  { value: 'segunda-feira', label: 'Segunda-feira', curto: 'Seg' },
  { value: 'terca-feira', label: 'Terça-feira', curto: 'Ter' },
  { value: 'quarta-feira', label: 'Quarta-feira', curto: 'Qua' },
  { value: 'quinta-feira', label: 'Quinta-feira', curto: 'Qui' },
  { value: 'sexta-feira', label: 'Sexta-feira', curto: 'Sex' },
  { value: 'sabado', label: 'Sábado', curto: 'Sáb' },
  { value: 'domingo', label: 'Domingo', curto: 'Dom' }
];

export const STATUS_OPTIONS = [
  { value: 'planejado', label: 'Planejado', cor: 'bg-blue-100 text-blue-800' },
  { value: 'ativo', label: 'Ativo', cor: 'bg-green-100 text-green-800' },
  { value: 'pausado', label: 'Pausado', cor: 'bg-yellow-100 text-yellow-800' },
  { value: 'concluido', label: 'Concluído', cor: 'bg-gray-200 text-gray-800' },
  { value: 'inativo', label: 'Inativo', cor: 'bg-red-100 text-red-800' }
];

export const formatarDia = (dia) => {
  const d = DIAS_SEMANA.find(x => x.value === dia || x.value.startsWith(dia));
  return d?.label || dia;
};

export const diaCurto = (dia) => {
  const d = DIAS_SEMANA.find(x => x.value === dia || x.value.startsWith(dia));
  return d?.curto || dia;
};

export const exportarRoteirosCSV = (roteiros, vendedores) => {
  const headers = ['vendedor', 'dia_semana', 'status', 'qtd_clientes', 'observacoes'];
  const linhas = roteiros.map(r => {
    const v = vendedores.find(x => x.id === r.vendedor_id);
    return [
      r.vendedor_nome || v?.nome || '',
      r.dia_semana || '',
      r.status || '',
      r.clientes_ids?.length || r.clientes_detalhes?.length || 0,
      (r.observacoes || '').replace(/[\r\n]+/g, ' ')
    ];
  });
  const csv = [headers.join(';'), ...linhas.map(l => l.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `roteiros_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
};

export const baixarModeloCSV = () => {
  const csv = 'cod_cliente;funcionario;segunda;terca;quarta;quinta;sexta;sabado;domingo\n12345;João Silva;sim;;sim;;sim;;\n67890;Maria Santos;;sim;;sim;;;';
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'modelo_roteiros.csv';
  link.click();
};