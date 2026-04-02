import React, { useRef, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Download, ArrowLeft, Loader2 } from 'lucide-react';

const LOGO_URL = "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6926e3c1dcadc4e314506362/7c2bd1831_8297750cb_cropped-cropped-logo.png";

const printStyles = `
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #000; padding: 10px; }
.pedido-page { page-break-after: always; padding: 20px; }
.pedido-page:last-child { page-break-after: auto; }
.header-table { width:100%; border-collapse:collapse; border:1.5px solid #000; }
.header-table td { padding:4px 6px; vertical-align:middle; }
.section-title { background:#e5e5e5; font-weight:700; font-size:10px; padding:3px 6px; border:1.5px solid #000; border-bottom:none; margin-top:8px; }
.grid-table { width:100%; border-collapse:collapse; border:1.5px solid #000; }
.grid-table td { border:1px solid #999; padding:2px 5px; font-size:9px; vertical-align:top; }
.grid-table .lbl { font-size:8px; color:#555; display:block; }
.grid-table .val { font-size:10px; font-weight:500; }
.prod-table { width:100%; border-collapse:collapse; border:1.5px solid #000; }
.prod-table th { background:#e5e5e5; border:1px solid #999; padding:3px 5px; font-size:8px; font-weight:700; text-transform:uppercase; text-align:center; }
.prod-table td { border:1px solid #999; padding:3px 5px; font-size:9px; }
.prod-table tfoot td { font-weight:700; background:#f5f5f5; }
.obs-box { border:1.5px solid #000; border-top:none; padding:6px; min-height:25px; font-size:9px; }
.footer { text-align:center; margin-top:16px; font-size:8px; color:#888; }
@media print { .pedido-page { page-break-after: always; } .pedido-page:last-child { page-break-after: auto; } }
`;

const fmtMoney = (v) => (v || 0).toFixed(2);
const fmtMoney3 = (v) => (v || 0).toFixed(3);

