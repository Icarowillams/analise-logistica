import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendingUp, ShoppingBag, Users, DollarSign, Target, Award, Package } from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ComposedChart, Area
} from 'recharts';
import KpiCard from './KpiCard';
import FiltrosBase from './FiltrosBase';
import { dentroPeriodo, exportarCSV, formatarMoeda, formatarNumero } from './utilsAnalises';

const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const formatMes = (k) => { const [a, m] = k.split('-'); return `${MESES_PT[+m-1]}/${a.slice(2)}`; };

export default function DashboardVendas() {
  const [filtros, setFiltros] = useState({ inicio: '', fim: '', vendedor_id: '', rota_id: '', modelo_nota: '' });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores_analise'],
    queryFn: () => base44.entities.Vendedor.list()
  });
  const { data: rotas = [] } = useQuery({
    queryKey: ['rotas_analise'],
    queryFn: () => base44.entities.Rota.list()
  });
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes_analise'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 20000)
  });
  // Pedidos de venda faturados (entregues ou com NF emitida)
  const { data: pedidosFaturados = [], isLoading: loadingF } = useQuery({
    queryKey: ['pedidos_venda_faturados'],
    queryFn: () => base44.entities.Pedido.filter({ tipo: 'venda', status: 'faturado' }, '-data_faturamento', 10000)
  });
  // Pedidos de bonificação faturados (separados para análise de desconto)
  const { data: pedidosBonif = [] } = useQuery({
    queryKey: ['pedidos_bonif_faturados'],
    queryFn: () => base44.entities.Pedido.filter({ tipo: 'bonificacao', status: 'faturado' }, '-data_faturamento', 2000)
  });
  // Metas de vendedores para atingimento
  const { data: metas = [] } = useQuery({
    queryKey: ['metas_vendas'],
    queryFn: () => base44.entities.Meta.filter({ tipo: 'venda' }, '-periodo_inicio', 200)
  });
  // LogCorte para análise de cortes
  const { data: cortes = [] } = useQuery({
    queryKey: ['log_cortes'],
    queryFn: () => base44.entities.LogCorte.list('-created_date', 5000)
  });

  // Mapa cliente_id → vendedor do cadastro (fonte da verdade)
  const vendedorPorCliente = useMemo(() => {
    const nomesVend = new Map(vendedores.map(v => [v.id, v.nome]));
    const map = new Map();
    clientes.forEach(c => {
      if (c.id && c.vendedor_id) map.set(c.id, { id: c.vendedor_id, nome: nomesVend.get(c.vendedor_id) || '-' });
    });
    return map;
  }, [clientes, vendedores]);

  // Mapa rota_id → nome (pedidos têm rota_id mas rota_nome vem vazio)
  const nomeRota = useMemo(() => new Map(rotas.map(r => [r.id, r.nome])), [rotas]);

  const enriquecer = (p) => {
    const v = vendedorPorCliente.get(p.cliente_id);
    return {
      ...p,
      vendedor_id: v?.id || p.vendedor_id,
      vendedor_nome: v?.nome || p.vendedor_nome,
      rota_nome: p.rota_nome || nomeRota.get(p.rota_id) || ''
    };
  };
  const pedidosEnr = useMemo(() => pedidosFaturados.map(enriquecer), [pedidosFaturados, vendedorPorCliente, nomeRota]);

  const filtrados = useMemo(() => pedidosEnr.filter(p => {
    if (filtros.vendedor_id && p.vendedor_id !== filtros.vendedor_id) return false;
    if (filtros.rota_id && p.rota_id !== filtros.rota_id) return false;
    if (filtros.modelo_nota && p.modelo_nota !== filtros.modelo_nota) return false;
    const dataRef = p.data_faturamento || p.created_date;
    if ((filtros.inicio || filtros.fim) && !dentroPeriodo(dataRef, filtros.inicio, filtros.fim)) return false;
    return true;
  }), [pedidosEnr, filtros]);

  // KPIs principais
  const totais = useMemo(() => {
    const valor = filtrados.reduce((a, p) => a + (p.valor_total || 0), 0);
    const itens = filtrados.reduce((a, p) => a + (p.total_itens || 0), 0);
    const clientesUnicos = new Set(filtrados.map(p => p.cliente_id)).size;
    const ticket = filtrados.length ? valor / filtrados.length : 0;
    const valorBonif = pedidosBonif.reduce((a, p) => a + (p.valor_total || 0), 0);
    const percBonif = valor > 0 ? ((valorBonif / valor) * 100).toFixed(1) : '0';
    return { total: filtrados.length, valor, itens, clientes: clientesUnicos, ticket, percBonif };
  }, [filtrados, pedidosBonif]);

  // Evolução mensal com linha de tendência
  const evolucaoMensal = useMemo(() => {
    const grupo = {};
    filtrados.forEach(p => {
      const k = String(p.data_faturamento || p.created_date || '').slice(0, 7);
      if (!k || k.length < 7) return;
      if (!grupo[k]) grupo[k] = { mes: k, label: formatMes(k), valor: 0, qtd: 0, clientes: new Set() };
      grupo[k].valor += p.valor_total || 0;
      grupo[k].qtd++;
      grupo[k].clientes.add(p.cliente_id);
    });
    return Object.values(grupo)
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .slice(-12)
      .map(g => ({ ...g, clientes: g.clientes.size, ticket: g.qtd ? g.valor / g.qtd : 0 }));
  }, [filtrados]);

  // Ranking de vendedores com % da meta
  const rankingVendedores = useMemo(() => {
    const v = {};
    filtrados.forEach(p => {
      const k = p.vendedor_id || 'sem_vendedor';
      const nome = p.vendedor_nome || '-';
      if (!v[k]) v[k] = { id: k, nome, valor: 0, qtd: 0, clientes: new Set() };
      v[k].valor += p.valor_total || 0;
      v[k].qtd++;
      v[k].clientes.add(p.cliente_id);
    });
    // Cruzar com metas (pegar a meta mais recente de cada vendedor)
    const metaMap = {};
    metas.forEach(m => {
      if (!metaMap[m.vendedor_id] || m.periodo_inicio > metaMap[m.vendedor_id].periodo_inicio) metaMap[m.vendedor_id] = m;
    });
    return Object.values(v)
      .map(vend => {
        const meta = metaMap[vend.id];
        const percMeta = meta?.valor_meta ? Math.round((vend.valor / meta.valor_meta) * 100) : null;
        return { ...vend, clientes: vend.clientes.size, meta: meta?.valor_meta || 0, percMeta };
      })
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 10);
  }, [filtrados, metas]);

  // Top clientes
  const topClientes = useMemo(() => {
    const c = {};
    filtrados.forEach(p => {
      const k = p.cliente_id || p.cliente_nome;
      if (!c[k]) c[k] = { nome: p.cliente_nome || '-', valor: 0, qtd: 0 };
      c[k].valor += p.valor_total || 0;
      c[k].qtd++;
    });
    return Object.values(c).sort((a, b) => b.valor - a.valor).slice(0, 10);
  }, [filtrados]);

  // Análise de cortes no período
  const analiseCortes = useMemo(() => {
    const cortesFiltrados = cortes.filter(c => {
      if (!filtros.inicio && !filtros.fim) return true;
      return dentroPeriodo(c.created_date, filtros.inicio, filtros.fim);
    });
    const valorCortado = cortesFiltrados.reduce((a, c) => a + (c.valor_cortado || 0), 0);
    return { total: cortesFiltrados.length, valorCortado };
  }, [cortes, filtros]);

  // Faturamento por rota
  const porRota = useMemo(() => {
    const r = {};
    filtrados.forEach(p => {
      const k = p.rota_nome || 'Sem rota';
      if (!r[k]) r[k] = { nome: k, valor: 0, qtd: 0 };
      r[k].valor += p.valor_total || 0;
      r[k].qtd++;
    });
    return Object.values(r).sort((a, b) => b.valor - a.valor).slice(0, 8);
  }, [filtrados]);

  const exportar = () => exportarCSV('dashboard_vendas',
    ['Data Faturamento', 'Nº Pedido', 'Cliente', 'Vendedor', 'Rota', 'Modelo NF', 'Origem', 'Itens', 'Valor', 'Status'],
    filtrados.map(p => [
      (p.data_faturamento || p.created_date)?.slice(0, 10),
      p.numero_pedido, p.cliente_nome, p.vendedor_nome, p.rota_nome,
      p.modelo_nota, p.origem, p.total_itens, p.valor_total, p.status
    ])
  );

  return (
    <div className="space-y-4">
      <FiltrosBase filtros={filtros} setFiltros={setFiltros} vendedores={vendedores}
        onLimpar={() => setFiltros({ inicio: '', fim: '', vendedor_id: '', rota_id: '', modelo_nota: '' })}
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
          <Label className="text-xs">Modelo NF</Label>
          <Select value={filtros.modelo_nota || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, modelo_nota: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos (D1 + 55)</SelectItem>
              <SelectItem value="55">NF-e (55)</SelectItem>
              <SelectItem value="d1">D1 (interno)</SelectItem>
              <SelectItem value="nfce">NFC-e</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FiltrosBase>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard titulo="Pedidos" valor={formatarNumero(totais.total)} icon={ShoppingBag} cor="cyan" />
        <KpiCard titulo="Faturamento" valor={formatarMoeda(totais.valor)} icon={DollarSign} cor="emerald" />
        <KpiCard titulo="Ticket médio" valor={formatarMoeda(totais.ticket)} icon={Target} cor="amber" />
        <KpiCard titulo="Itens vendidos" valor={formatarNumero(totais.itens)} icon={Package} cor="indigo" />
        <KpiCard titulo="Clientes ativos" valor={formatarNumero(totais.clientes)} icon={Users} cor="slate" />
        <KpiCard titulo="% Bonificação" valor={`${totais.percBonif}%`} sub={`${cortes.length > 0 ? formatarNumero(analiseCortes.total) + ' cortes' : 'sem cortes'}`} icon={TrendingUp} cor="red" />
      </div>

      {/* Evolução mensal */}
      <Card>
        <CardHeader><CardTitle className="text-base">Evolução de faturamento</CardTitle></CardHeader>
        <CardContent>
          {evolucaoMensal.length === 0
            ? <p className="text-sm text-slate-400 text-center py-12">Nenhum dado no período</p>
            : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={evolucaoMensal}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis yAxisId="left" tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip formatter={(v, n) => n === 'valor' ? formatarMoeda(v) : n === 'ticket' ? formatarMoeda(v) : v} />
                <Legend />
                <Area yAxisId="left" type="monotone" dataKey="valor" fill="#d1fae5" stroke="#16a34a" strokeWidth={2} name="Faturamento" />
                <Line yAxisId="right" type="monotone" dataKey="qtd" stroke="#0891b2" strokeWidth={2} name="Pedidos" dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="ticket" stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 4" name="Ticket médio" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Ranking vendedores + Top rotas */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Ranking de vendedores</CardTitle></CardHeader>
          <CardContent>
            {rankingVendedores.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
              : (
              <div className="space-y-2">
                {rankingVendedores.map((v, i) => (
                  <div key={v.id} className="flex items-center gap-3">
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
                        <span className="text-xs text-slate-500 shrink-0">{v.qtd} ped · {v.clientes} cli</span>
                        {v.percMeta !== null && (
                          <Badge variant="outline" className={`text-xs shrink-0 ${v.percMeta >= 100 ? 'text-emerald-700' : v.percMeta >= 80 ? 'text-amber-700' : 'text-red-600'}`}>
                            {v.percMeta}% meta
                          </Badge>
                        )}
                      </div>
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

      {/* Top clientes */}
      <Card>
        <CardHeader><CardTitle className="text-base">Top 10 clientes</CardTitle></CardHeader>
        <CardContent>
          {topClientes.length === 0
            ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
            : (
            <ResponsiveContainer width="100%" height={260}>
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

      {/* Tabela detalhada */}
      <Card>
        <CardHeader><CardTitle className="text-base">Pedidos detalhados</CardTitle></CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="p-2 text-left">Faturamento</th>
                <th className="p-2 text-left">Nº</th>
                <th className="p-2 text-left">Cliente</th>
                <th className="p-2 text-left">Vendedor</th>
                <th className="p-2 text-left">Rota</th>
                <th className="p-2 text-left">Modelo</th>
                <th className="p-2 text-right">Itens</th>
                <th className="p-2 text-right">Valor</th>
                <th className="p-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.slice(0, 300).map(p => (
                <tr key={p.id} className="border-t hover:bg-slate-50">
                  <td className="p-2 text-xs">{(p.data_faturamento || p.created_date || '').slice(0,10)}</td>
                  <td className="p-2 font-mono text-xs">{p.numero_pedido || '-'}</td>
                  <td className="p-2 max-w-[180px] truncate">{p.cliente_nome || '-'}</td>
                  <td className="p-2 max-w-[120px] truncate">{p.vendedor_nome || '-'}</td>
                  <td className="p-2 text-xs text-slate-600">{p.rota_nome || '-'}</td>
                  <td className="p-2"><Badge variant="outline">{p.modelo_nota || '-'}</Badge></td>
                  <td className="p-2 text-right">{p.total_itens || 0}</td>
                  <td className="p-2 text-right font-medium">{formatarMoeda(p.valor_total)}</td>
                  <td className="p-2"><Badge>{p.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtrados.length > 300 && <p className="text-xs text-slate-500 mt-2">Exibindo 300 de {filtrados.length}. Use Exportar para o relatório completo.</p>}
        </CardContent>
      </Card>
    </div>
  );
}