import React, { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, Minus, Package, Check } from 'lucide-react';

export default function ProdutoCardList({
  produtos,
  precosAll,
  tabelaPrecoId,
  itensLocal,
  onUpdateQuantidade,
  motivosTroca,
  tipo,
}) {
  const [search, setSearch] = useState('');

  // Produtos com preço na tabela do cliente
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

  // Quantidades atuais dos itens já adicionados
  const quantidadesMap = useMemo(() => {
    const m = {};
    itensLocal.forEach((item, idx) => {
      m[item.produto_id] = { quantidade: item.quantidade, index: idx };
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

  return (
    <div className="space-y-3">
      {/* Search */}
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

      {/* Product list */}
      <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
        {filtered.map(produto => {
          const preco = getPreco(produto.id);
          const existing = quantidadesMap[produto.id];
          const qty = existing?.quantidade || 0;

          return (
            <div
              key={produto.id}
              className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                qty > 0 ? 'bg-green-50 border-green-300' : 'bg-white border-slate-200'
              }`}
            >
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
                  {qty > 0 && <Check className="w-3.5 h-3.5 text-green-600" />}
                </div>
                <p className="text-sm font-medium truncate leading-tight">{produto.nome}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {produto.peso > 0 && (
                    <span className="text-[10px] text-slate-400">{produto.peso}g</span>
                  )}
                  <span className="text-xs font-semibold text-blue-700">
                    R$ {preco.toFixed(2).replace('.', ',')}
                  </span>
                </div>
              </div>

              {/* Quantity controls */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8 rounded-full"
                  disabled={qty <= 0}
                  onClick={() => onUpdateQuantidade(produto, preco, Math.max(0, qty - 1))}
                >
                  <Minus className="w-3.5 h-3.5" />
                </Button>
                <Input
                  type="number"
                  min="0"
                  value={qty || ''}
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
                  onClick={() => onUpdateQuantidade(produto, preco, qty + 1)}
                >
                  <Plus className="w-3.5 h-3.5 text-amber-700" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}