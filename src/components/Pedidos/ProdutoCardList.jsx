import React, { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Plus, Minus, Package, Check, Trash2, AlertCircle } from 'lucide-react';

export default function ProdutoCardList({
  produtos,
  precosAll,
  tabelaPrecoId,
  itensLocal,
  onUpdateQuantidade,
  onAddTrocaItem,
  onRemoveTrocaItem,
  motivosTroca,
  isTroca,
  bloquearSemTabela = false,
}) {
  const [search, setSearch] = useState('');

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

  const quantidadesMap = useMemo(() => {
    if (isTroca) return {};
    const m = {};
    itensLocal.forEach((item) => {
      if (m[item.produto_id]) {
        m[item.produto_id].quantidade += item.quantidade;
      } else {
        m[item.produto_id] = { quantidade: item.quantidade };
      }
    });
    return m;
  }, [itensLocal, isTroca]);

  // For troca mode: group items by produto_id
  const itensPorProduto = useMemo(() => {
    if (!isTroca) return {};
    const m = {};
    itensLocal.forEach((item, idx) => {
      if (!m[item.produto_id]) m[item.produto_id] = [];
      m[item.produto_id].push({ ...item, _index: idx });
    });
    return m;
  }, [itensLocal, isTroca]);

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

  // Totais para venda
  const totaisVenda = useMemo(() => {
    if (isTroca) return { totalItens: 0, totalUnidades: 0, totalValor: 0 };
    let totalItens = 0;
    let totalUnidades = 0;
    let totalValor = 0;
    itensLocal.forEach(item => {
      if (item.quantidade > 0) {
        totalItens++;
        totalUnidades += item.quantidade;
        totalValor += (item.quantidade * (item.valor_unitario || 0));
      }
    });
    return { totalItens, totalUnidades, totalValor };
  }, [itensLocal, isTroca]);

  return (
    <div className="space-y-3">
      {bloquearSemTabela ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Cliente sem tabela de preço cadastrada</p>
            <p className="text-sm text-amber-800">Nenhum produto pode ser exibido até que uma tabela de preço seja vinculada ao cliente.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Resumo de totais - sempre visível */}
          {!isTroca && (
            <div className="flex items-center justify-between p-3 rounded-lg border border-green-200 bg-green-50">
              <span className="text-sm font-semibold text-green-800">
                {totaisVenda.totalItens} item(ns) • {totaisVenda.totalUnidades} unid.
              </span>
              <span className="text-sm font-bold text-green-900">
                R$ {totaisVenda.totalValor.toFixed(2).replace('.', ',')}
              </span>
            </div>
          )}

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

          <div className="space-y-2 max-h-[55vh] overflow-auto pr-1">
        {filtered.map(produto => {
          const preco = getPreco(produto.id);

          if (isTroca) {
            return (
              <TrocaProductCard
                key={produto.id}
                produto={produto}
                preco={preco}
                motivosTroca={motivosTroca}
                itensAdicionados={itensPorProduto[produto.id] || []}
                onAdd={(qty, motivoId) => onAddTrocaItem(produto, preco, qty, motivoId)}
                onRemove={(idx) => onRemoveTrocaItem(idx)}
              />
            );
          }

          const qty = quantidadesMap[produto.id]?.quantidade || 0;

          return (
            <div
              key={produto.id}
              className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                qty > 0 ? 'bg-green-50 border-green-300' : 'bg-white border-slate-200'
              }`}
            >
              <div className="w-14 h-14 rounded-lg bg-slate-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
                {produto.imagem_url ? (
                  <img src={produto.imagem_url} alt={produto.nome} className="w-full h-full object-cover rounded-lg" />
                ) : (
                  <Package className="w-6 h-6 text-slate-300" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-slate-500">{produto.codigo}</span>
                  {qty > 0 && <Check className="w-3.5 h-3.5 text-green-600" />}
                </div>
                <p className="text-sm font-medium truncate leading-tight">{produto.nome}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {produto.peso > 0 && <span className="text-[10px] text-slate-400">{produto.peso}g</span>}
                  <span className="text-xs font-semibold text-blue-700">R$ {preco.toFixed(2).replace('.', ',')}</span>
                </div>
                {qty > 0 && (
                  <p className="text-[11px] font-semibold text-green-700 mt-0.5">
                    Total: R$ {(qty * preco).toFixed(2).replace('.', ',')}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1 flex-shrink-0">
                <Button size="icon" variant="outline" className="h-8 w-8 rounded-full" disabled={qty <= 0}
                  onClick={() => onUpdateQuantidade(produto, preco, Math.max(0, qty - 1))}>
                  <Minus className="w-3.5 h-3.5" />
                </Button>
                <Input type="number" min="0" value={qty || ''} placeholder="0"
                  onChange={(e) => onUpdateQuantidade(produto, preco, Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-14 h-8 text-center text-sm font-semibold px-1" />
                <Button size="icon" variant="outline" className="h-8 w-8 rounded-full bg-amber-50 border-amber-300 hover:bg-amber-100"
                  onClick={() => onUpdateQuantidade(produto, preco, qty + 1)}>
                  <Plus className="w-3.5 h-3.5 text-amber-700" />
                </Button>
              </div>
            </div>
          );
        })}
          </div>
        </>
      )}
    </div>
  );
}

function TrocaProductCard({ produto, preco, motivosTroca, itensAdicionados, onAdd, onRemove }) {
  const [motivoId, setMotivoId] = useState('');
  const [qty, setQty] = useState(1);
  const hasItems = itensAdicionados.length > 0;

  const handleAdd = () => {
    if (!motivoId) return;
    onAdd(qty, motivoId);
    setMotivoId('');
    setQty(1);
  };

  return (
    <div className={`rounded-lg border transition-colors ${hasItems ? 'bg-orange-50 border-orange-300' : 'bg-white border-slate-200'}`}>
      {/* Product info row */}
      <div className="flex items-center gap-3 p-2.5">
        <div className="w-14 h-14 rounded-lg bg-slate-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
          {produto.imagem_url ? (
            <img src={produto.imagem_url} alt={produto.nome} className="w-full h-full object-cover rounded-lg" />
          ) : (
            <Package className="w-6 h-6 text-slate-300" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono text-slate-500">{produto.codigo}</span>
            {hasItems && <Check className="w-3.5 h-3.5 text-orange-600" />}
          </div>
          <p className="text-sm font-medium truncate leading-tight">{produto.nome}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {produto.peso > 0 && <span className="text-[10px] text-slate-400">{produto.peso}g</span>}
            <span className="text-xs font-semibold text-blue-700">R$ {preco.toFixed(2).replace('.', ',')}</span>
          </div>
        </div>
      </div>

      {/* Added troca items */}
      {itensAdicionados.length > 0 && (
        <div className="px-2.5 pb-1 space-y-1">
          {itensAdicionados.map((item) => (
            <div key={item._index} className="flex items-center justify-between text-xs bg-white rounded px-2 py-1.5 border border-orange-200">
              <div className="flex-1 min-w-0">
                <span className="font-medium">Qtd: {item.quantidade}</span>
                <span className="mx-1.5 text-slate-300">|</span>
                <span className="text-orange-700 truncate">{item.motivo_troca_descricao || 'Sem motivo'}</span>
              </div>
              <Button size="icon" variant="ghost" className="h-6 w-6 text-red-400 hover:text-red-600"
                onClick={() => onRemove(item._index)}>
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add new troca item form */}
      <div className="px-2.5 pb-2.5 pt-1">
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <Button size="icon" variant="outline" className="h-8 w-8 rounded-full"
              disabled={qty <= 1} onClick={() => setQty(Math.max(1, qty - 1))}>
              <Minus className="w-3 h-3" />
            </Button>
            <Input type="number" min="1" value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-12 h-8 text-center text-xs px-0.5" />
            <Button size="icon" variant="outline" className="h-8 w-8 rounded-full"
              onClick={() => setQty(qty + 1)}>
              <Plus className="w-3 h-3" />
            </Button>
          </div>
          <Select value={motivoId} onValueChange={setMotivoId}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue placeholder="Motivo da troca..." />
            </SelectTrigger>
            <SelectContent>
              {motivosTroca.map(m => (
                <SelectItem key={m.id} value={m.id}>{m.descricao}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8 bg-orange-500 hover:bg-orange-600 text-white px-3"
            disabled={!motivoId} onClick={handleAdd}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Button>
        </div>
      </div>
    </div>
  );
}