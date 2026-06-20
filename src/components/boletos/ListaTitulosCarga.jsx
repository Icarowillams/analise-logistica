import React, { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Eye } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';

const STATUS_ABERTOS = new Set(['ABERTO', 'A VENCER', 'A PAGAR', 'A RECEBER', 'VENCIDO', 'PARCIAL', 'ATRASADO']);
// Status que NUNCA podem virar boleto (já encerrados)
const STATUS_BLOQUEADOS = new Set(['CANCELADO', 'LIQUIDADO', 'PAGO']);

const formatarValor = (v) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

const base64ToUint8Array = (b64) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
};

export default function ListaTitulosCarga({ titulos = [], loading, selecionados, setSelecionados }) {
  const [verLoading, setVerLoading] = useState(null);

  const verBoleto = async (t) => {
    setVerLoading(t.codigo_lancamento);
    try {
      const { data } = await base44.functions.invoke('baixarPdfBoletoOmie', {
        codigo_lancamento: t.codigo_lancamento,
        url_boleto: t.url_boleto || undefined
      });
      if (!data?.sucesso) throw new Error(data?.error || 'Não foi possível obter o boleto');
      const bytes = base64ToUint8Array(data.pdf_base64);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      toast.error(e.message);
    }
    setVerLoading(null);
  };
  // Elegível = qualquer título que não está cancelado/liquidado/pago.
  // Títulos com boleto já gerado também são elegíveis (para reimpressão).
  const elegiveis = titulos.filter(t => {
    const status = String(t.status_titulo || '').toUpperCase();
    return !STATUS_BLOQUEADOS.has(status);
  });

  const todosMarcados =
    elegiveis.length > 0 &&
    elegiveis.every(t => selecionados.has(String(t.codigo_lancamento)));

  const toggleTodos = () => {
    const novo = new Set(selecionados);
    if (todosMarcados) {
      elegiveis.forEach(t => novo.delete(String(t.codigo_lancamento)));
    } else {
      elegiveis.forEach(t => novo.add(String(t.codigo_lancamento)));
    }
    setSelecionados(novo);
  };

  const toggleLinha = (cod) => {
    const novo = new Set(selecionados);
    const k = String(cod);
    if (novo.has(k)) novo.delete(k); else novo.add(k);
    setSelecionados(novo);
  };

  if (loading) {
    return (
      <div className="py-10 text-center text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin inline mr-2" /> Buscando títulos no Omie...
      </div>
    );
  }

  if (titulos.length === 0) {
    return (
      <div className="py-10 text-center text-slate-500">
        Nenhum título encontrado para esta carga.
        <div className="text-xs mt-1">
          (As NFs precisam estar emitidas no Omie para gerar os títulos)
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50/80 text-slate-700">
          <tr>
            <th className="p-2 w-10 text-center">
              <Checkbox checked={todosMarcados} onCheckedChange={toggleTodos} aria-label="Selecionar todos elegíveis" />
            </th>
            <th className="p-2 text-left font-semibold">Cliente</th>
            <th className="p-2 text-left font-semibold">Nº Pedido</th>
            <th className="p-2 text-left font-semibold">Nº NF</th>
            <th className="p-2 text-left font-semibold">Vencimento</th>
            <th className="p-2 text-right font-semibold">Valor</th>
            <th className="p-2 text-left font-semibold">Status</th>
            <th className="p-2 text-left font-semibold">Boleto</th>
          </tr>
        </thead>
        <tbody>
          {titulos.map(t => {
            const status = String(t.status_titulo || '').toUpperCase();
            const aberto = STATUS_ABERTOS.has(status);
            const jaTemBoleto = !!(t.numero_boleto && String(t.numero_boleto).trim());
            const elegivel = !STATUS_BLOQUEADOS.has(status);
            const k = String(t.codigo_lancamento);
            const marcado = selecionados.has(k);

            return (
              <tr key={k} className={`border-t hover:bg-slate-50/50 ${marcado ? 'bg-amber-50/40' : ''} ${!elegivel ? 'opacity-60' : ''}`}>
                <td className="p-2 text-center">
                  {elegivel ? (
                    <Checkbox checked={marcado} onCheckedChange={() => toggleLinha(k)} />
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="p-2">{t.nome_fantasia || t.nome_cliente || '—'}</td>
                <td className="p-2">{t.numero_pedido_vinculado ? formatarNumeroPedido(t.numero_pedido_vinculado) : '—'}</td>
                <td className="p-2">{t.numero_documento || '—'}</td>
                <td className="p-2">{t.data_vencimento || '—'}</td>
                <td className="p-2 text-right">{formatarValor(t.valor_documento)}</td>
                <td className="p-2">
                  <Badge className={
                    (status === 'ATRASADO' || status === 'VENCIDO') ? 'bg-red-100 text-red-800' :
                    aberto ? 'bg-blue-100 text-blue-800' :
                    STATUS_BLOQUEADOS.has(status) ? 'bg-gray-200 text-gray-800' :
                    'bg-gray-200 text-gray-800'
                  }>
                    {status || '—'}
                  </Badge>
                </td>
                <td className="p-2">
                  {jaTemBoleto ? (
                    <div className="flex items-center gap-1">
                      <Badge className="bg-green-100 text-green-800">{t.numero_boleto || 'Sim'}</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1"
                        onClick={() => verBoleto(t)}
                        disabled={verLoading === t.codigo_lancamento}
                        title="Ver/Reimprimir boleto"
                      >
                        {verLoading === t.codigo_lancamento
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Eye className="w-3 h-3" />}
                      </Button>
                    </div>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}