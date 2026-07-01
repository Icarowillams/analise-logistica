import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendingUp, ShoppingBag, DollarSign, Target, Users, Package, Building2, AlertTriangle } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ComposedChart, Area
} from 'recharts';
import KpiCard from './KpiCard';
import FiltrosBase from './FiltrosBase';
import SyncStatusBadge from './SyncStatusBadge';
import { useEspelhoFaturamento } from '@/hooks/useEspelhoFaturamento';
import { exportarCSV, formatarMoeda, formatarNumero, arredondar2, valorCSV } from './utilsAnalises';

const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const formatMes = (k) => { const [a, m] = k.split('-'); return `${MESES_PT[+m-1]}/${a.slice(2)}`; };
const formatDia = (iso) => {
  const d = new Date(iso + 'T00:00:00');
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const diffDays = (a, b) => Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000);

// Normaliza "AVISTA" → "A VISTA" (erro de digitação no cadastro do Omie)
function normalizarFormaPagamento(nome) {
  const t = (nome || '').trim().toUpperCase();
  return t === 'AVISTA' ? 'A VISTA' : (nome || '').trim();
}

export default function DashboardVendas() {
  // Default = mês corrente (dia 1 → hoje)
  const hojeISO = new Date().toISOString().slice(0, 10);
  const inicioMesISO = `${hojeISO.slice(0, 7)}-01`;

  const [filtros, setFiltros] = useState({
    inicio: inicioMesISO,
    fim: hojeISO,
    vendedor_id: '',
    rota_id: '',
    forma_pagamento: ''
  });

  // Fonte de dados: espelho local (cache sob demanda)
  const { dados, isLoading, isSincronizando, ultimaSincronizacao, erroSync, sincronizarAgora } =
    useEspelhoFaturamento(filtros.inicio, filtros.fim);

  // Queries de apoio (mantidas)
  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores_analise'],
    queryFn: () => base44.entities.Vendedor.list(),
    staleTime: 10 * 60 * 1000
  });
  const { data: rotas = [] } = useQuery({
    queryKey: ['rotas_analise'],
    queryFn: () => base44.entities.Rota.list(),
    staleTime: 10 * 60 * 1000
  });
  const { data: metas = [] } = useQuery({
    queryKey: ['metas_vendas'],
    queryFn: () => base44.entities.Meta.filter({ tipo: 'venda' }, '-periodo_inicio', 200)
  });
  const { data: cortes = [] } = useQuery({
    queryKey: ['log_cortes'],
    queryFn: () => base44.entities.LogCorte.list('-created_date', 5000)
  });

  // Filtragem em memória (vendedor, rota, forma_pagamento — período já veio filtrado do banco)
  const filtrados = useMemo(() => {
    return dados.filter(nf => {
      if (filtros.vendedor_id && nf.vendedor_id !== filtros.vendedor_id) return false;
      if (filtros.rota_id && nf.rota_id !== filtros.rota_id) return false;
      if (filtros.forma_pagamento && normalizarFormaPagamento(nf.forma_pagamento) !== filtros.forma_pagamento) return false;
      return true;
    });
  }, [dados, filtros]);

  // Formas de pagamento distintas (para o filtro)
  const formasPagamento = useMemo(() => {
    const set = new Set();
    dados.forEach(n => { if (n.forma_pagamento) set.add(normalizarFormaPagamento(n.forma_pagamento)); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [dados]);

  // KPIs
  const kpis = useMemo(() => {
    const comissionaveis = filtrados.filter(n => n.comissionavel);
    const faturamento = arredondar2(comissionaveis.reduce((a, n) => a + (n.valor_venda || 0), 0));
    const qtdNfs = comissionaveis.length;
    const ticket = qtdNfs ? arredondar2(faturamento / qtdNfs) : 0;
    const institucional = arredondar2(filtrados.filter(n => n.tipo === 'institucional').reduce((a, n) => a + (n.valor_venda || 0), 0));
    const bonificacao = arredondar2(filtrados.reduce((a, n) => a + (n.valor_bonificacao || 0), 0));
    const naoId = filtrados.filter(n => n.tipo === 'venda' && !n.vendedor_id);
    const naoIdValor = arredondar2(naoId.reduce((a, n) => a + (n.valor_venda || 0), 0));
    const clientesUnicos = new Set(comissionaveis.map(n => n.cliente_id).filter(Boolean)).size;
    return { faturamento, qtdNfs, ticket, institucional, bonificacao, naoIdQtd: naoId.length, naoIdValor, clientesUnicos };
  }, [filtrados]);

  // Evolução por dia (ou por mês se período > 31 dias)
  const evolucao = useMemo(() => {
    const comissionaveis = filtrados.filter(n => n.comissionavel);
    const dias = diffDays(filtros.inicio, filtros.fim) + 1;
    const porDia = dias <= 31;
    const grupo = {};
    comissionaveis.forEach(n => {
      if (!n.data_emissao) return;
      const k = porDia ? n.data_emissao : n.data_emissao.slice(0, 7);
      if (!grupo[k]) grupo[k] = { periodo: k, label: porDia ? formatDia(k) : formatMes(k), valor: 0, qtd: 0 };
      grupo[k].valor = arredondar2(grupo[k].valor + (n.valor_venda || 0));
      grupo[k].qtd++;
    });
    return Object.values(grupo)
      .sort((a, b) => a.periodo.localeCompare(b.periodo))
      .map(g => ({ ...g, ticket: g.qtd ? arredondar2(g.valor / g.qtd) : 0 }));
  }, [filtrados, filtros.inicio, filtros.fim]);

  // Ranking de vendedores (TODOS, de-dup por nome, supervisor da linha de maior valor)
  const rankingVendedores = useMemo(() => {
    const v = {};
    filtrados.filter(n => n.comissionavel).forEach(n => {
      const k = n.vendedor_nome || '(sem vendedor)';
      if (!v[k]) v[k] = { nome: k, valor: 0, qtd: 0, supervisor: '', supervisorValor: 0, id: n.vendedor_id || '' };
      v[k].valor = arredondar2(v[k].valor + (n.valor_venda || 0));
      v[k].qtd++;
      if (n.supervisor_nome && (n.valor_venda || 0) > v[k].supervisorValor) {
        v[k].supervisor = n.supervisor_nome;
        v[k].supervisorValor = n.valor_venda || 0;
      }
    });
    const metaMap = {};
    metas.forEach(m => {
      if (!metaMap[m.vendedor_id] || m.periodo_inicio > metaMap[m.vendedor_id].periodo_inicio) metaMap[m.vendedor_id] = m;
    });
    return Object.values(v)
      .map(vend => {
        const meta = vend.id ? metaMap[vend.id] : null;
        const percMeta = meta?.valor_meta ? Math.round((vend.valor / meta.valor_meta) * 100) : null;
        return { ...vend, meta: meta?.valor_meta || 0, percMeta };
      })
      .sort((a, b) => b.valor - a.valor);
  }, [filtrados, metas]);

  // Por supervisor (exclui APLICATIVO e não identificados — só comissionável)
  const rankingSupervisores = useMemo(() => {
    const s = {};
    filtrados.filter(n => n.comissionavel).forEach(n => {
      const k = n.supervisor_nome || '(sem supervisor)';
      if (!s[k]) s[k] = { nome: k, valor: 0, qtd: 0, vendedores: new Set() };
      s[k].valor = arredondar2(s[k].valor + (n.valor_venda || 0));
      s[k].qtd++;
      if (n.vendedor_id) s[k].vendedores.add(n.vendedor_id);
    });
    return Object.values(s)
      .map(sup => ({ ...sup, vendedores: sup.vendedores.size }))
      .sort((a, b) => b.valor - a.valor);
  }, [filtrados]);

  // Faturamento por rota
  const porRota = useMemo(() => {
    const r = {};
    filtrados.filter(n => n.comissionavel).forEach(n => {
      const k = n.rota_nome || 'Sem rota';
      if (!r[k]) r[k] = { nome: k, valor: 0, qtd: 0 };
      r[k].valor = arredondar2(r[k].valor + (n.valor_venda || 0));
      r[k].qtd++;
    });
    return Object.values(r).sort((a, b) => b.valor - a.valor).slice(0, 8);
  }, [filtrados]);

  // Faturamento por forma de pagamento
  const porFormaPagamento = useMemo(() => {
    const f = {};
    filtrados.filter(n => n.comissionavel).forEach(n => {
      const k = n.forma_pagamento ? normalizarFormaPagamento(n.forma_pagamento) : 'Sem plano';
      if (!f[k]) f[k] = { nome: k, valor: 0, qtd: 0 };
      f[k].valor = arredondar2(f[k].valor + (n.valor_venda || 0));
      f[k].qtd++;
    });
    return Object.values(f).sort((a, b) => b.valor - a.valor);
  }, [filtrados]);

  // Top 10 clientes (por cliente_id + cliente_nome, nunca razão social)
  const topClientes = useMemo(() => {
    const c = {};
    filtrados.filter(n => n.comissionavel).forEach(n => {
      const k = n.cliente_id || n.cliente_nome || 'sem_id';
      if (!c[k]) c[k] = { nome: n.cliente_nome || '-', valor: 0, qtd: 0 };
      c[k].valor = arredondar2(c[k].valor + (n.valor_venda || 0));
      c[k].qtd++;
    });
    return Object.values(c).sort((a, b) => b.valor - a.valor).slice(0, 10);
  }, [filtrados]);

  // Análise de cortes (fonte independente — LogCorte)
  const analiseCortes = useMemo(() => {
    const cortesFiltrados = cortes.filter(c => {
      if (!filtros.inicio && !filtros.fim) return true;
      const d = new Date(c.created_date).getTime();
      if (filtros.inicio && d < new Date(filtros.inicio).getTime()) return false;
      if (filtros.fim && d > new Date(filtros.fim).getTime() + 86400000) return false;
      return true;
    });
    const valorCortado = arredondar2(cortesFiltrados.reduce((a, c) => a + (c.valor_cortado || 0), 0));
    return { total: cortesFiltrados.length, valorCortado };
  }, [cortes, filtros]);

  const exportar = () => exportarCSV('dashboard_vendas',
    ['Vendedor', 'Supervisor', 'NFs', 'Valor', '% Meta'],
    rankingVendedores.map(v => [v.nome, v.supervisor || '-', v.qtd, valorCSV(v.valor), v.percMeta !== null ? `${v.percMeta}%` : '-'])
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-cyan-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FiltrosBase filtros={filtros} setFiltros={setFiltros} vendedores={vendedores}
        onLimpar={() => setFiltros({ inicio: inicioMesISO, fim: hojeISO, vendedor_id: '', rota_id: '', forma_pagamento: '' })}
        onExportar={exportar}>
        <div>
          <Label className="text-xs">Rota</Label>
          <Select value={filtros.rota_id || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, rota_id: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todas as rotas</SelectItem>
              {rotas.map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Forma de Pagamento</Label>
          <Select value={filtros.forma_pagamento || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, forma_pagamento: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todas as formas</SelectItem>
              {formasPagamento.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </FiltrosBase>

      {/* Selinho de sync */}
      <div className="flex justify-end">
        <SyncStatusBadge
          ultimaSincronizacao={ultimaSincronizacao}
          isSincronizando={isSincronizando}
          erroSync={erroSync}
          onAtualizar={sincronizarAgora}
        />
      </div>

      {/* KPIs principais */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard titulo="NFs de venda" valor={formatarNumero(kpis.qtdNfs)} icon={ShoppingBag} cor="cyan" />
        <KpiCard titulo="Faturamento" valor={formatarMoeda(kpis.faturamento)} icon={DollarSign} cor="emerald" />
        <KpiCard titulo="Ticket médio" valor={formatarMoeda(kpis.ticket)} icon={Target} cor="amber" />
        <KpiCard titulo="Clientes ativos" valor={formatarNumero(kpis.clientesUnicos)} icon={Users} cor="indigo" />
        <KpiCard titulo="Cortes" valor={formatarNumero(analiseCortes.total)} sub={formatarMoeda(analiseCortes.valorCortado)} icon={Package} cor="slate" />
        <KpiCard titulo="% Bonificação" valor={`${kpis.faturamento > 0 ? ((kpis.bonificacao / kpis.faturamento) * 100).toFixed(1) : '0'}%`} sub={formatarMoeda(kpis.bonificacao)} icon={TrendingUp} cor="red" />
      </div>

      {/* Fora da comissão (cards discretos) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard titulo="Institucional (APLICATIVO)" valor={formatarMoeda(kpis.institucional)} sub="fora da comissão" icon={Building2} cor="slate" />
        <KpiCard titulo="Bonificação" valor={formatarMoeda(kpis.bonificacao)} sub="fora da comissão" icon={Package} cor="orange" />
        <KpiCard titulo="Não identificados" valor={`${kpis.naoIdQtd} NFs`} sub={formatarMoeda(kpis.naoIdValor)} icon={AlertTriangle} cor="red" />
      </div>

      {/* Evolução de faturamento */}
      <Card>
        <CardHeader><CardTitle className="text-base">Evolução de faturamento</CardTitle></CardHeader>
        <CardContent>
          {evolucao.length === 0
            ? <p className="text-sm text-slate-400 text-center py-12">Nenhum dado no período</p>
            : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={evolucao}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis yAxisId="left" tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip formatter={(v, n) => n === 'valor' || n === 'ticket' ? formatarMoeda(v) : v} />
                <Legend />
                <Area yAxisId="left" type="monotone" dataKey="valor" fill="#d1fae5" stroke="#16a34a" strokeWidth={2} name="Faturamento" />
                <Line yAxisId="right" type="monotone" dataKey="qtd" stroke="#0891b2" strokeWidth={2} name="NFs" dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="ticket" stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 4" name="Ticket médio" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Ranking vendedores + Por rota */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Ranking de vendedores</CardTitle></CardHeader>
          <CardContent>
            {rankingVendedores.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
              : (
              <div className="space-y-2 max-h-[480px] overflow-auto">
                {rankingVendedores.map((v, i) => (
                  <div key={v.nome} className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0
                      ${i === 0 ? 'bg-yellow-400' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-amber-600' : 'bg-slate-300'}`}>{i+1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium truncate">{v.nome}</span>
                        <span className="text-sm font-bold text-emerald-700 shrink-0 ml-2">{formatarMoeda(v.valor)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${rankingVendedores[0]?.valor ? (v.valor / rankingVendedores[0].valor) * 100 : 0}%` }} />
                        </div>
                        <span className="text-xs text-slate-500 shrink-0">{v.qtd} NFs</span>
                        {v.percMeta !== null && (
                          <Badge variant="outline" className={`text-xs shrink-0 ${v.percMeta >= 100 ? 'text-emerald-700' : v.percMeta >= 80 ? 'text-amber-700' : 'text-red-600'}`}>
                            {v.percMeta}% meta
                          </Badge>
                        )}
                      </div>
                      {v.supervisor && <p className="text-xs text-slate-400 mt-0.5">Sup: {v.supervisor}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Faturamento por rota</CardTitle></CardHeader>
          <CardContent>
            {porRota.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
              : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={porRota} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                  <YAxis dataKey="nome" type="category" width={100} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={v => formatarMoeda(v)} />
                  <Bar dataKey="valor" fill="#0891b2" name="Faturamento" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Por Supervisor */}
      <Card>
        <CardHeader><CardTitle className="text-base">Vendas por Supervisor</CardTitle></CardHeader>
        <CardContent>
          {rankingSupervisores.length === 0
            ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
            : (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="overflow-auto max-h-[420px]">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Supervisor</th>
                      <th className="p-2 text-right">Nº Vendedores</th>
                      <th className="p-2 text-right">NFs</th>
                      <th className="p-2 text-right">Valor Vendido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingSupervisores.map(sup => (
                      <tr key={sup.nome} className="border-t hover:bg-slate-50">
                        <td className="p-2 font-medium">{sup.nome}</td>
                        <td className="p-2 text-right">{formatarNumero(sup.vendedores)}</td>
                        <td className="p-2 text-right">{formatarNumero(sup.qtd)}</td>
                        <td className="p-2 text-right font-medium text-emerald-700">{formatarMoeda(sup.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={rankingSupervisores} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                  <YAxis dataKey="nome" type="category" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={v => formatarMoeda(v)} />
                  <Bar dataKey="valor" fill="#7c3aed" name="Comissionável" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Forma de pagamento + Top clientes */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Faturamento por Forma de Pagamento</CardTitle></CardHeader>
          <CardContent>
            {porFormaPagamento.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
              : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="p-2 text-left">Forma de Pagamento</th>
                      <th className="p-2 text-right">NFs</th>
                      <th className="p-2 text-right">Faturamento</th>
                      <th className="p-2 text-right">% do total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porFormaPagamento.map(f => (
                      <tr key={f.nome} className="border-t hover:bg-slate-50">
                        <td className="p-2 font-medium">{f.nome}</td>
                        <td className="p-2 text-right">{formatarNumero(f.qtd)}</td>
                        <td className="p-2 text-right font-medium text-emerald-700">{formatarMoeda(f.valor)}</td>
                        <td className="p-2 text-right text-slate-500">{kpis.faturamento > 0 ? ((f.valor / kpis.faturamento) * 100).toFixed(1) : '0'}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Top 10 clientes</CardTitle></CardHeader>
          <CardContent>
            {topClientes.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
              : (
              <ResponsiveContainer width="100%" height={300}>
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
      </div>
    </div>
  );
}