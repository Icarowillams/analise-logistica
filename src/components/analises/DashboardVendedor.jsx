import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  User, DollarSign, ShoppingBag, Target, Award, TrendingUp,
  CheckCircle2, Clock, ArrowLeftRight, Percent
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, LineChart, Line, ComposedChart, Area
} from 'recharts';
import KpiCard from './KpiCard';
import FiltrosBase from './FiltrosBase';
import useVisitasAnalise from './useVisitasAnalise';
import { dentroPeriodo, exportarCSV, formatarMoeda, formatarNumero, duracaoMin, mesKey } from './utilsAnalises';

const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const formatMes = (k) => { const [a, m] = k.split('-'); return `${MESES_PT[+m-1]}/${a.slice(2)}`; };

export default function DashboardVendedor() {
  const [filtros, setFiltros] = useState({ inicio: '', fim: '', vendedor_id: '' });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores_analise'],
    queryFn: () => base44.entities.Vendedor.list()
  });
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes_analise'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 20000)
  });
  const { data: pedidosVenda = [], isLoading: loadingV } = useQuery({
    queryKey: ['pedidos_venda_faturados'],
    queryFn: () => base44.entities.Pedido.filter({ tipo: 'venda', status: 'faturado' }, '-data_faturamento', 10000)
  });
  const { data: pedidosTroca = [] } = useQuery({
    queryKey: ['pedidos_troca_faturados'],
    queryFn: () => base44.entities.Pedido.filter({ tipo: 'troca', status: 'faturado' }, '-data_faturamento', 5000)
  });
  const { visitas } = useVisitasAnalise();
  const { data: metas = [] } = useQuery({
    queryKey: ['metas_vendas'],
    queryFn: () => base44.entities.Meta.filter({ tipo: 'venda' }, '-periodo_inicio', 200)
  });
  const { data: cortes = [] } = useQuery({
    queryKey: ['log_cortes'],
    queryFn: () => base44.entities.LogCorte.list('-created_date', 5000)
  });

  // Mapa cliente_id → vendedor
  const vendedorPorCliente = useMemo(() => {
    const nomesVend = new Map(vendedores.map(v => [v.id, v.nome]));
    const map = new Map();
    clientes.forEach(c => {
      if (c.id && c.vendedor_id) map.set(c.id, { id: c.vendedor_id, nome: nomesVend.get(c.vendedor_id) || '-' });
    });
    return map;
  }, [clientes, vendedores]);

  const enriquecer = (p) => {
    const v = vendedorPorCliente.get(p.cliente_id);
    return { ...p, vendedor_id: v?.id || p.vendedor_id, vendedor_nome: v?.nome || p.vendedor_nome };
  };

  // Filtrar por período e vendedor selecionado
  const vendaFiltradas = useMemo(() => pedidosVenda.map(enriquecer).filter(p => {
    if (filtros.vendedor_id && p.vendedor_id !== filtros.vendedor_id) return false;
    if ((filtros.inicio || filtros.fim) && !dentroPeriodo(p.data_faturamento || p.created_date, filtros.inicio, filtros.fim)) return false;
    return true;
  }), [pedidosVenda, vendedorPorCliente, filtros]);

  const trocaFiltradas = useMemo(() => pedidosTroca.map(enriquecer).filter(p => {
    if (filtros.vendedor_id && p.vendedor_id !== filtros.vendedor_id) return false;
    if ((filtros.inicio || filtros.fim) && !dentroPeriodo(p.data_faturamento || p.created_date, filtros.inicio, filtros.fim)) return false;
    return true;
  }), [pedidosTroca, vendedorPorCliente, filtros]);

  const visitasFiltradas = useMemo(() => visitas.filter(v => {
    if (filtros.vendedor_id && v.vendedor_id !== filtros.vendedor_id) return false;
    if ((filtros.inicio || filtros.fim) && !dentroPeriodo(v.data_visita || v.created_date, filtros.inicio, filtros.fim)) return false;
    return true;
  }), [visitas, filtros]);

  const cortesFiltrados = useMemo(() => cortes.filter(c => {
    if (filtros.vendedor_id && c.funcionario_id && c.funcionario_id !== filtros.vendedor_id) return false;
    if ((filtros.inicio || filtros.fim) && !dentroPeriodo(c.created_date, filtros.inicio, filtros.fim)) return false;
    return true;
  }), [cortes, filtros]);

  // KPIs do vendedor selecionado (ou de todos)
  const kpis = useMemo(() => {
    const faturamento = vendaFiltradas.reduce((a, p) => a + (p.valor_total || 0), 0);
    const pedidos = vendaFiltradas.length;
    const clientesUnicos = new Set(vendaFiltradas.map(p => p.cliente_id)).size;
    const ticket = pedidos ? faturamento / pedidos : 0;
    const trocasQtd = trocaFiltradas.length;
    const valorTrocas = trocaFiltradas.reduce((a, t) => a + (t.valor_total || 0), 0);
    const percTrocas = faturamento > 0 ? ((valorTrocas / faturamento) * 100).toFixed(1) : '0';
    const visitasRealizadas = visitasFiltradas.filter(v => v.status === 'visitado').length;
    const visitasTotal = visitasFiltradas.length;
    const taxaSucesso = visitasTotal > 0 ? Math.round((visitasRealizadas / visitasTotal) * 100) : 0;
    const comPedido = visitasFiltradas.filter(v => v.gerou_pedido).length;
    const taxaConversao = visitasRealizadas > 0 ? Math.round((comPedido / visitasRealizadas) * 100) : 0;

    // Meta mais recente do vendedor selecionado
    let meta = null;
    if (filtros.vendedor_id) {
      meta = metas.filter(m => m.vendedor_id === filtros.vendedor_id).sort((a, b) => (b.periodo_inicio || '').localeCompare(a.periodo_inicio || ''))[0];
    }
    const percMeta = meta?.valor_meta ? Math.round((faturamento / meta.valor_meta) * 100) : null;

    return { faturamento, pedidos, clientesUnicos, ticket, trocasQtd, valorTrocas, percTrocas, visitasRealizadas, visitasTotal, taxaSucesso, taxaConversao, meta, percMeta };
  }, [vendaFiltradas, trocaFiltradas, visitasFiltradas, metas, filtros.vendedor_id]);

  // Evolução mensal do vendedor (faturamento + trocas)
  const evolucaoMensal = useMemo(() => {
    const grupo = {};
    vendaFiltradas.forEach(p => {
      const k = mesKey(p.data_faturamento || p.created_date);
      if (!k || k.length < 7) return;
      if (!grupo[k]) grupo[k] = { mes: k, label: formatMes(k), venda: 0, troca: 0, pedidos: 0 };
      grupo[k].venda += p.valor_total || 0;
      grupo[k].pedidos++;
    });
    trocaFiltradas.forEach(p => {
      const k = mesKey(p.data_faturamento || p.created_date);
      if (!k || k.length < 7) return;
      if (!grupo[k]) grupo[k] = { mes: k, label: formatMes(k), venda: 0, troca: 0, pedidos: 0 };
      grupo[k].troca += p.valor_total || 0;
    });
    return Object.values(grupo).sort((a, b) => a.mes.localeCompare(b.mes)).slice(-12);
  }, [vendaFiltradas, trocaFiltradas]);

  // Comparativo entre vendedores (quando nenhum está selecionado)
  const comparativoVendedores = useMemo(() => {
    if (filtros.vendedor_id) return [];
    const grupo = {};
    pedidosVenda.map(enriquecer).forEach(p => {
      if ((filtros.inicio || filtros.fim) && !dentroPeriodo(p.data_faturamento || p.created_date, filtros.inicio, filtros.fim)) return;
      const k = p.vendedor_id || 'sem';
      const nome = p.vendedor_nome || '-';
      if (!grupo[k]) grupo[k] = { id: k, nome, faturamento: 0, pedidos: 0, trocas: 0, clientes: new Set() };
      grupo[k].faturamento += p.valor_total || 0;
      grupo[k].pedidos++;
      grupo[k].clientes.add(p.cliente_id);
    });
    pedidosTroca.map(enriquecer).forEach(p => {
      if ((filtros.inicio || filtros.fim) && !dentroPeriodo(p.data_faturamento || p.created_date, filtros.inicio, filtros.fim)) return;
      const k = p.vendedor_id || 'sem';
      if (grupo[k]) grupo[k].trocas++;
    });
    visitas.forEach(v => {
      if (filtros.vendedor_id && v.vendedor_id !== filtros.vendedor_id) return;
      if ((filtros.inicio || filtros.fim) && !dentroPeriodo(v.data_visita || v.created_date, filtros.inicio, filtros.fim)) return;
      const k = v.vendedor_id || 'sem';
      if (!grupo[k]) grupo[k] = { id: k, nome: v.vendedor_nome || '-', faturamento: 0, pedidos: 0, trocas: 0, clientes: new Set(), visitasTotal: 0, visitasRealizadas: 0 };
      if (!grupo[k].visitasTotal) { grupo[k].visitasTotal = 0; grupo[k].visitasRealizadas = 0; }
      grupo[k].visitasTotal++;
      if (v.status === 'visitado') grupo[k].visitasRealizadas++;
    });
    return Object.values(grupo)
      .map(g => ({
        ...g,
        clientes: g.clientes instanceof Set ? g.clientes.size : g.clientes,
        taxaSucesso: g.visitasTotal > 0 ? Math.round(((g.visitasRealizadas || 0) / g.visitasTotal) * 100) : 0,
        percTrocas: g.faturamento > 0 ? +((g.trocas / (g.pedidos || 1)) * 100).toFixed(1) : 0
      }))
      .sort((a, b) => b.faturamento - a.faturamento)
      .slice(0, 12);
  }, [pedidosVenda, pedidosTroca, visitas, vendedorPorCliente, filtros]);

  // Radar de performance do vendedor selecionado
  const radarData = useMemo(() => {
    if (!filtros.vendedor_id || comparativoVendedores.length === 0) return [];
    const all = comparativoVendedores;
    const maxFat = Math.max(...all.map(v => v.faturamento), 1);
    const maxPed = Math.max(...all.map(v => v.pedidos), 1);
    const vend = all.find(v => v.id === filtros.vendedor_id);
    if (!vend) return [];
    return [
      { eixo: 'Faturamento', valor: Math.round((vend.faturamento / maxFat) * 100) },
      { eixo: 'Pedidos', valor: Math.round((vend.pedidos / maxPed) * 100) },
      { eixo: 'Sucesso visitas', valor: kpis.taxaSucesso },
      { eixo: 'Conversão', valor: kpis.taxaConversao },
      { eixo: 'Meta', valor: kpis.percMeta ?? 0 },
    ];
  }, [filtros.vendedor_id, comparativoVendedores, kpis]);

  // Top clientes do vendedor
  const topClientes = useMemo(() => {
    const c = {};
    vendaFiltradas.forEach(p => {
      const k = p.cliente_id || p.cliente_nome;
      if (!c[k]) c[k] = { nome: p.cliente_nome || '-', valor: 0, qtd: 0 };
      c[k].valor += p.valor_total || 0;
      c[k].qtd++;
    });
    return Object.values(c).sort((a, b) => b.valor - a.valor).slice(0, 8);
  }, [vendaFiltradas]);

  const exportar = () => exportarCSV('dashboard_vendedor',
    ['Vendedor', 'Faturamento', 'Pedidos', 'Trocas', 'Clientes', 'Visitas', 'Taxa sucesso', 'Conversão'],
    comparativoVendedores.map(v => [v.nome, v.faturamento, v.pedidos, v.trocas, v.clientes, v.visitasTotal || '-', `${v.taxaSucesso}%`, '-'])
  );

  const vendedorSelecionado = vendedores.find(v => v.id === filtros.vendedor_id);

  return (
    <div className="space-y-4">
      {/* Filtro simplificado — aqui o vendedor É o foco, então fica em destaque */}
      <Card className="border-slate-200 bg-gradient-to-r from-indigo-50 to-purple-50">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-xs font-semibold text-indigo-700">Vendedor</Label>
              <Select value={filtros.vendedor_id || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, vendedor_id: v === '_todos_' ? '' : v })}>
                <SelectTrigger className="bg-white border-indigo-200">
                  <SelectValue placeholder="Todos os vendedores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_todos_">Comparativo geral</SelectItem>
                  {vendedores.filter(v => v.status !== 'inativo').map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">De</Label>
              <input type="date" value={filtros.inicio} onChange={e => setFiltros({ ...filtros, inicio: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm" />
            </div>
            <div>
              <Label className="text-xs">Até</Label>
              <input type="date" value={filtros.fim} onChange={e => setFiltros({ ...filtros, fim: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-white px-3 py-1 text-sm shadow-sm" />
            </div>
            <button onClick={() => setFiltros({ inicio: '', fim: '', vendedor_id: '' })}
              className="px-3 py-2 text-xs text-slate-600 border rounded-md hover:bg-white">
              Limpar
            </button>
            <button onClick={exportar}
              className="px-3 py-2 text-xs text-white bg-indigo-600 rounded-md hover:bg-indigo-700">
              Exportar CSV
            </button>
          </div>
          {vendedorSelecionado && (
            <div className="mt-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-lg">
                {vendedorSelecionado.nome?.charAt(0)}
              </div>
              <div>
                <p className="font-semibold text-indigo-900">{vendedorSelecionado.nome}</p>
                <p className="text-xs text-indigo-600">{vendedorSelecionado.funcao || vendedorSelecionado.cargo_id || 'Vendedor'} · {vendedorSelecionado.email}</p>
              </div>
              {kpis.percMeta !== null && (
                <Badge className={`ml-auto text-sm px-3 py-1 ${kpis.percMeta >= 100 ? 'bg-emerald-600' : kpis.percMeta >= 80 ? 'bg-amber-500' : 'bg-red-500'}`}>
                  {kpis.percMeta}% da meta
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPIs — mudam conforme vendedor selecionado ou geral */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiCard titulo="Faturamento" valor={formatarMoeda(kpis.faturamento)} icon={DollarSign} cor="emerald" />
        <KpiCard titulo="Pedidos" valor={formatarNumero(kpis.pedidos)} icon={ShoppingBag} cor="cyan" />
        <KpiCard titulo="Ticket médio" valor={formatarMoeda(kpis.ticket)} icon={Target} cor="amber" />
        <KpiCard titulo="Clientes" valor={formatarNumero(kpis.clientesUnicos)} icon={User} cor="indigo" />
        <KpiCard titulo="Trocas" valor={formatarNumero(kpis.trocasQtd)} sub={`${kpis.percTrocas}% do fat.`} icon={ArrowLeftRight} cor="red" />
        <KpiCard titulo="Sucesso visitas" valor={`${kpis.taxaSucesso}%`} sub={`${kpis.visitasRealizadas}/${kpis.visitasTotal}`} icon={CheckCircle2} cor="slate" />
        <KpiCard titulo="Conversão" valor={`${kpis.taxaConversao}%`} sub="visita→pedido" icon={TrendingUp} cor="amber" />
      </div>

      {/* Visão individual: radar + evolução mensal | Visão geral: comparativo */}
      {filtros.vendedor_id ? (
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Radar de performance */}
          <Card>
            <CardHeader><CardTitle className="text-base">Radar de performance</CardTitle></CardHeader>
            <CardContent>
              {radarData.length === 0
                ? <p className="text-sm text-slate-400 text-center py-8">Sem dados suficientes para radar</p>
                : (
                <ResponsiveContainer width="100%" height={280}>
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="eixo" tick={{ fontSize: 12 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Radar name="Performance" dataKey="valor" stroke="#7c3aed" fill="#7c3aed" fillOpacity={0.35} strokeWidth={2} />
                    <Tooltip formatter={v => `${v}%`} />
                    <Legend />
                  </RadarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Evolução mensal */}
          <Card>
            <CardHeader><CardTitle className="text-base">Evolução mensal</CardTitle></CardHeader>
            <CardContent>
              {evolucaoMensal.length === 0
                ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
                : (
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={evolucaoMensal}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis yAxisId="left" tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip formatter={(v, n) => n === 'venda' || n === 'troca' ? formatarMoeda(v) : v} />
                    <Legend />
                    <Area yAxisId="left" type="monotone" dataKey="venda" fill="#d1fae5" stroke="#16a34a" strokeWidth={2} name="Vendas" />
                    <Bar yAxisId="left" dataKey="troca" fill="#fca5a5" name="Trocas" />
                    <Line yAxisId="right" type="monotone" dataKey="pedidos" stroke="#0891b2" strokeWidth={2} name="Pedidos" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        /* Comparativo geral entre vendedores */
        <Card>
          <CardHeader><CardTitle className="text-base">Comparativo entre vendedores</CardTitle></CardHeader>
          <CardContent>
            {comparativoVendedores.length === 0
              ? <p className="text-sm text-slate-400 text-center py-12">Sem dados</p>
              : (
              <ResponsiveContainer width="100%" height={360}>
                <BarChart data={comparativoVendedores} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                  <YAxis dataKey="nome" type="category" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={v => formatarMoeda(v)} />
                  <Legend />
                  <Bar dataKey="faturamento" fill="#16a34a" name="Faturamento" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* Top clientes do vendedor selecionado */}
      {filtros.vendedor_id && (
        <Card>
          <CardHeader><CardTitle className="text-base">Top clientes</CardTitle></CardHeader>
          <CardContent>
            {topClientes.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
              : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={topClientes} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                  <YAxis dataKey="nome" type="category" width={160} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={v => formatarMoeda(v)} />
                  <Bar dataKey="valor" fill="#7c3aed" name="Faturamento" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tabela comparativa de todos os vendedores */}
      {!filtros.vendedor_id && comparativoVendedores.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Tabela comparativa</CardTitle></CardHeader>
          <CardContent className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="p-2 text-left">#</th>
                  <th className="p-2 text-left">Vendedor</th>
                  <th className="p-2 text-right">Faturamento</th>
                  <th className="p-2 text-right">Pedidos</th>
                  <th className="p-2 text-right">Ticket</th>
                  <th className="p-2 text-right">Clientes</th>
                  <th className="p-2 text-right">Trocas</th>
                  <th className="p-2 text-right">Sucesso visitas</th>
                </tr>
              </thead>
              <tbody>
                {comparativoVendedores.map((v, i) => (
                  <tr key={v.id} className="border-t hover:bg-slate-50 cursor-pointer"
                    onClick={() => setFiltros({ ...filtros, vendedor_id: v.id })}>
                    <td className="p-2 text-slate-500 font-bold">{i+1}</td>
                    <td className="p-2 font-medium text-indigo-700 hover:underline">{v.nome}</td>
                    <td className="p-2 text-right font-semibold text-emerald-700">{formatarMoeda(v.faturamento)}</td>
                    <td className="p-2 text-right">{v.pedidos}</td>
                    <td className="p-2 text-right">{formatarMoeda(v.pedidos ? v.faturamento / v.pedidos : 0)}</td>
                    <td className="p-2 text-right">{v.clientes}</td>
                    <td className="p-2 text-right">
                      <Badge variant="outline" className={v.trocas > 5 ? 'text-red-600' : 'text-slate-600'}>{v.trocas}</Badge>
                    </td>
                    <td className="p-2 text-right">
                      <Badge variant="outline" className={v.taxaSucesso >= 80 ? 'text-emerald-700' : v.taxaSucesso >= 60 ? 'text-amber-700' : 'text-red-600'}>
                        {v.taxaSucesso}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-400 mt-2">Clique em um vendedor para ver o detalhe individual.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}