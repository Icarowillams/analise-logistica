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
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; padding: 30px; color: #1a1a1a; background: #fff; }
        .pdf-header { text-align: center; padding-bottom: 16px; border-bottom: 3px solid #d97706; margin-bottom: 20px; }
        .pdf-header h1 { font-size: 18px; font-weight: 700; color: #92400e; letter-spacing: 0.5px; }
        .pdf-header .subtitle { font-size: 11px; color: #78716c; margin-top: 2px; }
        .pdf-header .pedido-num { font-size: 14px; font-weight: 700; color: #1a1a1a; margin-top: 10px; display: inline-block; background: #fef3c7; padding: 4px 16px; border-radius: 4px; }
        .pdf-header .pedido-data { font-size: 11px; color: #78716c; margin-top: 4px; }
        .section-title { font-size: 11px; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 1px; padding: 6px 0 4px; margin-top: 16px; border-bottom: 1.5px solid #e5e7eb; margin-bottom: 8px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; font-size: 11px; }
        .info-grid .label { color: #78716c; font-size: 10px; }
        .info-grid .value { font-weight: 500; color: #1a1a1a; }
        .info-row { margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 11px; }
        thead th { background: #fef3c7; color: #92400e; font-weight: 700; padding: 8px 6px; text-align: left; border-bottom: 2px solid #d97706; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
        tbody td { padding: 7px 6px; border-bottom: 1px solid #f3f4f6; }
        tbody tr:nth-child(even) { background: #fafafa; }
        tfoot td { padding: 10px 6px; font-weight: 700; border-top: 2px solid #d97706; background: #fef3c7; }
        .right { text-align: right; }
        .obs-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 4px; padding: 8px 12px; margin-top: 8px; font-size: 11px; }
        .footer { margin-top: 30px; text-align: center; font-size: 10px; color: #a8a29e; border-top: 1px solid #e5e7eb; padding-top: 12px; }
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

      <div ref={printRef} className="bg-white p-8 border rounded-xl shadow-sm text-sm max-w-3xl mx-auto">
        {/* Header */}
        <div className="pdf-header">
          <h1>PAO E MEL INDUSTRIA DE PANIFICACAO LTDA ME</h1>
          <p className="subtitle">PAO E MEL</p>
          {pedido.numero_pedido && <div className="pedido-num">Pedido Nº {pedido.numero_pedido}</div>}
          <p className="pedido-data">{dataEmissao}</p>
        </div>

        {/* Cliente */}
        <div className="section-title">Dados do Cliente</div>
        <div className="info-grid">
          <div className="info-row"><span className="label">Código</span><br /><span className="value">{pedido.cliente_codigo}</span></div>
          <div className="info-row"><span className="label">CPF/CNPJ</span><br /><span className="value">{pedido.cliente_cpf_cnpj || '-'}</span></div>
          <div className="info-row"><span className="label">Nome/Razão Social</span><br /><span className="value">{pedido.cliente_nome}</span></div>
          <div className="info-row"><span className="label">Nome Fantasia</span><br /><span className="value">{pedido.cliente_nome_fantasia || '-'}</span></div>
          <div className="info-row"><span className="label">Endereço</span><br /><span className="value">{[pedido.cliente_endereco, pedido.cliente_numero].filter(Boolean).join(', ')}</span></div>
          <div className="info-row"><span className="label">Bairro</span><br /><span className="value">{pedido.cliente_bairro || '-'}</span></div>
          <div className="info-row"><span className="label">Cidade / UF</span><br /><span className="value">{[pedido.cliente_cidade, pedido.cliente_estado].filter(Boolean).join(' - ')}</span></div>
          <div className="info-row"><span className="label">CEP</span><br /><span className="value">{pedido.cliente_cep || '-'}</span></div>
        </div>

        {/* Info Pedido */}
        <div className="section-title">Informações do Pedido</div>
        <div className="info-grid">
          <div className="info-row"><span className="label">Vendedor</span><br /><span className="value">{pedido.vendedor_nome}</span></div>
          <div className="info-row"><span className="label">Modelo da Nota</span><br /><span className="value">{modeloLabel}</span></div>
          <div className="info-row"><span className="label">Plano de Pagamento</span><br /><span className="value">{pedido.plano_pagamento_nome || '-'}</span></div>
          <div className="info-row"><span className="label">Tabela de Preço</span><br /><span className="value">{pedido.tabela_preco_nome || '-'}</span></div>
          <div className="info-row"><span className="label">Data Emissão</span><br /><span className="value">{dataEmissao}</span></div>
          <div className="info-row"><span className="label">Data Envio</span><br /><span className="value">{dataEnvio || '-'}</span></div>
          {pedido.numero_pedido_compra && <div className="info-row"><span className="label">Nº Ped. Compra</span><br /><span className="value">{pedido.numero_pedido_compra}</span></div>}
          {pedido.data_previsao_entrega && <div className="info-row"><span className="label">Previsão Entrega</span><br /><span className="value">{new Date(pedido.data_previsao_entrega + 'T12:00:00').toLocaleDateString('pt-BR')}</span></div>}
        </div>

        {/* Observações */}
        {pedido.observacoes && (
          <>
            <div className="section-title">Observações</div>
            <div className="obs-box">{pedido.observacoes}</div>
          </>
        )}

        {/* Produtos */}
        <div className="section-title">Produtos</div>
        <table>
          <thead>
            <tr>
              <th style={{width:'60px'}}>Cód.</th>
              <th>Descrição do Produto</th>
              <th className="right" style={{width:'60px'}}>Qtd.</th>
              <th className="right" style={{width:'80px'}}>Vl. Unit.</th>
              <th className="right" style={{width:'90px'}}>Vl. Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx}>
                <td>{item.produto_codigo}</td>
                <td>{item.produto_nome}</td>
                <td className="right">{item.quantidade}</td>
                <td className="right">R$ {(item.valor_unitario || 0).toFixed(2)}</td>
                <td className="right">R$ {(item.valor_total || 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan="4" className="right">TOTAL</td>
              <td className="right">R$ {totalProdutos.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Footer */}
        <div className="footer">
          Documento gerado em {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} — Pão e Mel
        </div>
      </div>
    </div>
  );
}