import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CalendarDays, Loader2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { PAPEL_LABEL } from '@/lib/coberturaUtils';

const STATUS_CLS = {
  pendente: 'bg-slate-100 text-slate-700 border-slate-300',
  realizada: 'bg-green-100 text-green-800 border-green-300',
  nao_realizada: 'bg-red-100 text-red-800 border-red-300',
};
const STATUS_LABEL = { pendente: 'Pendente', realizada: 'Realizada', nao_realizada: 'Não realizada' };

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function AgendaMensal() {
  const [mes, setMes] = useState(mesAtual());
  const [papel, setPapel] = useState('vendedor');
  const [gerando, setGerando] = useState(false);

  const { data: agendas = [], isLoading, refetch } = useQuery({
    queryKey: ['agenda-mensal', mes, papel],
    queryFn: () => base44.entities.AgendaComercial.filter({ mes_referencia: mes, papel }, 'data_prevista', 5000),
  });

  const gerar = async () => {
    setGerando(true);
    try {
      const r = await base44.functions.invoke('gerarAgendaMensal', { mes_referencia: mes, papel, recriar: true });
      toast.success(`Agenda gerada — ${r.data?.agendas_criadas || 0} visitas para ${r.data?.clientes_carteira || 0} clientes`);
      refetch();
    } catch (e) {
      toast.error('Erro ao gerar agenda: ' + (e?.message || ''));
    } finally {
      setGerando(false);
    }
  };

  const resumo = useMemo(() => {
    const r = { pendente: 0, realizada: 0, nao_realizada: 0 };
    agendas.forEach((a) => { r[a.status_visita] = (r[a.status_visita] || 0) + 1; });
    return r;
  }, [agendas]);

  const meses = useMemo(() => {
    const arr = [];
    const d = new Date();
    for (let i = -2; i <= 3; i++) {
      const m = new Date(d.getFullYear(), d.getMonth() + i, 1);
      arr.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}-01`);
    }
    return arr;
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={mes} onValueChange={setMes}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            {meses.map((m) => (
              <SelectItem key={m} value={m}>{new Date(m + 'T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={papel} onValueChange={setPapel}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(PAPEL_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={gerar} disabled={gerando} className="gap-2">
          {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          Gerar/Recriar agenda
        </Button>
        <div className="ml-auto flex gap-2">
          <Badge variant="outline" className={STATUS_CLS.pendente}>Pendentes: {resumo.pendente}</Badge>
          <Badge variant="outline" className={STATUS_CLS.realizada}>Realizadas: {resumo.realizada}</Badge>
          <Badge variant="outline" className={STATUS_CLS.nao_realizada}>Não realizadas: {resumo.nao_realizada}</Badge>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left p-3">Data</th>
                <th className="text-left p-3">Cliente</th>
                <th className="text-left p-3">Região</th>
                <th className="text-left p-3">Responsável</th>
                <th className="text-left p-3">Finalidade</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
              ) : agendas.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-slate-400">
                  <CalendarDays className="w-6 h-6 inline mb-2" /><br />
                  Nenhuma agenda para este mês/papel. Clique em "Gerar/Recriar agenda".
                </td></tr>
              ) : agendas.slice(0, 800).map((a) => (
                <tr key={a.id} className="border-t hover:bg-slate-50">
                  <td className="p-3 whitespace-nowrap">{new Date(a.data_prevista + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                  <td className="p-3 font-medium text-slate-800">{a.cliente_nome}</td>
                  <td className="p-3 text-slate-500">{a.cliente_regiao || '—'}</td>
                  <td className="p-3 text-slate-600">{a.usuario_nome || '—'}</td>
                  <td className="p-3">{a.finalidade_visita === 'reposicao' ? 'Reposição' : 'Venda'}</td>
                  <td className="p-3"><Badge variant="outline" className={STATUS_CLS[a.status_visita]}>{STATUS_LABEL[a.status_visita]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}