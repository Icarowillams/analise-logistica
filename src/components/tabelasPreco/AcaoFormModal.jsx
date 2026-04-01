import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Search, X, Plus, Trash2 } from 'lucide-react';

export default function AcaoFormModal({ open, onOpenChange, onSubmit, editingAcao, tabelas, produtos, clientes, isSubmitting }) {
  const [produtosSelecionados, setProdutosSelecionados] = useState(() => {
    if (editingAcao) {
      return [{ produto_id: editingAcao.produto_id, produto_nome: editingAcao.produto_nome, produto_codigo: editingAcao.produto_codigo, valor_acao: editingAcao.valor_acao }];
    }
    return [];
  });
  const [dataInicio, setDataInicio] = useState(editingAcao?.data_inicio || '');
  const [dataFim, setDataFim] = useState(editingAcao?.data_fim || '');
  const [clientesSelecionados, setClientesSelecionados] = useState(editingAcao?.clientes_detalhes || []);
  const [observacoes, setObservacoes] = useState(editingAcao?.observacoes || '');
  
  const [searchProduto, setSearchProduto] = useState('');
  const [searchCliente, setSearchCliente] = useState('');
  const [showDropdownProduto, setShowDropdownProduto] = useState(false);
  const [showDropdownCliente, setShowDropdownCliente] = useState(false);

  const filteredProdutos = useMemo(() => {
    if (!searchProduto.trim()) return [];
    const s = searchProduto.toLowerCase();
    return produtos.filter(p =>
      p.codigo?.toLowerCase().includes(s) || p.nome?.toLowerCase().includes(s)
    ).slice(0, 15);
  }, [produtos, searchProduto]);

  const filteredClientes = useMemo(() => {
    if (!searchCliente.trim()) return [];
    const s = searchCliente.toLowerCase();
    return clientes.filter(c =>
      !clientesSelecionados.some(cs => cs.cliente_id === c.id) &&
      (c.codigo?.toLowerCase().includes(s) || c.razao_social?.toLowerCase().includes(s) || c.nome_fantasia?.toLowerCase().includes(s))
    ).slice(0, 15);
  }, [clientes, searchCliente, clientesSelecionados]);

  const addProduto = (produto) => {
    if (editingAcao) return; // Ao editar, não pode trocar produto
    if (produtosSelecionados.some(p => p.produto_id === produto.id)) return;
    setProdutosSelecionados(prev => [...prev, {
      produto_id: produto.id,
      produto_nome: produto.nome,
      produto_codigo: produto.codigo,
      valor_acao: 0
    }]);
    setSearchProduto('');
    setShowDropdownProduto(false);
  };

  const removeProduto = (produtoId) => {
    setProdutosSelecionados(prev => prev.filter(p => p.produto_id !== produtoId));
  };

  const updateValorProduto = (produtoId, valor) => {
    setProdutosSelecionados(prev => prev.map(p =>
      p.produto_id === produtoId ? { ...p, valor_acao: parseFloat(valor) || 0 } : p
    ));
  };

  const addCliente = (cliente) => {
    setClientesSelecionados(prev => [...prev, {
      cliente_id: cliente.id,
      cliente_nome: cliente.nome_fantasia || cliente.razao_social,
      cliente_codigo: cliente.codigo
    }]);
    setSearchCliente('');
    setShowDropdownCliente(false);
  };

  const removeCliente = (clienteId) => {
    setClientesSelecionados(prev => prev.filter(c => c.cliente_id !== clienteId));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (produtosSelecionados.length === 0 || !dataInicio || !dataFim) {
      return;
    }
    onSubmit({
      produtos: produtosSelecionados,
      dataInicio,
      dataFim,
      clientes: clientesSelecionados,
      observacoes
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingAcao ? 'Editar Ação Promocional' : 'Nova Ação Promocional'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Produtos */}
          <div>
            <Label>Produtos *</Label>
            {!editingAcao && (
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Buscar produto por código ou nome..."
                  value={searchProduto}
                  onChange={(e) => { setSearchProduto(e.target.value); setShowDropdownProduto(true); }}
                  onFocus={() => setShowDropdownProduto(true)}
                  className="pl-9"
                />
                {showDropdownProduto && searchProduto.trim() && (
                  <div className="absolute z-20 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredProdutos.length === 0 ? (
                      <div className="p-3 text-sm text-slate-500 text-center">Nenhum produto encontrado</div>
                    ) : filteredProdutos.map(p => (
                      <div key={p.id} onClick={() => addProduto(p)} className="p-2 hover:bg-amber-50 cursor-pointer flex gap-2 items-center border-b last:border-b-0">
                        <span className="text-xs font-mono bg-amber-100 px-1.5 py-0.5 rounded">{p.codigo}</span>
                        <span className="text-sm truncate">{p.nome}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {produtosSelecionados.length > 0 && (
              <div className="mt-2 space-y-2">
                {produtosSelecionados.map(p => (
                  <div key={p.produto_id} className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2">
                    <span className="text-xs font-mono bg-amber-100 px-1.5 py-0.5 rounded">{p.produto_codigo}</span>
                    <span className="text-sm flex-1 truncate">{p.produto_nome}</span>
                    <div className="flex items-center gap-1">
                      <Label className="text-xs text-slate-500">R$</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={p.valor_acao || ''}
                        onChange={(e) => updateValorProduto(p.produto_id, e.target.value)}
                        className="w-24 h-8 text-sm"
                        placeholder="0,00"
                      />
                    </div>
                    {!editingAcao && (
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => removeProduto(p.produto_id)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Período */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Data Início *</Label>
              <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} required />
            </div>
            <div>
              <Label>Data Fim *</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} required />
            </div>
          </div>

          {/* Clientes */}
          <div>
            <Label>Clientes (opcional — deixe vazio para todos)</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Buscar cliente..."
                value={searchCliente}
                onChange={(e) => { setSearchCliente(e.target.value); setShowDropdownCliente(true); }}
                onFocus={() => setShowDropdownCliente(true)}
                className="pl-9"
              />
              {showDropdownCliente && searchCliente.trim() && (
                <div className="absolute z-20 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {filteredClientes.length === 0 ? (
                    <div className="p-3 text-sm text-slate-500 text-center">Nenhum cliente encontrado</div>
                  ) : filteredClientes.map(c => (
                    <div key={c.id} onClick={() => addCliente(c)} className="p-2 hover:bg-blue-50 cursor-pointer flex gap-2 items-center border-b last:border-b-0">
                      <span className="text-xs font-mono bg-slate-100 px-1.5 py-0.5 rounded">{c.codigo}</span>
                      <span className="text-sm truncate">{c.nome_fantasia || c.razao_social}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {clientesSelecionados.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {clientesSelecionados.map(c => (
                  <Badge key={c.cliente_id} className="bg-blue-100 text-blue-800 flex items-center gap-1 pr-1">
                    {c.cliente_codigo} - {c.cliente_nome}
                    <button type="button" onClick={() => removeCliente(c.cliente_id)} className="hover:bg-blue-200 rounded-full p-0.5">
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Observações */}
          <div>
            <Label>Observações</Label>
            <Textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Observações sobre a ação..." rows={2} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting} className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold">
              {isSubmitting ? 'Salvando...' : editingAcao ? 'Salvar Alterações' : 'Criar Ação'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}