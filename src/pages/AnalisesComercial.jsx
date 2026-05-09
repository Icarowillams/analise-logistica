import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BarChart3, Download, TrendingUp, Users, Route, ShoppingCart } from 'lucide-react';

const exportarCSV = (linhas) => {
  const csv = ['vendedor;visitas;pedidos;valor_total', ...linhas.map(l => `${l.vendedor};${l.visitas};${l.pedidos};${l.valor}`)].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `analise_comercial_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
};

export default function AnalisesComercial() {
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: visitas = [] } = useQuery({ queryKey: ['visitasRoteiro'], queryFn: () => base44.entities.VisitaRoteiro.list('-updated_date', 10000) });
  const { data: pedidos = [] } = useQuery({ queryKey: ['pedidos'], queryFn: () => base44.entities.Pedido.list('-updated_date', 10000) });
  const { data: roteiros = [] } = useQuery({ queryKey: ['roteiros'], queryFn: () => base44.entities.Roteiro.list('-updated_date', 10000) });

  const linhas = useMemo(() => vendedores.map(v => {
    const visitasVend = visitas.filter(x => x.vendedor_id === v.id && x.status === 'visitado').length;
    const pedidosVend = pedidos.filter(p => p.vendedor_id === v.id);
    const valor = pedidosVend.reduce((acc, p) => acc + (p.valor_total || 0), 0);
    return { vendedor: v.nome, supervisor_id: v.supervisor_id, visitas: visitasVend, pedidos: pedidosVend.length, valor };
  }).sort((a, b) => b.valor - a.valor), [vendedores, visitas, pedidos]);

  const totalValor = linhas.reduce((acc, l) => acc + l.valor, 0);
  const totalPedidos = linhas.reduce((acc, l) => acc + l.pedidos, 0);
  const totalVisitas = linhas.reduce((acc, l) => acc + l.visitas, 0);
  const totalPlanejado = roteiros.reduce((acc, r) => acc + (r.clientes_ids?.length || r.clientes_detalhes?.length || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <PageHeader title="Análises Comercial" subtitle="Indicadores de produtividade, visitas, pedidos e desempenho da equipe" icon={BarChart3} />
        <div className="flex gap-2"><Button variant="outline" onClick={() => exportarCSV(linhas)}><Download className="w-4 h-4" />CSV</Button><Button variant="outline" onClick={() => window.print()}><Download className="w-4 h-4" />PDF/Imprimir</Button></div>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><Users className="w-5 h-5 text-cyan-600 mb-2" /><p className="text-sm text-slate-500">Vendedores</p><p className="text-3xl font-bold">{vendedores.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><Route className="w-5 h-5 text-emerald-600 mb-2" /><p className="text-sm text-slate-500">Visitas realizadas</p><p className="text-3xl font-bold">{totalVisitas}/{totalPlanejado}</p></CardContent></Card>
        <Card><CardContent className="p-4"><ShoppingCart className="w-5 h-5 text-amber-600 mb-2" /><p className="text-sm text-slate-500">Pedidos</p><p className="text-3xl font-bold">{totalPedidos}</p></CardContent></Card>
        <Card><CardContent className="p-4"><TrendingUp className="w-5 h-5 text-indigo-600 mb-2" /><p className="text-sm text-slate-500">Valor vendido</p><p className="text-3xl font-bold">R$ {totalValor.toFixed(2)}</p></CardContent></Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Ranking de desempenho</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {linhas.slice(0, 10).map((l, i) => (
              <div key={l.vendedor} className="flex items-center justify-between rounded-lg border p-3">
                <div><Badge variant="outline">#{i + 1}</Badge><span className="ml-2 font-medium">{l.vendedor}</span></div>
                <div className="text-right text-sm"><p>R$ {l.valor.toFixed(2)}</p><p className="text-slate-500">{l.visitas} visitas • {l.pedidos} pedidos</p></div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Alertas gerenciais</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {roteiros.filter(r => (r.clientes_ids?.length || r.clientes_detalhes?.length || 0) > 12).map(r => (
              <div key={r.id} className="rounded-lg bg-red-50 border border-red-200 p-3 text-red-800">Gargalo: {r.vendedor_nome || 'Vendedor'} tem muitos clientes em {r.dia_semana}.</div>
            ))}
            {linhas.filter(l => l.visitas === 0 && l.pedidos === 0).slice(0, 5).map(l => (
              <div key={l.vendedor} className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-amber-800">Atenção: {l.vendedor} sem visitas e pedidos registrados.</div>
            ))}
            {roteiros.length === 0 && <p className="text-slate-500">Ainda não há dados suficientes para identificar tendências.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}