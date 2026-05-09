import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import FiltrosBase from '@/components/analises/FiltrosBase';
import KpiCard from '@/components/analises/KpiCard';
import { dentroPeriodo, exportarCSV, formatarMoeda, formatarNumero } from '@/components/analises/utilsAnalises';
import { ArrowLeftRight, AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react';

export default function RelatorioTrocas() {
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

  const totais = useMemo(() => ({
    total: filtradas.length,
    valor: filtradas.reduce((a, t) => a + (t.valor_total || 0), 0),
    aprovadas: filtradas.filter(t => ['aprovado','finalizado'].includes(t.status)).length,
    abertas: filtradas.filter(t => ['aberto','em_analise'].includes(t.status)).length
  }), [filtradas]);

  const exportar = () => exportarCSV('relatorio_trocas',
    ['Data', 'Nº', 'Cliente', 'Vendedor', 'Tipo', 'Motivo', 'Valor', 'Status', 'Aprovado por', 'Origem'],
    filtradas.map(t => [t.data_troca, t.numero_troca, t.cliente_nome, t.vendedor_nome, t.tipo, t.motivo_descricao, t.valor_total, t.status, t.aprovado_por, t.origem])
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
        <KpiCard titulo="Trocas" valor={formatarNumero(totais.total)} icon={ArrowLeftRight} cor="red" />
        <KpiCard titulo="Valor total" valor={formatarMoeda(totais.valor)} icon={AlertTriangle} cor="amber" />
        <KpiCard titulo="Aprovadas" valor={formatarNumero(totais.aprovadas)} icon={CheckCircle2} cor="emerald" />
        <KpiCard titulo="Em análise" valor={formatarNumero(totais.abertas)} icon={ShieldCheck} cor="indigo" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Auditoria de trocas</CardTitle></CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0"><tr><th className="p-2 text-left">Data</th><th className="p-2 text-left">Nº</th><th className="p-2 text-left">Cliente</th><th className="p-2 text-left">Vendedor</th><th className="p-2 text-left">Tipo</th><th className="p-2 text-left">Motivo</th><th className="p-2 text-right">Valor</th><th className="p-2 text-left">Status</th><th className="p-2 text-left">Aprovador</th></tr></thead>
            <tbody>{filtradas.slice(0, 200).map(t => (
              <tr key={t.id} className="border-t hover:bg-slate-50">
                <td className="p-2">{t.data_troca || '-'}</td>
                <td className="p-2 font-mono">{t.numero_troca || '-'}</td>
                <td className="p-2">{t.cliente_nome || '-'}</td>
                <td className="p-2">{t.vendedor_nome || '-'}</td>
                <td className="p-2"><Badge variant="outline">{t.tipo}</Badge></td>
                <td className="p-2 text-xs text-slate-600">{t.motivo_descricao || '-'}</td>
                <td className="p-2 text-right">{formatarMoeda(t.valor_total)}</td>
                <td className="p-2"><Badge>{t.status}</Badge></td>
                <td className="p-2 text-xs">{t.aprovado_por || '-'}</td>
              </tr>
            ))}</tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}