import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { BarChart3, Truck, Package, AlertTriangle, ArrowLeftRight, TrendingUp } from 'lucide-react';

const COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#f97316'];

export default function RelatorioLogistico() {
  const [periodoMes, setPeriodoMes] = useState(new Date().toISOString().slice(0, 7));

  const { data: cargas = [] } = useQuery({ queryKey: ['cargas'], queryFn: () => base44.entities.Carga.list('-data_montagem', 500) });
  const { data: pedidosVenda = [] } = useQuery({ queryKey: ['pedidosVenda'], queryFn: () => base44.entities.PedidoVenda.list('-data_pedido', 500) });
  const { data: pedidosTroca = [] } = useQuery({ queryKey: ['pedidosTroca'], queryFn: () => base44.entities.PedidoTroca.list('-data_troca', 500) });
  const { data: ocorrencias = [] } = useQuery({ queryKey: ['ocorrenciasOp'], queryFn: () => base44.entities.OcorrenciaOperacional.list('-data_ocorrencia', 500) });
  const { data: comodatos = [] } = useQuery({ queryKey: ['comodatos'], queryFn: () => base44.entities.Comodato.list('-data_entrega', 500) });

  const mes = periodoMes;

  const cargasMes = useMemo(() => cargas.filter(c => c.data_montagem?.startsWith(mes)), [cargas, mes]);
  const pedidosMes = useMemo(() => pedidosVenda.filter(p => p.data_pedido?.startsWith(mes)), [pedidosVenda, mes]);
  const trocasMes = useMemo(() => pedidosTroca.filter(t => t.data_troca?.startsWith(mes)), [pedidosTroca, mes]);
  const ocorrenciasMes = useMemo(() => ocorrencias.filter(o => o.data_ocorrencia?.startsWith(mes)), [ocorrencias, mes]);

  const faturamentoTotal = useMemo(() => pedidosMes.reduce((acc, p) => acc + (p.valor_total || 0), 0), [pedidosMes]);
  const trocasValor = useMemo(() => trocasMes.reduce((acc, t) => acc + (t.valor_total || 0), 0), [trocasMes]);

  const statusCargaData = useMemo(() => {
    const grupos = {};
    cargasMes.forEach(c => { grupos[c.status] = (grupos[c.status] || 0) + 1; });
    return Object.entries(grupos).map(([name, value]) => ({ name: name.replace('_', ' '), value }));
  }, [cargasMes]);

  const statusEntregaData = useMemo(() => {
    const entregues = pedidosMes.filter(p => p.status === 'entregue').length;
    const emRota = pedidosMes.filter(p => p.status === 'em_rota').length;
    const cancelados = pedidosMes.filter(p => p.status === 'cancelado').length;
    const outros = pedidosMes.length - entregues - emRota - cancelados;
    return [
      { name: 'Entregue', value: entregues },
      { name: 'Em Rota', value: emRota },
      { name: 'Cancelado', value: cancelados },
      { name: 'Outros', value: outros },
    ].filter(d => d.value > 0);
  }, [pedidosMes]);

  const ocorrenciasPorTipo = useMemo(() => {
    const grupos = {};
    ocorrenciasMes.forEach(o => { grupos[o.tipo] = (grupos[o.tipo] || 0) + 1; });
    return Object.entries(grupos).map(([name, value]) => ({ name: name.replace('_', ' '), value }));
  }, [ocorrenciasMes]);

  return (
    <div className="space-y-4">
      <PageHeader title="Relatório Logístico" icon={BarChart3} subtitle="Visão consolidada da operação logística" />

      <div className="flex items-center gap-3">
        <Label className="text-sm font-medium whitespace-nowrap">Mês de referência:</Label>
        <Input type="month" value={periodoMes} onChange={e => setPeriodoMes(e.target.value)} className="h-9 w-44" />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Cargas', value: cargasMes.length, icon: Truck, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Pedidos', value: pedidosMes.length, icon: Package, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Faturamento', value: `R$ ${(faturamentoTotal / 1000).toFixed(1)}k`, icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Trocas', value: trocasMes.length, icon: ArrowLeftRight, color: 'text-orange-600', bg: 'bg-orange-50' },
          { label: 'Ocorrências', value: ocorrenciasMes.length, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50' },
          { label: 'Comodatos Ativos', value: comodatos.filter(c => c.status === 'ativo').length, icon: Package, color: 'text-purple-600', bg: 'bg-purple-50' },
        ].map(kpi => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <div className={`w-7 h-7 ${kpi.bg} rounded-lg flex items-center justify-center`}><kpi.icon className={`w-4 h-4 ${kpi.color}`} /></div>
              </div>
              <div className="text-2xl font-bold text-slate-800">{kpi.value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{kpi.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Status das Cargas */}
        <Card className="border-0 shadow-md">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Status das Cargas</CardTitle></CardHeader>
          <CardContent>
            {statusCargaData.length === 0 ? <p className="text-center text-slate-400 py-8 text-sm">Sem dados no período</p> : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={statusCargaData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                    {statusCargaData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Status dos Pedidos */}
        <Card className="border-0 shadow-md">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Status dos Pedidos de Venda</CardTitle></CardHeader>
          <CardContent>
            {statusEntregaData.length === 0 ? <p className="text-center text-slate-400 py-8 text-sm">Sem dados no período</p> : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={statusEntregaData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                    {statusEntregaData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Ocorrências por tipo */}
        {ocorrenciasPorTipo.length > 0 && (
          <Card className="border-0 shadow-md md:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm">Ocorrências por Tipo</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={ocorrenciasPorTipo} layout="vertical">
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* Resumo Financeiro */}
        <Card className="border-0 shadow-md md:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Resumo Financeiro do Mês</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div className="p-3 bg-green-50 rounded-lg">
                <div className="text-xs text-green-600 font-medium">Faturamento Pedidos</div>
                <div className="text-lg font-bold text-green-700 mt-1">R$ {faturamentoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
              </div>
              <div className="p-3 bg-orange-50 rounded-lg">
                <div className="text-xs text-orange-600 font-medium">Valor em Trocas</div>
                <div className="text-lg font-bold text-orange-700 mt-1">R$ {trocasValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="text-xs text-blue-600 font-medium">Ticket Médio Pedido</div>
                <div className="text-lg font-bold text-blue-700 mt-1">R$ {pedidosMes.length > 0 ? (faturamentoTotal / pedidosMes.length).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '0,00'}</div>
              </div>
              <div className="p-3 bg-red-50 rounded-lg">
                <div className="text-xs text-red-600 font-medium">Ocorrências Abertas</div>
                <div className="text-lg font-bold text-red-700 mt-1">{ocorrencias.filter(o => o.status === 'aberta').length}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}