import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Users, CheckCircle2, XCircle, Clock, Activity, MapPin } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, CartesianGrid } from 'recharts';
import KpiCard from './KpiCard';
import FiltrosBase from './FiltrosBase';
import { dentroPeriodo, exportarCSV, formatarNumero, duracaoMin } from './utilsAnalises';

const CORES = ['#0891b2', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0ea5e9'];

export default function AnaliseVisitas() {
  const [filtros, setFiltros] = useState({ inicio: '', fim: '', vendedor_id: '', status: '' });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: visitas = [] } = useQuery({ queryKey: ['visitasRoteiro'], queryFn: () => base44.entities.VisitaRoteiro.list('-updated_date', 10000) });

  const filtradas = useMemo(() => visitas.filter(v => {
    if (filtros.vendedor_id && v.vendedor_id !== filtros.vendedor_id) return false;
    if (filtros.status && v.status !== filtros.status) return false;
    if ((filtros.inicio || filtros.fim) && !dentroPeriodo(v.data_visita || v.created_date, filtros.inicio, filtros.fim)) return false;
    return true;
  }), [visitas, filtros]);

  const totais = useMemo(() => {
    const realizadas = filtradas.filter(v => v.status === 'visitado').length;
    const naoVisitadas = filtradas.filter(v => v.status === 'nao_visitado').length;
    const duracoes = filtradas.map(v => duracaoMin(v.inicio_visita, v.fim_visita)).filter(d => d > 0);
    const duracaoMedia = duracoes.length ? Math.round(duracoes.reduce((a, b) => a + b, 0) / duracoes.length) : 0;
    const sucesso = filtradas.length ? Math.round((realizadas / filtradas.length) * 100) : 0;
    const vendedoresAtivos = new Set(filtradas.map(v => v.vendedor_id)).size;
    const mediaPorVendedor = vendedoresAtivos ? (realizadas / vendedoresAtivos).toFixed(1) : '0';
    return { total: filtradas.length, realizadas, naoVisitadas, duracaoMedia, sucesso, mediaPorVendedor };
  }, [filtradas]);

  const porSemana = useMemo(() => {
    const grupo = {};
    filtradas.forEach(v => {
      const d = v.data_visita || v.created_date;
      if (!d) return;
      const data = new Date(d);
      const ano = data.getFullYear();
      const semana = Math.ceil((((data - new Date(ano, 0, 1)) / 86400000) + new Date(ano, 0, 1).getDay() + 1) / 7);
      const k = `${ano}-S${String(semana).padStart(2, '0')}`;
      grupo[k] = (grupo[k] || 0) + 1;
    });
    return Object.entries(grupo).sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([s, q]) => ({ semana: s, visitas: q }));
  }, [filtradas]);

  const motivos = useMemo(() => {
    const m = {};
    filtradas.filter(v => v.status === 'nao_visitado' && v.motivo_nao_visita).forEach(v => {
      m[v.motivo_nao_visita] = (m[v.motivo_nao_visita] || 0) + 1;
    });
    return Object.entries(m).map(([k, v]) => ({ motivo: k.replace(/_/g, ' '), qtd: v }));
  }, [filtradas]);

  const rankingVendedores = useMemo(() => {
    const grupo = {};
    filtradas.forEach(v => {
      if (!grupo[v.vendedor_id]) grupo[v.vendedor_id] = { nome: v.vendedor_nome || vendedores.find(x => x.id === v.vendedor_id)?.nome || '-', total: 0, realizadas: 0 };
      grupo[v.vendedor_id].total++;
      if (v.status === 'visitado') grupo[v.vendedor_id].realizadas++;
    });
    return Object.values(grupo).sort((a, b) => b.realizadas - a.realizadas).slice(0, 10);
  }, [filtradas, vendedores]);

  const exportar = () => exportarCSV('analise_visitas',
    ['Data', 'Vendedor', 'Cliente', 'Status', 'Início', 'Fim', 'Duração (min)', 'Motivo', 'Observações'],
    filtradas.map(v => [v.data_visita, v.vendedor_nome, v.cliente_nome, v.status, v.inicio_visita, v.fim_visita, duracaoMin(v.inicio_visita, v.fim_visita), v.motivo_nao_visita, v.observacoes])
  );

  return (
    <div className="space-y-4">
      <FiltrosBase filtros={filtros} setFiltros={setFiltros} vendedores={vendedores} onLimpar={() => setFiltros({ inicio: '', fim: '', vendedor_id: '', status: '' })} onExportar={exportar}>
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
      </FiltrosBase>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard titulo="Total" valor={formatarNumero(totais.total)} icon={Activity} cor="slate" />
        <KpiCard titulo="Realizadas" valor={formatarNumero(totais.realizadas)} icon={CheckCircle2} cor="emerald" />
        <KpiCard titulo="Não realizadas" valor={formatarNumero(totais.naoVisitadas)} icon={XCircle} cor="red" />
        <KpiCard titulo="Sucesso" valor={`${totais.sucesso}%`} icon={CheckCircle2} cor="cyan" />
        <KpiCard titulo="Duração média" valor={`${totais.duracaoMedia} min`} icon={Clock} cor="amber" />
        <KpiCard titulo="Média/vendedor" valor={totais.mediaPorVendedor} icon={Users} cor="indigo" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Tendência de visitas</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={porSemana}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="semana" /><YAxis /><Tooltip /><Line type="monotone" dataKey="visitas" stroke="#0891b2" strokeWidth={2} /></LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Motivos de não visita</CardTitle></CardHeader>
          <CardContent>
            {motivos.length === 0 ? <p className="text-sm text-slate-400 text-center py-12">Sem dados</p> : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart><Pie data={motivos} dataKey="qtd" nameKey="motivo" outerRadius={90} label>{motivos.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}</Pie><Legend /><Tooltip /></PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Ranking de vendedores</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={rankingVendedores}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="nome" angle={-20} textAnchor="end" height={80} /><YAxis /><Tooltip /><Legend /><Bar dataKey="realizadas" fill="#16a34a" name="Realizadas" /><Bar dataKey="total" fill="#94a3b8" name="Planejadas" /></BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Visitas individuais</CardTitle></CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0"><tr><th className="p-2 text-left">Data</th><th className="p-2 text-left">Vendedor</th><th className="p-2 text-left">Cliente</th><th className="p-2 text-left">Status</th><th className="p-2 text-left">Início</th><th className="p-2 text-left">Fim</th><th className="p-2 text-right">Duração</th><th className="p-2 text-left">Obs.</th></tr></thead>
            <tbody>{filtradas.slice(0, 200).map(v => (
              <tr key={v.id} className="border-t hover:bg-slate-50">
                <td className="p-2">{v.data_visita || '-'}</td>
                <td className="p-2">{v.vendedor_nome || '-'}</td>
                <td className="p-2">{v.cliente_nome || '-'}</td>
                <td className="p-2"><Badge variant="outline">{v.status}</Badge></td>
                <td className="p-2 text-xs">{v.inicio_visita ? new Date(v.inicio_visita).toLocaleTimeString('pt-BR') : '-'}</td>
                <td className="p-2 text-xs">{v.fim_visita ? new Date(v.fim_visita).toLocaleTimeString('pt-BR') : '-'}</td>
                <td className="p-2 text-right">{duracaoMin(v.inicio_visita, v.fim_visita)} min</td>
                <td className="p-2 text-xs text-slate-500 max-w-xs truncate">{v.observacoes || '-'}</td>
              </tr>
            ))}</tbody>
          </table>
          {filtradas.length > 200 && <p className="text-xs text-slate-500 mt-2">Exibindo 200 de {filtradas.length}. Exporte CSV para o detalhe completo.</p>}
        </CardContent>
      </Card>
    </div>
  );
}