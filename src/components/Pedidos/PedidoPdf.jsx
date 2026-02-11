import React, { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

export default function PedidoPdf({ pedidoId }) {
  const printRef = useRef();

  const { data: pedido } = useQuery({
    queryKey: ['pedido-pdf', pedidoId],
    queryFn: async () => {
      const list = await base44.entities.Pedido.filter({});
      return list.find(p => p.id === pedidoId);
    },
    enabled: !!pedidoId
  });

  const { data: items = [] } = useQuery({
    queryKey: ['pedido-pdf-items', pedidoId],
    queryFn: () => base44.entities.PedidoItem.filter({ pedido_id: pedidoId }),
    enabled: !!pedidoId
  });

  if (!pedido) return <p className="text-center py-8 text-slate-500">Carregando...</p>;

  const modeloLabel = pedido.modelo_nota === 'd1' ? 'D1' : pedido.modelo_nota === '55' ? '55' : 'NFCe';
  const totalProdutos = items.reduce((s, i) => s + (i.valor_total || 0), 0);
  const dataEmissao = pedido.created_date ? new Date(pedido.created_date).toLocaleDateString('pt-BR') : '';
  const dataEnvio = pedido.data_envio ? new Date(pedido.data_envio).toLocaleDateString('pt-BR') : '';

  const handlePrint = () => {
    const content = printRef.current;
    const win = window.open('', '_blank');
    win.document.write(`
      <html><head><title>Pedido_${pedido.numero_pedido || 'N/A'}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th, td { border: 1px solid #333; padding: 4px 6px; text-align: left; font-size: 11px; }
        th { background: #f0f0f0; font-weight: bold; }
        .header { text-align: center; margin-bottom: 12px; }
        .section { margin-top: 12px; font-weight: bold; border-bottom: 1px solid #333; padding-bottom: 2px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 11px; }
        .right { text-align: right; }
      </style></head><body>${content.innerHTML}</body></html>
    `);
    win.document.close();
    win.print();
  };

  return (
    <div className="space-y-4">
      <Button onClick={handlePrint} className="bg-gradient-to-r from-blue-500 to-blue-600">
        <Download className="w-4 h-4 mr-2" /> Imprimir / Salvar PDF
      </Button>

      <div ref={printRef} className="bg-white p-6 border rounded-lg text-sm">
        <div className="text-center mb-4">
          <h2 className="font-bold text-lg">PAO E MEL INDUSTRIA DE PANIFICACAO LTDA ME</h2>
          <p className="text-xs">PAO E MEL</p>
          {pedido.numero_pedido && <p className="mt-2 font-bold">Pedido {pedido.numero_pedido}</p>}
          <p className="text-xs">{dataEmissao}</p>
        </div>

        <div className="section">CLIENTE</div>
        <div className="info-grid">
          <div><strong>Código:</strong> {pedido.cliente_codigo}</div>
          <div><strong>CPF/CNPJ:</strong> {pedido.cliente_cpf_cnpj}</div>
          <div><strong>Nome/Razão:</strong> {pedido.cliente_nome}</div>
          <div><strong>Fantasia:</strong> {pedido.cliente_nome_fantasia}</div>
          <div><strong>Endereço:</strong> {pedido.cliente_endereco}, {pedido.cliente_numero}</div>
          <div><strong>Bairro:</strong> {pedido.cliente_bairro}</div>
          <div><strong>Cidade:</strong> {pedido.cliente_cidade} - {pedido.cliente_estado}</div>
          <div><strong>CEP:</strong> {pedido.cliente_cep}</div>
        </div>

        <div className="section">INFORMAÇÕES DO PEDIDO</div>
        <div className="info-grid">
          <div><strong>Vendedor:</strong> {pedido.vendedor_nome}</div>
          <div><strong>Modelo:</strong> {modeloLabel}</div>
          <div><strong>Pagamento:</strong> {pedido.plano_pagamento_nome}</div>
          <div><strong>Tabela:</strong> {pedido.tabela_preco_nome}</div>
          <div><strong>Data Emissão:</strong> {dataEmissao}</div>
          <div><strong>Data Envio:</strong> {dataEnvio}</div>
          {pedido.numero_pedido_compra && <div><strong>Nº Ped. Compra:</strong> {pedido.numero_pedido_compra}</div>}
        </div>

        {pedido.observacoes && (
          <>
            <div className="section">OBSERVAÇÃO</div>
            <p>{pedido.observacoes}</p>
          </>
        )}

        <div className="section">DADOS DOS PRODUTOS</div>
        <table>
          <thead>
            <tr>
              <th>Cód.</th>
              <th>Descrição do Produto</th>
              <th className="right">Qtd.</th>
              <th className="right">Vl. Unit.</th>
              <th className="right">Vl. Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx}>
                <td>{item.produto_codigo}</td>
                <td>{item.produto_nome}</td>
                <td className="right">{item.quantidade}</td>
                <td className="right">{(item.valor_unitario || 0).toFixed(2)}</td>
                <td className="right">{(item.valor_total || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="4" className="right"><strong>TOTAL</strong></td>
              <td className="right"><strong>{totalProdutos.toFixed(2)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}