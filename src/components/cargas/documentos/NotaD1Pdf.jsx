import React, { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { fmtMoney, fmtDateTime, abrirImpressao } from './printHelper';

/**
 * Impressão de Notas D1 (vendas internas SEM NF-e do Omie).
 * Gera uma "via interna" por pedido D1 da carga, em formato compacto A4.
 * Cada nota tem cabeçalho da empresa, dados do cliente, lista de itens,
 * totais e linha de assinatura/recebimento.
 */
export default function NotaD1Pdf({ carga }) {
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

  // Apenas pedidos D1 (internos) da carga
  const notasD1 = useMemo(() => {
    if (!carga) return [];
    return (carga.pedidos_internos || []).filter(p => {
      const modelo = (p.modelo_nota || '').toString().toLowerCase();
      return modelo === 'd1' || modelo === '';
    }).map(p => ({
      ...p,
      cliente: clientesMap.get(p.cliente_id) || {}
    }));
  }, [carga, clientesMap]);

  const handlePrint = () => {
    if (!printRef.current) return;
    const styles = `
      <style>
        @page { size: A4; margin: 10mm; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        body { font-family: Arial, sans-serif; font-size: 10px; color: #1e293b; margin: 0; padding: 0; }
        .nota-d1 { page-break-after: always; padding: 8px 0; }
        .nota-d1:last-child { page-break-after: auto; }
        table { border-collapse: collapse; width: 100%; }
        th, td { padding: 4px 6px; }
      </style>
    `;
    abrirImpressao(styles + printRef.current.innerHTML, `Notas_D1_${carga?.numero_carga || ''}`);
  };

  if (!carga) return null;

  if (notasD1.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500">
        Nenhuma nota D1 (venda interna) nesta carga.
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

      <div ref={printRef} className="bg-white mx-auto" style={{ maxWidth: '800px', fontFamily: 'Arial, sans-serif', fontSize: '10px', color: '#1e293b' }}>
        {notasD1.map((nota, idx) => {
          const cli = nota.cliente || {};
          const totalItens = (nota.produtos || []).reduce((s, p) => s + Number(p.quantidade || 0), 0);
          const totalValor = Number(nota.valor_total_pedido || 0);

          return (
            <div key={idx} className="nota-d1" style={{ padding: '12px', border: '1px solid #cbd5e1', borderRadius: '6px', marginBottom: '12px' }}>
              {/* CABEÇALHO */}
              <div style={{ background: 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)', color: '#fff', padding: '8px 12px', borderRadius: '4px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '13px' }}>📄 NOTA D1 — Venda Interna</div>
                  <div style={{ fontSize: '9px', opacity: 0.9 }}>Documento interno — Sem valor fiscal</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '10px' }}>
                  <div><b>Pedido:</b> {nota.numero_pedido || '-'}</div>
                  <div><b>Carga:</b> {carga.numero_carga || '-'}</div>
                </div>
              </div>

              {/* EMPRESA */}
              <div style={{ background: '#f8fafc', padding: '6px 10px', borderRadius: '4px', marginBottom: '6px', fontSize: '9.5px' }}>
                <b>{empresa.razao_social || empresa.nome || 'PAO E MEL'}</b>
                {empresa.cnpj && <> • CNPJ: {empresa.cnpj || empresa.cnpj_cpf}</>}
                {empresa.inscricao_estadual && <> • IE: {empresa.inscricao_estadual}</>}
                {empresa.telefone && <> • Tel: {empresa.telefone}</>}
              </div>

              {/* CLIENTE */}
              <table style={{ width: '100%', fontSize: '10px', marginBottom: '6px' }}>
                <tbody>
                  <tr>
                    <td style={{ paddingBottom: '2px' }}>
                      <span style={{ color: '#64748b' }}>Cliente:</span> <b>{cli.razao_social || nota.nome_cliente || '-'}</b>
                      {cli.nome_fantasia && <span style={{ color: '#64748b' }}> • Fantasia: <b style={{ color: '#0f172a' }}>{cli.nome_fantasia}</b></span>}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ paddingBottom: '2px' }}>
                      <span style={{ color: '#64748b' }}>CPF/CNPJ:</span> {cli.cnpj_cpf || '-'} •
                      <span style={{ color: '#64748b' }}> Endereço:</span> {[cli.endereco, cli.numero, cli.bairro, cli.cidade, cli.estado].filter(Boolean).join(', ') || '-'}
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <span style={{ color: '#64748b' }}>Vendedor:</span> {nota.vendedor_nome || '-'} •
                      <span style={{ color: '#64748b' }}> Data:</span> {fmtDateTime(new Date())}
                    </td>
                  </tr>
                </tbody>
              </table>

              {/* ITENS */}
              <table style={{ border: '1px solid #cbd5e1', marginBottom: '6px' }}>
                <thead>
                  <tr style={{ background: '#1e293b', color: '#fff' }}>
                    <th style={{ textAlign: 'left' }}>Cód.</th>
                    <th style={{ textAlign: 'left' }}>Descrição</th>
                    <th style={{ textAlign: 'center', width: '50px' }}>UN</th>
                    <th style={{ textAlign: 'right', width: '70px' }}>Qtd</th>
                    <th style={{ textAlign: 'right', width: '90px' }}>Vl. Unit.</th>
                    <th style={{ textAlign: 'right', width: '100px' }}>Vl. Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(nota.produtos || []).length === 0 ? (
                    <tr><td colSpan="6" style={{ padding: '12px', textAlign: 'center', color: '#94a3b8' }}>Sem itens</td></tr>
                  ) : (nota.produtos || []).map((p, i) => (
                    <tr key={i} style={{ background: i % 2 ? '#f8fafc' : '#fff', borderBottom: '1px solid #e2e8f0' }}>
                      <td>{p.codigo_produto}</td>
                      <td>{p.descricao}</td>
                      <td style={{ textAlign: 'center' }}>{p.unidade || 'UN'}</td>
                      <td style={{ textAlign: 'right' }}>{Number(p.quantidade || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(p.valor_unitario)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(p.valor_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#fef3c7', fontWeight: 700 }}>
                    <td colSpan="3" style={{ textAlign: 'right' }}>TOTAL:</td>
                    <td style={{ textAlign: 'right' }}>{totalItens}</td>
                    <td></td>
                    <td style={{ textAlign: 'right', color: '#92400e' }}>{fmtMoney(totalValor)}</td>
                  </tr>
                </tfoot>
              </table>

              {/* OBSERVAÇÃO + RECEBIMENTO */}
              {nota.observacoes && (
                <div style={{ background: '#eff6ff', borderLeft: '3px solid #3b82f6', padding: '4px 8px', fontSize: '9.5px', marginBottom: '8px' }}>
                  <b>Obs.:</b> {nota.observacoes}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '20px', fontSize: '9.5px' }}>
                <div style={{ borderTop: '1px solid #1e293b', paddingTop: '4px', minWidth: '260px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>
                  Recebedor (Ass. / RG)
                </div>
                <div style={{ borderTop: '1px solid #1e293b', paddingTop: '4px', minWidth: '180px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>
                  Data: ___/___/______
                </div>
                <div style={{ borderTop: '1px solid #1e293b', paddingTop: '4px', minWidth: '200px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>
                  Entregador
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}