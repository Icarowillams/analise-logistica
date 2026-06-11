import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, X, GripVertical } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

export default function CriarRoteiroModal({ open, onOpenChange, roteiro, isEditing }) {
  const [formData, setFormData] = useState({
    vendedor_id: '', dia_semana: '', clientes_selecionados: []
  });
  const [showClientesPicker, setShowClientesPicker] = useState(false);
  const [filtros, setFiltros] = useState({
    busca: '', codigo: '', cidade: '', vendedor_id: '', supervisor_id: '',
    rede_id: '', rota_id: '', segmento_id: '', cpf_cnpj: ''
  });

  const queryClient = useQueryClient();

  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: () => base44.entities.Cliente.list() });
  const { data: redes = [] } = useQuery({ queryKey: ['redes'], queryFn: () => base44.entities.Rede.list() });
  const { data: rotas = [] } = useQuery({ queryKey: ['rotas'], queryFn: () => base44.entities.Rota.list() });
  const { data: segmentos = [] } = useQuery({ queryKey: ['segmentos'], queryFn: () => base44.entities.Segmento.list() });

  const supervisores = vendedores.filter(v => vendedores.some(vend => vend.supervisor_id === v.id));

  useEffect(() => {
    if (roteiro && isEditing) {
      setFormData({
        vendedor_id: roteiro.vendedor_id || '',
        dia_semana: roteiro.dia_semana || '',
        clientes_selecionados: roteiro.clientes_detalhes?.map(c => {
          const completo = clientes.find(cl => cl.id === c.cliente_id) ||
            (c.cliente_codigo ? clientes.find(cl => cl.codigo_interno === c.cliente_codigo) : undefined);
          return {
            id: completo?.id || c.cliente_id,
            nome: completo?.razao_social || c.cliente_nome,
            nome_fantasia: completo?.nome_fantasia || c.nome_fantasia || '',
            codigo: completo?.codigo_interno || c.cliente_codigo,
            cidade: completo?.cidade || c.cliente_cidade,
            bairro: completo?.bairro || c.cliente_bairro,
            ordem: c.ordem
          };
        }) || []
      });
    } else {
      setFormData({ vendedor_id: '', dia_semana: '', clientes_selecionados: [] });
    }
  }, [roteiro, isEditing, open, clientes]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Roteiro.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['roteiros']);
      onOpenChange(false);
      toast.success('Roteiro criado!');
    },
    onError: (error) => toast.error('Erro: ' + error.message)
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Roteiro.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['roteiros']);
      onOpenChange(false);
      toast.success('Roteiro atualizado!');
    },
    onError: (error) => toast.error('Erro: ' + error.message)
  });

  // Normaliza o dia para comparação robusta (ignora sufixo "-feira" e acentos)
  const normalizarDia = (d) => String(d || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/-feira$/, '');

  const handleSubmit = async () => {
    const vendedor = vendedores.find(v => v.id === formData.vendedor_id);

    if (!isEditing) {
      // Busca direta no banco (não confiar no cache, que pode estar desatualizado)
      // e compara o dia de forma normalizada para nunca criar duplicata.
      const existentes = await base44.entities.Roteiro.filter({ vendedor_id: formData.vendedor_id });
      const diaNorm = normalizarDia(formData.dia_semana);
      const dup = existentes.find(r => normalizarDia(r.dia_semana) === diaNorm);
      if (dup) {
        toast.error('Já existe um roteiro para este funcionário neste dia. Edite o roteiro existente em vez de criar um novo.');
        return;
      }
    }

    const data = {
      vendedor_id: formData.vendedor_id,
      vendedor_nome: vendedor?.nome || 'N/A',
      dia_semana: formData.dia_semana,
      clientes_ids: formData.clientes_selecionados.map(c => c.id),
      clientes_detalhes: formData.clientes_selecionados.map((c, idx) => ({
        cliente_id: c.id, cliente_nome: c.nome, nome_fantasia: c.nome_fantasia,
        cliente_codigo: c.codigo, cliente_cidade: c.cidade, cliente_bairro: c.bairro,
        ordem: idx + 1
      })),
      status: roteiro?.status || 'planejado'
    };

    if (roteiro && isEditing) updateMutation.mutate({ id: roteiro.id, data });
    else createMutation.mutate(data);
  };

  const handleAddCliente = (cliente) => {
    if (!formData.clientes_selecionados.find(c => c.id === cliente.id)) {
      setFormData({
        ...formData,
        clientes_selecionados: [...formData.clientes_selecionados, {
          id: cliente.id, nome: cliente.razao_social, nome_fantasia: cliente.nome_fantasia,
          codigo: cliente.codigo_interno, cidade: cliente.cidade, bairro: cliente.bairro,
          ordem: formData.clientes_selecionados.length + 1
        }]
      });
      toast.success(`Cliente ${cliente.codigo_interno} adicionado`);
    }
  };

  const limparFiltros = () => setFiltros({
    busca: '', codigo: '', cidade: '', vendedor_id: '', supervisor_id: '',
    rede_id: '', rota_id: '', segmento_id: '', cpf_cnpj: ''
  });

  const handleRemoveCliente = (id) => setFormData({ ...formData, clientes_selecionados: formData.clientes_selecionados.filter(c => c.id !== id) });

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(formData.clientes_selecionados);
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved);
    setFormData({ ...formData, clientes_selecionados: items.map((it, i) => ({ ...it, ordem: i + 1 })) });
  };

  const clientesFiltrados = clientes.filter(c => {
    if (formData.clientes_selecionados.find(cs => cs.id === c.id)) return false;
    if (filtros.busca) {
      const q = filtros.busca.toLowerCase();
      if (!(c.razao_social?.toLowerCase().includes(q) || c.nome_fantasia?.toLowerCase().includes(q) || c.codigo_interno?.toLowerCase().includes(q))) return false;
    }
    if (filtros.codigo && !c.codigo_interno?.toLowerCase().includes(filtros.codigo.toLowerCase())) return false;
    if (filtros.cpf_cnpj && !c.cnpj_cpf?.toLowerCase().includes(filtros.cpf_cnpj.toLowerCase())) return false;
    if (filtros.cidade && !c.cidade?.toLowerCase().includes(filtros.cidade.toLowerCase())) return false;
    if (filtros.vendedor_id && c.vendedor_id !== filtros.vendedor_id) return false;
    if (filtros.supervisor_id) {
      const v = vendedores.find(x => x.id === c.vendedor_id);
      if (!v || v.supervisor_id !== filtros.supervisor_id) return false;
    }
    if (filtros.rede_id && c.rede_id !== filtros.rede_id) return false;
    if (filtros.rota_id && c.rota_id !== filtros.rota_id) return false;
    if (filtros.segmento_id && c.segmento_id !== filtros.segmento_id) return false;
    return true;
  });

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{roteiro && isEditing ? 'Editar Roteiro' : 'Criar Novo Roteiro'}</DialogTitle></DialogHeader>

        <div className="space-y-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Selecione o funcionário *</Label>
              <Select value={formData.vendedor_id} onValueChange={(v) => setFormData({ ...formData, vendedor_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Selecione o dia da semana *</Label>
              <Select value={formData.dia_semana} onValueChange={(v) => setFormData({ ...formData, dia_semana: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="segunda-feira">Segunda-feira</SelectItem>
                  <SelectItem value="terca-feira">Terça-feira</SelectItem>
                  <SelectItem value="quarta-feira">Quarta-feira</SelectItem>
                  <SelectItem value="quinta-feira">Quinta-feira</SelectItem>
                  <SelectItem value="sexta-feira">Sexta-feira</SelectItem>
                  <SelectItem value="sabado">Sábado</SelectItem>
                  <SelectItem value="domingo">Domingo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <Label>Adicionar Clientes</Label>
              {!showClientesPicker && (
                <Button type="button" variant="outline" size="sm" onClick={() => setShowClientesPicker(true)}>
                  <Plus className="w-4 h-4 mr-2" />Adicionar Clientes
                </Button>
              )}
            </div>

            {showClientesPicker && (
              <div className="mb-4 p-4 border rounded-lg bg-slate-50">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                  <Input placeholder="Busca geral..." value={filtros.busca} onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })} />
                  <Input placeholder="Código..." value={filtros.codigo} onChange={(e) => setFiltros({ ...filtros, codigo: e.target.value })} />
                  <Input placeholder="Cidade..." value={filtros.cidade} onChange={(e) => setFiltros({ ...filtros, cidade: e.target.value })} />
                  <Input placeholder="CPF/CNPJ..." value={filtros.cpf_cnpj} onChange={(e) => setFiltros({ ...filtros, cpf_cnpj: e.target.value })} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <Select value={filtros.vendedor_id || 'all'} onValueChange={(v) => setFiltros({ ...filtros, vendedor_id: v === 'all' ? '' : v })}>
                    <SelectTrigger><SelectValue placeholder="Vendedor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filtros.supervisor_id || 'all'} onValueChange={(v) => setFiltros({ ...filtros, supervisor_id: v === 'all' ? '' : v })}>
                    <SelectTrigger><SelectValue placeholder="Supervisor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {supervisores.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filtros.segmento_id || 'all'} onValueChange={(v) => setFiltros({ ...filtros, segmento_id: v === 'all' ? '' : v })}>
                    <SelectTrigger><SelectValue placeholder="Segmento" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {segmentos.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <Select value={filtros.rede_id || 'all'} onValueChange={(v) => setFiltros({ ...filtros, rede_id: v === 'all' ? '' : v })}>
                    <SelectTrigger><SelectValue placeholder="Rede" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      {redes.map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filtros.rota_id || 'all'} onValueChange={(v) => setFiltros({ ...filtros, rota_id: v === 'all' ? '' : v })}>
                    <SelectTrigger><SelectValue placeholder="Rota" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      {rotas.map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="sm" onClick={limparFiltros}>Limpar Filtros</Button>
                </div>

                <div className="max-h-60 overflow-y-auto space-y-1 border-t pt-2">
                  {clientesFiltrados.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-4">Nenhum cliente</p>
                  ) : (
                    <>
                      <p className="text-xs text-slate-600 mb-2">{clientesFiltrados.length} encontrado(s) - até 50</p>
                      {clientesFiltrados.slice(0, 50).map(c => (
                        <div key={c.id} onClick={() => handleAddCliente(c)} className="p-2 hover:bg-slate-200 cursor-pointer rounded text-sm flex justify-between">
                          <span className="font-medium">{c.codigo_interno} - {c.nome_fantasia || c.razao_social}</span>
                          <span className="text-xs text-slate-500">{c.cidade}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="border rounded-lg p-4">
            <h3 className="font-semibold mb-3">Clientes no Roteiro ({formData.clientes_selecionados.length}):</h3>
            {formData.clientes_selecionados.length === 0 ? (
              <p className="text-center text-slate-500 py-8">Nenhum cliente selecionado</p>
            ) : (
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="clientes">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                      {formData.clientes_selecionados.map((c, index) => (
                        <Draggable key={c.id} draggableId={c.id} index={index}>
                          {(p) => (
                            <div ref={p.innerRef} {...p.draggableProps} className="flex items-center gap-3 p-3 bg-white border rounded-lg hover:bg-slate-50">
                              <div {...p.dragHandleProps} className="cursor-grab"><GripVertical className="w-4 h-4 text-slate-400" /></div>
                              <Badge className="bg-amber-100 text-amber-700">{index + 1}</Badge>
                              <div className="flex-1">
                                <p className="font-medium text-sm">{c.nome_fantasia || c.nome}</p>
                                <p className="text-xs text-slate-500">{c.codigo} • {c.cidade}</p>
                              </div>
                              <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoveCliente(c.id)}>
                                <X className="w-4 h-4 text-red-500" />
                              </Button>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Cancelar</Button>
            <Button onClick={handleSubmit}
              disabled={isLoading || !formData.vendedor_id || !formData.dia_semana || formData.clientes_selecionados.length === 0}
              className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900">
              {isLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</> : (roteiro && isEditing ? 'Salvar Alterações' : 'Criar Roteiro')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}