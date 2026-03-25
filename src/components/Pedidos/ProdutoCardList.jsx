import React, { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, Minus, Package, Check, ShoppingCart } from 'lucide-react';

export default function ProdutoCardList({
  produtos,
  precosAll,
  tabelaPrecoId,
  itensLocal,
  onUpdateQuantidade,
  onAdicionarItemTroca,
  motivosTroca,
  tipo,
}) {
  const [search, setSearch] = useState('');
  // Estado local por produto para troca: { [produto_id]: { quantidade, motivoId } }
  const [trocaInputs, setTrocaInputs] = useState({});

  const isTroca = tipo === 'troca';

  const produtosComPreco = useMemo(() => {
    if (!tabelaPrecoId || precosAll.length === 0) return produtos;
    const idsComPreco = new Set(
      precosAll
        .filter(p => p.valor_unitario > 0 || (p.ativacao_acao && p.valor_acao > 0))
        .map(p => p.produto_id)
    );
    return produtos.filter(p => idsComPreco.has(p.id));
  }, [produtos, precosAll, tabelaPrecoId]);

  const precosMap = useMemo(() => {
    const m = {};
    precosAll.forEach(p => { m[p.produto_id] = p; });
    return m;
  }, [precosAll]);

  // Para venda: soma quantidades por produto
  const quantidadesMap = useMemo(() => {
    const m = {};
    itensLocal.forEach((item) => {
      if (!m[item.produto_id]) m[item.produto_id] = 0;
      m[item.produto_id] += item.quantidade;
    });
    return m;
  }, [itensLocal]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase().trim();
    if (!s) return produtosComPreco;
    return produtosComPreco.filter(p =>
      p.nome?.toLowerCase().includes(s) || p.codigo?.includes(s)
    );
  }, [produtosComPreco, search]);

  const getPreco = (produtoId) => {
    const preco = precosMap[produtoId];
    if (!preco) return 0;
    return (preco.ativacao_acao && preco.valor_acao) ? preco.valor_acao : preco.valor_unitario || 0;
  };

  const getTrocaInput = (produtoId) => {
    return trocaInputs[produtoId] || { quantidade: 1, motivoId: '' };
  };

  const setTrocaInput = (produtoId, field, value) => {
    setTrocaInputs(prev => ({
      ...prev,
      [produtoId]: { ...getTrocaInput(produtoId), [field]: value }
    }));
  };

  const handleAdicionarTroca = (produto) => {
    const input = getTrocaInput(produto.id);
    const preco = getPreco(produto.id);
    if (!input.motivoId) return;
    if (!input.quantidade || input.quantidade <= 0) return;
    const motivoObj = motivosTroca.find(m => m.id === input.motivoId);
    onAdicionarItemTroca(produto, preco, input.quantidade, input.motivoId, motivoObj?.descricao || '');
    // Reset input deste produto
    setTrocaInputs(prev => ({ ...prev, [produto.id]: { quantidade: 1, motivoId: '' } }));
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          placeholder="Buscar por código ou nome..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <p className="text-xs text-slate-500">{filtered.length} produto(s) disponíveis</p>

      <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
        {filtered.map(produto => {
          const preco = getPreco(produto.id);
          const totalQty = quantidadesMap[produto.id] || 0;

          return (
            <div
              key={produto.id}
              className={`rounded-lg border transition-colors ${
                totalQty > 0 ? 'bg-green-50 border-green-300' : 'bg-white border-slate-200'
              }`}
            >
              <div className="flex items-center gap-3 p-2.5">
                {/* Foto */}
                <div className="w-14 h-14 rounded-lg bg-slate-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
                  {produto.imagem_url ? (
                    <img src={produto.imagem_url} alt={produto.nome} className="w-full h-full object-cover rounded-lg" />
                  ) : (
                    <Package className="w-6 h-6 text-slate-300" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-mono text-slate-500">{produto.codigo}</span>
                    {totalQty > 0 && <Check className="w-3.5 h-3.5 text-green-600" />}
                  </div>
                  <p className="text-sm font-medium truncate leading-tight">{produto.nome}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {produto.peso > 0 && (
                      <span className="text-[10px] text-slate-400">{produto.peso}g</span>
                    )}
                    <span className="text-xs font-semibold text-blue-700">
                      R$ {preco.toFixed(2).replace('.', ',')}
                    </span>
                    {totalQty > 0 && (
                      <span className="text-[10px] font-medium text-green-700 bg-green-100 px-1.5 rounded">
                        {totalQty} un.
                      </span>
                    )}
                  </div>
                </div>

                {/* Venda: controles +/- direto */}
                {!isTroca && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8 rounded-full"
                      disabled={totalQty <= 0}
                      onClick={() => onUpdateQuantidade(produto, preco, Math.max(0, totalQty - 1))}
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </Button>
                    <Input
                      type="number"
                      min="0"
                      value={totalQty || ''}
                      placeholder="0"
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0;
                        onUpdateQuantidade(produto, preco, Math.max(0, val));
                      }}
                      className="w-14 h-8 text-center text-sm font-semibold px-1"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-8 w-8 rounded-full bg-amber-50 border-amber-300 hover:bg-amber-100"
                      onClick={() => onUpdateQuantidade(produto, preco, totalQty + 1)}
                    >
                      <Plus className="w-3.5 h-3.5 text-amber-700" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Troca: linha de motivo + qtd + botão adicionar */}
              {isTroca && (
                <div className="px-2.5 pb-2.5 pt-0">
                  <div className="flex items-center gap-2">
                    <Select
                      value={getTrocaInput(produto.id).motivoId}
                      onValueChange={(val) => setTrocaInput(produto.id, 'motivoId', val)}
                    >
                      <SelectTrigger className="h-8 text-xs flex-1">
                        <SelectValue placeholder="Motivo da troca..." />
                      </SelectTrigger>
                      <SelectContent>
                        {motivosTroca.map(m => (
                          <SelectItem key={m.id} value={m.id}>{m.descricao}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-8 w-8 rounded-full"
                        onClick={() => {
                          const cur = getTrocaInput(produto.id).quantidade;
                          setTrocaInput(produto.id, 'quantidade', Math.max(1, (cur || 1) - 1));
                        }}
                      >
                        <Minus className="w-3 h-3" />
                      </Button>
                      <Input
                        type="number"
                        min="1"
                        value={getTrocaInput(produto.id).quantidade || ''}
                        placeholder="1"
                        onChange={(e) => setTrocaInput(produto.id, 'quantidade', parseInt(e.target.value) || 1)}
                        className="w-12 h-8 text-center text-xs font-semibold px-1"
                      />
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-8 w-8 rounded-full"
                        onClick={() => {
                          const cur = getTrocaInput(produto.id).quantidade;
                          setTrocaInput(produto.id, 'quantidade', (cur || 1) + 1);
                        }}
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      className="h-8 bg-orange-500 hover:bg-orange-600 text-white text-xs px-3"
                      disabled={!getTrocaInput(produto.id).motivoId}
                      onClick={() => handleAdicionarTroca(produto)}
                    >
                      <ShoppingCart className="w-3.5 h-3.5 mr-1" />
                      Add
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}