import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import FiltrosBase from '@/components/analises/FiltrosBase';
import KpiCard from '@/components/analises/KpiCard';
import { exportarCSV, formatarNumero } from '@/components/analises/utilsAnalises';
import { ClipboardList, CheckCircle2, AlertCircle, Route as RouteIcon } from 'lucide-react';

export default function RelatorioRoteiros() {
  const [filtros, setFiltros] = useState({ inicio: '', fim: '', vendedor_id: '', dia: '', status: '' });
  const [selecionado, setSelecionado] = useState(null);
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: roteiros = [] } = useQuery({ queryKey: ['roteiros'], queryFn: () => base44.entities.Roteiro.list('-updated_date', 5000) });
  const { data: visitas = [] } = useQuery({ queryKey: ['visitasRoteiro'], queryFn: () => base44.entities.VisitaRoteiro.list('-updated_date', 10000) });

  const filtrados = useMemo(() => roteiros.filter(r => {
    if (filtros.vendedor_id && r.vendedor_id !== filtros.vendedor_id) return false;
    if (filtros.dia && r.dia_semana !== filtros.dia) return false;
    if (filtros.status && r.status !== filtros.status) return false;
    return true;
  }), [roteiros, filtros]);

  const linhas = useMemo(() => filtrados.map(r => {
    const planejados = r.clientes_ids?.length || r.clientes_detalhes?.length || 0;
    const visitasR = visitas.filter(v => v.roteiro_id === r.id);
    const realizadas = visitasR.filter(v => v.status === 'visitado').length;
    const naoVisitadas = visitasR.filter(v => v.status === 'nao_visitado').length;
    const desvio = planejados - realizadas;
    return { ...r, planejados, realizadas, naoVisitadas, desvio, visitasR };
  }), [filtrados, visitas]);

  const totais = useMemo(() => ({
    total: linhas.length,
    ativos: linhas.filter(l => l.status === 'ativo').length,
    concluidos: linhas.filter(l => l.status === 'concluido').length,
    desvios: linhas.filter(l => l.desvio > 0 && l.status === 'concluido').length
  }), [linhas]);

  const exportar = () => exportarCSV('relatorio_roteiros',
    ['Vendedor', 'Dia', 'Status', 'Planejados', 'Realizadas', 'Não realizadas', 'Desvio'],
    linhas.map(l => [l.vendedor_nome, l.dia_semana, l.status, l.planejados, l.realizadas, l.naoVisitadas, l.desvio])
  );

  return (
    <div className="space-y-4">
      <FiltrosBase filtros={filtros} setFiltros={setFiltros} vendedores={vendedores} onLimpar={() => setFiltros({ inicio: '', fim: '', vendedor_id: '', dia: '', status: '' })} onExportar={exportar}>
        <div>
          <Label className="text-xs">Dia da semana</Label>
          <Select value={filtros.dia || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, dia: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos</SelectItem>
              {['segunda-feira','terca-feira','quarta-feira','quinta-feira','sexta-feira','sabado','domingo'].map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <Select value={filtros.status || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, status: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos</SelectItem>
              <SelectItem value="planejado">Planejado</SelectItem>
              <SelectItem value="ativo">Ativo</SelectItem>
              <SelectItem value="pausado">Pausado</SelectItem>
              <SelectItem value="concluido">Concluído</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FiltrosBase>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard titulo="Total roteiros" valor={formatarNumero(totais.total)} icon={ClipboardList} cor="cyan" />
        <KpiCard titulo="Ativos" valor={formatarNumero(totais.ativos)} icon={RouteIcon} cor="emerald" />
        <KpiCard titulo="Concluídos" valor={formatarNumero(totais.concluidos)} icon={CheckCircle2} cor="indigo" />
        <KpiCard titulo="Com desvio" valor={formatarNumero(totais.desvios)} icon={AlertCircle} cor="red" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Roteiros</CardTitle></CardHeader>
          <CardContent className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><th className="p-2 text-left">Vendedor</th><th className="p-2 text-left">Dia</th><th className="p-2 text-left">Status</th><th className="p-2 text-right">Plan.</th><th className="p-2 text-right">Real.</th><th className="p-2 text-right">Desvio</th></tr></thead>
              <tbody>{linhas.map(l => (
                <tr key={l.id} onClick={() => setSelecionado(l)} className={`border-t hover:bg-amber-50 cursor-pointer ${selecionado?.id === l.id ? 'bg-amber-50' : ''}`}>
                  <td className="p-2">{l.vendedor_nome || '-'}</td>
                  <td className="p-2">{l.dia_semana}</td>
                  <td className="p-2"><Badge variant="outline">{l.status}</Badge></td>
                  <td className="p-2 text-right">{l.planejados}</td>
                  <td className="p-2 text-right">{l.realizadas}</td>
                  <td className={`p-2 text-right font-semibold ${l.desvio > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{l.desvio}</td>
                </tr>
              ))}</tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Detalhe do roteiro</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!selecionado ? <p className="text-slate-400 text-center py-8">Selecione um roteiro</p> : (
              <>
                <div className="rounded-lg bg-slate-50 p-3"><p className="font-semibold">{selecionado.vendedor_nome}</p><p className="text-xs text-slate-500">{selecionado.dia_semana} • {selecionado.status}</p></div>
                {(selecionado.clientes_detalhes || []).sort((a, b) => (a.ordem||0)-(b.ordem||0)).map((c, i) => {
                  const v = selecionado.visitasR.find(x => x.cliente_id === c.cliente_id);
                  return (
                    <div key={i} className="flex justify-between items-center border-b pb-1">
                      <span className="text-xs">{i+1}. {c.cliente_nome}</span>
                      <Badge variant="outline" className="text-[10px]">{v?.status || 'planejada'}</Badge>
                    </div>
                  );
                })}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}