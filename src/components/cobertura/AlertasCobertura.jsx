import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bell, Check, Eye, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const NIVEL = {
  atencao: { label: 'Atenção', cls: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  alerta: { label: 'Alerta', cls: 'bg-orange-100 text-orange-800 border-orange-300' },
  critico: { label: 'Crítico', cls: 'bg-red-100 text-red-800 border-red-300' },
};

export default function AlertasCobertura() {
  const [filtroNivel, setFiltroNivel] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('aberto');

  const { data: alertas = [], isLoading, refetch } = useQuery({
    queryKey: ['alertas-cobertura'],
    queryFn: () => base44.entities.Alerta.list('-criado_em', 2000),
  });

  const marcar = async (id, status) => {
    await base44.entities.Alerta.update(id, { status });
    toast.success(status === 'resolvido' ? 'Alerta resolvido' : 'Alerta marcado como visualizado');
    refetch();
  };

  const filtrados = useMemo(() => alertas
    .filter((a) => filtroNivel === 'todos' || a.nivel === filtroNivel)
    .filter((a) => filtroStatus === 'todos' || a.status === filtroStatus), [alertas, filtroNivel, filtroStatus]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={filtroNivel} onValueChange={setFiltroNivel}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os níveis</SelectItem>
            {Object.entries(NIVEL).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtroStatus} onValueChange={setFiltroStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="aberto">Aberto</SelectItem>
            <SelectItem value="visualizado">Visualizado</SelectItem>
            <SelectItem value="resolvido">Resolvido</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline" className="ml-auto gap-1"><Bell className="w-3 h-3" /> {filtrados.length} alertas</Badge>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
      ) : filtrados.length === 0 ? (
        <Card className="p-8 text-center text-slate-400">Nenhum alerta. 🎉</Card>
      ) : (
        <div className="space-y-2">
          {filtrados.map((a) => (
            <Card key={a.id} className="p-4 flex items-center gap-4">
              <Badge variant="outline" className={NIVEL[a.nivel]?.cls}>{NIVEL[a.nivel]?.label || a.nivel}</Badge>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-800 truncate">{a.mensagem || a.cliente_nome}</div>
                <div className="text-xs text-slate-500">
                  Responsável: {a.responsavel_nome || '—'} · Destinatário: {a.destinatario_nome || '—'} · {a.criado_em ? new Date(a.criado_em).toLocaleString('pt-BR') : ''}
                </div>
              </div>
              {a.status === 'aberto' && (
                <Button size="sm" variant="outline" onClick={() => marcar(a.id, 'visualizado')} className="gap-1"><Eye className="w-3 h-3" /> Visualizar</Button>
              )}
              {a.status !== 'resolvido' && (
                <Button size="sm" onClick={() => marcar(a.id, 'resolvido')} className="gap-1"><Check className="w-3 h-3" /> Resolver</Button>
              )}
              {a.status === 'resolvido' && <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Resolvido</Badge>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}