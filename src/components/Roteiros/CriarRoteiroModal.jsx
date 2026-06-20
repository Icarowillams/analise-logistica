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
import useBuscaClientes from '@/components/hooks/useBuscaClientes';

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

  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list(), staleTime: 5 * 60 * 1000 });
  const { data: redes = [] } = useQuery({ queryKey: ['redes'], queryFn: () => base44.entities.Rede.list(), staleTime: 5 * 60 * 1000 });
  const { data: rotas = [] } = useQuery({ queryKey: ['rotas'], queryFn: () => base44.entities.Rota.list(), staleTime: 5 * 60 * 1000 });
  const { data: segmentos = [] } = useQuery({ queryKey: ['segmentos'], queryFn: () => base44.entities.Segmento.list(), staleTime: 5 * 60 * 1000 });

  // Busca SERVER-SIDE de clientes — gatilho é o primeiro campo de texto preenchido.
  const termoBusca = filtros.busca || filtros.codigo || filtros.cpf_cnpj || '';
  const { clientes, isFetching: buscandoClientes, termoAtivo: buscaAtiva } = useBuscaClientes(termoBusca, { minChars: 2, limite: 50 });

  const supervisores = vendedores.filter(v => vendedores.some(vend => vend.supervisor_id === v.id));

  useEffect(() => {
    let cancelado = false;
    if (roteiro && isEditing) {
      const detalhes = roteiro.clientes_detalhes || [];
      // REGRA DE OURO: o cliente_id é a fonte da verdade. Todo rótulo (código, nome,
      // cidade, bairro) é SEMPRE derivado do cadastro de Cliente daquele id — nunca
      // do rótulo gravado e nunca por fallback de código (causa do desalinhamento).
      const ids = [...new Set(detalhes.map(d => d.cliente_id).filter(Boolean))];

      // Pré-preenche com placeholder e resolve cada item pelo cadastro real.
      setFormData({
        vendedor_id: roteiro.vendedor_id || '',
        dia_semana: roteiro.dia_semana || '',
        clientes_selecionados: detalhes.map(c => ({
          id: c.cliente_id, nome: '', nome_fantasia: '', codigo: '',
          cidade: '', bairro: '', ordem: c.ordem, _carregando: true
        }))
      });

      (async () => {
        const registros = ids.length
          ? await base44.entities.Cliente.filter({ id: { $in: ids } })
          : [];
        if (cancelado) return;
        const porId = new Map(registros.map(r => [r.id, r]));
        const selecionados = detalhes.map(c => {
          const reg = porId.get(c.cliente_id);
          if (!reg) {
            // ID não existe mais no cadastro → item órfão, marcado para aviso visual.
            return {
              id: c.cliente_id, nome: c.cliente_nome || '(cliente não encontrado)',
              nome_fantasia: '', codigo: c.cliente_codigo || '', cidade: '', bairro: '',
              ordem: c.ordem, _orfao: true
            };
          }
          return {
            id: reg.id, nome: reg.razao_social, nome_fantasia: reg.nome_fantasia || '',
            codigo: reg.codigo_interno, cidade: reg.cidade, bairro: reg.bairro, ordem: c.ordem
          };
        });
        setFormData(prev => ({ ...prev, clientes_selecionados: selecionados }));
      })();
    } else {
      setFormData({ vendedor_id: '', dia_semana: '', clientes_selecionados: [] });
    }
    return () => { cancelado = true; };
  }, [roteiro, isEditing, open]);

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
    const diaNorm = normalizarDia(formData.dia_semana);

    // Busca SEMPRE no banco em tempo real (cache pode estar desatualizado) o roteiro
    // existente deste vendedor+dia — garante que nunca haja 2 roteiros para o mesmo par.
    const existentes = await base44.entities.Roteiro.filter({ vendedor_id: formData.vendedor_id });
    const roteiroExistente = existentes.find(r => normalizarDia(r.dia_semana) === diaNorm);

    // Monta detalhes a partir do que está na UI
    const detalhesForm = formData.clientes_selecionados.map((c) => ({
      cliente_id: c.id, cliente_nome: c.nome, nome_fantasia: c.nome_fantasia,
      cliente_codigo: c.codigo, cliente_cidade: c.cidade, cliente_bairro: c.bairro
    }));

    // MERGE: preserva clientes que já estavam no roteiro e que o usuário NÃO removeu
    // explicitamente na UI. Nunca descarta cliente por falha de lookup no carregamento.
    const baseDetalhes = roteiroExistente?.clientes_detalhes || roteiro?.clientes_detalhes || [];
    const idsNaUI = new Set(formData.clientes_selecionados.map(c => c.id));
    const idsCarregados = new Set((isEditing ? (roteiro?.clientes_detalhes || []) : []).map(d => d.cliente_id));
    const preservados = baseDetalhes.filter(d =>
      !idsNaUI.has(d.cliente_id) && // não está na UI
      (!isEditing || !idsCarregados.has(d.cliente_id)) // e não foi carregado (logo, não foi removido pelo usuário)
    );

    // Deduplica por cliente_id, prioriza a ordem da UI e renumera
    const combinados = [...detalhesForm, ...preservados];
    const vistos = new Set();
    const detalhesFinais = combinados
      .filter(d => {
        if (vistos.has(d.cliente_id)) return false;
        vistos.add(d.cliente_id);
        return true;
      })
      .map((d, idx) => ({ ...d, ordem: idx + 1 }));

    const data = {
      vendedor_id: formData.vendedor_id,
      vendedor_nome: vendedor?.nome || 'N/A',
      dia_semana: formData.dia_semana,
      clientes_ids: detalhesFinais.map(d => d.cliente_id),
      clientes_detalhes: detalhesFinais,
      status: roteiro?.status || roteiroExistente?.status || 'planejado'
    };

    // Se já existe um roteiro para este vendedor+dia, SEMPRE atualiza o existente
    // (mesmo em "criar"), nunca cria um segundo.
    const alvoId = (isEditing && roteiro?.id) ? roteiro.id : roteiroExistente?.id;
    if (alvoId) updateMutation.mutate({ id: alvoId, data });
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
                  {!buscaAtiva ? (
                    <p className="text-sm text-slate-500 text-center py-4">Digite ao menos 2 letras (busca, código ou CPF/CNPJ)</p>
                  ) : buscandoClientes ? (
                    <p className="text-sm text-slate-500 text-center py-4"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Buscando...</p>
                  ) : clientesFiltrados.length === 0 ? (
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
                                <p className="font-medium text-sm">
                                  {c._carregando ? 'Carregando...' : (c.nome_fantasia || c.nome)}
                                </p>
                                <p className="text-xs text-slate-500">{c.codigo} • {c.cidade}</p>
                                {c._orfao && (
                                  <p className="text-xs text-red-600 font-medium">⚠ Cliente não encontrado no cadastro</p>
                                )}
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