import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeftRight, AlertTriangle, Package, DollarSign } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import KpiCard from './KpiCard';
import FiltrosBase from './FiltrosBase';
import { dentroPeriodo, exportarCSV, formatarMoeda, formatarNumero } from './utilsAnalises';

const CORES = ['#dc2626', '#f59e0b', '#0891b2', '#7c3aed', '#16a34a'];

export default function DashboardTrocas() {
  const [filtros, setFiltros] = useState({ inicio: '', fim: '', vendedor_id: '', motivo_id: '' });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: motivos = [] } = useQuery({ queryKey: ['motivosTroca'], queryFn: () => base44.entities.MotivoTroca.list() });
  const { data: trocas = [] } = useQuery({ queryKey: ['pedidosTroca'], queryFn: () => base44.entities.PedidoTroca.list('-data_troca', 5000) });

  const filtradas = useMemo(() => trocas.filter(t => {
    if (filtros.vendedor_id && t.vendedor_id !== filtros.vendedor_id) return false;
    if (filtros.motivo_id && t.motivo_id !== filtros.motivo_id) return false;
    if ((filtros.inicio || filtros.fim) && !dentroPeriodo(t.data_troca, filtros.inicio, filtros.fim)) return false;
    return true;
  }), [trocas, filtros]);

  const totais = useMemo(() => {
    const valor = filtradas.reduce((a, t) => a + (t.valor_total || 0), 0);
    const aprovadas = filtradas.filter(t => t.status === 'aprovado' || t.status === 'finalizado').length;
    return { total: filtradas.length, valor, aprovadas, ticket: filtradas.length ? valor / filtradas.length : 0 };
  }, [filtradas]);

  const porMotivo = useMemo(() => {
    const m = {};
    filtradas.forEach(t => {
      const k = t.motivo_descricao || motivos.find(x => x.id === t.motivo_id)?.descricao || 'Sem motivo';
      m[k] = (m[k] || 0) + 1;
    });
    return Object.entries(m).map(([motivo, qtd]) => ({ motivo, qtd })).sort((a, b) => b.qtd - a.qtd).slice(0, 8);
  }, [filtradas, motivos]);

  const porVendedor = useMemo(() => {
    const v = {};
    filtradas.forEach(t => {
      const k = t.vendedor_nome || vendedores.find(x => x.id === t.vendedor_id)?.nome || '-';
      if (!v[k]) v[k] = { nome: k, qtd: 0, valor: 0 };
      v[k].qtd++; v[k].valor += t.valor_total || 0;
    });
    return Object.values(v).sort((a, b) => b.qtd - a.qtd).slice(0, 10);
  }, [filtradas, vendedores]);

  const exportar = () => exportarCSV('dashboard_trocas',
    ['Data', 'Cliente', 'Vendedor', 'Tipo', 'Origem', 'Motivo', 'Valor', 'Status'],
    filtradas.map(t => [t.data_troca, t.cliente_nome, t.vendedor_nome, t.tipo, t.origem, t.motivo_descricao, t.valor_total, t.status])
  );

  return (
    <div className="space-y-4">
      <FiltrosBase filtros={filtros} setFiltros={setFiltros} vendedores={vendedores} onLimpar={() => setFiltros({ inicio: '', fim: '', vendedor_id: '', motivo_id: '' })} onExportar={exportar}>
        <div>
          <Label className="text-xs">Motivo</Label>
          <Select value={filtros.motivo_id || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, motivo_id: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos</SelectItem>
              {motivos.map(m => <SelectItem key={m.id} value={m.id}>{m.descricao || m.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </FiltrosBase>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard titulo="Total de trocas" valor={formatarNumero(totais.total)} icon={ArrowLeftRight} cor="red" />
        <KpiCard titulo="Valor total" valor={formatarMoeda(totais.valor)} icon={DollarSign} cor="amber" />
        <KpiCard titulo="Aprovadas/finalizadas" valor={formatarNumero(totais.aprovadas)} icon={Package} cor="emerald" />
        <KpiCard titulo="Ticket médio" valor={formatarMoeda(totais.ticket)} icon={AlertTriangle} cor="indigo" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Trocas por motivo</CardTitle></CardHeader>
          <CardContent>
            {porMotivo.length === 0 ? <p className="text-sm text-slate-400 text-center py-12">Sem dados</p> : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart><Pie data={porMotivo} dataKey="qtd" nameKey="motivo" outerRadius={100} label>{porMotivo.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}</Pie><Legend /><Tooltip /></PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Trocas por vendedor</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={porVendedor}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="nome" angle={-20} textAnchor="end" height={70} /><YAxis /><Tooltip /><Legend /><Bar dataKey="qtd" fill="#dc2626" name="Qtd" /></BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Detalhe das trocas</CardTitle></CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0"><tr><th className="p-2 text-left">Data</th><th className="p-2 text-left">Nº</th><th className="p-2 text-left">Cliente</th><th className="p-2 text-left">Vendedor</th><th className="p-2 text-left">Tipo</th><th className="p-2 text-left">Motivo</th><th className="p-2 text-right">Valor</th><th className="p-2 text-left">Status</th></tr></thead>
            <tbody>{filtradas.slice(0, 200).map(t => (
              <tr key={t.id} className="border-t hover:bg-slate-50">
                <td className="p-2">{t.data_troca || '-'}</td>
                <td className="p-2 font-mono">{t.numero_troca || '-'}</td>
                <td className="p-2">{t.cliente_nome || '-'}</td>
                <td className="p-2">{t.vendedor_nome || '-'}</td>
                <td className="p-2"><Badge variant="outline">{t.tipo}</Badge></td>
                <td className="p-2 text-slate-600 text-xs">{t.motivo_descricao || '-'}</td>
                <td className="p-2 text-right">{formatarMoeda(t.valor_total)}</td>
                <td className="p-2"><Badge>{t.status}</Badge></td>
              </tr>
            ))}</tbody>
          </table>
          {filtradas.length > 200 && <p className="text-xs text-slate-500 mt-2">Exibindo 200 de {filtradas.length}.</p>}
        </CardContent>
      </Card>
    </div>
  );
}