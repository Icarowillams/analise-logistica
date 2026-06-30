import React from 'react';
import { Button } from '@/components/ui/button';
import { FileText } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { gerarPdfOcorrenciaTroca } from './gerarPdfOcorrenciaTroca';

export default function ExportarPdfOcorrenciaButton({ filtradas, filtros, vendedores, gerando, setGerando }) {
  const handleExport = async () => {
    if (gerando) return;
    if (filtradas.length === 0) {
      alert('Nenhuma troca no filtro atual para exportar.');
      return;
    }
    setGerando(true);
    try {
      // Mesmo padrão da exportação XLSX: getItensPedidosLote em lotes de 200 IDs
      // (a função quebra internamente em $in de 40 no servidor).
      const pedido_ids = filtradas.map(t => t.id);
      const LOTE = 200;
      const itensPorPedidoRaw = {};
      for (let i = 0; i < pedido_ids.length; i += LOTE) {
        const chunk = pedido_ids.slice(i, i + LOTE);
        const resp = await base44.functions.invoke('getItensPedidosLote', { pedido_ids: chunk, troca_ids: [] });
        const parcial = resp?.data?.itens_pedido || {};
        Object.assign(itensPorPedidoRaw, parcial);
      }

      // De-duplicar por id do item (PedidoItem tem duplicados)
      const itensUnicos = new Map();
      Object.values(itensPorPedidoRaw).flat().forEach(it => {
        if (it.id) itensUnicos.set(it.id, it);
      });

      // Indexar por pedido_id
      const itensPorPedido = new Map();
      itensUnicos.forEach(it => {
        if (!it.pedido_id) return;
        const nome = it.produto_nome || it.produto_codigo || '(sem nome)';
        const motivo = it.motivo_troca_descricao || '';
        const valorItem = Number(it.valor_total) > 0
          ? Number(it.valor_total)
          : Number((Number(it.valor_unitario || 0)) * (Number(it.quantidade || 0)));
        if (!itensPorPedido.has(it.pedido_id)) itensPorPedido.set(it.pedido_id, []);
        itensPorPedido.get(it.pedido_id).push({
          produto_codigo: it.produto_codigo || '',
          produto_nome: nome,
          quantidade: Number(it.quantidade || 0),
          valor_total: valorItem,
          motivo_troca_descricao: motivo
        });
      });

      const resultado = gerarPdfOcorrenciaTroca({ filtradas, itensPorPedido, filtros, vendedores });
      console.log(`[Exportar PDF Ocorrência] produtos=${resultado.produtos} | ocorrencias=${resultado.ocorrencias} | pedidos=${filtradas.length}`);
    } finally {
      setGerando(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={gerando}>
      <FileText className="w-4 h-4 mr-1" />
      {gerando ? 'Gerando...' : 'Exportar PDF (Ocorrência por Produto)'}
    </Button>
  );
}