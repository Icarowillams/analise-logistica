import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Save, Search, Trash2, Plus, Pencil } from 'lucide-react';
import { toast } from 'sonner';

export default function PedidoFormulario({ cliente, tipo, vendedor, editingPedidoId, onVoltar }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('pedido');
  const [salvando, setSalvando] = useState(false);
  const [pedidoId, setPedidoId] = useState(editingPedidoId || null);

  // Pedido fields
  const [planoPagamentoId, setPlanoPagamentoId] = useState(cliente.plano_pagamento_id || '');
  const [tabelaPrecoId, setTabelaPrecoId] = useState(cliente.tabela_id || '');
  const [modeloNota, setModeloNota] = useState(tipo === 'troca' ? 'd1' : '55');
  const [dataPrevisaoEntrega, setDataPrevisaoEntrega] = useState('');
  const [numeroPedidoCompra, setNumeroPedidoCompra] = useState('');
  const [observacoes, setObservacoes] = useState('');

  // Product tab fields
  const [produtoSearch, setProdutoSearch] = useState('');
  const [selectedProdutoId, setSelectedProdutoId] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [valorUnitario, setValorUnitario] = useState(0);
  const [itensLocal, setItensLocal] = useState([]);
  const [editingItemIndex, setEditingItemIndex] = useState(null);
  const [motivoTrocaId, setMotivoTrocaId] = useState('');

  const { data: planosPagamento = [] } = useQuery({
    queryKey: ['planosPagamento'],
    queryFn: () => base44.entities.PlanoPagamento.list()
  });

  const { data: tabelasPreco = [] } = useQuery({
    queryKey: ['tabelasPreco'],
    queryFn: () => base44.entities.TabelaPreco.list()
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.filter({ status: 'ativo' })
  });

  const { data: precosAll = [] } = useQuery({
    queryKey: ['precosProduto', tabelaPrecoId],
    queryFn: () => tabelaPrecoId ? base44.entities.PrecoProduto.filter({ tabela_id: tabelaPrecoId }) : [],
    enabled: !!tabelaPrecoId
  });

  const { data: motivosTroca = [] } = useQuery({
    queryKey: ['motivosTroca'],
    queryFn: () => base44.entities.MotivoTroca.list(),
    enabled: tipo === 'troca'
  });

  // Load existing pedido if editing
  const { data: existingPedido } = useQuery({
    queryKey: ['pedido-detail', editingPedidoId],
    queryFn: async () => {
      if (!editingPedidoId) return null;
      const pedidos = await base44.entities.Pedido.filter({});
      return pedidos.find(p => p.id === editingPedidoId);
    },
    enabled: !!editingPedidoId
  });

  const { data: existingItems = [] } = useQuery({
    queryKey: ['pedido-items', editingPedidoId],
    queryFn: () => editingPedidoId ? base44.entities.PedidoItem.filter({ pedido_id: editingPedidoId }) : [],
    enabled: !!editingPedidoId
  });

  useEffect(() => {
    if (existingPedido) {
      setPlanoPagamentoId(existingPedido.plano_pagamento_id || '');
      setTabelaPrecoId(existingPedido.tabela_preco_id || '');
      setModeloNota(existingPedido.modelo_nota || (tipo === 'troca' ? 'd1' : '55'));
      setDataPrevisaoEntrega(existingPedido.data_previsao_entrega || '');
      setNumeroPedidoCompra(existingPedido.numero_pedido_compra || '');
      setObservacoes(existingPedido.observacoes || '');
    }
  }, [existingPedido]);

  useEffect(() => {
    if (existingItems.length > 0 && itensLocal.length === 0) {
      setItensLocal(existingItems.map(item => ({
        dbId: item.id,
        produto_id: item.produto_id,
        produto_codigo: item.produto_codigo,
        produto_nome: item.produto_nome,
        quantidade: item.quantidade,
        valor_unitario: item.valor_unitario,
        valor_total: item.valor_total,
        motivo_troca_id: item.motivo_troca_id || '',
        motivo_troca_descricao: item.motivo_troca_descricao || ''
      })));
    }
  }, [existingItems]);

  // When a product is selected, find its price
  useEffect(() => {
    if (selectedProdutoId && tabelaPrecoId) {
      const preco = precosAll.find(p => p.produto_id === selectedProdutoId);
      if (preco) {
        const val = (preco.ativacao_acao && preco.valor_acao) ? preco.valor_acao : preco.valor_unitario;
        setValorUnitario(val || 0);
      } else {
        setValorUnitario(0);
      }
    }
  }, [selectedProdutoId, precosAll, tabelaPrecoId]);

  // Auto-select product when search matches a code exactly
  useEffect(() => {
    if (produtoSearch.trim()) {
      const match = produtos.find(p => p.codigo === produtoSearch.trim());
      if (match) {
        setSelectedProdutoId(match.id);
      }
    }
  }, [produtoSearch, produtos]);

  const produtosFiltrados = useMemo(() => {
    const s = produtoSearch.toLowerCase();
    if (!s) return produtos.slice(0, 50);
    return produtos.filter(p => 
      p.nome?.toLowerCase().includes(s) || p.codigo?.includes(s)
    ).slice(0, 50);
  }, [produtos, produtoSearch]);

  const selectedProduto = produtos.find(p => p.id === selectedProdutoId);
  const valorTotal = (parseFloat(quantidade) || 0) * valorUnitario;

  const planoAtual = planosPagamento.find(p => p.id === planoPagamentoId);
  const tabelaAtual = tabelasPreco.find(t => t.id === tabelaPrecoId);

  const adicionarItem = () => {
    if (!selectedProdutoId || !quantidade || parseFloat(quantidade) <= 0) {
      toast.error('Selecione um produto e informe a quantidade');
      return;
    }

    const produto = produtos.find(p => p.id === selectedProdutoId);
    const motivoObj = motivosTroca.find(m => m.id === motivoTrocaId);
    const novoItem = {
      produto_id: selectedProdutoId,
      produto_codigo: produto?.codigo || '',
      produto_nome: produto?.nome || '',
      quantidade: parseFloat(quantidade),
      valor_unitario: valorUnitario,
      valor_total: valorTotal,
      motivo_troca_id: tipo === 'troca' ? motivoTrocaId : '',
      motivo_troca_descricao: tipo === 'troca' ? (motivoObj?.descricao || '') : ''
    };

    if (editingItemIndex !== null) {
      const updated = [...itensLocal];
      updated[editingItemIndex] = { ...updated[editingItemIndex], ...novoItem };
      setItensLocal(updated);
      setEditingItemIndex(null);
    } else {
      setItensLocal(prev => [...prev, novoItem]);
    }

    setSelectedProdutoId('');
    setProdutoSearch('');
    setQuantidade('');
    setValorUnitario(0);
    setMotivoTrocaId('');
    toast.success('Item adicionado!');
  };

  const removerItem = (index) => {
    setItensLocal(prev => prev.filter((_, i) => i !== index));
  };

  const editarItem = (index) => {
    const item = itensLocal[index];
    setSelectedProdutoId(item.produto_id);
    setQuantidade(String(item.quantidade));
    setValorUnitario(item.valor_unitario);
    setMotivoTrocaId(item.motivo_troca_id || '');
    setEditingItemIndex(index);
  };

  const totalPedido = itensLocal.reduce((sum, item) => sum + (item.valor_total || 0), 0);

  const salvarPedido = async () => {
    if (itensLocal.length === 0) {
      toast.error('Adicione pelo menos um item ao pedido');
      return;
    }
    setSalvando(true);

    const planoObj = planosPagamento.find(p => p.id === planoPagamentoId);
    const tabelaObj = tabelasPreco.find(t => t.id === tabelaPrecoId);

    const pedidoData = {
      tipo,
      status: 'pendente',
      cliente_id: cliente.id,
      cliente_codigo: cliente.codigo || '',
      cliente_nome: cliente.razao_social || '',
      cliente_nome_fantasia: cliente.nome_fantasia || '',
      cliente_endereco: cliente.endereco || '',
      cliente_numero: cliente.numero || '',
      cliente_bairro: cliente.bairro || '',
      cliente_cidade: cliente.cidade || '',
      cliente_estado: cliente.estado || '',
      cliente_cep: cliente.cep || '',
      cliente_cpf_cnpj: cliente.cpf_cnpj || '',
      vendedor_id: vendedor.id,
      vendedor_nome: vendedor.nome,
      plano_pagamento_id: planoPagamentoId,
      plano_pagamento_nome: planoObj?.nome || '',
      tabela_preco_id: tabelaPrecoId,
      tabela_preco_nome: tabelaObj?.nome || '',
      modelo_nota: tipo === 'troca' ? 'd1' : modeloNota,
      data_previsao_entrega: dataPrevisaoEntrega,
      numero_pedido_compra: numeroPedidoCompra,
      observacoes,
      total_itens: itensLocal.length,
      valor_total: totalPedido
    };

    let savedPedidoId = pedidoId;

    if (pedidoId) {
      await base44.entities.Pedido.update(pedidoId, pedidoData);
      // Delete old items
      for (const item of existingItems) {
        await base44.entities.PedidoItem.delete(item.id);
      }
    } else {
      const created = await base44.entities.Pedido.create(pedidoData);
      savedPedidoId = created.id;
      setPedidoId(created.id);
    }

    // Create items
    for (const item of itensLocal) {
      const itemData = {
        pedido_id: savedPedidoId,
        produto_id: item.produto_id,
        produto_codigo: item.produto_codigo,
        produto_nome: item.produto_nome,
        quantidade: item.quantidade,
        valor_unitario: item.valor_unitario,
        valor_total: item.valor_total
      };
      if (tipo === 'troca' && item.motivo_troca_id) {
        itemData.motivo_troca_id = item.motivo_troca_id;
        itemData.motivo_troca_descricao = item.motivo_troca_descricao;
      }
      await base44.entities.PedidoItem.create(itemData);
    }

    queryClient.invalidateQueries({ queryKey: ['pedidos'] });
    queryClient.invalidateQueries({ queryKey: ['pedido-items'] });
    toast.success('Pedido salvo com sucesso!');
    setSalvando(false);
    onVoltar();
  };

  return (
    <div className="space-y-4">
      <button onClick={onVoltar} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {tipo === 'troca' ? 'Troca' : 'Venda'} - {cliente.codigo} - {cliente.nome_fantasia || cliente.razao_social}
            </CardTitle>
            <Badge className={tipo === 'troca' ? 'bg-orange-500' : 'bg-green-500'}>{tipo === 'troca' ? 'Troca' : 'Venda'}</Badge>
          </div>
        </CardHeader>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="pedido">Pedido</TabsTrigger>
          <TabsTrigger value="produto">Produto</TabsTrigger>
        </TabsList>

        {/* Tab Pedido */}
        <TabsContent value="pedido">
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div>
                <Label className="text-xs text-slate-500">Cliente</Label>
                <p className="text-sm font-medium">{cliente.codigo} - {cliente.razao_social}</p>
              </div>
              <div>
                <Label className="text-xs text-slate-500">Endereço</Label>
                <p className="text-sm">{[cliente.endereco, cliente.numero, cliente.bairro, cliente.cidade, cliente.estado].filter(Boolean).join(', ')}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-slate-500">Plano de Pagamento</Label>
                  <p className="text-sm font-medium">{planoAtual?.nome || '-'}</p>
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Tabela de Preço</Label>
                  <p className="text-sm font-medium">{tabelaAtual?.nome || '-'}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-slate-500">Modelo da Nota</Label>
                  <p className="text-sm font-medium">{tipo === 'troca' ? 'D1' : modeloNota === 'nfce' ? 'NFCe' : '55'}</p>
                </div>
                <div>
                  <Label>Data Previsão de Entrega</Label>
                  <Input type="date" value={dataPrevisaoEntrega} onChange={(e) => setDataPrevisaoEntrega(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Nº Pedido Compra</Label>
                <Input value={numeroPedidoCompra} onChange={(e) => setNumeroPedidoCompra(e.target.value)} placeholder="Número do pedido de compra do cliente" />
              </div>
              <div>
                <Label>Observações</Label>
                <Input value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Observações do pedido..." />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab Produto */}
        <TabsContent value="produto">
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div>
                <Label>Produto *</Label>
                <div className="flex gap-2">
                  <div className="relative w-36 shrink-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                      placeholder="Cód..."
                      value={produtoSearch}
                      onChange={(e) => setProdutoSearch(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <div className="flex-1">
                    <Select value={selectedProdutoId} onValueChange={(val) => { setSelectedProdutoId(val); const p = produtos.find(pr => pr.id === val); if (p) setProdutoSearch(p.codigo || ''); }}>
                      <SelectTrigger><SelectValue placeholder="Selecione o produto..." /></SelectTrigger>
                      <SelectContent>
                        {produtosFiltrados.map(p => (
                          <SelectItem key={p.id} value={p.id}>{p.codigo} - {p.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div>
                <Label>Quantidade *</Label>
                <Input type="number" min="1" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} placeholder="0" />
              </div>
              {tipo === 'troca' && (
                <div>
                  <Label>Motivo da Troca</Label>
                  <Select value={motivoTrocaId} onValueChange={setMotivoTrocaId}>
                    <SelectTrigger><SelectValue placeholder="Selecione o motivo..." /></SelectTrigger>
                    <SelectContent>
                      {motivosTroca.map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.descricao}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Card className="bg-blue-50 border-blue-200">
                  <CardContent className="p-3 text-center">
                    <p className="text-xs text-blue-600">Valor Unitário</p>
                    <p className="text-lg font-bold text-blue-800">R$ {valorUnitario.toFixed(2)}</p>
                  </CardContent>
                </Card>
                <Card className="bg-green-50 border-green-200">
                  <CardContent className="p-3 text-center">
                    <p className="text-xs text-green-600">Valor Total</p>
                    <p className="text-lg font-bold text-green-800">R$ {valorTotal.toFixed(2)}</p>
                  </CardContent>
                </Card>
              </div>
              <Button onClick={adicionarItem} className="w-full bg-gradient-to-r from-amber-500 to-amber-600" disabled={!selectedProdutoId || !quantidade}>
                <Plus className="w-4 h-4 mr-2" />
                {editingItemIndex !== null ? 'Atualizar Item' : 'Adicionar Item'}
              </Button>

              {/* Items added */}
              {itensLocal.length > 0 && (
                <div className="space-y-2 mt-4">
                  <h4 className="text-sm font-semibold text-slate-700">Itens adicionados ({itensLocal.length})</h4>
                  {itensLocal.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{item.produto_codigo} - {item.produto_nome}</p>
                        <p className="text-xs text-slate-500">
                          Qtd: {item.quantidade} | Unit: R$ {item.valor_unitario.toFixed(2)} | Total: R$ {item.valor_total.toFixed(2)}
                          {item.motivo_troca_descricao ? ` | Motivo: ${item.motivo_troca_descricao}` : ''}
                        </p>
                      </div>
                      <div className="flex gap-1 ml-2">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => editarItem(idx)}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => removerItem(idx)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>


      </Tabs>

      {/* Save button */}
      <Button onClick={salvarPedido} disabled={salvando || itensLocal.length === 0} className="w-full bg-gradient-to-r from-green-500 to-green-600">
        <Save className="w-4 h-4 mr-2" />
        {salvando ? 'Salvando...' : 'Salvar Pedido'}
      </Button>
    </div>
  );
}