import React, { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { abrirImpressao } from './printHelper';

const LOGO_URL = "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6926e3c1dcadc4e314506362/7c2bd1831_8297750cb_cropped-cropped-logo.png";

const fmtMoney = (v) => Number(v || 0).toFixed(2);
const fmtMoney3 = (v) => Number(v || 0).toFixed(3);
const fmtDate = (v) => {
  if (!v) return '';
  try {
    const d = typeof v === 'string' && v.length === 10 ? new Date(v + 'T12:00:00') : new Date(v);
    return d.toLocaleDateString('pt-BR');
  } catch { return ''; }
};

const printStyles = `
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #000; padding: 20px; }
.page { width: 100%; page-break-after: always; }
.page:last-child { page-break-after: auto; }
`;

/**
 * Impressão de Notas D1 (vendas internas SEM NF-e do Omie).
 * Replica o modelo analítico do "Gerenciar Pedidos" (PedidoPdf).
 * Recebe `carga` (usa pedidos_internos D1) OU `pedidos` (lista direta de pedidos D1).
 */
export default function NotaD1Pdf({ carga, pedidos: pedidosProp }) {
  const printRef = useRef();

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresa-notad1'],
    queryFn: () => base44.entities.Empresa.list()
  });
  const empresa = empresas[0] || {};

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes-notad1'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 10000)
  });

  const clientesMap = useMemo(() => {
    const m = new Map();
    clientes.forEach(c => m.set(c.id, c));
    return m;
  }, [clientes]);

  // Pedidos D1 (internos) + Trocas: ambos viram nota D1 (sem NF-e fiscal).
  // Para trocas, marca explicitamente o tipo_operacao_fiscal='troca' para que o cenário
  // seja exibido corretamente e o motivo apareça por item.
  const notasD1 = useMemo(() => {
    if (pedidosProp && pedidosProp.length > 0) {
      return pedidosProp
        .filter(p => {
          const modelo = (p.modelo_nota || '').toString().toLowerCase();
          return modelo === 'd1' || modelo === '';
        })
        .map(p => ({ ...p, cliente: clientesMap.get(p.cliente_id) || {} }));
    }
    const internos = (carga?.pedidos_internos || []).map(p => ({
      ...p,
      cliente: clientesMap.get(p.cliente_id) || {}
    }));
    const trocas = (carga?.pedidos_troca || []).map(p => ({
      ...p,
      modelo_nota: 'd1',
      tipo_operacao_fiscal: 'troca',
      cenario_fiscal_nome: p.cenario_fiscal_nome || 'Troca',
      cliente: clientesMap.get(p.cliente_id) || {}
    }));
    return [...internos, ...trocas];
  }, [carga, pedidosProp, clientesMap]);

  const handlePrint = () => {
    if (!printRef.current) return;
    const html = `<html><head><title>Notas_D1_${carga?.numero_carga || ''}</title><meta charset="utf-8" /><style>${printStyles}</style></head><body>${printRef.current.innerHTML}</body></html>`;
    const win = window.open('', '_blank');
    if (!win) { alert('Permita pop-ups para imprimir o documento.'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => { win.focus(); win.print(); }, 300);
  };

  if (notasD1.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500">
        Nenhuma nota D1 (venda interna) encontrada.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="text-sm text-slate-600">
          <b>{notasD1.length}</b> nota(s) D1 a imprimir
        </div>
        <Button onClick={handlePrint} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Printer className="w-4 h-4 mr-2" /> Imprimir / PDF
        </Button>
      </div>

      <div ref={printRef}>
        {notasD1.map((nota, idx) => {
          const cli = nota.cliente || {};
          const produtos = nota.produtos || [];
          const totalProdutos = produtos.reduce((s, p) => s + Number(p.valor_total || 0), 0);
          const totalQtd = produtos.reduce((s, p) => s + Number(p.quantidade || 0), 0);
          const dataEmissao = fmtDate(nota.created_date || nota.data_emissao || new Date());
          const dataEntrega = fmtDate(nota.data_previsao_entrega || carga?.data_carga);
          const cenarioFiscalLabel = nota.cenario_local_nome || nota.cenario_fiscal_nome || 'Venda Interna D1';
          const produtosComMotivo = produtos.filter(item => item.motivo_troca_descricao || item.motivo_descricao || item.motivo || item.observacao);

          return (
            <div
              key={idx}
              className="page bg-white border rounded-xl shadow-sm max-w-4xl mx-auto mb-6"
              style={{ padding: '20px', fontFamily: 'Arial, sans-serif', fontSize: '10px', color: '#000' }}
            >
              {/* ===== HEADER ===== */}
              <table style={{ width:'100%', borderCollapse:'collapse', border:'1.5px solid #000' }}>
                <tbody>
                  <tr>
                    <td style={{ width:'90px', textAlign:'center', borderRight:'1.5px solid #000', padding:'6px' }}>
                      <img src={LOGO_URL} alt="Logo" style={{ height:'60px' }} />
                    </td>
                    <td style={{ textAlign:'center', padding:'6px' }}>
                      <div style={{ fontSize:'13px', fontWeight:700 }}>{empresa?.razao_social || 'PAO E MEL INDUSTRIA DE PANIFICACAO LTDA ME'}</div>
                      <div style={{ fontSize:'9px', color:'#555' }}>{empresa?.nome_fantasia || 'PAO E MEL'}</div>
                      <div style={{ fontSize:'8px', color:'#555', marginTop:'2px' }}>
                        CNPJ: {empresa?.cnpj || '-'} — IE: {empresa?.inscricao_estadual || '-'} — Tel: {empresa?.telefone || '-'}
                      </div>
                    </td>
                    <td style={{ width:'140px', borderLeft:'1.5px solid #000', padding:'6px', fontSize:'10px' }}>
                      <div><span style={{ fontWeight:700 }}>Nota D1</span></div>
                      <div style={{ fontSize:'14px', fontWeight:700 }}>{nota.numero_pedido || '-'}</div>
                      <div style={{ marginTop:'4px' }}>{dataEmissao}</div>
                      <div>Folha 1/1</div>
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* ===== AVISO D1 ===== */}
              <div style={{ background:'#FEF3C7', border:'2px solid #D97706', marginTop:'6px', padding:'6px 10px', textAlign:'center' }}>
                <span style={{ fontSize:'12px', fontWeight:700, color:'#92400E', textTransform:'uppercase', letterSpacing:'1px' }}>
                  📄 NOTA D1 — VENDA INTERNA (SEM VALOR FISCAL)
                </span>
              </div>

              {/* ===== CLIENTE ===== */}
              <div style={{ background:'#e5e5e5', fontWeight:700, fontSize:'10px', padding:'3px 6px', border:'1.5px solid #000', borderBottom:'none', marginTop:'8px' }}>
                CLIENTE
              </div>
              <table style={{ width:'100%', borderCollapse:'collapse', border:'1.5px solid #000' }}>
                <tbody>
                  <tr>
                    <td style={{ border:'1px solid #999', padding:'2px 5px', width:'80px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>CÓDIGO</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{cli.codigo_interno || cli.codigo_omie || '-'}</span>
                    </td>
                    <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>NOME/RAZÃO SOCIAL</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{cli.razao_social || nota.nome_cliente || '-'}</span>
                    </td>
                    <td style={{ border:'1px solid #999', padding:'2px 5px', width:'140px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>CPF/CNPJ</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{cli.cnpj_cpf || '-'}</span>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan="3" style={{ border:'1px solid #999', padding:'2px 5px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>FANTASIA</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{cli.nome_fantasia || nota.nome_fantasia || '-'}</span>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan="2" style={{ border:'1px solid #999', padding:'2px 5px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>ENDEREÇO</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{cli.endereco || '-'}</span>
                    </td>
                    <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>NÚMERO</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{cli.numero || '-'}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>BAIRRO</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{cli.bairro || '-'}</span>
                    </td>
                    <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>CIDADE</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{cli.cidade || nota.cidade || '-'}</span>
                    </td>
                    <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>UF / CEP</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{cli.estado || '-'} / {cli.cep || '-'}</span>
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
                      <span style={{ fontSize:'10px', fontWeight:500 }}>D1</span>
                    </td>
                    <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>Nº CARGA</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{carga?.numero_carga || '-'}</span>
                    </td>
                    <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>ROTA</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{nota.rota_cliente || carga?.rota_nome || '-'}</span>
                    </td>
                    <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>VENDEDOR</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{nota.vendedor_nome || '-'}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>DATA EMISSÃO</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{dataEmissao}</span>
                    </td>
                    <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>PREVISÃO ENTREGA</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{dataEntrega || '-'}</span>
                    </td>
                    <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>MOTORISTA</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{carga?.motorista_nome || '-'}</span>
                    </td>
                    <td style={{ border:'1px solid #999', padding:'2px 5px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>VEÍCULO</span>
                      <span style={{ fontSize:'10px', fontWeight:500 }}>{carga?.veiculo_placa || '-'}</span>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan="4" style={{ border:'1px solid #999', padding:'2px 5px' }}>
                      <span style={{ fontSize:'8px', color:'#555', display:'block' }}>CENÁRIO FISCAL</span>
                      <span style={{ fontSize:'10px', fontWeight:600 }}>{cenarioFiscalLabel}</span>
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* ===== OBSERVAÇÃO ===== */}
              <div style={{ background:'#e5e5e5', fontWeight:700, fontSize:'10px', padding:'3px 6px', border:'1.5px solid #000', borderBottom:'none', marginTop:'8px' }}>
                OBSERVAÇÃO
              </div>
              <div style={{ border:'1.5px solid #000', borderTop:'none', padding:'6px', minHeight:'25px', fontSize:'9px' }}>
                {nota.observacoes || ''}
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
                    <th style={{ background:'#e5e5e5', border:'1px solid #999', padding:'3px 5px', fontSize:'8px', fontWeight:700, textTransform:'uppercase', textAlign:'left', width:'130px' }}>MOTIVO</th>
                    <th style={{ background:'#e5e5e5', border:'1px solid #999', padding:'3px 5px', fontSize:'8px', fontWeight:700, textTransform:'uppercase', textAlign:'center', width:'45px' }}>UN</th>
                    <th style={{ background:'#e5e5e5', border:'1px solid #999', padding:'3px 5px', fontSize:'8px', fontWeight:700, textTransform:'uppercase', textAlign:'center', width:'55px' }}>QTD.</th>
                    <th style={{ background:'#e5e5e5', border:'1px solid #999', padding:'3px 5px', fontSize:'8px', fontWeight:700, textTransform:'uppercase', textAlign:'right', width:'80px' }}>VL. UNIT.</th>
                    <th style={{ background:'#e5e5e5', border:'1px solid #999', padding:'3px 5px', fontSize:'8px', fontWeight:700, textTransform:'uppercase', textAlign:'right', width:'90px' }}>VL. TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {produtos.map((item, i) => (
                    <tr key={i}>
                      <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px', textAlign:'center' }}>{item.codigo_produto}</td>
                      <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px' }}>{item.descricao}</td>
                      <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px' }}>{item.motivo_troca_descricao || item.motivo_descricao || item.motivo || '-'}{item.observacao ? ` — ${item.observacao}` : ''}</td>
                      <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px', textAlign:'center' }}>{item.unidade || 'UN'}</td>
                      <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px', textAlign:'center' }}>{Number(item.quantidade || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</td>
                      <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px', textAlign:'right' }}>{fmtMoney(item.valor_unitario)}</td>
                      <td style={{ border:'1px solid #999', padding:'3px 5px', fontSize:'9px', textAlign:'right' }}>{fmtMoney(item.valor_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="4" style={{ border:'1px solid #999', padding:'4px 6px', fontSize:'10px', fontWeight:700, background:'#e5e5e5', textAlign:'right' }}>TOTAL GERAL</td>
                    <td style={{ border:'1px solid #999', padding:'4px 6px', fontSize:'11px', fontWeight:700, background:'#e5e5e5', textAlign:'center' }}>{Number(totalQtd).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</td>
                    <td style={{ border:'1px solid #999', padding:'4px 6px', fontSize:'10px', fontWeight:700, background:'#e5e5e5', textAlign:'right' }}>{produtos.length} ite{produtos.length === 1 ? 'm' : 'ns'}</td>
                    <td style={{ border:'1px solid #999', padding:'4px 6px', fontSize:'13px', fontWeight:700, background:'#e5e5e5', textAlign:'right' }}>R$ {fmtMoney(totalProdutos)}</td>
                  </tr>
                  <tr>
                    <td colSpan="6" style={{ border:'1px solid #999', padding:'4px 6px', fontSize:'10px', fontWeight:700, background:'#f5f5f5', textAlign:'right' }}>PREÇO MÉDIO</td>
                    <td style={{ border:'1px solid #999', padding:'4px 6px', fontSize:'12px', fontWeight:700, background:'#f5f5f5', textAlign:'right' }}>R$ {fmtMoney3(totalQtd > 0 ? totalProdutos / totalQtd : 0)}</td>
                  </tr>
                </tfoot>
              </table>

              {produtosComMotivo.length > 0 && (
                <>
                  <div style={{ background:'#DCFCE7', fontWeight:700, fontSize:'10px', padding:'3px 6px', border:'1.5px solid #16A34A', borderBottom:'none', marginTop:'8px', color:'#166534' }}>
                    MOTIVOS DE TROCA
                  </div>
                  <div style={{ border:'1.5px solid #16A34A', borderTop:'none', padding:'6px', fontSize:'9px', background:'#F0FDF4', color:'#166534' }}>
                    {produtosComMotivo.map((item, idxMotivo) => (
                      <div key={idxMotivo}>- [{item.descricao || item.codigo_produto || 'Produto'}]: {item.motivo_troca_descricao || item.motivo_descricao || item.motivo || '-'}{item.observacao ? ` — ${item.observacao}` : ''}</div>
                    ))}
                  </div>
                </>
              )}

              {/* ===== RECEBIMENTO ===== */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginTop:'20px', fontSize:'9.5px' }}>
                <div style={{ borderTop:'1px solid #1e293b', paddingTop:'4px', minWidth:'260px', textAlign:'center', fontWeight:600, color:'#475569' }}>
                  Recebedor (Ass. / RG)
                </div>
                <div style={{ borderTop:'1px solid #1e293b', paddingTop:'4px', minWidth:'180px', textAlign:'center', fontWeight:600, color:'#475569' }}>
                  Data: ___/___/______
                </div>
                <div style={{ borderTop:'1px solid #1e293b', paddingTop:'4px', minWidth:'200px', textAlign:'center', fontWeight:600, color:'#475569' }}>
                  Entregador
                </div>
              </div>

              {/* Footer */}
              <div style={{ textAlign:'center', marginTop:'10px', fontSize:'8px', color:'#888' }}>
                Pão e Mel — Documento interno gerado em {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}