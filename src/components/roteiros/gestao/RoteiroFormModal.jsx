import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Search, GripVertical, X, Plus, Save } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { DIAS_SEMANA } from './gestaoUtils';

const ESTADO_INICIAL = { vendedor_id: '', dia_semana: '', status: 'ativo', observacoes: '', clientes: [] };

export default function RoteiroFormModal({ open, onOpenChange, roteiro, vendedores, clientes, roteiros, onSaved }) {
  const [form, setForm] = useState(ESTADO_INICIAL);
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (roteiro) {
      setForm({
        vendedor_id: roteiro.vendedor_id || '',
        dia_semana: roteiro.dia_semana || '',
        status: roteiro.status || 'ativo',
        observacoes: roteiro.observacoes || '',
        clientes: (roteiro.clientes_detalhes || []).slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
      });
    } else {
      setForm(ESTADO_INICIAL);
    }
    setBusca('');
  }, [roteiro, open]);

  const idsAdicionados = useMemo(() => new Set(form.clientes.map(c => c.cliente_id)), [form.clientes]);

  const resultadoBusca = useMemo(() => {
    if (!busca.trim()) return [];
    const q = busca.toLowerCase();
    return clientes.filter(c =>
      !idsAdicionados.has(c.id) && (
        (c.razao_social || '').toLowerCase().includes(q) ||
        (c.nome_fantasia || '').toLowerCase().includes(q) ||
        (c.codigo_interno || '').includes(busca) ||
        (c.cidade || '').toLowerCase().includes(q)
      )
    ).slice(0, 15);
  }, [busca, clientes, idsAdicionados]);

  const adicionar = (c) => {
    setForm(prev => ({
      ...prev,
      clientes: [...prev.clientes, {
        cliente_id: c.id, cliente_nome: c.razao_social, cliente_codigo: c.codigo_interno,
        cliente_cidade: c.cidade, cliente_endereco: c.endereco, cliente_telefone: c.telefone,
        ordem: prev.clientes.length + 1
      }]
    }));
    setBusca('');
  };

  const remover = (id) => setForm(prev => ({ ...prev, clientes: prev.clientes.filter(c => c.cliente_id !== id) }));

  const onDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(form.clientes);
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved);
    setForm(prev => ({ ...prev, clientes: items.map((c, i) => ({ ...c, ordem: i + 1 })) }));
  };

  const salvar = async () => {
    if (!form.vendedor_id) { toast.error('Selecione o funcionário.'); return; }
    if (!form.dia_semana) { toast.error('Selecione o dia da semana.'); return; }

    if (!roteiro) {
      const duplicado = roteiros.find(r => r.vendedor_id === form.vendedor_id && r.dia_semana === form.dia_semana);
      if (duplicado) { toast.error('Já existe um roteiro para este funcionário neste dia. Edite o existente.'); return; }
    }

    setSalvando(true);
    const v = vendedores.find(x => x.id === form.vendedor_id);
    const payload = {
      vendedor_id: form.vendedor_id,
      vendedor_nome: v?.nome || '',
      dia_semana: form.dia_semana,
      status: form.status,
      observacoes: form.observacoes,
      clientes_ids: form.clientes.map(c => c.cliente_id),
      clientes_detalhes: form.clientes.map((c, i) => ({ ...c, ordem: i + 1 }))
    };

    if (roteiro) await base44.entities.Roteiro.update(roteiro.id, payload);
    else await base44.entities.Roteiro.create(payload);
    toast.success(roteiro ? 'Roteiro atualizado.' : 'Roteiro criado.');
    setSalvando(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{roteiro ? 'Editar Roteiro' : 'Novo Roteiro'}</DialogTitle></DialogHeader>

        <div className="grid md:grid-cols-3 gap-3">
          <div><Label className="text-xs">Funcionário *</Label>
            <Select value={form.vendedor_id} onValueChange={(v) => setForm({ ...form, vendedor_id: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {vendedores.filter(v => v.status === 'ativo').map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Dia da semana *</Label>
            <Select value={form.dia_semana} onValueChange={(v) => setForm({ ...form, dia_semana: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{DIAS_SEMANA.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="planejado">Planejado</SelectItem>
                <SelectItem value="pausado">Pausado</SelectItem>
                <SelectItem value="concluido">Concluído</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div><Label className="text-xs">Observações</Label>
          <Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} placeholder="Notas gerais sobre o roteiro..." rows={2} />
        </div>

        <div className="border-t pt-4">
          <Label className="text-sm font-semibold">Clientes do Roteiro <Badge variant="outline" className="ml-2">{form.clientes.length}</Badge></Label>
          <p className="text-xs text-slate-500 mb-2">Arraste para reordenar a sequência de visitas</p>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input className="pl-9" placeholder="Buscar cliente por nome, código ou cidade..." value={busca} onChange={(e) => setBusca(e.target.value)} />
            {resultadoBusca.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-auto">
                {resultadoBusca.map(c => (
                  <button key={c.id} type="button" onClick={() => adicionar(c)} className="w-full text-left px-3 py-2 hover:bg-amber-50 border-b last:border-0">
                    <div className="text-sm font-medium">{c.razao_social}</div>
                    <div className="text-xs text-slate-500">{c.codigo_interno} · {c.cidade || '-'} · {c.bairro || '-'}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="clientes">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="mt-3 border rounded-lg max-h-80 overflow-auto">
                  {form.clientes.length === 0 ? (
                    <p className="p-6 text-center text-sm text-slate-500">Busque acima e adicione clientes ao roteiro</p>
                  ) : form.clientes.map((c, idx) => (
                    <Draggable key={c.cliente_id} draggableId={c.cliente_id} index={idx}>
                      {(p) => (
                        <div ref={p.innerRef} {...p.draggableProps} className="flex items-center gap-2 p-2 border-b last:border-0 bg-white hover:bg-amber-50">
                          <span {...p.dragHandleProps} className="cursor-grab text-slate-400"><GripVertical className="w-4 h-4" /></span>
                          <Badge className="bg-amber-100 text-amber-800 w-7 justify-center">{idx + 1}</Badge>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{c.cliente_nome}</div>
                            <div className="text-xs text-slate-500 truncate">{c.cliente_codigo} · {c.cliente_cidade || '-'}</div>
                          </div>
                          <Button size="icon" variant="ghost" onClick={() => remover(c.cliente_id)} className="h-7 w-7 text-red-500"><X className="w-4 h-4" /></Button>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando} className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold">
            <Save className="w-4 h-4 mr-2" />{salvando ? 'Salvando...' : 'Salvar Roteiro'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}