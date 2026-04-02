import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { MapPin, Search, CheckCircle, Clock, AlertCircle, Package, Eye } from 'lucide-react';
import { toast } from 'sonner';

const STATUS = {
  pendente: { label: 'Pendente', color: 'bg-slate-100 text-slate-700', icon: Clock },
  entregue: { label: 'Entregue', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  parcial: { label: 'Parcial', color: 'bg-yellow-100 text-yellow-700', icon: AlertCircle },
  nao_entregue: { label: 'Não Entregue', color: 'bg-red-100 text-red-700', icon: AlertCircle },
  reagendado: { label: 'Reagendado', color: 'bg-blue-100 text-blue-700', icon: Clock },
};

export default function ControleEntregas() {
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroData, setFiltroData] = useState(new Date().toISOString().split('T')[0]);
  const [detalhe, setDetalhe] = useState(null);
  const [motivo, setMotivo] = useState('');
  const qc = useQueryClient();

  const { data: entregas = [], isLoading } = useQuery({
    queryKey: ['entregasRota', filtroData],
    queryFn: () => filtroData
      ? base44.entities.EntregaRota.filter({ data_entrega: filtroData })
      : base44.entities.EntregaRota.list('-data_entrega', 500)
  });

  const { data: cargas = [] } = useQuery({
    queryKey: ['cargas'],
    queryFn: () => base44.entities.Carga.list('-data_montagem', 100)
  });

  const atualizarStatus = useMutation({
    mutationFn: ({ id, status, motivo_nao_entrega, assinatura_recebedor }) =>
      base44.entities.EntregaRota.update(id, {
        status,
        motivo_nao_entrega,
        assinatura_recebedor,
        hora_entrega: new Date().toTimeString().slice(0, 5)
      }),
    onSuccess: () => { qc.invalidateQueries(['entregasRota']); setDetalhe(null); toast.success('Status atualizado!'); }
  });

  const filtradas = useMemo(() => entregas.filter(e => {
    if (filtroStatus && e.status !== filtroStatus) return false;
    if (busca) {
      const t = busca.toLowerCase();
      return e.cliente_nome?.toLowerCase().includes(t) || e.carga_numero?.toLowerCase().includes(t) || e.pedido_venda_numero?.toLowerCase().includes(t);
    }
    return true;
  }), [entregas, filtroStatus, busca]);

  const stats = useMemo(() => ({
    total: entregas.length,
    entregue: entregas.filter(e => e.status === 'entregue').length,
    pendente: entregas.filter(e => e.status === 'pendente').length,
    problema: entregas.filter(e => ['nao_entregue', 'parcial'].includes(e.status)).length,
  }), [entregas]);

  return (
    <div className="space-y-4">
      <PageHeader title="Controle de Entregas" icon={MapPin} subtitle="Acompanhamento em tempo real das entregas" />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, color: 'text-slate-700' },
          { label: 'Entregues', value: stats.entregue, color: 'text-green-600' },
          { label: 'Pendentes', value: stats.pendente, color: 'text-slate-500' },
          { label: 'Com Problema', value: stats.problema, color: 'text-red-600' },
        ].map(s => (
          <Card key={s.label} className="border-0 shadow-sm">
            <CardContent className="p-3 text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2 items-end">
        <div>
          <Label className="text-xs">Data</Label>
          <Input type="date" value={filtroData} onChange={e => setFiltroData(e.target.value)} className="h-9 w-40" />
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="Buscar cliente, carga, pedido..." className="pl-8 h-9" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <Select value={filtroStatus} onValueChange={v => setFiltroStatus(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos</SelectItem>
            {Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? <p className="text-center py-10 text-slate-500">Carregando...</p> : (
        <div className="space-y-2">
          {filtradas.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-slate-500">Nenhuma entrega encontrada para os filtros selecionados.</CardContent></Card>
          ) : filtradas.map(e => {
            const st = STATUS[e.status] || STATUS.pendente;
            const Icon = st.icon;
            return (
              <Card key={e.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-teal-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Icon className={`w-4 h-4 ${e.status === 'entregue' ? 'text-green-600' : e.status === 'nao_entregue' ? 'text-red-500' : 'text-teal-600'}`} />
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-slate-800">{e.cliente_nome}</div>
                        <div className="text-xs text-slate-500">
                          Carga: {e.carga_numero || '-'} {e.pedido_venda_numero && `· Pedido: ${e.pedido_venda_numero}`}
                        </div>
                        {e.hora_entrega && <div className="text-xs text-slate-400">Horário: {e.hora_entrega}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {e.valor_entregue > 0 && <span className="text-sm font-semibold text-slate-700">R$ {e.valor_entregue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                      <Badge className={`text-xs ${st.color}`}>{st.label}</Badge>
                      <Select value={e.status} onValueChange={v => atualizarStatus.mutate({ id: e.id, status: v })}>
                        <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDetalhe(e)}><Eye className="w-3 h-3 mr-1" />Ver</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!detalhe} onOpenChange={() => setDetalhe(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Entrega — {detalhe?.cliente_nome}</DialogTitle></DialogHeader>
          {detalhe && (
            <div className="space-y-3 mt-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-slate-500">Carga:</span> <span className="font-medium">{detalhe.carga_numero || '-'}</span></div>
                <div><span className="text-slate-500">Pedido:</span> <span className="font-medium">{detalhe.pedido_venda_numero || '-'}</span></div>
                <div><span className="text-slate-500">Valor:</span> <span className="font-medium">R$ {(detalhe.valor_entregue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
                <div><span className="text-slate-500">Volumes:</span> <span className="font-medium">{detalhe.volumes_entregues || 0}</span></div>
                {detalhe.assinatura_recebedor && <div className="col-span-2"><span className="text-slate-500">Recebedor:</span> <span className="font-medium">{detalhe.assinatura_recebedor}</span></div>}
              </div>
              {detalhe.motivo_nao_entrega && <div className="p-2 bg-red-50 rounded text-xs text-red-700"><strong>Motivo não entrega:</strong> {detalhe.motivo_nao_entrega}</div>}
              {detalhe.observacoes && <div className="p-2 bg-slate-50 rounded text-xs text-slate-600">{detalhe.observacoes}</div>}
              {detalhe.status === 'pendente' && (
                <div className="space-y-2 pt-2 border-t">
                  <Label className="text-xs">Nome de quem recebeu</Label>
                  <Input placeholder="Nome do recebedor" className="h-8" onChange={e => setMotivo(e.target.value)} />
                  <div className="flex gap-2">
                    <Button className="flex-1 h-8 bg-green-600 hover:bg-green-700 text-white text-xs" onClick={() => atualizarStatus.mutate({ id: detalhe.id, status: 'entregue', assinatura_recebedor: motivo })}>
                      <CheckCircle className="w-3 h-3 mr-1" />Confirmar Entrega
                    </Button>
                    <Button className="flex-1 h-8 bg-red-600 hover:bg-red-700 text-white text-xs" onClick={() => atualizarStatus.mutate({ id: detalhe.id, status: 'nao_entregue', motivo_nao_entrega: motivo })}>
                      <AlertCircle className="w-3 h-3 mr-1" />Não Entregue
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}