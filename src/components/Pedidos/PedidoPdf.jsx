import React, { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

const LOGO_URL = "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6926e3c1dcadc4e314506362/7c2bd1831_8297750cb_cropped-cropped-logo.png";

const printStyles = `
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #000; padding: 20px; }
.page { width: 100%; }
/* HEADER */
.header-table { width:100%; border-collapse:collapse; border:1.5px solid #000; }
.header-table td { padding:4px 6px; vertical-align:middle; }
.header-logo { width:90px; text-align:center; border-right:1.5px solid #000; }
.header-logo img { height:60px; }
.header-info { text-align:center; }
.header-info h1 { font-size:13px; font-weight:700; margin-bottom:1px; }
.header-info p { font-size:9px; }
.header-pedido { width:130px; border-left:1.5px solid #000; text-align:left; font-size:10px; }
.header-pedido div { padding:1px 0; }
.header-pedido span { font-weight:700; }
/* SECTIONS */
.section-title { background:#e5e5e5; font-weight:700; font-size:10px; padding:3px 6px; border:1.5px solid #000; border-bottom:none; margin-top:8px; }
.grid-table { width:100%; border-collapse:collapse; border:1.5px solid #000; }
.grid-table td { border:1px solid #999; padding:2px 5px; font-size:9px; vertical-align:top; }
.grid-table .lbl { font-size:8px; color:#555; display:block; margin-bottom:0px; }
.grid-table .val { font-size:10px; font-weight:500; }
/* PRODUCTS TABLE */
.prod-table { width:100%; border-collapse:collapse; border:1.5px solid #000; }
.prod-table th { background:#e5e5e5; border:1px solid #999; padding:3px 5px; font-size:8px; font-weight:700; text-transform:uppercase; text-align:center; }
.prod-table td { border:1px solid #999; padding:3px 5px; font-size:9px; }
.prod-table td.r { text-align:right; }
.prod-table td.c { text-align:center; }
.prod-table tfoot td { font-weight:700; background:#f5f5f5; }
/* VALUES */
.val-table { width:100%; border-collapse:collapse; border:1.5px solid #000; }
.val-table td { border:1px solid #999; padding:2px 5px; font-size:9px; }
.val-table .lbl { font-size:8px; color:#555; display:block; }
.val-table .val { font-size:10px; font-weight:600; }
/* OBS */
.obs-box { border:1.5px solid #000; border-top:none; padding:6px; min-height:30px; font-size:9px; }
/* FOOTER */
.footer { text-align:center; margin-top:16px; font-size:8px; color:#888; }
`;

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

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresa-pdf'],
    queryFn: () => base44.entities.Empresa.list()
  });
  const empresa = empresas[0];

  if (!pedido) return <p className="text-center py-8 text-slate-500">Carregando...</p>;

  const modeloLabel = pedido.modelo_nota === 'd1' ? 'D1' : pedido.modelo_nota === 'nfce' ? 'NFCe' : '55';
  const totalProdutos = items.reduce((s, i) => s + (i.valor_total || 0), 0);
  const totalQtd = items.reduce((s, i) => s + (i.quantidade || 0), 0);
  const dataEmissao = pedido.created_date ? new Date(pedido.created_date).toLocaleDateString('pt-BR') : '';
  const dataEnvio = pedido.data_envio ? new Date(pedido.data_envio).toLocaleDateString('pt-BR') : '';
  const dataEntrega = pedido.data_previsao_entrega ? new Date(pedido.data_previsao_entrega + 'T12:00:00').toLocaleDateString('pt-BR') : '';

  const handlePrint = () => {
    const content = printRef.current;
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>Pedido_${pedido.numero_pedido || 'N-A'}</title><style>${printStyles}</style></head><body>${content.innerHTML}</body></html>`);
    win.document.close();
    win.print();
  };

  const fmtMoney = (v) => (v || 0).toFixed(2);

  return (
    <div className="space-y-4">
      <Button onClick={handlePrint} className="bg-gradient-to-r from-blue-500 to-blue-600">
        <Download className="w-4 h-4 mr-2" /> Imprimir / Salvar PDF
      </Button>

      <div ref={printRef} className="bg-white border rounded-xl shadow-sm max-w-4xl mx-auto" style={{ padding: '20px', fontFamily: 'Arial, sans-serif', fontSize: '10px', color: '#000' }}>
        
        {/* ===== HEADER ===== */}
        <table className="header-table" style={{ width:'100%', borderCollapse:'collapse', border:'1.5px solid #000' }}>
          <tbody>
            <tr>
              <td style={{ width:'90px', textAlign:'center', borderRight:'1.5px solid #000', padding:'6px' }}>
                <img src={LOGO_URL} alt="Logo" style={{ height:'60px' }} />
              </td>
              <td style={{ textAlign:'center', padding:'6px' }}>
                <div style={{ fontSize:'13px', fontWeight:700 }}>{empresa?.razao_social || 'PAO E MEL INDUSTRIA DE PANIFICACAO LTDA ME'}</div>
                <div style={{ fontSize:'9px', color:'#555' }}>{empresa?.nome_fantasia || 'PAO E MEL'}</div>
                {empresa && (
                  <div style={{ fontSize:'8px', color:'#555', marginTop:'2px' }}>
                    CNPJ: {empresa.cnpj} — IE: {empresa.inscricao_estadual || '-'} — Tel: {empresa.telefone || '-'}
                  </div>
                )}
              </td>
              <td style={{ width:'140px', borderLeft:'1.5px solid #000', padding:'6px', fontSize:'10px' }}>
                <div><span style={{ fontWeight:700 }}>Pedido</span></div>
                <div style={{ fontSize:'14px', fontWeight:700 }}>{pedido.numero_pedido || '-'}</div>
                <div style={{ marginTop:'4px' }}>{dataEmissao}</div>
                <div>Folha 1/1</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ===== CLIENTE ===== */}
        <div style={{ background:'#e5e5e5', fontWeight:700, fontSize:'10px', padding:'3px 6px', border:'1.5px solid #000', borderBottom:'none', marginTop:'8px' }}>
          CLIENTE
        </div>
        <table style={{ width:'100%', borderCollapse:'collapse', border:'1.5px solid #000' }}>
          <tbody>
            <tr>
              <td style={{ border:'1px solid #999', padding:'2px 5px', width:'80px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>CÓDIGO</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_codigo}</span>
              </td>
              <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>NOME/RAZÃO SOCIAL</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_nome}</span>
              </td>
              <td style={{ border:'1px solid #999', padding:'2px 5px', width:'140px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>CPF/CNPJ</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_cpf_cnpj || '-'}</span>
              </td>
            </tr>
            <tr>
              <td colSpan="3" style={{ border:'1px solid #999', padding:'2px 5px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>FANTASIA</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_nome_fantasia || '-'}</span>
              </td>
            </tr>
            <tr>
              <td colSpan="2" style={{ border:'1px solid #999', padding:'2px 5px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>ENDEREÇO</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_endereco || '-'}</span>
              </td>
              <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>NÚMERO</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_numero || '-'}</span>
              </td>
            </tr>
            <tr>
              <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>BAIRRO</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_bairro || '-'}</span>
              </td>
              <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>CIDADE</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_cidade || '-'}</span>
              </td>
              <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>UF / CEP</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.cliente_estado || '-'} / {pedido.cliente_cep || '-'}</span>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ===== OUTRAS INFORMAÇÕES ===== */}
        <div style={{ background:'#e5e5e5', fontWeight:700, fontSize:'10px', padding:'3px 6px', border:'1.5px solid #000', borderBottom:'none', marginTop:'8px' }}>
          OUTRAS INFORMAÇÕES
        </div>
        <table style={{ width:'100%', borderCollapse:'collapse', border:'1.5px solid #000' }}>
          <tbody>
            <tr>
              <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>MODELO NOTA</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{modeloLabel}</span>
              </td>
              <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>PLANO PAGAMENTO</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.plano_pagamento_nome || '-'}</span>
              </td>
              <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>TABELA DE PREÇO</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.tabela_preco_nome || '-'}</span>
              </td>
              <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>VENDEDOR</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.vendedor_nome}</span>
              </td>
            </tr>
            <tr>
              <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>DATA EMISSÃO</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{dataEmissao}</span>
              </td>
              <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>DATA ENVIO</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{dataEnvio || '-'}</span>
              </td>
              <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>PREVISÃO ENTREGA</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{dataEntrega || '-'}</span>
              </td>
              <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                <span style={{ fontSize:'8px', color:'#555', display:'block' }}>Nº PED. COMPRA</span>
                <span style={{ fontSize:'10px', fontWeight:500 }}>{pedido.numero_pedido_compra || '-'}</span>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Observação */}
        <div style={{ background:'#e5e5e5', fontWeight:700, fontSize:'10px', padding:'3px 6px', border:'1.5px solid #000', borderBottom:'none', marginTop:'0' }}>
          OBSERVAÇÃO
        </div>
        <div style={{ border:'1.5px solid #000', borderTop:'none', padding:'6px', minHeight:'25px', fontSize:'9px' }}>
          {pedido.observacoes || ''}
        </div>

        {/* ===== DADOS DOS PRODUTOS ===== */}
        <div style={{ background:'#e5e5e5', fontWeight:700, fontSize:'10px', padding:'3px 6px', border:'1.5px solid #000', borderBottom:'none', marginTop:'8px' }}>
          DADOS DOS PRODUTOS
        </div>
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
              <tr key={idx}>
                <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px', textAlign:'center' }}>{item.produto_codigo}</td>
                <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px' }}>{item.produto_nome}</td>
                <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px', textAlign:'center' }}>{item.quantidade}</td>
                <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px', textAlign:'right' }}>{fmtMoney(item.valor_unitario)}</td>
                <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px', textAlign:'right' }}>{fmtMoney(item.valor_total)}</td>
              </tr>
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
              <td style={{ border:'1px solid #999', padding:'4px 6px', fontSize:'12px', fontWeight:700, background:'#f5f5f5', textAlign:'right' }}>R$ {fmtMoney(totalQtd > 0 ? totalProdutos / totalQtd : 0)}</td>
            </tr>
          </tfoot>
        </table>

        {/* Footer */}
        <div style={{ textAlign:'center', marginTop:'16px', fontSize:'8px', color:'#888' }}>
          Pão e Mel — Documento gerado em {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}
        </div>
      </div>
    </div>
  );
}