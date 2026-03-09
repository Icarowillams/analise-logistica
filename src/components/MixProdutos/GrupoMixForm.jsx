import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Pencil, Trash2, Search, Package, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from '@/components/ui/dialog';

export default function GrupoMixForm() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingGrupo, setEditingGrupo] = useState(null);
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [produtosSelecionados, setProdutosSelecionados] = useState([]);
  const [searchProd, setSearchProd] = useState('');

  const { data: grupos = [] } = useQuery({
    queryKey: ['gruposMix'],
    queryFn: () => base44.entities.GrupoMix.list()
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });

  const produtosFiltrados = useMemo(() => {
    const s = searchProd.toLowerCase();
    return produtos.filter(p =>
      p.status === 'ativo' &&
      (!s || p.nome?.toLowerCase().includes(s) || p.codigo?.includes(s))
    );
  }, [produtos, searchProd]);

  const openNew = () => {
    setEditingGrupo(null);
    setNome('');
    setDescricao('');
    setProdutosSelecionados([]);
    setSearchProd('');
    setDialogOpen(true);
  };

  const openEdit = (grupo) => {
    setEditingGrupo(grupo);
    setNome(grupo.nome);
    setDescricao(grupo.descricao || '');
    setProdutosSelecionados(grupo.produtos_ids || []);
    setSearchProd('');
    setDialogOpen(true);
  };

  const toggleProduto = (prodId) => {
    setProdutosSelecionados(prev =>
      prev.includes(prodId) ? prev.filter(id => id !== prodId) : [...prev, prodId]
    );
  };

  const salvar = async () => {
    if (!nome.trim()) { toast.error('Informe o nome do grupo'); return; }
    const data = { nome, descricao, produtos_ids: produtosSelecionados, status: 'ativo' };
    if (editingGrupo) {
      await base44.entities.GrupoMix.update(editingGrupo.id, data);
      toast.success('Grupo atualizado!');
    } else {
      await base44.entities.GrupoMix.create(data);
      toast.success('Grupo criado!');
    }
    queryClient.invalidateQueries({ queryKey: ['gruposMix'] });
    setDialogOpen(false);
  };

  const excluir = async (id) => {
    if (!confirm('Excluir este grupo?')) return;
    await base44.entities.GrupoMix.delete(id);
    queryClient.invalidateQueries({ queryKey: ['gruposMix'] });
    toast.success('Grupo excluído!');
  };

  const getProdutoNome = (id) => produtos.find(p => p.id === id)?.nome || id;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Grupos de Mix</h3>
        <Button onClick={openNew} className="bg-amber-500 hover:bg-amber-600">
          <Plus className="w-4 h-4 mr-2" /> Novo Grupo
        </Button>
      </div>

      {grupos.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-slate-500">
            <Package className="w-12 h-12 mx-auto mb-3 text-slate-300" />
            <p>Nenhum grupo de mix cadastrado</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {grupos.map(g => (
            <Card key={g.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{g.nome}</CardTitle>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(g)}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => excluir(g.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {g.descricao && <p className="text-xs text-slate-500 mb-2">{g.descricao}</p>}
                <div className="flex flex-wrap gap-1">
                  {(g.produtos_ids || []).slice(0, 5).map(pid => (
                    <Badge key={pid} variant="outline" className="text-xs">{getProdutoNome(pid)}</Badge>
                  ))}
                  {(g.produtos_ids || []).length > 5 && (
                    <Badge variant="secondary" className="text-xs">+{g.produtos_ids.length - 5}</Badge>
                  )}
                  {(!g.produtos_ids || g.produtos_ids.length === 0) && (
                    <span className="text-xs text-slate-400">Nenhum produto</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingGrupo ? 'Editar Grupo' : 'Novo Grupo de Mix'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Grupo Padaria" />
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descrição opcional" />
            </div>
            <div>
              <Label>Produtos ({produtosSelecionados.length} selecionados)</Label>
              <div className="relative mt-1">
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
                {produtosFiltrados.map(p => (
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
            </div>
            <Button onClick={salvar} className="w-full bg-amber-500 hover:bg-amber-600">
              {editingGrupo ? 'Atualizar' : 'Criar Grupo'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}