import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, UserCheck, UserX, DollarSign, Target, Loader2, Filter, RefreshCw, Search, Printer, MapPin, User, Route as RouteIcon } from 'lucide-react';
import KpiCard from './KpiCard';
import { formatarMoeda, formatarNumero, exportarCSV, valorCSV } from './utilsAnalises';

const hoje = new Date().toISOString().slice(0, 10);
const inicioMes = hoje.slice(0, 8) + '01';

function DistribCard({ titulo, icon: Icon, dados }) {
  const max = Math.max(...dados.map(d => d.clientes), 1);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Icon className="w-4 h-4 text-indigo-500" />{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        {dados.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">Sem dados.</p>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {dados.slice(0, 20).map(d => (
              <div key={d.nome}>
                <div className="flex justify-between text-xs mb-0.5 gap-2">
                  <span className="font-medium text-slate-700 truncate">{d.nome}</span>
                  <span className="text-slate-500 shrink-0">{formatarNumero(d.clientes)} · {formatarMoeda(d.valor)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${(d.clientes / max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardClientesComercial() {
  const [filtros, setFiltros] = useState({ inicio: inicioMes, fim: hoje, vendedor_id: '', cidade: '', rota_id: '' });
  const [aplicado, setAplicado] = useState({ inicio: inicioMes, fim: hoje, vendedor_id: '', cidade: '', rota_id: '' });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores_dash_clientes'],
    queryFn: () => base44.entities.Vendedor.list('nome', 5000)
  });
  const { data: rotas = [] } = useQuery({
    queryKey: ['rotas_dash_clientes'],
    queryFn: () => base44.entities.Rota.list('-created_date', 5000)
  });

  const { data, isFetching } = useQuery({
    queryKey: ['agregados_clientes_comercial', aplicado],
    queryFn: async () => {
      const res = await base44.functions.invoke('agregadosClientesComercial', aplicado);
      return res.data;
    }
  });

  const kpis = data?.kpis || { ativos: 0, positivados: 0, sem_compra: 0, faturamento: 0, ticket_medio: 0 };
  const ranking = data?.ranking || [];
  const semCompra = data?.sem_compra || [];

  // Cidades disponíveis pro filtro (das distribuições)
  const cidades = useMemo(() => {
    const set = new Set((data?.por_cidade || []).map(c => c.nome));
    return Array.from(set).filter(c => c && c !== 'Sem cidade').sort();
  }, [data]);

  const aplicar = () => setAplicado({ ...filtros });
  const limpar = () => {
    const reset = { inicio: inicioMes, fim: hoje, vendedor_id: '', cidade: '', rota_id: '' };
    setFiltros(reset);
    setAplicado(reset);
  };

  const exportarRanking = () => exportarCSV('ranking_clientes',
    ['Cliente', 'Cidade', 'Vendedor', 'Faturamento', 'Pedidos', 'Ticket'],
    ranking.map(r => [r.nome, r.cidade, r.vendedor_nome, r.valor, r.pedidos, r.ticket])
  );
  const exportarSemCompra = () => exportarCSV('clientes_sem_compra',
    ['Cliente', 'Cidade', 'Vendedor', 'Rota'],
    semCompra.map(r => [r.nome, r.cidade, r.vendedor_nome, r.rota_nome])
  );

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card className="border-slate-200">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-700"><Filter className="w-4 h-4" />Filtros</h3>
            <Button variant="ghost" size="sm" onClick={limpar}><RefreshCw className="w-4 h-4" />Limpar</Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <div>
              <Label className="text-xs">Início</Label>
              <Input type="date" value={filtros.inicio} onChange={(e) => setFiltros({ ...filtros, inicio: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Fim</Label>
              <Input type="date" value={filtros.fim} onChange={(e) => setFiltros({ ...filtros, fim: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Vendedor</Label>
              <Select value={filtros.vendedor_id || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, vendedor_id: v === '_todos_' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_todos_">Todos</SelectItem>
                  {vendedores.filter(v => v.nome).map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Cidade</Label>
              <Select value={filtros.cidade || '_todas_'} onValueChange={(v) => setFiltros({ ...filtros, cidade: v === '_todas_' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_todas_">Todas</SelectItem>
                  {cidades.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Rota</Label>
              <Select value={filtros.rota_id || '_todas_'} onValueChange={(v) => setFiltros({ ...filtros, rota_id: v === '_todas_' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_todas_">Todas</SelectItem>
                  {rotas.filter(r => r.nome).map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={aplicar} disabled={isFetching} className="bg-indigo-600 hover:bg-indigo-700 w-full">
              {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Aplicar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard titulo="Ativos" valor={formatarNumero(kpis.ativos)} icon={Users} cor="slate" />
        <KpiCard titulo="Positivados" valor={formatarNumero(kpis.positivados)} sub="compraram no período" icon={UserCheck} cor="emerald" />
        <KpiCard titulo="Sem compra" valor={formatarNumero(kpis.sem_compra)} sub="alvo de visita" icon={UserX} cor="red" />
        <KpiCard titulo="Faturamento" valor={formatarMoeda(kpis.faturamento)} icon={DollarSign} cor="cyan" />
        <KpiCard titulo="Ticket médio" valor={formatarMoeda(kpis.ticket_medio)} icon={Target} cor="amber" />
      </div>

      {/* Ranking */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">Ranking de clientes ({formatarNumero(ranking.length)})</CardTitle>
          <Button variant="outline" size="sm" onClick={exportarRanking} disabled={ranking.length === 0}><Printer className="w-4 h-4" />Exportar</Button>
        </CardHeader>
        <CardContent>
          {isFetching && ranking.length === 0 ? (
            <div className="py-12 text-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
          ) : ranking.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-12">Nenhuma compra no período.</p>
          ) : (
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-slate-50">
                  <tr className="text-slate-600">
                    <th className="p-2 text-left w-8">#</th>
                    <th className="p-2 text-left">Cliente</th>
                    <th className="p-2 text-left">Cidade</th>
                    <th className="p-2 text-left">Vendedor</th>
                    <th className="p-2 text-right">R$</th>
                    <th className="p-2 text-right">Nº Ped.</th>
                    <th className="p-2 text-right">Ticket</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.slice(0, 200).map((r, i) => (
                    <tr key={r.cliente_id} className="border-t hover:bg-slate-50">
                      <td className="p-2 text-slate-400 font-bold">{i + 1}</td>
                      <td className="p-2 font-medium max-w-[200px] truncate" title={r.nome}>{r.nome}</td>
                      <td className="p-2 text-slate-600 max-w-[140px] truncate" title={r.cidade}>{r.cidade}</td>
                      <td className="p-2 text-slate-600 max-w-[160px] truncate" title={r.vendedor_nome}>{r.vendedor_nome}</td>
                      <td className="p-2 text-right font-semibold text-emerald-700 whitespace-nowrap">{formatarMoeda(r.valor)}</td>
                      <td className="p-2 text-right">{formatarNumero(r.pedidos)}</td>
                      <td className="p-2 text-right text-slate-600 whitespace-nowrap">{formatarMoeda(r.ticket)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ranking.length > 200 && <p className="text-xs text-slate-400 mt-2">Mostrando os 200 maiores. Use Exportar para a lista completa.</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sem compra + Distribuição */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2"><UserX className="w-4 h-4 text-red-500" />Sem compra ({formatarNumero(semCompra.length)})</CardTitle>
            <Button variant="outline" size="sm" onClick={exportarSemCompra} disabled={semCompra.length === 0}><Printer className="w-4 h-4" />Exportar</Button>
          </CardHeader>
          <CardContent>
            {semCompra.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">Todos compraram no período. 🎉</p>
            ) : (
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {semCompra.slice(0, 300).map(c => (
                  <div key={c.cliente_id} className="flex items-center justify-between gap-2 p-2 rounded border border-slate-100 hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate" title={c.nome}>{c.nome}</div>
                      <div className="text-xs text-slate-500 truncate">{c.cidade} · {c.vendedor_nome}</div>
                    </div>
                    <span className="text-xs text-slate-400 shrink-0 truncate max-w-[90px]" title={c.rota_nome}>{c.rota_nome}</span>
                  </div>
                ))}
                {semCompra.length > 300 && <p className="text-xs text-slate-400 pt-1">Mostrando 300. Use Exportar para a lista completa.</p>}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4">
          <DistribCard titulo="Por cidade" icon={MapPin} dados={data?.por_cidade || []} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DistribCard titulo="Por vendedor" icon={User} dados={data?.por_vendedor || []} />
        <DistribCard titulo="Por rota" icon={RouteIcon} dados={data?.por_rota || []} />
      </div>
    </div>
  );
}