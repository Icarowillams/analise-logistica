import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
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
    vendedor_id: '',
    dia_semana: '',
    clientes_selecionados: []
  });
  const [searchCliente, setSearchCliente] = useState('');
  const [showClientesPicker, setShowClientesPicker] = useState(false);

  const queryClient = useQueryClient();

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  useEffect(() => {
    if (roteiro && isEditing) {
      setFormData({
        vendedor_id: roteiro.vendedor_id || '',
        dia_semana: roteiro.dia_semana || '',
        clientes_selecionados: roteiro.clientes_detalhes?.map(c => ({
          id: c.cliente_id,
          nome: c.cliente_nome,
          codigo: c.cliente_codigo,
          cidade: c.cliente_cidade,
          ordem: c.ordem
        })) || []
      });
    } else {
      setFormData({
        vendedor_id: '',
        dia_semana: '',
        clientes_selecionados: []
      });
    }
  }, [roteiro, isEditing, open]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.Roteiro.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['roteiros']);
      onOpenChange(false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Roteiro.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['roteiros']);
      onOpenChange(false);
    }
  });

  const handleSubmit = () => {
    const vendedor = vendedores.find(v => v.id === formData.vendedor_id);
    
    const data = {
      vendedor_id: formData.vendedor_id,
      vendedor_nome: vendedor?.nome || 'N/A',
      dia_semana: formData.dia_semana,
      clientes_ids: formData.clientes_selecionados.map(c => c.id),
      clientes_detalhes: formData.clientes_selecionados.map((c, idx) => ({
        cliente_id: c.id,
        cliente_nome: c.nome,
        cliente_codigo: c.codigo,
        cliente_cidade: c.cidade,
        ordem: idx + 1
      })),
      status: roteiro?.status || 'planejado'
    };

    if (roteiro && isEditing) {
      updateMutation.mutate({ id: roteiro.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleAddCliente = (cliente) => {
    if (!formData.clientes_selecionados.find(c => c.id === cliente.id)) {
      setFormData({
        ...formData,
        clientes_selecionados: [
          ...formData.clientes_selecionados,
          {
            id: cliente.id,
            nome: cliente.razao_social || cliente.nome_fantasia,
            codigo: cliente.codigo,
            cidade: cliente.cidade,
            ordem: formData.clientes_selecionados.length + 1
          }
        ]
      });
    }
    setSearchCliente('');
    setShowClientesPicker(false);
  };

  const handleRemoveCliente = (clienteId) => {
    setFormData({
      ...formData,
      clientes_selecionados: formData.clientes_selecionados.filter(c => c.id !== clienteId)
    });
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;

    const items = Array.from(formData.clientes_selecionados);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);

    setFormData({
      ...formData,
      clientes_selecionados: items.map((item, idx) => ({ ...item, ordem: idx + 1 }))
    });
  };

  const clientesFiltrados = clientes.filter(c => {
    if (!searchCliente) return false;
    const search = searchCliente.toLowerCase();
    return (
      c.razao_social?.toLowerCase().includes(search) ||
      c.nome_fantasia?.toLowerCase().includes(search) ||
      c.codigo?.toLowerCase().includes(search)
    );
  });

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{roteiro && isEditing ? 'Editar Roteiro' : 'Criar Novo Roteiro'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Selecione o funcionário *</Label>
              <Select 
                value={formData.vendedor_id} 
                onValueChange={(v) => setFormData({ ...formData, vendedor_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o funcionário" />
                </SelectTrigger>
                <SelectContent>
                  {vendedores.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Selecione o dia da semana *</Label>
              <Select 
                value={formData.dia_semana} 
                onValueChange={(v) => setFormData({ ...formData, dia_semana: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o dia da semana" />
                </SelectTrigger>
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowClientesPicker(!showClientesPicker)}
              >
                <Plus className="w-4 h-4 mr-2" />
                Adicionar Clientes
              </Button>
            </div>

            {showClientesPicker && (
              <div className="mb-4 p-4 border rounded-lg bg-slate-50">
                <Input
                  placeholder="Buscar cliente por nome ou código..."
                  value={searchCliente}
                  onChange={(e) => setSearchCliente(e.target.value)}
                  className="mb-2"
                />
                {searchCliente && (
                  <div className="max-h-60 overflow-y-auto space-y-1">
                    {clientesFiltrados.length === 0 ? (
                      <p className="text-sm text-slate-500 text-center py-4">Nenhum cliente encontrado</p>
                    ) : (
                      clientesFiltrados.slice(0, 20).map(cliente => (
                        <div
                          key={cliente.id}
                          onClick={() => handleAddCliente(cliente)}
                          className="p-2 hover:bg-slate-200 cursor-pointer rounded text-sm flex justify-between items-center"
                        >
                          <span>
                            {cliente.codigo} - {cliente.razao_social || cliente.nome_fantasia}
                          </span>
                          <span className="text-xs text-slate-500">{cliente.cidade}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border rounded-lg p-4">
            <h3 className="font-semibold mb-3">
              Clientes no Roteiro ({formData.clientes_selecionados.length}):
            </h3>
            {formData.clientes_selecionados.length === 0 ? (
              <p className="text-center text-slate-500 py-8">Nenhum cliente selecionado</p>
            ) : (
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="clientes">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                      {formData.clientes_selecionados.map((cliente, index) => (
                        <Draggable key={cliente.id} draggableId={cliente.id} index={index}>
                          {(provided) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className="flex items-center gap-3 p-3 bg-white border rounded-lg hover:bg-slate-50"
                            >
                              <div {...provided.dragHandleProps} className="cursor-grab">
                                <GripVertical className="w-4 h-4 text-slate-400" />
                              </div>
                              <Badge className="bg-amber-100 text-amber-700">{index + 1}</Badge>
                              <div className="flex-1">
                                <p className="font-medium text-sm">{cliente.nome}</p>
                                <p className="text-xs text-slate-500">
                                  {cliente.codigo} • {cliente.cidade}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveCliente(cliente.id)}
                              >
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
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isLoading || !formData.vendedor_id || !formData.dia_semana || formData.clientes_selecionados.length === 0}
              className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900"
            >
              {isLoading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Salvando...</>
              ) : (
                roteiro && isEditing ? 'Salvar Alterações' : 'Criar Roteiro'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}