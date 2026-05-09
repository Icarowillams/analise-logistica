import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Clock, MapPin, Phone, ShoppingCart, Save, Upload } from 'lucide-react';
import { hojeISO, formatarStatus, statusVisitaClasses } from './roteirosUtils';

const estadoInicial = {
  status: 'planejada', inicio_visita: '', fim_visita: '', motivo_nao_visita: '', nova_data: '',
  atendimento: '', estoque_disponivel: '', trocas: '', observacoes: '', fotos_urls: []
};

export default function ClienteVisitaDialog({ open, onOpenChange, roteiro, cliente, visita, pedidos, onSaved }) {
  const [form, setForm] = useState(estadoInicial);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setForm({ ...estadoInicial, ...(visita || {}) });
  }, [visita, open]);

  if (!cliente) return null;

  const comprasCliente = pedidos.filter(p => p.cliente_id === cliente.cliente_id).slice(0, 5);
  const salvar = async () => {
    const payload = {
      ...form,
      roteiro_id: roteiro.id,
      vendedor_id: roteiro.vendedor_id,
      vendedor_nome: roteiro.vendedor_nome,
      cliente_id: cliente.cliente_id,
      cliente_nome: cliente.cliente_nome,
      dia_semana: roteiro.dia_semana,
      data_visita: form.data_visita || hojeISO()
    };
    if (visita?.id) await base44.entities.VisitaRoteiro.update(visita.id, payload);
    else await base44.entities.VisitaRoteiro.create(payload);
    toast.success('Visita registrada com sucesso.');
    onSaved?.();
    onOpenChange(false);
  };

  const uploadFoto = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const uploaded = await base44.integrations.Core.UploadFile({ file });
    setForm(prev => ({ ...prev, fotos_urls: [...(prev.fotos_urls || []), uploaded.file_url] }));
    setUploading(false);
  };

  const marcarInicio = () => setForm(prev => ({ ...prev, status: 'em_andamento', inicio_visita: new Date().toISOString() }));
  const marcarFim = () => setForm(prev => ({ ...prev, fim_visita: new Date().toISOString() }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{cliente.cliente_nome}</DialogTitle>
        </DialogHeader>

        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div className="rounded-xl border bg-slate-50 p-4 space-y-2">
            <Badge className={statusVisitaClasses[form.status]}>{formatarStatus(form.status)}</Badge>
            <p className="flex gap-2"><MapPin className="w-4 h-4 text-slate-500" />{cliente.cliente_endereco || cliente.cliente_cidade || 'Endereço não informado'}</p>
            <p className="flex gap-2"><Phone className="w-4 h-4 text-slate-500" />{cliente.cliente_telefone || 'Telefone não informado'}</p>
            <p className="text-slate-600">Código: {cliente.cliente_codigo || '-'}</p>
          </div>

          <div className="rounded-xl border p-4 space-y-2">
            <h3 className="font-semibold flex items-center gap-2"><ShoppingCart className="w-4 h-4" />Histórico recente</h3>
            {comprasCliente.length === 0 ? <p className="text-slate-500">Sem pedidos recentes.</p> : comprasCliente.map(p => (
              <div key={p.id} className="text-xs border-b last:border-0 py-1">
                Pedido {p.numero_pedido || p.id.slice(0, 6)} • R$ {(p.valor_total || 0).toFixed(2)} • {p.status}
              </div>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          <Button type="button" variant="outline" onClick={marcarInicio}><Clock className="w-4 h-4" />Iniciar visita</Button>
          <Button type="button" variant="outline" onClick={marcarFim}><Clock className="w-4 h-4" />Finalizar visita</Button>
          <Button type="button" onClick={() => window.location.href = '/EmissaoPedidos'}><ShoppingCart className="w-4 h-4" />Fazer pedido</Button>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Status da visita</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="planejada">Planejada</SelectItem>
                <SelectItem value="em_andamento">Em andamento</SelectItem>
                <SelectItem value="visitado">Visitado com sucesso</SelectItem>
                <SelectItem value="nao_visitado">Não visitado</SelectItem>
                <SelectItem value="reagendado">Reagendado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.status === 'nao_visitado' && (
            <div>
              <Label>Motivo</Label>
              <Select value={form.motivo_nao_visita || ''} onValueChange={(v) => setForm({ ...form, motivo_nao_visita: v })}>
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
          )}
          {form.status === 'reagendado' && (
            <div>
              <Label>Nova data</Label>
              <Input type="date" value={form.nova_data || ''} onChange={(e) => setForm({ ...form, nova_data: e.target.value })} />
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div><Label>Atendimento</Label><Textarea value={form.atendimento || ''} onChange={(e) => setForm({ ...form, atendimento: e.target.value })} /></div>
          <div><Label>Estoque disponível</Label><Textarea value={form.estoque_disponivel || ''} onChange={(e) => setForm({ ...form, estoque_disponivel: e.target.value })} /></div>
          <div><Label>Trocas</Label><Textarea value={form.trocas || ''} onChange={(e) => setForm({ ...form, trocas: e.target.value })} /></div>
          <div><Label>Observações</Label><Textarea value={form.observacoes || ''} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Label className="cursor-pointer rounded-md border px-3 py-2 text-sm hover:bg-slate-50">
            <Upload className="w-4 h-4 inline mr-2" />{uploading ? 'Enviando...' : 'Adicionar foto'}
            <input type="file" accept="image/*" className="hidden" onChange={uploadFoto} disabled={uploading} />
          </Label>
          {(form.fotos_urls || []).map((url) => <img key={url} src={url} className="w-14 h-14 object-cover rounded border" />)}
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={salvar}><Save className="w-4 h-4" />Salvar visita</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}