function PedidoPageContent({ pedido, items, empresa }) {
  const modeloLabel = pedido.modelo_nota === 'd1' ? 'D1' : pedido.modelo_nota === 'nfce' ? 'NFCe' : '55';
  const totalProdutos = items.reduce((s, i) => s + (i.valor_total || 0), 0);
  const totalQtd = items.reduce((s, i) => s + (i.quantidade || 0), 0);
  const dataEmissao = pedido.created_date ? new Date(pedido.created_date).toLocaleDateString('pt-BR') : '';
  const dataEnvio = pedido.data_envio ? new Date(pedido.data_envio).toLocaleDateString('pt-BR') : '';
  const dataEntrega = pedido.data_previsao_entrega ? new Date(pedido.data_previsao_entrega + 'T12:00:00').toLocaleDateString('pt-BR') : '';

  return (
    <div className="pedido-page" style={{ position: 'relative' }}>
      {pedido.status === 'cancelado' && (
        <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%, -50%) rotate(-35deg)', fontSize:'80px', fontWeight:900, color:'rgba(220, 38, 38, 0.18)', textTransform:'uppercase', letterSpacing:'12px', pointerEvents:'none', zIndex:10, whiteSpace:'nowrap' }}>CANCELADO</div>
      )}
      {pedido.status === 'cancelado' && (
        <div style={{ background:'#DC2626', color:'#FFF', textAlign:'center', padding:'8px', fontSize:'14px', fontWeight:700, letterSpacing:'2px', marginBottom:'8px', textTransform:'uppercase' }}>✕ PEDIDO CANCELADO</div>
      )}

      {/* HEADER */}
      <table style={{ width:'100%', borderCollapse:'collapse', border:'1.5px solid #000' }}>
        <tbody><tr>
          <td style={{ width:'90px', textAlign:'center', borderRight:'1.5px solid #000', padding:'6px' }}>
            <img src={LOGO_URL} alt="Logo" style={{ height:'60px' }} />
          </td>
          <td style={{ textAlign:'center', padding:'6px' }}>
            <div style={{ fontSize:'13px', fontWeight:700 }}>{empresa?.razao_social || 'PAO E MEL INDUSTRIA DE PANIFICACAO LTDA ME'}</div>
            <div style={{ fontSize:'9px', color:'#555' }}>{empresa?.nome_fantasia || 'PAO E MEL'}</div>
            {empresa && <div style={{ fontSize:'8px', color:'#555', marginTop:'2px' }}>CNPJ: {empresa.cnpj} — IE: {empresa.inscricao_estadual || '-'} — Tel: {empresa.telefone || '-'}</div>}
          </td>
          <td style={{ width:'140px', borderLeft:'1.5px solid #000', padding:'6px', fontSize:'10px' }}>
            <div><span style={{ fontWeight:700 }}>Pedido</span></div>
            <div style={{ fontSize:'14px', fontWeight:700 }}>{pedido.numero_pedido || '-'}</div>
            <div style={{ marginTop:'4px' }}>{dataEmissao}</div>
          </td>
        </tr></tbody>
      </table>

      {/* CLIENTE */}
      <div style={{ background:'#e5e5e5', fontWeight:700, fontSize:'10px', padding:'3px 6px', border:'1.5px solid #000', borderBottom:'none', marginTop:'8px' }}>CLIENTE</div>
      <table style={{ width:'100%', borderCollapse:'collapse', border:'1.5px solid #000' }}>
        <tbody>
          <tr>
            <td style={{ border:'1px solid #999', padding:'2px 5px', width:'80px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>CÓDIGO</span><span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_codigo}</span></td>
            <td style={{ border:'1px solid #999', padding:'2px 5px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>NOME/RAZÃO SOCIAL</span><span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_nome}</span></td>
            <td style={{ border:'1px solid #999', padding:'2px 5px', width:'140px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>CPF/CNPJ</span><span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_cpf_cnpj || '-'}</span></td>
          </tr>
          <tr>
            <td colSpan="3" style={{ border:'1px solid #999', padding:'2px 5px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>FANTASIA</span><span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_nome_fantasia || '-'}</span></td>
          </tr>
          <tr>
            <td colSpan="2" style={{ border:'1px solid #999', padding:'2px 5px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>ENDEREÇO</span><span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_endereco || '-'}</span></td>
            <td style={{ border:'1px solid #999', padding:'2px 5px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>NÚMERO</span><span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_numero || '-'}</span></td>
          </tr>
          <tr>
            <td style={{ border:'1px solid #999', padding:'2px 5px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>BAIRRO</span><span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_bairro || '-'}</span></td>
            <td style={{ border:'1px solid #999', padding:'2px 5px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>CIDADE</span><span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_cidade || '-'}</span></td>
            <td style={{ border:'1px solid #999', padding:'2px 5px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>UF / CEP</span><span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_estado || '-'} / {pedido.cliente_cep || '-'}</span></td>
          </tr>
        </tbody>
      </table>

      {/* OUTRAS INFORMAÇÕES */}
      <div style={{ background:'#e5e5e5', fontWeight:700, fontSize:'10px', padding:'3px 6px', border:'1.5px solid #000', borderBottom:'none', marginTop:'8px' }}>OUTRAS INFORMAÇÕES</div>
      <table style={{ width:'100%', borderCollapse:'collapse', border:'1.5px solid #000' }}>
        <tbody>
          <tr>
            <td style={{ border:'1px solid #999', padding:'2px 5px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>MODELO NOTA</span><span style={{ fontSize:'10px', fontWeight:500 }}>{modeloLabel}</span></td>
            <td style={{ border:'1px solid #999', padding:'2px 5px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>PLANO PAGAMENTO</span><span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.plano_pagamento_nome || '-'}</span></td>
            <td style={{ border:'1px solid #999', padding:'2px 5px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>TABELA DE PREÇO</span><span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.tabela_preco_nome || '-'}</span></td>
            <td style={{ border:'1px solid #999', padding:'2px 5px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>VENDEDOR</span><span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.vendedor_nome}</span></td>
          </tr>
          <tr>
            <td style={{ border:'1px solid #999', padding:'2px 5px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>DATA EMISSÃO</span><span style={{ fontSize:'10px', fontWeight:500 }}>{dataEmissao}</span></td>
            <td style={{ border:'1px solid #999', padding:'2px 5px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>DATA ENVIO</span><span style={{ fontSize:'10px', fontWeight:500 }}>{dataEnvio || '-'}</span></td>
            <td style={{ border:'1px solid #999', padding:'2px 5px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>PREVISÃO ENTREGA</span><span style={{ fontSize:'10px', fontWeight:500 }}>{dataEntrega || '-'}</span></td>
            <td style={{ border:'1px solid #999', padding:'2px 5px' }}><span style={{ fontSize:'8px', color:'#555', display:'block' }}>Nº PED. COMPRA</span><span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.numero_pedido_compra || '-'}</span></td>
          </tr>
        </tbody>
      </table>

      {/* OBSERVAÇÃO */}
      <div style={{ background:'#e5e5e5', fontWeight:700, fontSize:'10px', padding:'3px 6px', border:'1.5px solid #000', borderBottom:'none' }}>OBSERVAÇÃO</div>
      <div style={{ border:'1.5px solid #000', borderTop:'none', padding:'6px', minHeight:'25px', fontSize:'9px' }}>{pedido.observacoes || ''}</div>

      {/* AVISO DE TROCA */}
      {pedido.tipo === 'troca' && (
        <div style={{ background:'#DCFCE7', border:'2px solid #16A34A', marginTop:'8px', padding:'8px 10px', textAlign:'center' }}>
          <span style={{ fontSize:'13px', fontWeight:700, color:'#166534', textTransform:'uppercase', letterSpacing:'1px' }}>🟢 PEDIDO DE TROCA — MODELO D1</span>
        </div>
      )}

      {/* PRODUTOS */}
      <div style={{ background:'#e5e5e5', fontWeight:700, fontSize:'10px', padding:'3px 6px', border:'1.5px solid #000', borderBottom:'none', marginTop:'8px' }}>DADOS DOS PRODUTOS</div>
      <table style={{ width:'100%', borderCollapse:'collapse', border:'1.5px solid #000' }}>
        <thead>
          <tr>
            <th style={{ background:'#e5e5e5', border:'1px solid #999', padding:'3px 5px', fontSize:'8px', fontWeight:700, textTransform:'uppercase', textAlign:'center', width:'50px' }}>CÓD.</th>
            <th style={{ background:'#e5e5e5', border:'1px solid #999', padding:'3px 5px', fontSize:'8px', fontWeight:700, textTransform:'uppercase', textAlign:'left' }}>DESCRIÇÃO DO PRODUTO</th>
            <th style={{ background:'#e5e5e5', border:'1px solid #999', padding:'3px 5px', fontSize:'8px', fontWeight:700, textTransform:'uppercase', textAlign:'center', width:'50px' }}>QTD.</th>
            <th style={{ background:'#e5e5e5', border:'1px solid #999', padding:'3px 5px', fontSize:'8px', fontWeight:700, textTransform:'uppercase', textAlign:'right', width:'80px' }}>VL. UNIT.</th>
            <th style={{ background:'#e5e5e5', border:'1px solid #999', padding:'3px 5px', fontSize:'8px', fontWeight:700, textTransform:'uppercase', textAlign:'right', width:'90px' }}>VL. TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <React.Fragment key={idx}>
              <tr>
                <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px', textAlign:'center' }}>{item.produto_codigo}</td>
                <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px' }}>{item.produto_nome}</td>
                <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px', textAlign:'center' }}>{item.quantidade}</td>
                <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px', textAlign:'right' }}>{fmtMoney(item.valor_unitario)}</td>
                <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px', textAlign:'right' }}>{fmtMoney(item.valor_total)}</td>
              </tr>
              {pedido.tipo === 'troca' && item.motivo_troca_descricao && (
                <tr><td colSpan="5" style={{ border:'1px solid #999', borderTop:'none', padding:'2px 5px 4px 20px', fontSize:'8px', color:'#166534', background:'#F0FDF4' }}><strong>Motivo da troca:</strong> {item.motivo_troca_descricao}</td></tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="2" style={{ border:'1px solid #999', padding:'4px 6px', fontSize:'10px', fontWeight:700, background:'#e5e5e5', textAlign:'right' }}>TOTAL GERAL</td>
            <td style={{ border:'1px solid #999', padding:'4px 6px', fontSize:'11px', fontWeight:700, background:'#e5e5e5', textAlign:'center' }}>{totalQtd}</td>
            <td style={{ border:'1px solid #999', padding:'4px 6px', fontSize:'10px', fontWeight:700, background:'#e5e5e5', textAlign:'right' }}>{items.length} ite{items.length === 1 ? 'm' : 'ns'}</td>
            <td style={{ border:'1px solid #999', padding:'4px 6px', fontSize:'13px', fontWeight:700, background:'#e5e5e5', textAlign:'right' }}>R$ {fmtMoney(totalProdutos)}</td>
          </tr>
          <tr>
            <td colSpan="4" style={{ border:'1px solid #999', padding:'4px 6px', fontSize:'10px', fontWeight:700, background:'#f5f5f5', textAlign:'right' }}>PREÇO MÉDIO</td>
            <td style={{ border:'1px solid #999', padding:'4px 6px', fontSize:'12px', fontWeight:700, background:'#f5f5f5', textAlign:'right' }}>R$ {fmtMoney3(totalQtd > 0 ? totalProdutos / totalQtd : 0)}</td>
          </tr>
        </tfoot>
      </table>

      {/* CANCELAMENTO */}
      {pedido.status === 'cancelado' && (
        <>
          <div style={{ background:'#FEE2E2', fontWeight:700, fontSize:'10px', padding:'3px 6px', border:'1.5px solid #DC2626', borderBottom:'none', marginTop:'8px', color:'#991B1B' }}>DADOS DO CANCELAMENTO</div>
          <table style={{ width:'100%', borderCollapse:'collapse', border:'1.5px solid #DC2626' }}>
            <tbody>
              <tr>
                <td style={{ border:'1px solid #FCA5A5', padding:'2px 5px', background:'#FEF2F2' }}><span style={{ fontSize:'8px', color:'#991B1B', display:'block' }}>CANCELADO POR</span><span style={{ fontSize:'10px', fontWeight:500, color:'#991B1B' }}>{pedido.cancelado_por_nome || pedido.cancelado_por || '-'}</span></td>
                <td style={{ border:'1px solid #FCA5A5', padding:'2px 5px', background:'#FEF2F2' }}><span style={{ fontSize:'8px', color:'#991B1B', display:'block' }}>DATA/HORA</span><span style={{ fontSize:'10px', fontWeight:500, color:'#991B1B' }}>{pedido.data_cancelamento ? new Date(pedido.data_cancelamento).toLocaleString('pt-BR') : '-'}</span></td>
              </tr>
              <tr><td colSpan="2" style={{ border:'1px solid #FCA5A5', padding:'4px 5px', background:'#FEF2F2' }}><span style={{ fontSize:'8px', color:'#991B1B', display:'block' }}>MOTIVO DO CANCELAMENTO</span><span style={{ fontSize:'10px', fontWeight:600, color:'#991B1B' }}>{pedido.motivo_cancelamento || '-'}</span></td></tr>
            </tbody>
          </table>
        </>
      )}

      <div style={{ textAlign:'center', marginTop:'16px', fontSize:'8px', color:'#888' }}>
        Pão e Mel — Documento gerado em {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}
      </div>
    </div>
  );
}

export default function PedidoPdfMultiplo({ pedidoIds, onVoltar }) {
  const printRef = useRef();
  const [loading, setLoading] = useState(true);
  const [pedidosData, setPedidosData] = useState([]);

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresa-pdf'],
    queryFn: () => base44.entities.Empresa.list()
  });
  const empresa = empresas[0];

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      const results = [];
      for (const id of pedidoIds) {
        const pedidos = await base44.entities.Pedido.filter({});
        const pedido = pedidos.find(p => p.id === id);
        if (pedido) {
          const items = await base44.entities.PedidoItem.filter({ pedido_id: id });
          results.push({ pedido, items });
        }
      }
      setPedidosData(results);
      setLoading(false);
    };
    if (pedidoIds.length > 0) fetchAll();
  }, [pedidoIds]);

  const handlePrint = () => {
    const content = printRef.current;
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>Pedidos_Analiticos</title><style>${printStyles}</style></head><body>${content.innerHTML}</body></html>`);
    win.document.close();
    win.print();
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        <p className="text-sm text-slate-500">Carregando {pedidoIds.length} pedido(s)...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <Button variant="outline" onClick={onVoltar}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
        </Button>
        <Button onClick={handlePrint} className="bg-gradient-to-r from-blue-500 to-blue-600">
          <Download className="w-4 h-4 mr-2" /> Imprimir {pedidosData.length} Pedido(s)
        </Button>
        <span className="text-sm text-slate-500">{pedidosData.length} pedido(s) carregado(s)</span>
      </div>

      <div ref={printRef} className="bg-white border rounded-xl shadow-sm max-w-4xl mx-auto" style={{ fontFamily: 'Arial, sans-serif', fontSize: '10px', color: '#000' }}>
        {pedidosData.map(({ pedido, items }, idx) => (
          <PedidoPageContent key={pedido.id} pedido={pedido} items={items} empresa={empresa} />
        ))}
      </div>
    </div>
  );
}