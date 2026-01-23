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
    vendedor_id: '',
    dia_semana: '',
    clientes_selecionados: []
  });
  const [showClientesPicker, setShowClientesPicker] = useState(false);
  const [filtros, setFiltros] = useState({
    busca: '',
    codigo: '',
    cidade: '',
    vendedor_id: '',
    supervisor_id: '',
    rede_id: '',
    rota_id: '',
    segmento_id: '',
    cpf_cnpj: ''
  });

  const queryClient = useQueryClient();

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: redes = [] } = useQuery({
    queryKey: ['redes'],
    queryFn: () => base44.entities.Rede.list()
  });

  const { data: rotas = [] } = useQuery({
    queryKey: ['rotas'],
    queryFn: () => base44.entities.Rota.list()
  });

  const { data: segmentos = [] } = useQuery({
    queryKey: ['segmentos'],
    queryFn: () => base44.entities.Segmento.list()
  });

  const supervisores = vendedores.filter(v => {
    return vendedores.some(vend => vend.supervisor_id === v.id);
  });

  useEffect(() => {
    if (roteiro && isEditing) {
      setFormData({
        vendedor_id: roteiro.vendedor_id || '',
        dia_semana: roteiro.dia_semana || '',
        clientes_selecionados: roteiro.clientes_detalhes?.map(c => ({
          id: c.cliente_id,
          nome: c.cliente_nome,
          nome_fantasia: c.nome_fantasia,
          codigo: c.cliente_codigo,
          cidade: c.cliente_cidade,
          bairro: c.cliente_bairro,
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
      toast.success('✅ Roteiro criado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao criar roteiro: ' + error.message);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Roteiro.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['roteiros']);
      onOpenChange(false);
      toast.success('✅ Roteiro atualizado com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao atualizar roteiro: ' + error.message);
    }
  });

  const handleSubmit = () => {
    const vendedor = vendedores.find(v => v.id === formData.vendedor_id);
    
    // Validar se já existe roteiro para este vendedor/dia
    if (!isEditing) {
      const { data: roteiros = [] } = queryClient.getQueryState(['roteiros']) || {};
      const roteiroExistente = roteiros.find(r => 
        r.vendedor_id === formData.vendedor_id && 
        r.dia_semana === formData.dia_semana
      );
      
      if (roteiroExistente) {
        toast.error('Já existe um roteiro para este funcionário neste dia da semana.');
        return;
      }
    }
    
    const data = {
      vendedor_id: formData.vendedor_id,
      vendedor_nome: vendedor?.nome || 'N/A',
      dia_semana: formData.dia_semana,
      clientes_ids: formData.clientes_selecionados.map(c => c.id),
      clientes_detalhes: formData.clientes_selecionados.map((c, idx) => ({
        cliente_id: c.id,
        cliente_nome: c.nome,
        nome_fantasia: c.nome_fantasia,
        cliente_codigo: c.codigo,
        cliente_cidade: c.cidade,
        cliente_bairro: c.bairro,
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
            nome: cliente.razao_social,
            nome_fantasia: cliente.nome_fantasia,
            codigo: cliente.codigo,
            cidade: cliente.cidade,
            bairro: cliente.bairro,
            ordem: formData.clientes_selecionados.length + 1
          }
        ]
      });
      toast.success(`Cliente ${cliente.codigo} adicionado ao roteiro`);
    }
  };

  const limparFiltros = () => {
    setFiltros({
      busca: '',
      codigo: '',
      cidade: '',
      vendedor_id: '',
      supervisor_id: '',
      rede_id: '',
      rota_id: '',
      segmento_id: '',
      cpf_cnpj: ''
    });
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
    // Excluir clientes já adicionados
    if (formData.clientes_selecionados.find(cs => cs.id === c.id)) {
      return false;
    }

    // Filtro de busca geral
    if (filtros.busca) {
      const busca = filtros.busca.toLowerCase();
      const matchBusca = 
        c.razao_social?.toLowerCase().includes(busca) ||
        c.nome_fantasia?.toLowerCase().includes(busca) ||
        c.codigo?.toLowerCase().includes(busca);
      if (!matchBusca) return false;
    }

    // Filtro por código
    if (filtros.codigo && !c.codigo?.toLowerCase().includes(filtros.codigo.toLowerCase())) {
      return false;
    }

    // Filtro por CPF/CNPJ
    if (filtros.cpf_cnpj && !c.cpf_cnpj?.toLowerCase().includes(filtros.cpf_cnpj.toLowerCase())) {
      return false;
    }

    // Filtro por cidade
    if (filtros.cidade && !c.cidade?.toLowerCase().includes(filtros.cidade.toLowerCase())) {
      return false;
    }

    // Filtro por vendedor
    if (filtros.vendedor_id && c.vendedor_id !== filtros.vendedor_id) {
      return false;
    }

    // Filtro por supervisor (via vendedor)
    if (filtros.supervisor_id) {
      const vendedor = vendedores.find(v => v.id === c.vendedor_id);
      if (!vendedor || vendedor.supervisor_id !== filtros.supervisor_id) {
        return false;
      }
    }

    // Filtro por rede
    if (filtros.rede_id && c.rede_id !== filtros.rede_id) {
      return false;
    }

    // Filtro por rota
    if (filtros.rota_id && c.rota_id !== filtros.rota_id) {
      return false;
    }

    // Filtro por segmento
    if (filtros.segmento_id && c.segmento_id !== filtros.segmento_id) {
      return false;
    }

    return true;
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
              {!showClientesPicker && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowClientesPicker(true)}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Adicionar Clientes
                </Button>
              )}
            </div>

            {showClientesPicker && (
              <div className="mb-4 p-4 border rounded-lg bg-slate-50">
                <div className="space-y-3 mb-3">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div>
                      <Label className="text-xs">Busca Geral</Label>
                      <Input
                        placeholder="Nome ou Razão Social..."
                        value={filtros.busca}
                        onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Código</Label>
                      <Input
                        placeholder="Código do cliente..."
                        value={filtros.codigo}
                        onChange={(e) => setFiltros({ ...filtros, codigo: e.target.value })}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Cidade</Label>
                      <Input
                        placeholder="Cidade..."
                        value={filtros.cidade}
                        onChange={(e) => setFiltros({ ...filtros, cidade: e.target.value })}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">CPF/CNPJ</Label>
                      <Input
                        placeholder="CPF ou CNPJ..."
                        value={filtros.cpf_cnpj}
                        onChange={(e) => setFiltros({ ...filtros, cpf_cnpj: e.target.value })}
                        className="h-9"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Vendedor</Label>
                      <Select value={filtros.vendedor_id} onValueChange={(v) => setFiltros({ ...filtros, vendedor_id: v })}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Todos" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={null}>Todos</SelectItem>
                          {vendedores.map(v => (
                            <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Supervisor</Label>
                      <Select value={filtros.supervisor_id} onValueChange={(v) => setFiltros({ ...filtros, supervisor_id: v })}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Todos" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={null}>Todos</SelectItem>
                          {supervisores.map(s => (
                            <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Segmento</Label>
                      <Select value={filtros.segmento_id} onValueChange={(v) => setFiltros({ ...filtros, segmento_id: v })}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Todos" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={null}>Todos</SelectItem>
                          {segmentos.map(s => (
                            <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Rede</Label>
                      <Select value={filtros.rede_id} onValueChange={(v) => setFiltros({ ...filtros, rede_id: v })}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Todas" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={null}>Todas</SelectItem>
                          {redes.map(r => (
                            <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Rota</Label>
                      <Select value={filtros.rota_id} onValueChange={(v) => setFiltros({ ...filtros, rota_id: v })}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Todas" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={null}>Todas</SelectItem>
                          {rotas.map(r => (
                            <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={limparFiltros}
                        className="w-full h-9"
                      >
                        Limpar Filtros
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="max-h-60 overflow-y-auto space-y-1 border-t pt-2">
                  {clientesFiltrados.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-4">
                      {Object.values(filtros).some(v => v) ? 'Nenhum cliente encontrado com os filtros aplicados' : 'Use os filtros acima para buscar clientes'}
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-slate-600 mb-2">
                        {clientesFiltrados.length} cliente(s) encontrado(s) - mostrando até 50
                      </p>
                      {clientesFiltrados.slice(0, 50).map(cliente => (
                        <div
                          key={cliente.id}
                          onClick={() => handleAddCliente(cliente)}
                          className="p-2 hover:bg-slate-200 cursor-pointer rounded text-sm flex justify-between items-center"
                        >
                          <div className="flex-1">
                            <span className="font-medium">
                              {cliente.codigo} - {cliente.razao_social || cliente.nome_fantasia}
                            </span>
                            {cliente.nome_fantasia && cliente.razao_social && (
                              <span className="text-xs text-slate-500 ml-2">({cliente.nome_fantasia})</span>
                            )}
                          </div>
                          <span className="text-xs text-slate-500">{cliente.cidade}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
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
                                <p className="font-medium text-sm">{cliente.nome_fantasia || cliente.nome}</p>
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