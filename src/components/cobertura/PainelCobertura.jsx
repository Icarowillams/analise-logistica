import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PAPEL_LABEL, STATUS_COBERTURA } from '@/lib/coberturaUtils';
import StatusBadge from './StatusBadge';

const STATUS_ORDER = { critico: 0, atrasado: 1, atencao: 2, em_dia: 3 };

export default function PainelCobertura() {
  const [busca, setBusca] = useState('');
  const [filtroPapel, setFiltroPapel] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [recalculando, setRecalculando] = useState(false);

  const { data: coberturas = [], isLoading, refetch } = useQuery({
    queryKey: ['cobertura-status'],
    queryFn: () => base44.entities.CoberturaStatus.list('-falhas_consecutivas', 5000),
  });

  const recalcular = async () => {
    setRecalculando(true);
    try {
      const r = await base44.functions.invoke('recalcularCobertura', {});
      toast.success(`Cobertura recalculada — ${r.data?.coberturas_atualizadas || 0} clientes, ${r.data?.alertas_criados || 0} novos alertas`);
      refetch();
    } catch (e) {
      toast.error('Erro ao recalcular: ' + (e?.message || ''));
    } finally {
      setRecalculando(false);
    }
  };

  const resumo = useMemo(() => {
    const r = { em_dia: 0, atencao: 0, atrasado: 0, critico: 0 };
    coberturas.forEach((c) => { r[c.status_cobertura] = (r[c.status_cobertura] || 0) + 1; });
    return r;
  }, [coberturas]);

  const filtradas = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return coberturas
      .filter((c) => filtroPapel === 'todos' || c.papel === filtroPapel)
      .filter((c) => filtroStatus === 'todos' || c.status_cobertura === filtroStatus)
      .filter((c) => !b || (c.cliente_nome || '').toLowerCase().includes(b) || (c.responsavel_nome || '').toLowerCase().includes(b))
      .sort((a, b2) => (STATUS_ORDER[a.status_cobertura] - STATUS_ORDER[b2.status_cobertura]) || (b2.falhas_consecutivas - a.falhas_consecutivas));
  }, [coberturas, busca, filtroPapel, filtroStatus]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(STATUS_COBERTURA).map(([k, cfg]) => (
          <Card key={k} className="p-4">
            <div className="text-xs text-slate-500">{cfg.label}</div>
            <div className="text-2xl font-bold text-slate-800">{resumo[k] || 0}</div>
            <div className="text-[11px] text-slate-400">{cfg.falhas}</div>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Buscar cliente ou responsável..." value={busca} onChange={(e) => setBusca(e.target.value)} className="max-w-xs" />
        <Select value={filtroPapel} onValueChange={setFiltroPapel}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os papéis</SelectItem>
            {Object.entries(PAPEL_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtroStatus} onValueChange={setFiltroStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            {Object.entries(STATUS_COBERTURA).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={recalcular} disabled={recalculando} className="ml-auto gap-2">
          {recalculando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Recalcular cobertura
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left p-3">Cliente</th>
                <th className="text-left p-3">Papel</th>
                <th className="text-left p-3">Responsável</th>
                <th className="text-center p-3">Falhas</th>
                <th className="text-left p-3">Última visita</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
              ) : filtradas.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-400">Nenhum dado de cobertura. Gere a agenda mensal e clique em "Recalcular cobertura".</td></tr>
              ) : filtradas.slice(0, 500).map((c) => (
                <tr key={c.id} className="border-t hover:bg-slate-50">
                  <td className="p-3 font-medium text-slate-800">{c.cliente_nome || '—'}</td>
                  <td className="p-3">{PAPEL_LABEL[c.papel] || c.papel}</td>
                  <td className="p-3 text-slate-600">{c.responsavel_nome || '—'}</td>
                  <td className="p-3 text-center font-semibold">{c.falhas_consecutivas}</td>
                  <td className="p-3 text-slate-500">{c.ultima_visita_em || '—'}</td>
                  <td className="p-3"><StatusBadge status={c.status_cobertura} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}