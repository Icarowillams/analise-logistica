import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatarDia } from './gestaoUtils';

export default function RoteirosVisualizar({ roteiro }) {
  if (!roteiro) {
    return (
      <Card className="mt-4">
        <CardContent className="p-12 text-center">
          <p className="text-amber-700">Selecione um roteiro na aba "Busca de Roteiros" e clique em "Visualizar"</p>
        </CardContent>
      </Card>
    );
  }

  const detalhes = (roteiro.clientes_detalhes || []).slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{roteiro.vendedor_nome || '-'} · {formatarDia(roteiro.dia_semana)}</span>
            <Badge variant="outline">{detalhes.length} clientes</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left p-3 font-medium w-16">Ordem</th>
                <th className="text-left p-3 font-medium">Código</th>
                <th className="text-left p-3 font-medium">Cliente</th>
                <th className="text-left p-3 font-medium">Cidade</th>
                <th className="text-left p-3 font-medium">Endereço</th>
                <th className="text-left p-3 font-medium">Telefone</th>
              </tr>
            </thead>
            <tbody>
              {detalhes.map((d, i) => (
                <tr key={i} className="border-b">
                  <td className="p-3 font-bold text-amber-600">{d.ordem || i + 1}</td>
                  <td className="p-3">{d.cliente_codigo || '-'}</td>
                  <td className="p-3 font-medium">{d.cliente_nome}</td>
                  <td className="p-3">{d.cliente_cidade || '-'}</td>
                  <td className="p-3 text-slate-600">{d.cliente_endereco || '-'}</td>
                  <td className="p-3 text-slate-600">{d.cliente_telefone || '-'}</td>
                </tr>
              ))}
              {detalhes.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">Roteiro sem clientes.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {roteiro.observacoes && (
        <Card><CardHeader><CardTitle className="text-base">Observações</CardTitle></CardHeader><CardContent><p className="text-sm whitespace-pre-line">{roteiro.observacoes}</p></CardContent></Card>
      )}
    </div>
  );
}