import { useState, useCallback } from 'react';

const STORAGE_KEY = 'gerenciar-pedidos-column-order-v5';

export const DEFAULT_COLUMNS = [
  { id: 'numero_pedido', label: 'Nº Pedido', field: 'numero_pedido' },
  { id: 'cliente_codigo', label: 'Cód. Cliente', field: 'cliente_codigo' },
  { id: 'cliente_nome', label: 'Cliente', field: 'cliente_nome' },
  { id: 'cliente_nome_fantasia', label: 'Fantasia', field: 'cliente_nome_fantasia' },
  { id: 'cliente_cpf_cnpj', label: 'CPF/CNPJ', field: 'cliente_cpf_cnpj' },
  { id: 'valor_total', label: 'Valor', field: 'valor_total' },
  { id: 'total_itens', label: 'Total Itens', field: 'total_itens' },
  { id: 'preco_medio', label: 'Preço Médio', field: 'preco_medio', computed: true },
  { id: 'tipo', label: 'Tipo', field: 'tipo' },
  { id: 'status', label: 'Status', field: 'status', custom: true },
  { id: 'etapa_omie', label: 'Etapa Omie', field: 'omie_etapa_real', custom: true },
  { id: 'vendedor_nome', label: 'Vendedor', field: 'vendedor_nome' },
  { id: 'cliente_cidade', label: 'Cidade', field: 'cliente_cidade' },
  { id: 'plano_pagamento_nome', label: 'Plano Pgto', field: 'plano_pagamento_nome' },
  { id: 'tabela_preco_nome', label: 'Tab. Preço', field: 'tabela_preco_nome' },
  { id: 'data_previsao_entrega', label: 'Prev. Entrega', field: 'data_previsao_entrega' },
  { id: 'numero_carga', label: 'N Carga', field: 'numero_carga' },
  { id: 'usuario_envio', label: 'Usuário Envio', field: 'created_by' },
  { id: 'liberado_por_nome', label: 'Liberado por', field: 'liberado_por_nome' },
  { id: 'data_liberacao', label: 'Dt. Liberação', field: 'data_liberacao' },
  { id: 'cancelado_por_nome', label: 'Cancelado por', field: 'cancelado_por_nome' },
  { id: 'data_cancelamento', label: 'Dt. Cancelamento', field: 'data_cancelamento' },
  { id: 'motivo_cancelamento', label: 'Motivo Cancel.', field: 'motivo_cancelamento' },
  { id: 'data_envio', label: 'Dt. Envio', field: 'data_envio' },
  { id: 'created_date', label: 'Dt. Criação', field: 'created_date' },
];

function loadOrder() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const ids = JSON.parse(saved);
    if (!Array.isArray(ids)) return null;
    // Rebuild from saved order, adding any new columns at end
    const colMap = {};
    DEFAULT_COLUMNS.forEach(c => { colMap[c.id] = c; });
    const ordered = [];
    ids.forEach(id => {
      if (colMap[id]) {
        ordered.push(colMap[id]);
        delete colMap[id];
      }
    });
    // Append any columns not in saved order
    Object.values(colMap).forEach(c => ordered.push(c));
    return ordered;
  } catch {
    return null;
  }
}

function saveOrder(columns) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(columns.map(c => c.id)));
}

export default function useColumnOrder() {
  const [columns, setColumns] = useState(() => loadOrder() || DEFAULT_COLUMNS);

  const reorder = useCallback((sourceIndex, destinationIndex) => {
    setColumns(prev => {
      const result = Array.from(prev);
      const [removed] = result.splice(sourceIndex, 1);
      result.splice(destinationIndex, 0, removed);
      saveOrder(result);
      return result;
    });
  }, []);

  const resetOrder = useCallback(() => {
    setColumns(DEFAULT_COLUMNS);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { columns, reorder, resetOrder };
}