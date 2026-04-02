import React, { useState } from 'react';
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
import { MonitorSpeaker, Plus, Search, Eye } from 'lucide-react';
import { toast } from 'sonner';

const STATUS = {
  ativo: { label: 'Ativo', color: 'bg-green-100 text-green-800' },
  retirado: { label: 'Retirado', color: 'bg-slate-100 text-slate-700' },
  extraviado: { label: 'Extraviado', color: 'bg-red-100 text-red-800' },
  danificado: { label: 'Danificado', color: 'bg-orange-100 text-orange-800' },
  em_manutencao: { label: 'Em Manutenção', color: 'bg-yellow-100 text-yellow-800' },
};

const FORM_INIT = { numero_comodato: '', cliente_id: '', cliente_nome: '', vendedor_id: '', vendedor_nome: '', descricao_equipamento: '', numero_serie: '', quantidade: 1, data_entrega: new Date().toISOString().split('T')[0], condicao_entrega: 'novo', valor_equipamento: '', observacoes: '' };

export default function ControleComodatos() {
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('ativo');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [detalhe, setDetalhe] = useState(null);
  const qc = useQueryClient();

  const { data: comodatos = [], isLoading } = useQuery({
    queryKey: ['comodatos'],
    queryFn: () => base44.entities.Comodato.list('-data_entrega', 500)
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 3000)
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const criar = useMutation({
    mutationFn: (data) => base44.entities.Comodato.create(data),
    onSuccess: () => { qc.invalidateQueries(['comodatos']); setModal(false); setForm(FORM_INIT); toast.success('Comodato registrado!'); }
  });

  const atualizarStatus = useMutation({
    mutationFn: ({ id, status }) => base44.entities.Comodato.update(id, { status }),
    onSuccess: () => { qc.invalidateQueries(['comodatos']); toast.success('Status atualizado!'); }
  });

  const filtrados = comodatos.filter(c => {
    if (filtroStatus && c.status !== filtroStatus) return false;
    if (busca) {
      const t = busca.toLowerCase();
      return c.numero_comodato?.toLowerCase().includes(t) || c.cliente_nome?.toLowerCase().includes(t) || c.descricao_equipamento?.toLowerCase().includes(t) || c.numero_serie?.toLowerCase().includes(t);
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Controle de Comodatos" icon={MonitorSpeaker} subtitle="Equipamentos cedidos em comodato para clientes" />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {Object.entries(STATUS).map(([k, v]) => (
          <Card key={k} className={`border-0 shadow-sm cursor-pointer hover:shadow-md transition-shadow ${filtroStatus === k ? 'ring-2 ring-amber-400' : ''}`} onClick={() => setFiltroStatus(filtroStatus === k ? '' : k)}>
            <CardContent className="p-3 text-center">
              <div className="text-xl font-bold text-slate-700">{comodatos.filter(c => c.status === k).length}</div>
              <Badge className={`text-xs mt-1 ${v.color}`}>{v.label}</Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2 items-end">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="Buscar por cliente, equipamento, nº série..." className="pl-8 h-9" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <Select value={filtroStatus} onValueChange={v => setFiltroStatus(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos</SelectItem>
            {Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button className="btn-pao-mel h-9" onClick={() => setModal(true)}><Plus className="w-4 h-4 mr-1" />Novo Comodato</Button>
      </div>

      {isLoading ? <p className="text-center py-10 text-slate-500">Carregando...</p> : (
        <div className="space-y-2">
          {filtrados.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-slate-500">Nenhum comodato encontrado.</CardContent></Card>
          ) : filtrados.map(c => {
            const st = STATUS[c.status] || STATUS.ativo;
            return (
              <Card key={c.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <MonitorSpeaker className="w-4 h-4 text-purple-600" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-slate-800">{c.numero_comodato} — {c.descricao_equipamento || 'Equipamento'}</div>
                        <div className="text-xs text-slate-500">{c.cliente_nome} · {c.vendedor_nome}</div>
                        <div className="text-xs text-slate-400">
                          Entregue em: {c.data_entrega && new Date(c.data_entrega + 'T12:00:00').toLocaleDateString('pt-BR')}
                          {c.numero_serie && ` · S/N: ${c.numero_serie}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={`text-xs ${st.color}`}>{st.label}</Badge>
                      <Select value={c.status} onValueChange={v => atualizarStatus.mutate({ id: c.id, status: v })}>
                        <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDetalhe(c)}><Eye className="w-3 h-3 mr-1" />Ver</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={modal} onOpenChange={setModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Novo Comodato</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Número</Label><Input value={form.numero_comodato} onChange={e => setForm({ ...form, numero_comodato: e.target.value })} className="h-9" /></div>
              <div><Label className="text-xs">Data de Entrega</Label><Input type="date" value={form.data_entrega} onChange={e => setForm({ ...form, data_entrega: e.target.value })} className="h-9" /></div>
            </div>
            <div>
              <Label className="text-xs">Cliente</Label>
              <Select value={form.cliente_id || ''} onValueChange={v => { const c = clientes.find(x => x.id === v); setForm({ ...form, cliente_id: v, cliente_nome: c?.nome_fantasia || c?.razao_social || '' }); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{clientes.slice(0, 100).map(c => <SelectItem key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Descrição do Equipamento</Label>
              <Input value={form.descricao_equipamento} onChange={e => setForm({ ...form, descricao_equipamento: e.target.value })} className="h-9" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Nº de Série</Label><Input value={form.numero_serie} onChange={e => setForm({ ...form, numero_serie: e.target.value })} className="h-9" /></div>
              <div><Label className="text-xs">Qtd</Label><Input type="number" value={form.quantidade} onChange={e => setForm({ ...form, quantidade: Number(e.target.value) })} className="h-9" /></div>
              <div>
                <Label className="text-xs">Condição</Label>
                <Select value={form.condicao_entrega} onValueChange={v => setForm({ ...form, condicao_entrega: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="novo">Novo</SelectItem>
                    <SelectItem value="bom">Bom</SelectItem>
                    <SelectItem value="regular">Regular</SelectItem>
                    <SelectItem value="ruim">Ruim</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Vendedor Responsável</Label>
              <Select value={form.vendedor_id || ''} onValueChange={v => { const ve = vendedores.find(x => x.id === v); setForm({ ...form, vendedor_id: v, vendedor_nome: ve?.nome || '' }); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>{vendedores.filter(v => v.status === 'ativo').map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs">Observações</Label><Textarea value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} rows={2} /></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setModal(false)}>Cancelar</Button>
              <Button className="btn-pao-mel" onClick={() => criar.mutate(form)} disabled={!form.numero_comodato || !form.cliente_id}>Registrar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detalhe} onOpenChange={() => setDetalhe(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Comodato {detalhe?.numero_comodato}</DialogTitle></DialogHeader>
          {detalhe && (
            <div className="space-y-2 mt-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-slate-500">Cliente:</span> <span className="font-medium">{detalhe.cliente_nome}</span></div>
                <div><span className="text-slate-500">Vendedor:</span> <span className="font-medium">{detalhe.vendedor_nome}</span></div>
                <div><span className="text-slate-500">Equipamento:</span> <span className="font-medium">{detalhe.descricao_equipamento}</span></div>
                <div><span className="text-slate-500">Nº Série:</span> <span className="font-medium">{detalhe.numero_serie || '-'}</span></div>
                <div><span className="text-slate-500">Entregue em:</span> <span className="font-medium">{detalhe.data_entrega && new Date(detalhe.data_entrega + 'T12:00:00').toLocaleDateString('pt-BR')}</span></div>
                <div><span className="text-slate-500">Condição:</span> <span className="font-medium capitalize">{detalhe.condicao_entrega}</span></div>
              </div>
              {detalhe.observacoes && <p className="text-xs text-slate-500 bg-slate-50 p-2 rounded">{detalhe.observacoes}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}