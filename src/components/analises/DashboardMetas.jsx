import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  Target, TrendingUp, Award, Users, CheckCircle2,
  XCircle, Clock, DollarSign, Activity
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, RadialBarChart, RadialBar, Cell, PieChart, Pie
} from 'recharts';
import KpiCard from './KpiCard';
import { formatarMoeda, formatarNumero } from './utilsAnalises';

const TIPO_LABEL = {
  vendas: 'Vendas (R$)',
  visitas: 'Visitas',
  clientes_novos: 'Novos Clientes',
  ticket_medio: 'Ticket Médio (R$)',
  trocas_max: 'Trocas (máx)',
};

const TIPO_FORMATO = {
  vendas: (v) => formatarMoeda(v),
  ticket_medio: (v) => formatarMoeda(v),
  visitas: (v) => formatarNumero(v),
  clientes_novos: (v) => formatarNumero(v),
  trocas_max: (v) => formatarNumero(v),
};

const STATUS_COLOR = {
  ativa: 'bg-blue-100 text-blue-800',
  concluida: 'bg-emerald-100 text-emerald-800',
  cancelada: 'bg-slate-100 text-slate-500',
};

const CORES_PERC = (p) => {
  if (p >= 100) return '#16a34a';
  if (p >= 80) return '#f59e0b';
  if (p >= 50) return '#f97316';
  return '#dc2626';
};

function GaugePerc({ perc, label }) {
  const safe = Math.min(perc, 100);
  const data = [{ name: label, value: safe, fill: CORES_PERC(perc) }];
  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width={120} height={80}>
        <RadialBarChart innerRadius={28} outerRadius={50} data={data} startAngle={180} endAngle={0}>
          <RadialBar dataKey="value" cornerRadius={4} background={{ fill: '#e2e8f0' }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <p className="text-lg font-bold -mt-4" style={{ color: CORES_PERC(perc) }}>{perc}%</p>
      <p className="text-xs text-slate-500 text-center mt-0.5">{label}</p>
    </div>
  );
}

