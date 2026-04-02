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
import { AlertTriangle, Plus, Search, Eye, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

const TIPOS = {
  avaria: 'Avaria',
  furto: 'Furto',
  acidente: 'Acidente',
  atraso: 'Atraso',
  reclamacao_cliente: 'Reclamação Cliente',
  erro_carga: 'Erro de Carga',
  desvio_rota: 'Desvio de Rota',
  veiculo: 'Problema Veículo',
  outro: 'Outro',
};

const GRAVIDADE = {
  baixa: { label: 'Baixa', color: 'bg-green-100 text-green-700' },
  media: { label: 'Média', color: 'bg-yellow-100 text-yellow-700' },
  alta: { label: 'Alta', color: 'bg-orange-100 text-orange-700' },
  critica: { label: 'Crítica', color: 'bg-red-100 text-red-800' },
};

const STATUS = {
  aberta: { label: 'Aberta', color: 'bg-red-100 text-red-700' },
  em_analise: { label: 'Em Análise', color: 'bg-blue-100 text-blue-700' },
  resolvida: { label: 'Resolvida', color: 'bg-green-100 text-green-700' },
  encerrada: { label: 'Encerrada', color: 'bg-slate-100 text-slate-600' },
};

const FORM_INIT = { numero_ocorrencia: '', data_ocorrencia: new Date().toISOString().split('T')[0], tipo: 'avaria', gravidade: 'media', status: 'aberta', motorista_nome: '', cliente_nome: '', descricao: '', acao_tomada: '' };

export default function OcorrenciasOperacionais() {
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroGravidade, setFiltroGravidade] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(FORM_INIT);
  const [detalhe, setDetalhe] = useState(null);
  const qc = useQueryClient();

  const { data: ocorrencias = [], isLoading } = useQuery({
    queryKey: ['ocorrenciasOp'],
    queryFn: () => base44.entities.OcorrenciaOperacional.list('-data_ocorrencia', 500)
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const criar = useMutation({
    mutationFn: (data) => base44.entities.OcorrenciaOperacional.create(data),
    onSuccess: () => { qc.invalidateQueries(['ocorrenciasOp']); setModal(false); setForm(FORM_INIT); toast.success('Ocorrência registrada!'); }
  });

  const resolver = useMutation({
    mutationFn: ({ id, acao }) => base44.entities.OcorrenciaOperacional.update(id, { status: 'resolvida', acao_tomada: acao, data_resolucao: new Date().toISOString().split('T')[0] }),
    onSuccess: () => { qc.invalidateQueries(['ocorrenciasOp']); setDetalhe(null); toast.success('Ocorrência resolvida!'); }
  });

  const filtradas = ocorrencias.filter(o => {
    if (filtroStatus && o.status !== filtroStatus) return false;
    if (filtroGravidade && o.gravidade !== filtroGravidade) return false;
    if (busca) {
      const t = busca.toLowerCase();
      return o.numero_ocorrencia?.toLowerCase().includes(t) || o.descricao?.toLowerCase().includes(t) || o.motorista_nome?.toLowerCase().includes(t) || o.cliente_nome?.toLowerCase().includes(t);
    }
    return true;
  });

  const abertas = ocorrencias.filter(o => o.status === 'aberta').length;
  const criticas = ocorrencias.filter(o => o.gravidade === 'critica' && o.status !== 'encerrada').length;

  return (
    <div className="space-y-4">
      <PageHeader title="Ocorrências Operacionais" icon={AlertTriangle} subtitle="Registro e controle de ocorrências na operação logística" />

      {(abertas > 0 || criticas > 0) && (
        <div className="flex gap-3">
          {abertas > 0 && <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm"><AlertTriangle className="w-4 h-4 text-red-500" /><span className="text-red-700 font-medium">{abertas} ocorrência(s) em aberto</span></div>}
          {criticas > 0 && <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-sm"><AlertTriangle className="w-4 h-4 text-orange-500" /><span className="text-orange-700 font-medium">{criticas} crítica(s) não encerrada(s)</span></div>}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 items-end">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="Buscar ocorrência, motorista, cliente..." className="pl-8 h-9" value={busca} onChange={e => setBusca(e.target.value)} />
        </div>
        <Select value={filtroStatus} onValueChange={v => setFiltroStatus(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos</SelectItem>
            {Object.entries(STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtroGravidade} onValueChange={v => setFiltroGravidade(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-36"><SelectValue placeholder="Gravidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas</SelectItem>
            {Object.entries(GRAVIDADE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button className="btn-pao-mel h-9" onClick={() => setModal(true)}><Plus className="w-4 h-4 mr-1" />Registrar</Button>
      </div>

      {isLoading ? <p className="text-center py-10 text-slate-500">Carregando...</p> : (
        <div className="space-y-2">
          {filtradas.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-slate-500">Nenhuma ocorrência encontrada.</CardContent></Card>
          ) : filtradas.map(o => {
            const st = STATUS[o.status] || STATUS.aberta;
            const grav = GRAVIDADE[o.gravidade] || GRAVIDADE.media;
            return (
              <Card key={o.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${o.gravidade === 'critica' ? 'bg-red-100' : 'bg-orange-50'}`}>
                        <AlertTriangle className={`w-4 h-4 ${o.gravidade === 'critica' ? 'text-red-600' : 'text-orange-500'}`} />
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-slate-800">{o.numero_ocorrencia} — {TIPOS[o.tipo] || o.tipo}</div>
                        <div className="text-xs text-slate-500">{o.motorista_nome || o.cliente_nome || '-'} · {o.data_ocorrencia && new Date(o.data_ocorrencia + 'T12:00:00').toLocaleDateString('pt-BR')}</div>
                        <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{o.descricao}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={`text-xs ${grav.color}`}>{grav.label}</Badge>
                      <Badge className={`text-xs ${st.color}`}>{st.label}</Badge>
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setDetalhe(o)}><Eye className="w-3 h-3 mr-1" />Ver</Button>
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
          <DialogHeader><DialogTitle>Registrar Ocorrência</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-3 gap-3">
              <div><Label className="text-xs">Número</Label><Input value={form.numero_ocorrencia} onChange={e => setForm({ ...form, numero_ocorrencia: e.target.value })} className="h-9" /></div>
              <div><Label className="text-xs">Data</Label><Input type="date" value={form.data_ocorrencia} onChange={e => setForm({ ...form, data_ocorrencia: e.target.value })} className="h-9" /></div>
              <div>
                <Label className="text-xs">Gravidade</Label>
                <Select value={form.gravidade} onValueChange={v => setForm({ ...form, gravidade: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(GRAVIDADE).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Tipo</Label>
                <Select value={form.tipo} onValueChange={v => setForm({ ...form, tipo: v })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TIPOS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Motorista</Label>
                <Select value={form.motorista_id || ''} onValueChange={v => { const ve = vendedores.find(x => x.id === v); setForm({ ...form, motorista_id: v, motorista_nome: ve?.nome || '' }); }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>{vendedores.filter(v => v.status === 'ativo').map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label className="text-xs">Descrição da Ocorrência</Label><Textarea value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} rows={3} /></div>
            <div><Label className="text-xs">Ação Tomada</Label><Textarea value={form.acao_tomada} onChange={e => setForm({ ...form, acao_tomada: e.target.value })} rows={2} /></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setModal(false)}>Cancelar</Button>
              <Button className="btn-pao-mel" onClick={() => criar.mutate(form)} disabled={!form.numero_ocorrencia || !form.descricao}>Registrar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detalhe} onOpenChange={() => setDetalhe(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Ocorrência {detalhe?.numero_ocorrencia}</DialogTitle></DialogHeader>
          {detalhe && (
            <div className="space-y-3 mt-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-slate-500">Tipo:</span> <span className="font-medium">{TIPOS[detalhe.tipo]}</span></div>
                <div><span className="text-slate-500">Data:</span> <span className="font-medium">{detalhe.data_ocorrencia && new Date(detalhe.data_ocorrencia + 'T12:00:00').toLocaleDateString('pt-BR')}</span></div>
                <div><span className="text-slate-500">Motorista:</span> <span className="font-medium">{detalhe.motorista_nome || '-'}</span></div>
                <div><span className="text-slate-500">Cliente:</span> <span className="font-medium">{detalhe.cliente_nome || '-'}</span></div>
              </div>
              <div className="p-3 bg-slate-50 rounded"><p className="text-xs font-medium text-slate-600 mb-1">Descrição:</p><p className="text-xs text-slate-700">{detalhe.descricao}</p></div>
              {detalhe.acao_tomada && <div className="p-3 bg-green-50 rounded"><p className="text-xs font-medium text-green-700 mb-1">Ação Tomada:</p><p className="text-xs text-slate-700">{detalhe.acao_tomada}</p></div>}
              {(detalhe.status === 'aberta' || detalhe.status === 'em_analise') && (
                <Button className="w-full h-9 bg-green-600 hover:bg-green-700 text-white" onClick={() => resolver.mutate({ id: detalhe.id, acao: detalhe.acao_tomada })}>
                  <CheckCircle className="w-4 h-4 mr-2" />Marcar como Resolvida
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}