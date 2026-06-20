import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Link2Off } from 'lucide-react';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';

const formatarValor = (v) =>
  `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

// Mostra pedidos da carga que precisam de atenção manual:
//  - nfSemTitulo: pedido COM numero_nf mas SEM título correspondente no Omie (erro de espelho)
//  - semNf: pedido SEM numero_nf preenchido (aguardando emissão / pendência de vínculo)
export default function PendenciasVinculoCarga({ nfSemTitulo = [], semNf = [] }) {
  if (nfSemTitulo.length === 0 && semNf.length === 0) return null;

  return (
    <Card className="border-amber-200">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          Pendências de Vínculo
          <Badge variant="outline" className="text-xs">
            {nfSemTitulo.length + semNf.length} pedido(s)
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {nfSemTitulo.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 overflow-hidden">
            <div className="px-3 py-2 text-sm font-semibold text-red-800 flex items-center gap-2">
              <Link2Off className="w-4 h-4" />
              NF vinculada ao pedido mas título não encontrado no Omie — verificar espelho
            </div>
            <table className="w-full text-sm">
              <thead className="bg-red-100/60 text-red-800">
                <tr>
                  <th className="p-2 text-left font-semibold">Cliente</th>
                  <th className="p-2 text-left font-semibold">Nº Pedido</th>
                  <th className="p-2 text-left font-semibold">Nº NF</th>
                  <th className="p-2 text-right font-semibold">Valor</th>
                </tr>
              </thead>
              <tbody>
                {nfSemTitulo.map((p) => (
                  <tr key={`nf-${p.codigo_pedido}`} className="border-t border-red-200">
                    <td className="p-2 text-red-900">{p.nome_fantasia || p.nome_cliente || '—'}</td>
                    <td className="p-2 text-red-900">{p.numero_pedido ? formatarNumeroPedido(p) : '—'}</td>
                    <td className="p-2 font-mono text-red-900">{p.numero_nf}</td>
                    <td className="p-2 text-right text-red-900">{formatarValor(p.valor_total_pedido)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {semNf.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
            <div className="px-3 py-2 text-sm font-semibold text-amber-800">
              Pedidos sem NF emitida — correção/emissão manual necessária
            </div>
            <table className="w-full text-sm">
              <thead className="bg-amber-100/60 text-amber-800">
                <tr>
                  <th className="p-2 text-left font-semibold">Cliente</th>
                  <th className="p-2 text-left font-semibold">Nº Pedido</th>
                  <th className="p-2 text-left font-semibold">Cód. Pedido Omie</th>
                  <th className="p-2 text-right font-semibold">Valor</th>
                </tr>
              </thead>
              <tbody>
                {semNf.map((p) => (
                  <tr key={`semnf-${p.codigo_pedido || p.numero_pedido}`} className="border-t border-amber-200">
                    <td className="p-2 text-amber-900">{p.nome_fantasia || p.nome_cliente || '—'}</td>
                    <td className="p-2 text-amber-900">{p.numero_pedido ? formatarNumeroPedido(p) : '—'}</td>
                    <td className="p-2 font-mono text-amber-900">{p.codigo_pedido || '—'}</td>
                    <td className="p-2 text-right text-amber-900">{formatarValor(p.valor_total_pedido)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}