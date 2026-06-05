import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, CheckCircle2, XCircle, Clock, Activity, MapPin, ShoppingBag, TrendingUp } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid, ComposedChart, Area
} from 'recharts';
import KpiCard from './KpiCard';
import FiltrosBase from './FiltrosBase';
import { dentroPeriodo, exportarCSV, formatarNumero, formatarMoeda, duracaoMin } from './utilsAnalises';

const CORES = ['#0891b2', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0ea5e9'];
const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const formatMes = (k) => { const [a, m] = k.split('-'); return `${MESES_PT[+m-1]}/${a.slice(2)}`; };

export default function AnaliseVisitas() {
  const [filtros, setFiltros] = useState({ inicio: '', fim: '', vendedor_id: '', status: '', rota: '', dia_semana: '' });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores_analise'],
    queryFn: () => base44.entities.Vendedor.list()
  });
  // VisitaRoteiro — fonte principal (supervisor e app campo)
  const { data: visitas = [], isLoading: loadingV } = useQuery({
    queryKey: ['visitasRoteiro'],
    queryFn: () => base44.entities.VisitaRoteiro.list('-updated_date', 10000)
  });
  // Pedidos gerados a partir de visitas (para taxa de conversão real)
  const { data: pedidosVisita = [] } = useQuery({
    queryKey: ['pedidos_venda_faturados'],
    queryFn: () => base44.entities.Pedido.filter({ tipo: 'venda', status: 'faturado' }, '-data_faturamento', 10000)
  });
  // EstoqueVisita — itens coletados nas visitas
  const { data: estoqueVisitas = [] } = useQuery({
    queryKey: ['estoque_visitas'],
    queryFn: () => base44.entities.EstoqueVisita.list('-created_date', 5000)
  });

  const DIAS_SEMANA = ['segunda-feira','terca-feira','quarta-feira','quinta-feira','sexta-feira','sabado','domingo'];

  const filtradas = useMemo(() => visitas.filter(v => {
    if (filtros.vendedor_id && v.vendedor_id !== filtros.vendedor_id) return false;
    if (filtros.status && v.status !== filtros.status) return false;
    if (filtros.rota && v.cliente_rota !== filtros.rota) return false;
    if (filtros.dia_semana && v.dia_semana !== filtros.dia_semana) return false;
    if ((filtros.inicio || filtros.fim) && !dentroPeriodo(v.data_visita || v.created_date, filtros.inicio, filtros.fim)) return false;
    return true;
  }), [visitas, filtros]);

  // Rotas únicas para filtro
  const rotasUnicas = useMemo(() => [...new Set(visitas.map(v => v.cliente_rota).filter(Boolean))].sort(), [visitas]);

  // KPIs
  const totais = useMemo(() => {
    const realizadas = filtradas.filter(v => v.status === 'visitado').length;
    const naoVisitadas = filtradas.filter(v => v.status === 'nao_visitado').length;
    const comPedido = filtradas.filter(v => v.gerou_pedido).length;
    const duracoes = filtradas.map(v => v.duracao_min || duracaoMin(v.checkin_em, v.checkout_em)).filter(d => d > 0);
    const duracaoMedia = duracoes.length ? Math.round(duracoes.reduce((a, b) => a + b, 0) / duracoes.length) : 0;
    const taxaConversao = realizadas > 0 ? Math.round((comPedido / realizadas) * 100) : 0;
    const taxaSucesso = filtradas.length > 0 ? Math.round((realizadas / filtradas.length) * 100) : 0;
    const valorVisitas = filtradas.reduce((a, v) => a + (v.valor_pedido || 0), 0);
    return { total: filtradas.length, realizadas, naoVisitadas, comPedido, duracaoMedia, taxaConversao, taxaSucesso, valorVisitas };
  }, [filtradas]);

  // Evolução semanal com taxa de conversão
  const evolucaoSemanal = useMemo(() => {
    const grupo = {};
    filtradas.forEach(v => {
      const d = v.data_visita || v.created_date;
      if (!d) return;
      const dt = new Date(d + 'T12:00:00');
      const k = `${dt.getFullYear()}-S${String(Math.ceil((((dt - new Date(dt.getFullYear(), 0, 1)) / 86400000) + new Date(dt.getFullYear(), 0, 1).getDay() + 1) / 7)).padStart(2, '0')}`;
      if (!grupo[k]) grupo[k] = { semana: k, total: 0, realizadas: 0, comPedido: 0 };
      grupo[k].total++;
      if (v.status === 'visitado') grupo[k].realizadas++;
      if (v.gerou_pedido) grupo[k].comPedido++;
    });
    return Object.values(grupo).sort((a, b) => a.semana.localeCompare(b.semana)).slice(-16).map(g => ({
      ...g,
      taxaSucesso: g.total > 0 ? Math.round((g.realizadas / g.total) * 100) : 0,
      taxaConversao: g.realizadas > 0 ? Math.round((g.comPedido / g.realizadas) * 100) : 0
    }));
  }, [filtradas]);

  // Motivos de não visita
  const motivos = useMemo(() => {
    const m = {};
    filtradas.filter(v => v.status === 'nao_visitado' && v.motivo_nao_atendimento).forEach(v => {
      const k = v.motivo_nao_atendimento;
      m[k] = (m[k] || 0) + 1;
    });
    return Object.entries(m).map(([motivo, qtd]) => ({ motivo: motivo.replace(/_/g, ' '), qtd })).sort((a, b) => b.qtd - a.qtd);
  }, [filtradas]);

  // Ranking de vendedores com taxa de conversão
  const rankingVendedores = useMemo(() => {
    const grupo = {};
    filtradas.forEach(v => {
      const id = v.vendedor_id;
      if (!grupo[id]) grupo[id] = { nome: v.vendedor_nome || vendedores.find(x => x.id === id)?.nome || '-', total: 0, realizadas: 0, comPedido: 0, durTotal: 0, durCont: 0 };
      grupo[id].total++;
      if (v.status === 'visitado') grupo[id].realizadas++;
      if (v.gerou_pedido) grupo[id].comPedido++;
      const dur = v.duracao_min || duracaoMin(v.checkin_em, v.checkout_em);
      if (dur > 0) { grupo[id].durTotal += dur; grupo[id].durCont++; }
    });
    return Object.values(grupo).map(g => ({
      ...g,
      taxaSucesso: g.total > 0 ? Math.round((g.realizadas / g.total) * 100) : 0,
      taxaConversao: g.realizadas > 0 ? Math.round((g.comPedido / g.realizadas) * 100) : 0,
      duracaoMedia: g.durCont > 0 ? Math.round(g.durTotal / g.durCont) : 0
    })).sort((a, b) => b.realizadas - a.realizadas).slice(0, 10);
  }, [filtradas, vendedores]);

  // Visitas por dia da semana
  const porDiaSemana = useMemo(() => {
    const dMap = { 'segunda-feira': 'Seg', 'terca-feira': 'Ter', 'quarta-feira': 'Qua', 'quinta-feira': 'Qui', 'sexta-feira': 'Sex', 'sabado': 'Sáb', 'domingo': 'Dom' };
    const grupo = {};
    filtradas.forEach(v => {
      const k = v.dia_semana || 'sem_dia';
      if (!grupo[k]) grupo[k] = { dia: dMap[k] || k, total: 0, realizadas: 0 };
      grupo[k].total++;
      if (v.status === 'visitado') grupo[k].realizadas++;
    });
    return DIAS_SEMANA.map(d => grupo[d] || { dia: d.slice(0,3), total: 0, realizadas: 0 }).filter(g => g.total > 0);
  }, [filtradas]);

  // Visitas por rota
  const porRota = useMemo(() => {
    const r = {};
    filtradas.forEach(v => {
      const k = v.cliente_rota || 'Sem rota';
      if (!r[k]) r[k] = { rota: k, total: 0, realizadas: 0, comPedido: 0 };
      r[k].total++;
      if (v.status === 'visitado') r[k].realizadas++;
      if (v.gerou_pedido) r[k].comPedido++;
    });
    return Object.values(r).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [filtradas]);

  // Estoque coletado em visitas — top produtos com validade próxima
  const estoqueAlerta = useMemo(() => {
    const hoje = new Date();
    return estoqueVisitas
      .filter(e => e.data_validade && new Date(e.data_validade) > hoje)
      .sort((a, b) => new Date(a.data_validade) - new Date(b.data_validade))
      .slice(0, 10);
  }, [estoqueVisitas]);

  const exportar = () => exportarCSV('analise_visitas',
    ['Data', 'Dia semana', 'Vendedor', 'Cliente', 'Rota', 'Status', 'Duração (min)', 'Gerou pedido', 'Valor pedido', 'Motivo não atendimento', 'Obs'],
    filtradas.map(v => [
      v.data_visita, v.dia_semana, v.vendedor_nome, v.cliente_nome, v.cliente_rota,
      v.status, v.duracao_min || duracaoMin(v.checkin_em, v.checkout_em),
      v.gerou_pedido ? 'Sim' : 'Não', v.valor_pedido, v.motivo_nao_atendimento, v.observacoes
    ])
  );

  return (
    <div className="space-y-4">
      <FiltrosBase filtros={filtros} setFiltros={setFiltros} vendedores={vendedores}
        onLimpar={() => setFiltros({ inicio: '', fim: '', vendedor_id: '', status: '', rota: '', dia_semana: '' })}
        onExportar={exportar}>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={filtros.status || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, status: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos</SelectItem>
              <SelectItem value="planejada">Planejada</SelectItem>
              <SelectItem value="em_andamento">Em andamento</SelectItem>
              <SelectItem value="visitado">Visitado</SelectItem>
              <SelectItem value="nao_visitado">Não visitado</SelectItem>
              <SelectItem value="reagendado">Reagendado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Rota</Label>
          <Select value={filtros.rota || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, rota: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todas as rotas</SelectItem>
              {rotasUnicas.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Dia da semana</Label>
          <Select value={filtros.dia_semana || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, dia_semana: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos os dias</SelectItem>
              <SelectItem value="segunda-feira">Segunda</SelectItem>
              <SelectItem value="terca-feira">Terça</SelectItem>
              <SelectItem value="quarta-feira">Quarta</SelectItem>
              <SelectItem value="quinta-feira">Quinta</SelectItem>
              <SelectItem value="sexta-feira">Sexta</SelectItem>
              <SelectItem value="sabado">Sábado</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FiltrosBase>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiCard titulo="Total" valor={formatarNumero(totais.total)} icon={Activity} cor="slate" />
        <KpiCard titulo="Realizadas" valor={formatarNumero(totais.realizadas)} icon={CheckCircle2} cor="emerald" />
        <KpiCard titulo="Não realizadas" valor={formatarNumero(totais.naoVisitadas)} icon={XCircle} cor="red" />
        <KpiCard titulo="Taxa sucesso" valor={`${totais.taxaSucesso}%`} icon={TrendingUp} cor="cyan" />
        <KpiCard titulo="Com pedido" valor={formatarNumero(totais.comPedido)} icon={ShoppingBag} cor="indigo" />
        <KpiCard titulo="Conversão" valor={`${totais.taxaConversao}%`} sub="visita→pedido" icon={CheckCircle2} cor="amber" />
        <KpiCard titulo="Duração média" valor={`${totais.duracaoMedia} min`} icon={Clock} cor="slate" />
      </div>

      {/* Evolução semanal */}
      <Card>
        <CardHeader><CardTitle className="text-base">Tendência semanal (visitas + conversão)</CardTitle></CardHeader>
        <CardContent>
          {evolucaoSemanal.length === 0
            ? <p className="text-sm text-slate-400 text-center py-12">Nenhum dado no período</p>
            : (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={evolucaoSemanal}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="semana" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" tickFormatter={v => `${v}%`} domain={[0, 100]} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="total" fill="#e2e8f0" name="Planejadas" />
                <Bar yAxisId="left" dataKey="realizadas" fill="#0891b2" name="Realizadas" />
                <Line yAxisId="right" type="monotone" dataKey="taxaConversao" stroke="#16a34a" strokeWidth={2} name="Conversão %" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Ranking vendedores + Por dia da semana */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Ranking de vendedores</CardTitle></CardHeader>
          <CardContent>
            {rankingVendedores.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
              : (
              <div className="space-y-2 overflow-auto max-h-72">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="p-1 text-left">#</th>
                      <th className="p-1 text-left">Vendedor</th>
                      <th className="p-1 text-right">Realizadas</th>
                      <th className="p-1 text-right">Sucesso</th>
                      <th className="p-1 text-right">Conversão</th>
                      <th className="p-1 text-right">Dur. média</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingVendedores.map((v, i) => (
                      <tr key={i} className="border-t hover:bg-slate-50">
                        <td className="p-1 font-bold text-slate-500">{i+1}</td>
                        <td className="p-1 max-w-[120px] truncate font-medium">{v.nome}</td>
                        <td className="p-1 text-right">{v.realizadas}/{v.total}</td>
                        <td className="p-1 text-right">
                          <Badge variant="outline" className={v.taxaSucesso >= 80 ? 'text-emerald-700' : v.taxaSucesso >= 60 ? 'text-amber-700' : 'text-red-600'}>
                            {v.taxaSucesso}%
                          </Badge>
                        </td>
                        <td className="p-1 text-right">
                          <Badge variant="outline" className={v.taxaConversao >= 50 ? 'text-emerald-700' : v.taxaConversao >= 30 ? 'text-amber-700' : 'text-red-600'}>
                            {v.taxaConversao}%
                          </Badge>
                        </td>
                        <td className="p-1 text-right text-slate-600">{v.duracaoMedia} min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Visitas por dia da semana</CardTitle></CardHeader>
          <CardContent>
            {porDiaSemana.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
              : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={porDiaSemana}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="dia" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="realizadas" fill="#16a34a" name="Realizadas" stackId="a" />
                  <Bar dataKey="total" fill="#e2e8f0" name="Planejadas" stackId="b" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Motivos de não visita + Por rota */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Motivos de não atendimento</CardTitle></CardHeader>
          <CardContent>
            {motivos.length === 0
              ? <p className="text-sm text-slate-400 text-center py-12">Sem registros de não atendimento</p>
              : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={motivos} dataKey="qtd" nameKey="motivo" outerRadius={90} label={({ motivo, percent }) => `${motivo.slice(0,12)} ${(percent*100).toFixed(0)}%`}>
                    {motivos.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Visitas por rota</CardTitle></CardHeader>
          <CardContent>
            {porRota.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem dados de rota</p>
              : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={porRota} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="rota" type="category" width={100} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="realizadas" fill="#0891b2" name="Realizadas" stackId="a" />
                  <Bar dataKey="comPedido" fill="#16a34a" name="Com pedido" stackId="b" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabela individual */}
      <Card>
        <CardHeader><CardTitle className="text-base">Visitas individuais</CardTitle></CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="p-2 text-left">Data</th>
                <th className="p-2 text-left">Dia</th>
                <th className="p-2 text-left">Vendedor</th>
                <th className="p-2 text-left">Cliente</th>
                <th className="p-2 text-left">Rota</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-right">Duração</th>
                <th className="p-2 text-center">Pedido?</th>
                <th className="p-2 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.slice(0, 200).map(v => (
                <tr key={v.id} className="border-t hover:bg-slate-50">
                  <td className="p-2 text-xs">{v.data_visita || '-'}</td>
                  <td className="p-2 text-xs capitalize">{(v.dia_semana || '').slice(0, 3)}</td>
                  <td className="p-2 max-w-[120px] truncate">{v.vendedor_nome || '-'}</td>
                  <td className="p-2 max-w-[160px] truncate">{v.cliente_nome || '-'}</td>
                  <td className="p-2 text-xs text-slate-600">{v.cliente_rota || '-'}</td>
                  <td className="p-2"><Badge variant="outline" className={`text-xs ${v.status === 'visitado' ? 'text-emerald-700' : v.status === 'nao_visitado' ? 'text-red-600' : ''}`}>{v.status}</Badge></td>
                  <td className="p-2 text-right text-xs">{(v.duracao_min || duracaoMin(v.checkin_em, v.checkout_em)) || '-'} min</td>
                  <td className="p-2 text-center">{v.gerou_pedido ? '✅' : '-'}</td>
                  <td className="p-2 text-right text-xs">{v.valor_pedido ? formatarMoeda(v.valor_pedido) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtradas.length > 200 && <p className="text-xs text-slate-500 mt-2">Exibindo 200 de {filtradas.length}. Use Exportar para o detalhe completo.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
