import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, Package, Pencil, Trash2, X, Users, Layers } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function MixClienteForm() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMix, setEditingMix] = useState(null);
  const [searchCliente, setSearchCliente] = useState('');
  const [searchProd, setSearchProd] = useState('');
  const [selectedClienteIds, setSelectedClienteIds] = useState([]);
  const [produtosSelecionados, setProdutosSelecionados] = useState([]);
  const [gruposSelecionados, setGruposSelecionados] = useState([]);
  const [activeTab, setActiveTab] = useState('produtos');
  const [filterMixSearch, setFilterMixSearch] = useState('');

  const { data: mixClientes = [] } = useQuery({
    queryKey: ['mixClientes'],
    queryFn: () => base44.entities.MixCliente.list()
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });

  const { data: gruposMix = [] } = useQuery({
    queryKey: ['gruposMix'],
    queryFn: () => base44.entities.GrupoMix.list()
  });

  const clientesFiltrados = useMemo(() => {
    const s = searchCliente.toLowerCase();
    return clientes.filter(c =>
      c.status === 'ativo' &&
      (!s || c.razao_social?.toLowerCase().includes(s) || c.nome_fantasia?.toLowerCase().includes(s) || c.codigo?.includes(s))
    ).slice(0, 100);
  }, [clientes, searchCliente]);

  const produtosFiltradosDialog = useMemo(() => {
    const s = searchProd.toLowerCase();
    return produtos.filter(p =>
      p.status === 'ativo' &&
      (!s || p.nome?.toLowerCase().includes(s) || p.codigo?.includes(s))
    );
  }, [produtos, searchProd]);

  const mixFiltrados = useMemo(() => {
    const s = filterMixSearch.toLowerCase();
    if (!s) return mixClientes;
    return mixClientes.filter(m =>
      m.cliente_nome?.toLowerCase().includes(s) || m.cliente_codigo?.includes(s)
    );
  }, [mixClientes, filterMixSearch]);

  const openNew = () => {
    setEditingMix(null);
    setSelectedClienteIds([]);
    setProdutosSelecionados([]);
    setGruposSelecionados([]);
    setSearchCliente('');
    setSearchProd('');
    setActiveTab('produtos');
    setDialogOpen(true);
  };

  const openEdit = (mix) => {
    setEditingMix(mix);
    setSelectedClienteIds([mix.cliente_id]);
    setProdutosSelecionados(mix.produtos_ids || []);
    setGruposSelecionados(mix.grupos_ids || []);
    setSearchCliente('');
    setSearchProd('');
    setActiveTab('produtos');
    setDialogOpen(true);
  };

  const toggleCliente = (cliId) => {
    if (editingMix) return; // Não pode mudar cliente ao editar
    setSelectedClienteIds(prev =>
      prev.includes(cliId) ? prev.filter(id => id !== cliId) : [...prev, cliId]
    );
  };

  const toggleProduto = (prodId) => {
    setProdutosSelecionados(prev =>
      prev.includes(prodId) ? prev.filter(id => id !== prodId) : [...prev, prodId]
    );
  };

  const toggleGrupo = (grupoId) => {
    setGruposSelecionados(prev =>
      prev.includes(grupoId) ? prev.filter(id => id !== grupoId) : [...prev, grupoId]
    );
  };

  const salvar = async () => {
    if (selectedClienteIds.length === 0) { toast.error('Selecione pelo menos um cliente'); return; }
    if (produtosSelecionados.length === 0 && gruposSelecionados.length === 0) {
      toast.error('Selecione produtos ou grupos');
      return;
    }

    if (editingMix) {
      await base44.entities.MixCliente.update(editingMix.id, {
        produtos_ids: produtosSelecionados,
        grupos_ids: gruposSelecionados
      });
      toast.success('Mix atualizado!');
    } else {
      // Criar mix para cada cliente selecionado
      for (const clienteId of selectedClienteIds) {
        const cliente = clientes.find(c => c.id === clienteId);
        // Verificar se já existe mix para este cliente
        const existente = mixClientes.find(m => m.cliente_id === clienteId);
        if (existente) {
          // Merge: adicionar novos produtos/grupos sem remover existentes
          const mergedProds = [...new Set([...(existente.produtos_ids || []), ...produtosSelecionados])];
          const mergedGrupos = [...new Set([...(existente.grupos_ids || []), ...gruposSelecionados])];
          await base44.entities.MixCliente.update(existente.id, {
            produtos_ids: mergedProds,
            grupos_ids: mergedGrupos
          });
        } else {
          await base44.entities.MixCliente.create({
            cliente_id: clienteId,
            cliente_codigo: cliente?.codigo || '',
            cliente_nome: cliente?.nome_fantasia || cliente?.razao_social || '',
            produtos_ids: produtosSelecionados,
            grupos_ids: gruposSelecionados
          });
        }
      }
      toast.success(`Mix atribuído para ${selectedClienteIds.length} cliente(s)!`);
    }

    queryClient.invalidateQueries({ queryKey: ['mixClientes'] });
    setDialogOpen(false);
  };

  const excluir = async (id) => {
    if (!confirm('Remover mix deste cliente?')) return;
    await base44.entities.MixCliente.delete(id);
    queryClient.invalidateQueries({ queryKey: ['mixClientes'] });
    toast.success('Mix removido!');
  };

  const getProdutoNome = (id) => produtos.find(p => p.id === id)?.nome || id;
  const getGrupoNome = (id) => gruposMix.find(g => g.id === id)?.nome || id;
  const getClienteNome = (id) => {
    const c = clientes.find(c => c.id === id);
    return c ? `${c.codigo} - ${c.nome_fantasia || c.razao_social}` : id;
  };

  // Calcular total de produtos efetivos de um mix
  const getTotalProdutosMix = (mix) => {
    const ids = new Set(mix.produtos_ids || []);
    (mix.grupos_ids || []).forEach(gid => {
      const g = gruposMix.find(gr => gr.id === gid);
      (g?.produtos_ids || []).forEach(pid => ids.add(pid));
    });
    return ids.size;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-semibold">Mix por Cliente</h3>
        <Button onClick={openNew} className="bg-amber-500 hover:bg-amber-600">
          <Users className="w-4 h-4 mr-2" /> Atribuir Mix
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          placeholder="Buscar cliente..."
          value={filterMixSearch}
          onChange={e => setFilterMixSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {mixFiltrados.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-slate-500">
            <Package className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p>Nenhum mix cadastrado</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {mixFiltrados.map(mix => (
            <Card key={mix.id}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {mix.cliente_codigo} - {mix.cliente_nome}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        <Package className="w-3 h-3 mr-1" /> {getTotalProdutosMix(mix)} produtos
                      </Badge>
                      {(mix.grupos_ids || []).length > 0 && (
                        <Badge className="bg-purple-100 text-purple-700 text-xs">
                          <Layers className="w-3 h-3 mr-1" /> {mix.grupos_ids.length} grupo(s)
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(mix)}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => excluir(mix.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingMix ? 'Editar Mix' : 'Atribuir Mix a Clientes'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Seleção de Clientes */}
            {!editingMix && (
              <div>
                <Label>Clientes ({selectedClienteIds.length} selecionados)</Label>
                <div className="relative mt-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Buscar cliente..."
                    value={searchCliente}
                    onChange={e => setSearchCliente(e.target.value)}
                    className="pl-10"
                  />
                </div>
                {selectedClienteIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selectedClienteIds.map(cid => (
                      <Badge key={cid} className="bg-blue-100 text-blue-800 text-xs cursor-pointer" onClick={() => toggleCliente(cid)}>
                        {getClienteNome(cid)} <X className="w-3 h-3 ml-1" />
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="mt-2 max-h-36 overflow-y-auto border rounded-lg">
                  {clientesFiltrados.map(c => (
                    <div
                      key={c.id}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b last:border-b-0"
                      onClick={() => toggleCliente(c.id)}
                    >
                      <Checkbox checked={selectedClienteIds.includes(c.id)} />
                      <span className="text-sm truncate">{c.codigo} - {c.nome_fantasia || c.razao_social}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {editingMix && (
              <div>
                <Label>Cliente</Label>
                <p className="text-sm font-medium">{editingMix.cliente_codigo} - {editingMix.cliente_nome}</p>
              </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="produtos">
                  Produtos ({produtosSelecionados.length})
                </TabsTrigger>
                <TabsTrigger value="grupos">
                  Grupos ({gruposSelecionados.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="produtos">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Buscar produto..."
                    value={searchProd}
                    onChange={e => setSearchProd(e.target.value)}
                    className="pl-10"
                  />
                </div>
                {produtosSelecionados.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {produtosSelecionados.map(pid => (
                      <Badge key={pid} className="bg-amber-100 text-amber-800 text-xs cursor-pointer" onClick={() => toggleProduto(pid)}>
                        {getProdutoNome(pid)} <X className="w-3 h-3 ml-1" />
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="mt-2 max-h-48 overflow-y-auto border rounded-lg">
                  {produtosFiltradosDialog.map(p => (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b last:border-b-0"
                      onClick={() => toggleProduto(p.id)}
                    >
                      <Checkbox checked={produtosSelecionados.includes(p.id)} />
                      <span className="text-sm">{p.codigo} - {p.nome}</span>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="grupos">
                {gruposMix.filter(g => g.status === 'ativo').length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-4">Nenhum grupo criado ainda</p>
                ) : (
                  <div className="space-y-2">
                    {gruposMix.filter(g => g.status === 'ativo').map(g => (
                      <div
                        key={g.id}
                        className="flex items-center gap-2 p-3 border rounded-lg hover:bg-slate-50 cursor-pointer"
                        onClick={() => toggleGrupo(g.id)}
                      >
                        <Checkbox checked={gruposSelecionados.includes(g.id)} />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{g.nome}</p>
                          <p className="text-xs text-slate-500">{(g.produtos_ids || []).length} produtos</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <Button onClick={salvar} className="w-full bg-amber-500 hover:bg-amber-600">
              {editingMix ? 'Atualizar Mix' : 'Salvar Mix'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}