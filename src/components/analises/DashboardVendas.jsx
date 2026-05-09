import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendingUp, ShoppingBag, Users, DollarSign, Target, Award } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import KpiCard from './KpiCard';
import FiltrosBase from './FiltrosBase';
import { dentroPeriodo, exportarCSV, formatarMoeda, formatarNumero } from './utilsAnalises';

export default function DashboardVendas() {
  const [filtros, setFiltros] = useState({ inicio: '', fim: '', vendedor_id: '', tipo: '' });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: pedidos = [] } = useQuery({ queryKey: ['pedidos'], queryFn: () => base44.entities.Pedido.list('-created_date', 10000) });
  const { data: visitas = [] } = useQuery({ queryKey: ['visitasRoteiro'], queryFn: () => base44.entities.VisitaRoteiro.list('-created_date', 10000) });

  const filtrados = useMemo(() => pedidos.filter(p => {
    if (filtros.vendedor_id && p.vendedor_id !== filtros.vendedor_id) return false;
    if (filtros.tipo && p.tipo !== filtros.tipo) return false;
    if ((filtros.inicio || filtros.fim) && !dentroPeriodo(p.created_date, filtros.inicio, filtros.fim)) return false;
    return true;
  }), [pedidos, filtros]);

  const totais = useMemo(() => {
    const valor = filtrados.reduce((a, p) => a + (p.valor_total || 0), 0);
    const itens = filtrados.reduce((a, p) => a + (p.total_itens || 0), 0);
    const clientes = new Set(filtrados.map(p => p.cliente_id)).size;
    const ticket = filtrados.length ? valor / filtrados.length : 0;
    const conv = visitas.length ? Math.round((filtrados.length / visitas.length) * 100) : 0;
    return { total: filtrados.length, valor, itens, clientes, ticket, conversao: conv };
  }, [filtrados, visitas]);

  const porMes = useMemo(() => {
    const grupo = {};
    filtrados.forEach(p => {
      const k = String(p.created_date || '').slice(0, 7);
      if (!k) return;
      if (!grupo[k]) grupo[k] = { mes: k, valor: 0, qtd: 0 };
      grupo[k].valor += p.valor_total || 0;
      grupo[k].qtd++;
    });
    return Object.values(grupo).sort((a, b) => a.mes.localeCompare(b.mes)).slice(-12);
  }, [filtrados]);

  const ranking = useMemo(() => {
    const v = {};
    filtrados.forEach(p => {
      const k = p.vendedor_nome || vendedores.find(x => x.id === p.vendedor_id)?.nome || '-';
      if (!v[k]) v[k] = { nome: k, valor: 0, qtd: 0 };
      v[k].valor += p.valor_total || 0;
      v[k].qtd++;
    });
    return Object.values(v).sort((a, b) => b.valor - a.valor).slice(0, 10);
  }, [filtrados, vendedores]);

  const topClientes = useMemo(() => {
    const c = {};
    filtrados.forEach(p => {
      const k = p.cliente_nome || '-';
      if (!c[k]) c[k] = { nome: k, valor: 0, qtd: 0 };
      c[k].valor += p.valor_total || 0;
      c[k].qtd++;
    });
    return Object.values(c).sort((a, b) => b.valor - a.valor).slice(0, 10);
  }, [filtrados]);

  const exportar = () => exportarCSV('dashboard_vendas',
    ['Data', 'Pedido', 'Cliente', 'Vendedor', 'Tipo', 'Itens', 'Valor', 'Status'],
    filtrados.map(p => [p.created_date?.slice(0,10), p.numero_pedido, p.cliente_nome, p.vendedor_nome, p.tipo, p.total_itens, p.valor_total, p.status])
  );

  return (
    <div className="space-y-4">
      <FiltrosBase filtros={filtros} setFiltros={setFiltros} vendedores={vendedores} onLimpar={() => setFiltros({ inicio: '', fim: '', vendedor_id: '', tipo: '' })} onExportar={exportar}>
        <div>
          <Label className="text-xs">Tipo</Label>
          <Select value={filtros.tipo || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, tipo: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos</SelectItem>
              <SelectItem value="venda">Venda</SelectItem>
              <SelectItem value="bonificacao">Bonificação</SelectItem>
              <SelectItem value="troca">Troca</SelectItem>
              <SelectItem value="devolucao">Devolução</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FiltrosBase>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard titulo="Pedidos" valor={formatarNumero(totais.total)} icon={ShoppingBag} cor="cyan" />
        <KpiCard titulo="Faturamento" valor={formatarMoeda(totais.valor)} icon={DollarSign} cor="emerald" />
        <KpiCard titulo="Ticket médio" valor={formatarMoeda(totais.ticket)} icon={Target} cor="amber" />
        <KpiCard titulo="Itens vendidos" valor={formatarNumero(totais.itens)} icon={Award} cor="indigo" />
        <KpiCard titulo="Clientes" valor={formatarNumero(totais.clientes)} icon={Users} cor="slate" />
        <KpiCard titulo="Conversão" valor={`${totais.conversao}%`} sub="pedidos/visitas" icon={TrendingUp} cor="red" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Evolução de vendas</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={porMes}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="mes" /><YAxis yAxisId="left" /><YAxis yAxisId="right" orientation="right" /><Tooltip formatter={(v, n) => n === 'valor' ? formatarMoeda(v) : v} /><Legend /><Line yAxisId="left" type="monotone" dataKey="valor" stroke="#16a34a" strokeWidth={2} name="Faturamento" /><Line yAxisId="right" type="monotone" dataKey="qtd" stroke="#0891b2" strokeWidth={2} name="Pedidos" /></LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Top 10 vendedores</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={ranking} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis dataKey="nome" type="category" width={120} /><Tooltip formatter={(v) => formatarMoeda(v)} /><Bar dataKey="valor" fill="#16a34a" /></BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Top 10 clientes</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={topClientes} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis dataKey="nome" type="category" width={140} /><Tooltip formatter={(v) => formatarMoeda(v)} /><Bar dataKey="valor" fill="#0891b2" /></BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Pedidos detalhados</CardTitle></CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0"><tr><th className="p-2 text-left">Data</th><th className="p-2 text-left">Nº</th><th className="p-2 text-left">Cliente</th><th className="p-2 text-left">Vendedor</th><th className="p-2 text-left">Tipo</th><th className="p-2 text-right">Itens</th><th className="p-2 text-right">Valor</th><th className="p-2 text-left">Status</th></tr></thead>
            <tbody>{filtrados.slice(0, 200).map(p => (
              <tr key={p.id} className="border-t hover:bg-slate-50">
                <td className="p-2">{(p.created_date || '').slice(0,10)}</td>
                <td className="p-2 font-mono">{p.numero_pedido || '-'}</td>
                <td className="p-2">{p.cliente_nome || '-'}</td>
                <td className="p-2">{p.vendedor_nome || '-'}</td>
                <td className="p-2"><Badge variant="outline">{p.tipo}</Badge></td>
                <td className="p-2 text-right">{p.total_itens || 0}</td>
                <td className="p-2 text-right">{formatarMoeda(p.valor_total)}</td>
                <td className="p-2"><Badge>{p.status}</Badge></td>
              </tr>
            ))}</tbody>
          </table>
          {filtrados.length > 200 && <p className="text-xs text-slate-500 mt-2">Exibindo 200 de {filtrados.length}.</p>}
        </CardContent>
      </Card>
    </div>
  );
}