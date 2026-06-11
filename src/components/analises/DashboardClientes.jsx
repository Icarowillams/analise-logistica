import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Users, DollarSign, ShoppingBag, AlertTriangle, TrendingUp,
  TrendingDown, MapPin, Activity, CheckCircle2, XCircle
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, ScatterChart, Scatter
} from 'recharts';
import KpiCard from './KpiCard';
import FiltrosBase from './FiltrosBase';
import useVisitasAnalise from './useVisitasAnalise';
import { dentroPeriodo, exportarCSV, formatarMoeda, formatarNumero } from './utilsAnalises';

const CORES = ['#0891b2', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#f97316', '#64748b', '#0ea5e9'];
const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const formatMes = (k) => { const [a, m] = k.split('-'); return `${MESES_PT[+m-1]}/${a.slice(2)}`; };

export default function DashboardClientes() {
  const [filtros, setFiltros] = useState({ inicio: '', fim: '', vendedor_id: '', segmento_id: '', rede_id: '', estado: '' });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores_analise'],
    queryFn: () => base44.entities.Vendedor.list()
  });
  const { data: clientes = [], isLoading: loadingC } = useQuery({
    queryKey: ['clientes_analise'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 20000)
  });
  const { data: segmentos = [] } = useQuery({
    queryKey: ['segmentos'],
    queryFn: () => base44.entities.Segmento.list()
  });
  const { data: redes = [] } = useQuery({
    queryKey: ['redes'],
    queryFn: () => base44.entities.Rede.list()
  });
  // Pedidos faturados para cruzar com clientes
  const { data: pedidos = [], isLoading: loadingP } = useQuery({
    queryKey: ['pedidos_venda_faturados'],
    queryFn: () => base44.entities.Pedido.filter({ tipo: 'venda', status: 'faturado' }, '-data_faturamento', 10000)
  });
  // Cancelamentos
  const { data: cancelamentos = [] } = useQuery({
    queryKey: ['cancelamentos'],
    queryFn: () => base44.entities.Cancelamento.list('-created_date', 3000)
  });
  // Clientes com erro Omie / pré-cadastro
  const { data: logNaoCadastrados = [] } = useQuery({
    queryKey: ['log_nao_cadastrados'],
    queryFn: () => base44.entities.LogClienteNaoCadastrado.list('-created_date', 1000)
  });
  // Visitas para calcular frequência de atendimento (entidade Visita normalizada)
  const { visitas } = useVisitasAnalise();

  // Filtrar clientes
  const clientesFiltrados = useMemo(() => clientes.filter(c => {
    if (filtros.vendedor_id && c.vendedor_id !== filtros.vendedor_id) return false;
    if (filtros.segmento_id && c.segmento_id !== filtros.segmento_id) return false;
    if (filtros.rede_id && c.rede_id !== filtros.rede_id) return false;
    if (filtros.estado && c.estado !== filtros.estado) return false;
    return true;
  }), [clientes, filtros]);

  // Pedidos filtrados por período e pelo mesmo grupo de clientes
  const clienteIds = useMemo(() => new Set(clientesFiltrados.map(c => c.id)), [clientesFiltrados]);
  const pedidosFiltrados = useMemo(() => pedidos.filter(p => {
    if (!clienteIds.has(p.cliente_id)) return false;
    if ((filtros.inicio || filtros.fim) && !dentroPeriodo(p.data_faturamento || p.created_date, filtros.inicio, filtros.fim)) return false;
    return true;
  }), [pedidos, clienteIds, filtros]);

  // KPIs de clientes
  const kpis = useMemo(() => {
    const ativos = clientesFiltrados.filter(c => c.status === 'ativo').length;
    const inativos = clientesFiltrados.filter(c => c.status === 'inativo').length;
    const bloqueados = clientesFiltrados.filter(c => c.bloquear_faturamento).length;
    const comPendencia = clientesFiltrados.filter(c => c.pendencia_financeira).length;
    // Clientes que compraram no período
    const clientesAtivos = new Set(pedidosFiltrados.map(p => p.cliente_id)).size;
    const faturamentoTotal = pedidosFiltrados.reduce((a, p) => a + (p.valor_total || 0), 0);
    const ticketMedio = clientesAtivos > 0 ? faturamentoTotal / clientesAtivos : 0;
    // Clientes sem compra no período (inativos comercialmente)
    const clientesSemCompra = clientesFiltrados.filter(c => c.status === 'ativo' && !new Set(pedidosFiltrados.map(p => p.cliente_id)).has(c.id)).length;
    return { total: clientesFiltrados.length, ativos, inativos, bloqueados, comPendencia, clientesAtivos, faturamentoTotal, ticketMedio, clientesSemCompra };
  }, [clientesFiltrados, pedidosFiltrados]);

  // Por segmento
  const porSegmento = useMemo(() => {
    const s = {};
    const nomeSeg = new Map(segmentos.map(x => [x.id, x.nome]));
    clientesFiltrados.forEach(c => {
      const k = nomeSeg.get(c.segmento_id) || 'Sem segmento';
      if (!s[k]) s[k] = { nome: k, clientes: 0, faturamento: 0 };
      s[k].clientes++;
    });
    pedidosFiltrados.forEach(p => {
      const cli = clientes.find(c => c.id === p.cliente_id);
      if (!cli) return;
      const k = nomeSeg.get(cli.segmento_id) || 'Sem segmento';
      if (s[k]) s[k].faturamento += p.valor_total || 0;
    });
    return Object.values(s).sort((a, b) => b.faturamento - a.faturamento).slice(0, 8);
  }, [clientesFiltrados, pedidosFiltrados, clientes, segmentos]);

  // Por rede
  const porRede = useMemo(() => {
    const r = {};
    const nomeRede = new Map(redes.map(x => [x.id, x.nome]));
    clientesFiltrados.forEach(c => {
      if (!c.rede_id) return;
      const k = nomeRede.get(c.rede_id) || 'Sem rede';
      if (!r[k]) r[k] = { nome: k, clientes: 0, faturamento: 0 };
      r[k].clientes++;
    });
    pedidosFiltrados.forEach(p => {
      const cli = clientes.find(c => c.id === p.cliente_id);
      if (!cli || !cli.rede_id) return;
      const k = nomeRede.get(cli.rede_id) || 'Sem rede';
      if (r[k]) r[k].faturamento += p.valor_total || 0;
    });
    return Object.values(r).sort((a, b) => b.faturamento - a.faturamento).slice(0, 8);
  }, [clientesFiltrados, pedidosFiltrados, clientes, redes]);

  // Por estado
  const porEstado = useMemo(() => {
    const e = {};
    clientesFiltrados.forEach(c => {
      const k = c.estado || 'N/I';
      if (!e[k]) e[k] = { estado: k, clientes: 0, faturamento: 0 };
      e[k].clientes++;
    });
    pedidosFiltrados.forEach(p => {
      const estado = p.cliente_estado || clientes.find(c => c.id === p.cliente_id)?.estado || 'N/I';
      if (!e[estado]) e[estado] = { estado, clientes: 0, faturamento: 0 };
      e[estado].faturamento += p.valor_total || 0;
    });
    return Object.values(e).sort((a, b) => b.faturamento - a.faturamento).slice(0, 10);
  }, [clientesFiltrados, pedidosFiltrados, clientes]);

  // Novos clientes por mês
  const novosPorMes = useMemo(() => {
    const grupo = {};
    clientesFiltrados.forEach(c => {
      const k = String(c.created_date || '').slice(0, 7);
      if (!k || k.length < 7) return;
      if (!grupo[k]) grupo[k] = { mes: k, label: formatMes(k), novos: 0 };
      grupo[k].novos++;
    });
    return Object.values(grupo).sort((a, b) => a.mes.localeCompare(b.mes)).slice(-12);
  }, [clientesFiltrados]);

  // Top clientes por faturamento no período
  const topClientes = useMemo(() => {
    const c = {};
    pedidosFiltrados.forEach(p => {
      const k = p.cliente_id;
      if (!c[k]) c[k] = { nome: p.cliente_nome || '-', valor: 0, qtd: 0 };
      c[k].valor += p.valor_total || 0;
      c[k].qtd++;
    });
    return Object.values(c).sort((a, b) => b.valor - a.valor).slice(0, 10);
  }, [pedidosFiltrados]);

  // Clientes inativos comercialmente (cadastrado como ativo mas sem pedido no período)
  const clientesInativos = useMemo(() => {
    if (!filtros.inicio && !filtros.fim) return [];
    const compraram = new Set(pedidosFiltrados.map(p => p.cliente_id));
    return clientesFiltrados
      .filter(c => c.status === 'ativo' && !compraram.has(c.id))
      .slice(0, 50);
  }, [clientesFiltrados, pedidosFiltrados, filtros]);

  // Frequência de visitas por cliente (clientes com mais e menos visitas)
  const frequenciaVisitas = useMemo(() => {
    const v = {};
    visitas.forEach(vis => {
      if (!clienteIds.has(vis.cliente_id)) return;
      if ((filtros.inicio || filtros.fim) && !dentroPeriodo(vis.data_visita || vis.created_date, filtros.inicio, filtros.fim)) return;
      if (!v[vis.cliente_id]) v[vis.cliente_id] = { nome: vis.cliente_nome || '-', total: 0, realizadas: 0 };
      v[vis.cliente_id].total++;
      if (vis.status === 'visitado') v[vis.cliente_id].realizadas++;
    });
    return Object.values(v).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [visitas, clienteIds, filtros]);

  // Estados únicos para filtro
  const estadosUnicos = useMemo(() => [...new Set(clientes.map(c => c.estado).filter(Boolean))].sort(), [clientes]);

  const exportar = () => exportarCSV('dashboard_clientes',
    ['Nome', 'Segmento', 'Rede', 'Estado', 'Cidade', 'Vendedor', 'Status', 'Bloqueado', 'Pendência financeira'],
    clientesFiltrados.map(c => [
      c.razao_social || c.nome_fantasia, c.segmento_id, c.rede_id, c.estado, c.cidade,
      vendedores.find(v => v.id === c.vendedor_id)?.nome || '-',
      c.status, c.bloquear_faturamento ? 'Sim' : 'Não', c.pendencia_financeira ? 'Sim' : 'Não'
    ])
  );

  return (
    <div className="space-y-4">
      <FiltrosBase filtros={filtros} setFiltros={setFiltros} vendedores={vendedores}
        onLimpar={() => setFiltros({ inicio: '', fim: '', vendedor_id: '', segmento_id: '', rede_id: '', estado: '' })}
        onExportar={exportar}>
        <div>
          <Label className="text-xs">Segmento</Label>
          <Select value={filtros.segmento_id || '_todos_'} onValueChange={v => setFiltros({ ...filtros, segmento_id: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos</SelectItem>
              {segmentos.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Rede</Label>
          <Select value={filtros.rede_id || '_todos_'} onValueChange={v => setFiltros({ ...filtros, rede_id: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todas</SelectItem>
              {redes.map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Estado</Label>
          <Select value={filtros.estado || '_todos_'} onValueChange={v => setFiltros({ ...filtros, estado: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos</SelectItem>
              {estadosUnicos.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </FiltrosBase>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <KpiCard titulo="Total clientes" valor={formatarNumero(kpis.total)} icon={Users} cor="slate" />
        <KpiCard titulo="Ativos" valor={formatarNumero(kpis.ativos)} icon={CheckCircle2} cor="emerald" />
        <KpiCard titulo="Inativos" valor={formatarNumero(kpis.inativos)} icon={XCircle} cor="red" />
        <KpiCard titulo="Bloqueados" valor={formatarNumero(kpis.bloqueados)} icon={AlertTriangle} cor="amber" />
        <KpiCard titulo="Compraram" valor={formatarNumero(kpis.clientesAtivos)} sub="no período" icon={ShoppingBag} cor="cyan" />
        <KpiCard titulo="Sem compra" valor={formatarNumero(kpis.clientesSemCompra)} sub="ativos s/ pedido" icon={TrendingDown} cor="red" />
        <KpiCard titulo="Faturamento" valor={formatarMoeda(kpis.faturamentoTotal)} icon={DollarSign} cor="indigo" />
        <KpiCard titulo="Com pendência" valor={formatarNumero(kpis.comPendencia)} sub="financeira" icon={AlertTriangle} cor="red" />
      </div>

      {/* Por segmento + Por rede */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Faturamento por segmento</CardTitle></CardHeader>
          <CardContent>
            {porSegmento.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
              : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={porSegmento} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                  <YAxis dataKey="nome" type="category" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, n) => n === 'faturamento' ? formatarMoeda(v) : v} />
                  <Legend />
                  <Bar dataKey="faturamento" fill="#0891b2" name="Faturamento" radius={[0,4,4,0]} />
                  <Bar dataKey="clientes" fill="#e2e8f0" name="Clientes" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Faturamento por rede</CardTitle></CardHeader>
          <CardContent>
            {porRede.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem clientes em redes</p>
              : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={porRede} dataKey="faturamento" nameKey="nome" outerRadius={90}
                    label={({ nome, percent }) => `${nome.slice(0,12)} ${(percent*100).toFixed(0)}%`}>
                    {porRede.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                  </Pie>
                  <Tooltip formatter={v => formatarMoeda(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Novos clientes por mês + Por estado */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Novos clientes por mês</CardTitle></CardHeader>
          <CardContent>
            {novosPorMes.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
              : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={novosPorMes}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="novos" fill="#16a34a" name="Novos clientes" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Distribuição por estado</CardTitle></CardHeader>
          <CardContent>
            {porEstado.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
              : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={porEstado}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="estado" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip formatter={(v, n) => n === 'faturamento' ? formatarMoeda(v) : v} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="clientes" fill="#0891b2" name="Clientes" />
                  <Bar yAxisId="right" dataKey="faturamento" fill="#16a34a" name="Faturamento" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top clientes */}
      <Card>
        <CardHeader><CardTitle className="text-base">Top 10 clientes por faturamento</CardTitle></CardHeader>
        <CardContent>
          {topClientes.length === 0
            ? <p className="text-sm text-slate-400 text-center py-8">{filtros.inicio || filtros.fim ? 'Nenhum pedido no período selecionado' : 'Selecione um período para ver o faturamento'}</p>
            : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={topClientes} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                <YAxis dataKey="nome" type="category" width={180} tick={{ fontSize: 11 }} />
                <Tooltip formatter={v => formatarMoeda(v)} />
                <Bar dataKey="valor" fill="#7c3aed" name="Faturamento" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Clientes inativos comercialmente (só mostra se período selecionado) */}
      {clientesInativos.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="text-base text-orange-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Clientes ativos sem pedido no período ({clientesInativos.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-orange-100 sticky top-0">
                <tr>
                  <th className="p-2 text-left">Cliente</th>
                  <th className="p-2 text-left">Cidade / UF</th>
                  <th className="p-2 text-left">Segmento</th>
                  <th className="p-2 text-left">Vendedor</th>
                  <th className="p-2 text-left">Rota</th>
                </tr>
              </thead>
              <tbody>
                {clientesInativos.map(c => (
                  <tr key={c.id} className="border-t hover:bg-orange-100">
                    <td className="p-2 font-medium">{c.razao_social || c.nome_fantasia || '-'}</td>
                    <td className="p-2 text-xs">{c.cidade} / {c.estado}</td>
                    <td className="p-2 text-xs">{segmentos.find(s => s.id === c.segmento_id)?.nome || '-'}</td>
                    <td className="p-2 text-xs">{vendedores.find(v => v.id === c.vendedor_id)?.nome || '-'}</td>
                    <td className="p-2 text-xs">{c.rota_id ? '✓' : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {clientesInativos.length === 50 && <p className="text-xs text-orange-600 mt-2">Mostrando primeiros 50. Exporte para lista completa.</p>}
          </CardContent>
        </Card>
      )}

      {/* Clientes cadastrados com problemas */}
      {(kpis.bloqueados > 0 || kpis.comPendencia > 0) && (
        <Card className="border-red-200">
          <CardHeader><CardTitle className="text-base text-red-800">Clientes com alertas</CardTitle></CardHeader>
          <CardContent className="overflow-auto max-h-64">
            <table className="w-full text-sm">
              <thead className="bg-red-50 sticky top-0">
                <tr>
                  <th className="p-2 text-left">Cliente</th>
                  <th className="p-2 text-left">Cidade</th>
                  <th className="p-2 text-left">Vendedor</th>
                  <th className="p-2 text-center">Bloqueado</th>
                  <th className="p-2 text-center">Pendência</th>
                  <th className="p-2 text-left">Motivo bloqueio</th>
                </tr>
              </thead>
              <tbody>
                {clientesFiltrados.filter(c => c.bloquear_faturamento || c.pendencia_financeira).slice(0, 30).map(c => (
                  <tr key={c.id} className="border-t hover:bg-red-50">
                    <td className="p-2 font-medium max-w-[160px] truncate">{c.razao_social || c.nome_fantasia || '-'}</td>
                    <td className="p-2 text-xs">{c.cidade}/{c.estado}</td>
                    <td className="p-2 text-xs">{vendedores.find(v => v.id === c.vendedor_id)?.nome || '-'}</td>
                    <td className="p-2 text-center">{c.bloquear_faturamento ? <Badge className="bg-red-600 text-xs">Bloqueado</Badge> : '-'}</td>
                    <td className="p-2 text-center">{c.pendencia_financeira ? <Badge className="bg-amber-500 text-xs">Pendente</Badge> : '-'}</td>
                    <td className="p-2 text-xs text-slate-600 max-w-[180px] truncate">{c.motivo_bloqueio || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}