export default function DashboardMetas() {
  const [filtros, setFiltros] = useState({ vendedor_id: '', tipo: '', status: '', periodo: '' });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores_analise'],
    queryFn: () => base44.entities.Vendedor.list()
  });
  const { data: metas = [], isLoading } = useQuery({
    queryKey: ['metas_todas'],
    queryFn: () => base44.entities.Meta.list('-periodo_inicio', 500)
  });
  // Pedidos faturados para calcular realizado de vendas em tempo real
  const { data: pedidos = [] } = useQuery({
    queryKey: ['pedidos_venda_faturados'],
    queryFn: () => base44.entities.Pedido.filter({ tipo: 'venda', status: 'faturado' }, '-data_faturamento', 10000)
  });
  // Visitas para calcular realizado de visitas
  const { data: visitas = [] } = useQuery({
    queryKey: ['visitasRoteiro'],
    queryFn: () => base44.entities.VisitaRoteiro.list('-updated_date', 10000)
  });
  // Clientes para novos cadastros
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes_analise'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 20000)
  });

  // Enriquecer cada meta com o valor realizado calculado dinamicamente
  const metasEnriquecidas = useMemo(() => metas.map(meta => {
    let realizado = meta.valor_realizado || 0;
    // Calcular realizado em tempo real baseado no período e tipo
    if (meta.periodo_inicio && meta.periodo_fim) {
      const ini = meta.periodo_inicio;
      const fim = meta.periodo_fim;
      const pedVend = pedidos.filter(p =>
        (!meta.vendedor_id || p.vendedor_id === meta.vendedor_id) &&
        (p.data_faturamento || '').slice(0, 10) >= ini &&
        (p.data_faturamento || '').slice(0, 10) <= fim
      );
      const visVend = visitas.filter(v =>
        (!meta.vendedor_id || v.vendedor_id === meta.vendedor_id) &&
        (v.data_visita || '').slice(0, 10) >= ini &&
        (v.data_visita || '').slice(0, 10) <= fim
      );
      const cliVend = clientes.filter(c =>
        (!meta.vendedor_id || c.vendedor_id === meta.vendedor_id) &&
        (c.created_date || '').slice(0, 10) >= ini &&
        (c.created_date || '').slice(0, 10) <= fim
      );

      if (meta.tipo === 'vendas') realizado = pedVend.reduce((a, p) => a + (p.valor_total || 0), 0);
      else if (meta.tipo === 'visitas') realizado = visVend.filter(v => v.status === 'visitado').length;
      else if (meta.tipo === 'clientes_novos') realizado = cliVend.length;
      else if (meta.tipo === 'ticket_medio') {
        realizado = pedVend.length > 0 ? pedVend.reduce((a, p) => a + (p.valor_total || 0), 0) / pedVend.length : 0;
      } else if (meta.tipo === 'trocas_max') {
        // para trocas_max, quanto menor melhor — inverter a lógica
        realizado = meta.valor_realizado || 0;
      }
    }
    const perc = meta.valor_meta > 0 ? Math.round((realizado / meta.valor_meta) * 100) : 0;
    return { ...meta, realizado_calc: realizado, perc_calc: perc };
  }), [metas, pedidos, visitas, clientes]);

  // Filtrar
  const metasFiltradas = useMemo(() => metasEnriquecidas.filter(m => {
    if (filtros.vendedor_id && m.vendedor_id !== filtros.vendedor_id) return false;
    if (filtros.tipo && m.tipo !== filtros.tipo) return false;
    if (filtros.status && m.status !== filtros.status) return false;
    if (filtros.periodo) {
      const hoje = new Date().toISOString().slice(0, 10);
      if (filtros.periodo === 'ativas' && !(m.periodo_fim >= hoje && m.status === 'ativa')) return false;
      if (filtros.periodo === 'encerradas' && m.periodo_fim >= hoje) return false;
    }
    return true;
  }), [metasEnriquecidas, filtros]);

  // KPIs gerais
  const kpis = useMemo(() => {
    const ativas = metasFiltradas.filter(m => m.status === 'ativa').length;
    const concluidas = metasFiltradas.filter(m => m.status === 'concluida' || m.perc_calc >= 100).length;
    const abaixo50 = metasFiltradas.filter(m => m.status === 'ativa' && m.perc_calc < 50).length;
    const mediaPerc = metasFiltradas.length > 0
      ? Math.round(metasFiltradas.reduce((a, m) => a + m.perc_calc, 0) / metasFiltradas.length) : 0;
    // Total faturado nas metas de venda ativas
    const totalMetaVendas = metasFiltradas.filter(m => m.tipo === 'vendas').reduce((a, m) => a + (m.valor_meta || 0), 0);
    const totalRealizadoVendas = metasFiltradas.filter(m => m.tipo === 'vendas').reduce((a, m) => a + m.realizado_calc, 0);
    return { total: metasFiltradas.length, ativas, concluidas, abaixo50, mediaPerc, totalMetaVendas, totalRealizadoVendas };
  }, [metasFiltradas]);

  // Ranking de vendedores por % de atingimento (metas de vendas)
  const rankingVendedores = useMemo(() => {
    const v = {};
    metasFiltradas.filter(m => m.tipo === 'vendas' && m.vendedor_id).forEach(m => {
      if (!v[m.vendedor_id]) v[m.vendedor_id] = { nome: m.vendedor_nome || '-', metas: 0, percTotal: 0, realizado: 0, meta: 0 };
      v[m.vendedor_id].metas++;
      v[m.vendedor_id].percTotal += m.perc_calc;
      v[m.vendedor_id].realizado += m.realizado_calc;
      v[m.vendedor_id].meta += m.valor_meta || 0;
    });
    return Object.values(v).map(x => ({ ...x, percMedio: x.metas > 0 ? Math.round(x.percTotal / x.metas) : 0 }))
      .sort((a, b) => b.percMedio - a.percMedio).slice(0, 10);
  }, [metasFiltradas]);

  // Distribuição por tipo
  const porTipo = useMemo(() => {
    const t = {};
    metasFiltradas.forEach(m => {
      const k = TIPO_LABEL[m.tipo] || m.tipo;
      t[k] = (t[k] || 0) + 1;
    });
    return Object.entries(t).map(([nome, qtd]) => ({ nome, qtd }));
  }, [metasFiltradas]);

  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card className="border-slate-200">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Vendedor</Label>
              <Select value={filtros.vendedor_id || '_todos_'} onValueChange={v => setFiltros({ ...filtros, vendedor_id: v === '_todos_' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_todos_">Todos</SelectItem>
                  {vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={filtros.tipo || '_todos_'} onValueChange={v => setFiltros({ ...filtros, tipo: v === '_todos_' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_todos_">Todos</SelectItem>
                  {Object.entries(TIPO_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={filtros.status || '_todos_'} onValueChange={v => setFiltros({ ...filtros, status: v === '_todos_' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_todos_">Todos</SelectItem>
                  <SelectItem value="ativa">Ativa</SelectItem>
                  <SelectItem value="concluida">Concluída</SelectItem>
                  <SelectItem value="cancelada">Cancelada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Período</Label>
              <Select value={filtros.periodo || '_todos_'} onValueChange={v => setFiltros({ ...filtros, periodo: v === '_todos_' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_todos_">Todos</SelectItem>
                  <SelectItem value="ativas">Em andamento</SelectItem>
                  <SelectItem value="encerradas">Encerradas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <button onClick={() => setFiltros({ vendedor_id: '', tipo: '', status: '', periodo: '' })}
                className="w-full px-3 py-2 text-xs text-slate-600 border rounded-md hover:bg-slate-50">
                Limpar filtros
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiCard titulo="Total metas" valor={formatarNumero(kpis.total)} icon={Target} cor="slate" />
        <KpiCard titulo="Ativas" valor={formatarNumero(kpis.ativas)} icon={Activity} cor="cyan" />
        <KpiCard titulo="Concluídas" valor={formatarNumero(kpis.concluidas)} icon={CheckCircle2} cor="emerald" />
        <KpiCard titulo="Abaixo 50%" valor={formatarNumero(kpis.abaixo50)} icon={XCircle} cor="red" />
        <KpiCard titulo="Média atingimento" valor={`${kpis.mediaPerc}%`} icon={TrendingUp} cor="amber" />
        <KpiCard titulo="Meta vendas" valor={formatarMoeda(kpis.totalMetaVendas)} icon={DollarSign} cor="indigo" />
        <KpiCard titulo="Realizado" valor={formatarMoeda(kpis.totalRealizadoVendas)} sub={`${kpis.totalMetaVendas > 0 ? Math.round((kpis.totalRealizadoVendas/kpis.totalMetaVendas)*100) : 0}% da meta`} icon={Award} cor="emerald" />
      </div>

      {/* Ranking vendedores + Distribuição por tipo */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Ranking por atingimento de meta (vendas)</CardTitle></CardHeader>
          <CardContent>
            {rankingVendedores.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem metas de venda</p>
              : (
              <div className="space-y-3">
                {rankingVendedores.map((v, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0
                      ${i === 0 ? 'bg-yellow-400' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-amber-600' : 'bg-slate-300'}`}>{i+1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium truncate">{v.nome}</span>
                        <span className="text-sm font-bold shrink-0 ml-2" style={{ color: CORES_PERC(v.percMedio) }}>{v.percMedio}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full mt-1 overflow-hidden">
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${Math.min(v.percMedio, 100)}%`, backgroundColor: CORES_PERC(v.percMedio) }} />
                      </div>
                      <div className="flex justify-between text-xs text-slate-500 mt-0.5">
                        <span>{formatarMoeda(v.realizado)}</span>
                        <span>meta: {formatarMoeda(v.meta)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Distribuição por tipo de meta</CardTitle></CardHeader>
          <CardContent>
            {porTipo.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem metas</p>
              : (
              <div className="space-y-4">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={porTipo} dataKey="qtd" nameKey="nome" outerRadius={80}
                      label={({ nome, percent }) => `${nome.slice(0,14)} ${(percent*100).toFixed(0)}%`}>
                      {porTipo.map((_, i) => <Cell key={i} fill={['#0891b2','#16a34a','#f59e0b','#7c3aed','#dc2626'][i%5]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cards de metas individuais */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Metas individuais</span>
            <Badge variant="outline">{metasFiltradas.length} metas</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-slate-400 text-center py-8">Carregando...</p>}
          {!isLoading && metasFiltradas.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">Nenhuma meta encontrada</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {metasFiltradas.map(meta => {
              const fmt = TIPO_FORMATO[meta.tipo] || formatarNumero;
              const isAtrasada = meta.status === 'ativa' && meta.periodo_fim < hoje && meta.perc_calc < 100;
              const diasRestantes = meta.periodo_fim
                ? Math.max(0, Math.ceil((new Date(meta.periodo_fim) - new Date()) / 86400000))
                : null;
              return (
                <div key={meta.id} className={`border rounded-lg p-4 space-y-3 ${isAtrasada ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
                  {/* Cabeçalho */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">{meta.titulo || TIPO_LABEL[meta.tipo]}</p>
                      <p className="text-xs text-slate-500">{meta.vendedor_nome || meta.supervisor_nome || 'Geral'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge className={`text-xs ${STATUS_COLOR[meta.status]}`}>{meta.status}</Badge>
                      <Badge variant="outline" className="text-xs">{TIPO_LABEL[meta.tipo] || meta.tipo}</Badge>
                    </div>
                  </div>

                  {/* Gauge + valores */}
                  <div className="flex items-center gap-3">
                    <GaugePerc perc={meta.perc_calc} label={meta.vendedor_nome?.split(' ')[0] || 'Meta'} />
                    <div className="flex-1 space-y-1.5">
                      <div>
                        <p className="text-xs text-slate-500">Realizado</p>
                        <p className="font-bold text-base" style={{ color: CORES_PERC(meta.perc_calc) }}>{fmt(meta.realizado_calc)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Meta</p>
                        <p className="font-semibold text-sm text-slate-700">{fmt(meta.valor_meta)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Barra de progresso */}
                  <div>
                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(meta.perc_calc, 100)}%`, backgroundColor: CORES_PERC(meta.perc_calc) }} />
                    </div>
                  </div>

                  {/* Rodapé */}
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{meta.periodo_inicio} → {meta.periodo_fim}</span>
                    {meta.status === 'ativa' && diasRestantes !== null && (
                      <span className={diasRestantes <= 5 ? 'text-red-600 font-semibold' : ''}>
                        {diasRestantes > 0 ? `${diasRestantes}d restantes` : 'Encerrada'}
                      </span>
                    )}
                    {isAtrasada && <span className="text-red-600 font-semibold">⚠ Atrasada</span>}
                  </div>

                  {/* Premiação */}
                  {meta.premiacao && (
                    <div className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
                      <Award className="w-3 h-3" />
                      <span>{meta.premiacao}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
