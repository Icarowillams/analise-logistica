import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import FiltrosBase from '@/components/analises/FiltrosBase';
import KpiCard from '@/components/analises/KpiCard';
import { exportarCSV, formatarMoeda, formatarNumero } from '@/components/analises/utilsAnalises';
import { Users, Award, Activity, Target } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function RotinaSupervisores() {
  const [filtros, setFiltros] = useState({ inicio: '', fim: '', vendedor_id: '', supervisor_id: '' });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: visitas = [] } = useQuery({ queryKey: ['visitasRoteiro'], queryFn: () => base44.entities.VisitaRoteiro.list('-updated_date', 10000) });
  const { data: pedidos = [] } = useQuery({ queryKey: ['pedidos'], queryFn: () => base44.entities.Pedido.list('-created_date', 10000) });
  const { data: trocas = [] } = useQuery({ queryKey: ['pedidosTroca'], queryFn: () => base44.entities.PedidoTroca.list('-data_troca', 5000) });
  const { data: roteiros = [] } = useQuery({ queryKey: ['roteiros'], queryFn: () => base44.entities.Roteiro.list('-updated_date', 5000) });

  const supervisores = vendedores.filter(v => v.papeis?.includes('supervisor') || vendedores.some(x => x.supervisor_id === v.id));

  const equipes = useMemo(() => supervisores.map(sup => {
    const equipe = vendedores.filter(v => v.supervisor_id === sup.id || v.supervisor_ids?.includes(sup.id));
    const ids = equipe.map(v => v.id);
    const visitasEquipe = visitas.filter(v => ids.includes(v.vendedor_id) && v.status === 'visitado').length;
    const pedidosEquipe = pedidos.filter(p => ids.includes(p.vendedor_id));
    const valorEquipe = pedidosEquipe.reduce((a, p) => a + (p.valor_total || 0), 0);
    const trocasEquipe = trocas.filter(t => ids.includes(t.vendedor_id)).length;
    const roteirosValidados = roteiros.filter(r => ids.includes(r.vendedor_id) && r.feedback_supervisor).length;
    return { supervisor: sup.nome, supervisor_id: sup.id, equipe: equipe.length, visitas: visitasEquipe, pedidos: pedidosEquipe.length, valor: valorEquipe, trocas: trocasEquipe, validados: roteirosValidados };
  }).filter(e => !filtros.supervisor_id || e.supervisor_id === filtros.supervisor_id), [supervisores, vendedores, visitas, pedidos, trocas, roteiros, filtros]);

  const totais = useMemo(() => ({
    supervisores: equipes.length,
    vendedores: equipes.reduce((a, e) => a + e.equipe, 0),
    valor: equipes.reduce((a, e) => a + e.valor, 0),
    visitas: equipes.reduce((a, e) => a + e.visitas, 0)
  }), [equipes]);

  const exportar = () => exportarCSV('rotina_supervisores',
    ['Supervisor', 'Equipe', 'Visitas', 'Pedidos', 'Valor', 'Trocas', 'Roteiros validados'],
    equipes.map(e => [e.supervisor, e.equipe, e.visitas, e.pedidos, e.valor, e.trocas, e.validados])
  );

  return (
    <div className="space-y-4">
      <FiltrosBase filtros={filtros} setFiltros={setFiltros} vendedores={vendedores} onLimpar={() => setFiltros({ inicio: '', fim: '', vendedor_id: '', supervisor_id: '' })} onExportar={exportar}>
        <div>
          <Label className="text-xs">Supervisor</Label>
          <Select value={filtros.supervisor_id || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, supervisor_id: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos</SelectItem>
              {supervisores.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </FiltrosBase>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard titulo="Supervisores" valor={formatarNumero(totais.supervisores)} icon={Users} cor="cyan" />
        <KpiCard titulo="Vendedores na equipe" valor={formatarNumero(totais.vendedores)} icon={Award} cor="indigo" />
        <KpiCard titulo="Visitas realizadas" valor={formatarNumero(totais.visitas)} icon={Activity} cor="emerald" />
        <KpiCard titulo="Faturamento equipe" valor={formatarMoeda(totais.valor)} icon={Target} cor="amber" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Desempenho por supervisor</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={equipes}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="supervisor" angle={-15} textAnchor="end" height={70} /><YAxis yAxisId="left" /><YAxis yAxisId="right" orientation="right" /><Tooltip formatter={(v, n) => n === 'valor' ? formatarMoeda(v) : v} /><Legend /><Bar yAxisId="left" dataKey="visitas" fill="#16a34a" name="Visitas" /><Bar yAxisId="left" dataKey="pedidos" fill="#0891b2" name="Pedidos" /><Bar yAxisId="right" dataKey="valor" fill="#f59e0b" name="Faturamento" /></BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Avaliação de liderança</CardTitle></CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="p-2 text-left">Supervisor</th><th className="p-2 text-right">Equipe</th><th className="p-2 text-right">Visitas</th><th className="p-2 text-right">Pedidos</th><th className="p-2 text-right">Faturamento</th><th className="p-2 text-right">Trocas</th><th className="p-2 text-right">Roteiros validados</th></tr></thead>
            <tbody>{equipes.map(e => (
              <tr key={e.supervisor_id} className="border-t hover:bg-slate-50">
                <td className="p-2 font-medium">{e.supervisor}</td>
                <td className="p-2 text-right">{e.equipe}</td>
                <td className="p-2 text-right">{e.visitas}</td>
                <td className="p-2 text-right">{e.pedidos}</td>
                <td className="p-2 text-right">{formatarMoeda(e.valor)}</td>
                <td className="p-2 text-right">{e.trocas}</td>
                <td className="p-2 text-right"><Badge variant="outline">{e.validados}</Badge></td>
              </tr>
            ))}</tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}