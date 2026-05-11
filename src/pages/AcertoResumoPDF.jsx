import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Printer, Loader2 } from 'lucide-react';

const fmt = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

export default function AcertoResumoPDF() {
  const id = new URLSearchParams(window.location.search).get('id');
  const [carga, setCarga] = useState(null);
  const [empresa, setEmpresa] = useState({});

  const { data: acerto, isLoading } = useQuery({
    queryKey: ['acerto-pdf', id],
    queryFn: () => base44.entities.AcertoCaixa.get(id),
    enabled: !!id
  });

  useEffect(() => {
    const carregar = async () => {
      if (!acerto) return;
      try {
        const c = await base44.entities.Carga.get(acerto.carga_id);
        setCarga(c);
      } catch (_) {}
      try {
        const e = await base44.entities.Empresa.list();
        setEmpresa(e[0] || {});
      } catch (_) {}
    };
    carregar();
  }, [acerto]);

  if (isLoading || !acerto) return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div>;

  const entregues = (acerto.notas || []).filter(n => n.status_entrega === 'entregue');
  const naoEntregues = (acerto.notas || []).filter(n => n.status_entrega === 'nao_entregue');

  return (
    <div className="bg-white p-4">
      <style>{`
        @page { size: A4 landscape; margin: 8mm; }
        @media print {
          .no-print { display: none !important; }
          body { font-size: 10px; }
        }
      `}</style>

      <div className="no-print mb-4 max-w-7xl mx-auto flex justify-between">
        <h1 className="text-xl font-bold">Resumo do Acerto — Carga {acerto.numero_carga}</h1>
        <Button onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700">
          <Printer className="w-4 h-4 mr-2" /> Imprimir / PDF
        </Button>
      </div>

      <div className="max-w-7xl mx-auto text-[11px]">
        {/* Header */}
        <div style={{ background: 'linear-gradient(90deg,#059669,#047857)', color: '#fff', padding: '10px 14px', borderRadius: 6, display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div className="font-bold text-base">{empresa.razao_social || empresa.nome || 'PAO E MEL'}</div>
            <div className="text-xs opacity-90">{empresa.cnpj && `CNPJ: ${empresa.cnpj}`} {empresa.telefone && `• ${empresa.telefone}`}</div>
          </div>
          <div className="text-right">
            <div className="font-bold">ACERTO DE CAIXA — Carga {acerto.numero_carga}</div>
            <div className="text-xs">Saída: {acerto.data_saida_carga} • Acerto: {acerto.data_acerto}</div>
          </div>
        </div>

        <div className="mt-2 p-2 bg-slate-50 rounded border text-xs flex flex-wrap gap-x-6 gap-y-1">
          <span><b>Motorista:</b> {acerto.motorista_nome || '-'}</span>
          {carga && <><span><b>Veículo:</b> {carga.veiculo_placa || '-'}</span><span><b>Rota:</b> {carga.rota_nome || '-'}</span></>}
          <span><b>Status:</b> {acerto.status_acerto}</span>
        </div>

        {/* Notas Entregues */}
        <div className="mt-3">
          <div className="font-bold bg-emerald-100 text-emerald-800 px-2 py-1 rounded">Notas Entregues ({entregues.length})</div>
          <table className="w-full border-collapse mt-1 text-[10px]">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="p-1 text-left">Pedido</th>
                <th className="p-1 text-left">NF-e</th>
                <th className="p-1 text-left">Cliente</th>
                <th className="p-1 text-left">Pgto</th>
                <th className="p-1 text-right">Original</th>
                <th className="p-1 text-right">Recebido</th>
                <th className="p-1 text-right">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {entregues.length === 0 ? (
                <tr><td colSpan="7" className="p-2 text-center text-slate-400">—</td></tr>
              ) : entregues.map((n, i) => (
                <tr key={i} className={i % 2 ? 'bg-slate-50' : ''}>
                  <td className="p-1 border-b">{n.numero_pedido}</td>
                  <td className="p-1 border-b">{n.numero_nfe || '-'}</td>
                  <td className="p-1 border-b">{n.nome_cliente}</td>
                  <td className="p-1 border-b uppercase">{n.forma_pagamento}</td>
                  <td className="p-1 border-b text-right">{fmt(n.valor_original)}</td>
                  <td className="p-1 border-b text-right">{fmt(n.valor_recebido)}</td>
                  <td className={`p-1 border-b text-right font-semibold ${Number(n.diferenca) < 0 ? 'text-red-600' : Number(n.diferenca) > 0 ? 'text-emerald-600' : ''}`}>{fmt(n.diferenca)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Notas Não Entregues */}
        <div className="mt-3">
          <div className="font-bold bg-red-100 text-red-800 px-2 py-1 rounded">Notas Não Entregues ({naoEntregues.length})</div>
          <table className="w-full border-collapse mt-1 text-[10px]">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="p-1 text-left">Pedido</th>
                <th className="p-1 text-left">NF-e</th>
                <th className="p-1 text-left">Cliente</th>
                <th className="p-1 text-right">Valor</th>
                <th className="p-1 text-left">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {naoEntregues.length === 0 ? (
                <tr><td colSpan="5" className="p-2 text-center text-slate-400">—</td></tr>
              ) : naoEntregues.map((n, i) => (
                <tr key={i} className={i % 2 ? 'bg-slate-50' : ''}>
                  <td className="p-1 border-b">{n.numero_pedido}</td>
                  <td className="p-1 border-b">{n.numero_nfe || '-'}</td>
                  <td className="p-1 border-b">{n.nome_cliente}</td>
                  <td className="p-1 border-b text-right">{fmt(n.valor_original)}</td>
                  <td className="p-1 border-b text-red-700">{n.motivo_cancelamento || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Resumo */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="p-2 bg-slate-50 border rounded">
            <div className="text-[9px] text-slate-500">TOTAIS</div>
            <div>Notas: <b>{(acerto.notas || []).length}</b></div>
            <div>Entregues: <b className="text-emerald-700">{entregues.length}</b></div>
            <div>Não Entregues: <b className="text-red-700">{naoEntregues.length}</b></div>
          </div>
          <div className="p-2 bg-emerald-50 border border-emerald-200 rounded">
            <div className="text-[9px] text-emerald-700">VALORES</div>
            <div>Original: <b>{fmt(acerto.valor_total_original)}</b></div>
            <div>Recebido: <b>{fmt(acerto.valor_total_recebido)}</b></div>
            <div>Diferença: <b className={Number(acerto.valor_total_diferenca) < 0 ? 'text-red-600' : ''}>{fmt(acerto.valor_total_diferenca)}</b></div>
          </div>
          <div className="p-2 bg-slate-50 border rounded">
            <div className="text-[9px] text-slate-500">OBSERVAÇÕES</div>
            <div className="whitespace-pre-wrap">{acerto.observacao_geral || '—'}</div>
          </div>
        </div>

        {/* Assinaturas */}
        <div className="mt-8 grid grid-cols-2 gap-8">
          <div className="text-center">
            <div className="border-t border-slate-800 pt-1 text-xs">Motorista / Conferente</div>
          </div>
          <div className="text-center">
            <div className="border-t border-slate-800 pt-1 text-xs">Responsável Financeiro</div>
          </div>
        </div>
      </div>
    </div>
  );
}