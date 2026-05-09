import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { MapPin, Clock, Camera, Save, CheckCircle2, ShoppingCart, Package, ArrowLeftRight, Plus, Trash2, Loader2 } from 'lucide-react';
import { calcularDuracao } from './roteirosUtils';

export default function CheckinDialog({ open, onOpenChange, cliente, roteiro, vendedor, visitaExistente, onSaved }) {
  const [aba, setAba] = useState('atendimento');
  const [carregando, setCarregando] = useState(false);
  const [coords, setCoords] = useState(null);
  const [form, setForm] = useState({
    tipo_visita: 'acompanhamento',
    status: 'em_andamento',
    checkin_em: '', checkout_em: '',
    atendimento: '',
    estoque_itens: [],
    trocas_itens: [],
    motivo_nao_atendimento: '',
    data_reagendamento: '',
    observacoes: '',
    fotos_urls: []
  });

  useEffect(() => {
    if (visitaExistente) setForm({ ...form, ...visitaExistente });
    else if (open && cliente) iniciarCheckin();
  }, [open, cliente?.id]);

  const iniciarCheckin = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocalização não disponível neste navegador');
      return;
    }
    setCarregando(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        setForm(f => ({ ...f, checkin_em: new Date().toISOString(), status: 'em_andamento' }));
        setCarregando(false);
        toast.success(`Check-in registrado: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      },
      (err) => {
        setCarregando(false);
        toast.warning('Não foi possível obter GPS — registrando sem localização.');
        setForm(f => ({ ...f, checkin_em: new Date().toISOString(), status: 'em_andamento' }));
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const adicionarItem = (campo) => setForm(f => ({ ...f, [campo]: [...f[campo], { produto_codigo: '', produto_nome: '', quantidade: 1 }] }));
  const removerItem = (campo, idx) => setForm(f => ({ ...f, [campo]: f[campo].filter((_, i) => i !== idx) }));
  const atualizarItem = (campo, idx, key, val) => setForm(f => ({ ...f, [campo]: f[campo].map((it, i) => i === idx ? { ...it, [key]: val } : it) }));

  const uploadFoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCarregando(true);
    const r = await base44.integrations.Core.UploadFile({ file });
    setForm(f => ({ ...f, fotos_urls: [...f.fotos_urls, r.file_url] }));
    setCarregando(false);
  };

  const salvar = async (statusFinal) => {
    setCarregando(true);
    const checkout = statusFinal === 'concluida' ? new Date().toISOString() : form.checkout_em;
    const payload = {
      ...form,
      status: statusFinal,
      checkout_em: checkout,
      duracao_min: calcularDuracao(form.checkin_em, checkout),
      checkin_lat: coords?.lat,
      checkin_lng: coords?.lng,
      roteiro_id: roteiro?.id,
      vendedor_id: vendedor?.id,
      vendedor_nome: vendedor?.nome,
      vendedor_email: vendedor?.email,
      cliente_id: cliente.cliente_id || cliente.id,
      cliente_codigo: cliente.cliente_codigo,
      cliente_nome: cliente.cliente_nome || cliente.razao_social,
      cliente_cidade: cliente.cliente_cidade || cliente.cidade,
      cliente_endereco: cliente.cliente_endereco || cliente.endereco,
      dia_semana: roteiro?.dia_semana,
      data_visita: form.data_visita || new Date().toISOString().slice(0, 10)
    };
    if (visitaExistente?.id) await base44.entities.VisitaRoteiro.update(visitaExistente.id, payload);
    else await base44.entities.VisitaRoteiro.create(payload);
    setCarregando(false);
    toast.success(statusFinal === 'concluida' ? 'Visita concluída!' : 'Visita salva');
    onSaved?.();
    onOpenChange(false);
  };

  if (!cliente) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-blue-600" />
            {cliente.cliente_codigo || cliente.codigo_interno} — {cliente.cliente_nome || cliente.razao_social}
          </DialogTitle>
        </DialogHeader>

        <div className="grid md:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl bg-slate-50 border p-3">
            <p className="text-xs text-slate-500">Cidade / Endereço</p>
            <p className="font-medium">{cliente.cliente_cidade || cliente.cidade || '-'}</p>
            <p className="text-xs text-slate-600">{cliente.cliente_endereco || cliente.endereco || '-'}</p>
          </div>
          <div className="rounded-xl bg-blue-50 border border-blue-200 p-3">
            <p className="text-xs text-blue-600">Check-in</p>
            <p className="font-medium flex items-center gap-1"><Clock className="w-3 h-3" />{form.checkin_em ? new Date(form.checkin_em).toLocaleTimeString('pt-BR') : '-'}</p>
            <p className="text-xs text-blue-700">{coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}` : 'sem GPS'}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
            <p className="text-xs text-emerald-600">Duração</p>
            <p className="font-medium">{calcularDuracao(form.checkin_em, form.checkout_em || new Date().toISOString())} min</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <Label>Tipo de visita</Label>
            <Select value={form.tipo_visita} onValueChange={(v) => setForm({ ...form, tipo_visita: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="acompanhamento">Acompanhamento</SelectItem>
                <SelectItem value="venda">Venda</SelectItem>
                <SelectItem value="abertura">Abertura</SelectItem>
                <SelectItem value="cobranca">Cobrança</SelectItem>
                <SelectItem value="treinamento">Treinamento</SelectItem>
                <SelectItem value="outros">Outros</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Badge className="block w-full text-center py-2 text-sm">{form.status}</Badge>
          </div>
        </div>

        <Tabs value={aba} onValueChange={setAba}>
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="atendimento">Atendimento</TabsTrigger>
            <TabsTrigger value="estoque"><Package className="w-4 h-4 mr-1" />Estoque</TabsTrigger>
            <TabsTrigger value="trocas"><ArrowLeftRight className="w-4 h-4 mr-1" />Trocas</TabsTrigger>
            <TabsTrigger value="fotos"><Camera className="w-4 h-4 mr-1" />Fotos & Obs</TabsTrigger>
          </TabsList>

          <TabsContent value="atendimento" className="space-y-3">
            <div><Label>Anotações do atendimento</Label><Textarea rows={6} value={form.atendimento} onChange={(e) => setForm({ ...form, atendimento: e.target.value })} /></div>
            <Button variant="outline" onClick={() => window.location.href = '/EmissaoPedidos'}><ShoppingCart className="w-4 h-4" />Fazer pedido</Button>
          </TabsContent>

          <TabsContent value="estoque" className="space-y-2">
            {form.estoque_itens.map((it, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3"><Label className="text-xs">Código</Label><Input value={it.produto_codigo || ''} onChange={(e) => atualizarItem('estoque_itens', i, 'produto_codigo', e.target.value)} /></div>
                <div className="col-span-5"><Label className="text-xs">Produto</Label><Input value={it.produto_nome || ''} onChange={(e) => atualizarItem('estoque_itens', i, 'produto_nome', e.target.value)} /></div>
                <div className="col-span-2"><Label className="text-xs">Qtd</Label><Input type="number" value={it.quantidade || 0} onChange={(e) => atualizarItem('estoque_itens', i, 'quantidade', Number(e.target.value))} /></div>
                <div className="col-span-1"><Button size="icon" variant="outline" onClick={() => removerItem('estoque_itens', i)}><Trash2 className="w-4 h-4" /></Button></div>
              </div>
            ))}
            <Button variant="outline" onClick={() => adicionarItem('estoque_itens')}><Plus className="w-4 h-4" />Adicionar item</Button>
          </TabsContent>

          <TabsContent value="trocas" className="space-y-2">
            {form.trocas_itens.map((it, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3"><Label className="text-xs">Código</Label><Input value={it.produto_codigo || ''} onChange={(e) => atualizarItem('trocas_itens', i, 'produto_codigo', e.target.value)} /></div>
                <div className="col-span-4"><Label className="text-xs">Produto</Label><Input value={it.produto_nome || ''} onChange={(e) => atualizarItem('trocas_itens', i, 'produto_nome', e.target.value)} /></div>
                <div className="col-span-2"><Label className="text-xs">Qtd</Label><Input type="number" value={it.quantidade || 0} onChange={(e) => atualizarItem('trocas_itens', i, 'quantidade', Number(e.target.value))} /></div>
                <div className="col-span-2"><Label className="text-xs">Motivo</Label><Input value={it.motivo_descricao || ''} onChange={(e) => atualizarItem('trocas_itens', i, 'motivo_descricao', e.target.value)} /></div>
                <div className="col-span-1"><Button size="icon" variant="outline" onClick={() => removerItem('trocas_itens', i)}><Trash2 className="w-4 h-4" /></Button></div>
              </div>
            ))}
            <Button variant="outline" onClick={() => adicionarItem('trocas_itens')}><Plus className="w-4 h-4" />Adicionar troca</Button>
          </TabsContent>

          <TabsContent value="fotos" className="space-y-3">
            <div><Label>Observações</Label><Textarea rows={4} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
            <Label className="cursor-pointer rounded-md border px-3 py-2 text-sm hover:bg-slate-50 inline-flex items-center"><Camera className="w-4 h-4 mr-2" />Anexar foto<input type="file" accept="image/*" className="hidden" onChange={uploadFoto} /></Label>
            <div className="flex flex-wrap gap-2">{form.fotos_urls.map((u) => <img key={u} src={u} className="w-20 h-20 rounded border object-cover" />)}</div>
          </TabsContent>
        </Tabs>

        <div className="rounded-xl border-t pt-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <Label>Não Atendimento — motivo</Label>
            <Select value={form.motivo_nao_atendimento || ''} onValueChange={(v) => setForm({ ...form, motivo_nao_atendimento: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cliente_fechado">Cliente fechado</SelectItem>
                <SelectItem value="horario_nao_comercial">Horário não comercial</SelectItem>
                <SelectItem value="cliente_ausente">Cliente ausente</SelectItem>
                <SelectItem value="endereco_nao_localizado">Endereço não localizado</SelectItem>
                <SelectItem value="sem_tempo">Sem tempo</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <Label>Reagendar para</Label>
            <Input type="date" value={form.data_reagendamento || ''} onChange={(e) => setForm({ ...form, data_reagendamento: e.target.value })} />
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={carregando}>Fechar</Button>
          <Button variant="outline" className="border-red-300 text-red-700" onClick={() => salvar('nao_atendimento')} disabled={carregando}>Não Atendimento</Button>
          <Button variant="outline" className="border-purple-300 text-purple-700" onClick={() => salvar('reagendada')} disabled={carregando || !form.data_reagendamento}>Reagendar</Button>
          <Button onClick={() => salvar('concluida')} className="bg-emerald-600 hover:bg-emerald-700" disabled={carregando}>{carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}Concluir Visita</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}