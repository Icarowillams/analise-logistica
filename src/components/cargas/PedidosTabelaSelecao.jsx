import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useState } from 'react';

export default function PedidosTabelaSelecao({ pedidos, selecionados, setSelecionados }) {
  const [filtro, setFiltro] = useState('');

  const filtrados = useMemo(() => {
    if (!filtro) return pedidos;
    const f = filtro.toLowerCase();
    return pedidos.filter(p =>
      (p.nome_cliente || '').toLowerCase().includes(f) ||
      (p.nome_fantasia || '').toLowerCase().includes(f) ||
      (p.numero_pedido || '').toLowerCase().includes(f) ||
      (p.cidade || '').toLowerCase().includes(f) ||
      (p.rota_nome || '').toLowerCase().includes(f)
    );
  }, [pedidos, filtro]);

  const toggleTodos = () => {
    if (selecionados.length === filtrados.length) setSelecionados([]);
    else setSelecionados(filtrados.map(p => p.codigo_pedido));
  };

  const toggle = (cod) => {
    setSelecionados(prev => prev.includes(cod) ? prev.filter(c => c !== cod) : [...prev, cod]);
  };

  const totalSelecionado = useMemo(() =>
    pedidos.filter(p => selecionados.includes(p.codigo_pedido)).reduce((s, p) => s + (p.valor_total_pedido || 0), 0),
    [pedidos, selecionados]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span>{filtrados.length} pedidos | {selecionados.length} selecionados | R$ {totalSelecionado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
          <Input className="max-w-xs" placeholder="Filtrar cliente/pedido/rota..." value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 max-h-[60vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className="p-2 w-10">
                <Checkbox checked={selecionados.length === filtrados.length && filtrados.length > 0} onCheckedChange={toggleTodos} />
              </th>
              <th className="p-2 text-left">Pedido</th>
              <th className="p-2 text-left">Cliente</th>
              <th className="p-2 text-left">Cidade</th>
              <th className="p-2 text-left">Rota</th>
              <th className="p-2 text-right">Itens</th>
              <th className="p-2 text-right">Valor</th>
              <th className="p-2 text-center">Tipo NF</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map(p => (
              <tr key={p.codigo_pedido} className={`border-t hover:bg-slate-50 ${selecionados.includes(p.codigo_pedido) ? 'bg-amber-50' : ''}`}>
                <td className="p-2"><Checkbox checked={selecionados.includes(p.codigo_pedido)} onCheckedChange={() => toggle(p.codigo_pedido)} /></td>
                <td className="p-2 font-mono">{p.numero_pedido}</td>
                <td className="p-2">{p.nome_fantasia || p.nome_cliente || <span className="text-red-500">Sem vínculo ({p.codigo_cliente})</span>}</td>
                <td className="p-2">{p.cidade}</td>
                <td className="p-2">{p.rota_nome || '-'}</td>
                <td className="p-2 text-right">{p.quantidade_itens}</td>
                <td className="p-2 text-right">R$ {Number(p.valor_total_pedido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td className="p-2 text-center">
                  <Badge className={p.tipo_nota === 'D1' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'}>{p.tipo_nota || '55'}</Badge>
                </td>
              </tr>
            ))}
            {filtrados.length === 0 && (
              <tr><td colSpan={8} className="text-center py-8 text-slate-500">Nenhum pedido encontrado</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}