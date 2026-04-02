import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Truck, Package, Eye, Edit, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

const STATUS_LABELS = {
  montando: { label: 'Montando', color: 'bg-yellow-100 text-yellow-800' },
  aguardando_saida: { label: 'Aguardando Saída', color: 'bg-blue-100 text-blue-800' },
  em_rota: { label: 'Em Rota', color: 'bg-orange-100 text-orange-800' },
  finalizada: { label: 'Finalizada', color: 'bg-green-100 text-green-800' },
  cancelada: { label: 'Cancelada', color: 'bg-red-100 text-red-800' },
};

export default function MontagemCargas() {
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState({ numero_carga: '', data_montagem: '', rota_nome: '', veiculo: '', motorista_nome: '', ajudante_nome: '', observacoes: '' });
  const qc = useQueryClient();

  const { data: cargas = [], isLoading } = useQuery({
    queryKey: ['cargas'],
    queryFn: () => base44.entities.Carga.list('-data_montagem', 200)
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: rotas = [] } = useQuery({
    queryKey: ['rotas'],
    queryFn: () => base44.entities.Rota.list()
  });

  const criarCarga = useMutation({
    mutationFn: (data) => base44.entities.Carga.create(data),
    onSuccess: () => { qc.invalidateQueries(['cargas']); setModalAberto(false); setForm({ numero_carga: '', data_montagem: '', rota_nome: '', veiculo: '', motorista_nome: '', ajudante_nome: '', observacoes: '' }); toast.success('Carga criada!'); }
  });

  const atualizarStatus = useMutation({
    mutationFn: ({ id, status }) => base44.entities.Carga.update(id, { status }),
    onSuccess: () => { qc.invalidateQueries(['cargas']); toast.success('Status atualizado!'); }
  });

  const cargasFiltradas = cargas.filter(c => {
    if (filtroStatus && c.status !== filtroStatus) return false;
    if (busca) {
      const t = busca.toLowerCase();
      return c.numero_carga?.toLowerCase().includes(t) || c.motorista_nome?.toLowerCase().includes(t) || c.rota_nome?.toLowerCase().includes(t) || c.veiculo?.toLowerCase().includes(t);
    }
    return true;
  });

  const proximoNumero = () => {
    const hoje = new Date();
    const prefixo = `C${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, '0')}${String(hoje.getDate()).padStart(2, '0')}`;
    const hoje_cargas = cargas.filter(c => c.numero_carga?.startsWith(prefixo));
    return `${prefixo}${String(hoje_cargas.length + 1).padStart(3, '0')}`;
  };

  const abrirModal = () => {
    setForm({ numero_carga: proximoNumero(), data_montagem: new Date().toISOString().split('T')[0], rota_nome: '', veiculo: '', motorista_nome: '', ajudante_nome: '', observacoes: '' });
    setModalAberto(true);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Montagem de Cargas" icon={Truck} subtitle="Crie e gerencie as cargas para expedição" />

      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-2 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Buscar carga, motorista, rota..." className="pl-8 h-9" value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
          <Select value={filtroStatus} onValueChange={v => setFiltroStatus(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-9 w-48">
              <SelectValue placeholder="Todos os status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button className="btn-pao-mel h-9" onClick={abrirModal}>
          <Plus className="w-4 h-4 mr-1" /> Nova Carga
        </Button>
      </div>

      {isLoading ? (
        <p className="text-center text-slate-500 py-10">Carregando...</p>
      ) : (
        <div className="grid gap-3">
          {cargasFiltradas.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-slate-500">Nenhuma carga encontrada.</CardContent></Card>
          ) : cargasFiltradas.map(carga => {
            const st = STATUS_LABELS[carga.status] || { label: carga.status, color: 'bg-slate-100 text-slate-700' };
            return (
              <Card key={carga.id} className="border-0 shadow-md hover:shadow-lg transition-shadow">
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <Truck className="w-5 h-5 text-amber-600" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-800">{carga.numero_carga}</div>
                        <div className="text-xs text-slate-500">{carga.data_montagem && new Date(carga.data_montagem + 'T12:00:00').toLocaleDateString('pt-BR')} · {carga.rota_nome || 'Rota não definida'}</div>
                        {carga.motorista_nome && <div className="text-xs text-slate-500">Motorista: {carga.motorista_nome}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {carga.total_pedidos > 0 && <Badge variant="outline" className="text-xs"><Package className="w-3 h-3 mr-1" />{carga.total_pedidos} ped.</Badge>}
                      {carga.valor_total > 0 && <Badge variant="outline" className="text-xs">R$ {carga.valor_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</Badge>}
                      <Badge className={`text-xs ${st.color}`}>{st.label}</Badge>
                      <Link to={`/DetalheCarga?id=${carga.id}`}>
                        <Button variant="outline" size="sm" className="h-7 text-xs"><Eye className="w-3 h-3 mr-1" />Ver</Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nova Carga</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Número da Carga</Label>
                <Input value={form.numero_carga} onChange={e => setForm({ ...form, numero_carga: e.target.value })} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Data de Montagem</Label>
                <Input type="date" value={form.data_montagem} onChange={e => setForm({ ...form, data_montagem: e.target.value })} className="h-9" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Rota</Label>
              <Select value={form.rota_id || ''} onValueChange={v => { const r = rotas.find(x => x.id === v); setForm({ ...form, rota_id: v, rota_nome: r?.nome || '' }); }}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Selecione a rota" /></SelectTrigger>
                <SelectContent>{rotas.map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Motorista</Label>
                <Select value={form.motorista_id || ''} onValueChange={v => { const vend = vendedores.find(x => x.id === v); setForm({ ...form, motorista_id: v, motorista_nome: vend?.nome || '' }); }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>{vendedores.filter(v => v.status === 'ativo').map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Veículo (Placa)</Label>
                <Input value={form.veiculo} onChange={e => setForm({ ...form, veiculo: e.target.value })} className="h-9" placeholder="Ex: ABC-1234" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Ajudante</Label>
              <Input value={form.ajudante_nome} onChange={e => setForm({ ...form, ajudante_nome: e.target.value })} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Observações</Label>
              <Textarea value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} rows={2} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setModalAberto(false)}>Cancelar</Button>
              <Button className="btn-pao-mel" onClick={() => criarCarga.mutate(form)} disabled={!form.numero_carga || !form.data_montagem}>Criar Carga</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}