import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import ProdutoCardList from './ProdutoCardList';

export default function PedidoFormulario({ cliente, tipo, vendedor, editingPedidoId, onVoltar, permissaoCenariosFiscais }) {
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
  const [itensLocal, setItensLocal] = useState([]);
  const [cenarioFiscalCodigo, setCenarioFiscalCodigo] = useState('');
  const [cenarioFiscalNome, setCenarioFiscalNome] = useState('');
  const [cenarios, setCenarios] = useState([]);
  const [loadingCenarios, setLoadingCenarios] = useState(false);

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

  const isTroca = cenarioFiscalCodigo === 'troca';

  const { data: motivosTroca = [] } = useQuery({
    queryKey: ['motivosTroca'],
    queryFn: () => base44.entities.MotivoTroca.list()
  });

  // Carrega cenários fiscais do Omie (com permissão, inclui opção Troca)
  const mostrarCenarioFiscal = !!permissaoCenariosFiscais;

  useEffect(() => {
    if (mostrarCenarioFiscal && cenarios.length === 0) {
      setLoadingCenarios(true);
      base44.functions.invoke('listarCenariosOmie', {})
        .then(resp => {
          const data = resp.data;
          if (data.sucesso && data.cenarios) {
            setCenarios(data.cenarios);
            // Se houver cenário padrão, pré-selecionar
            const padrao = data.cenarios.find(c => c.padrao);
            if (padrao && !cenarioFiscalCodigo) {
              setCenarioFiscalCodigo(String(padrao.codigo));
              setCenarioFiscalNome(padrao.nome);
            }
          }
        })
        .catch(() => {})
        .finally(() => setLoadingCenarios(false));
    }
  }, [mostrarCenarioFiscal]);

  // Load existing pedido if editing
  const { data: existingPedido } = useQuery({
    queryKey: ['pedido-detail', editingPedidoId],
    queryFn: async () => {
      if (!editingPedidoId) return null;
      const p = await base44.entities.Pedido.list('-created_date', 5000);
      return p.find(x => x.id === editingPedidoId);
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
      if (existingPedido.cenario_fiscal_codigo) {
        setCenarioFiscalCodigo(String(existingPedido.cenario_fiscal_codigo));
        setCenarioFiscalNome(existingPedido.cenario_fiscal_nome || '');
      }
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

  const planoAtual = planosPagamento.find(p => p.id === planoPagamentoId);
  const tabelaAtual = tabelasPreco.find(t => t.id === tabelaPrecoId);

  const handleUpdateQuantidade = (produto, preco, novaQtd) => {
    setItensLocal(prev => {
      const idx = prev.findIndex(i => i.produto_id === produto.id);
      if (novaQtd <= 0) {
        return idx >= 0 ? prev.filter((_, i) => i !== idx) : prev;
      }
      const item = {
        produto_id: produto.id,
        produto_codigo: produto.codigo || '',
        produto_nome: produto.nome || '',
        quantidade: novaQtd,
        valor_unitario: preco,
        valor_total: novaQtd * preco,
        motivo_troca_id: '',
        motivo_troca_descricao: '',
      };
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...item };
        return updated;
      }
      return [...prev, item];
    });
  };

  const handleAddTrocaItem = (produto, preco, quantidade, motivoId) => {
    const motivoObj = motivosTroca.find(m => m.id === motivoId);
    const novoItem = {
      produto_id: produto.id,
      produto_codigo: produto.codigo || '',
      produto_nome: produto.nome || '',
      quantidade,
      valor_unitario: preco,
      valor_total: quantidade * preco,
      motivo_troca_id: motivoId,
      motivo_troca_descricao: motivoObj?.descricao || '',
    };
    setItensLocal(prev => [...prev, novoItem]);
  };

  const handleRemoveTrocaItem = (index) => {
    setItensLocal(prev => prev.filter((_, i) => i !== index));
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

    const tipoFinal = isTroca ? 'troca' : tipo;

    const pedidoData = {
      tipo: tipoFinal,
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
      modelo_nota: tipoFinal === 'troca' ? 'd1' : modeloNota,
      cenario_fiscal_codigo: cenarioFiscalCodigo ? Number(cenarioFiscalCodigo) : null,
      cenario_fiscal_nome: cenarioFiscalNome || null,
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
      pedidoData.status = 'pendente';
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
      if (item.motivo_troca_id) {
        itemData.motivo_troca_id = item.motivo_troca_id;
        itemData.motivo_troca_descricao = item.motivo_troca_descricao;
      }
      await base44.entities.PedidoItem.create(itemData);
    }

    // Se o pedido já foi enviado ao Omie, sincronizar alterações
    if (pedidoId && existingPedido?.omie_enviado && existingPedido?.omie_codigo_pedido) {
      try {
        const resp = await base44.functions.invoke('editarPedidoOmie', { pedido_id: savedPedidoId });
        const result = resp.data;
        if (result.sucesso) {
          toast.success('Pedido salvo e atualizado no Omie!');
        } else {
          toast.warning(`Pedido salvo, mas erro ao atualizar no Omie: ${result.erro}`);
        }
      } catch (omieErr) {
        toast.warning('Pedido salvo localmente, mas falhou ao sincronizar com Omie');
      }
    } else {
      toast.success('Pedido salvo com sucesso!');
    }

    queryClient.invalidateQueries({ queryKey: ['pedidos'] });
    queryClient.invalidateQueries({ queryKey: ['pedido-items'] });
    queryClient.invalidateQueries({ queryKey: ['todos-pedidos'] });
    queryClient.invalidateQueries({ queryKey: ['pedidoItems-all-gestao'] });
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
              {isTroca ? 'Troca' : 'Venda'} - {cliente.codigo} - {cliente.nome_fantasia || cliente.razao_social}
            </CardTitle>
            <Badge className={isTroca ? 'bg-orange-500' : 'bg-green-500'}>{isTroca ? 'Troca' : 'Venda'}</Badge>
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
              {mostrarCenarioFiscal && (
                <div>
                  <Label className="text-xs text-slate-500">Cenário Fiscal (Omie)</Label>
                  {loadingCenarios ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Carregando cenários...
                    </div>
                  ) : (
                    <Select
                      value={cenarioFiscalCodigo}
                      onValueChange={(val) => {
                        setCenarioFiscalCodigo(val);
                        const c = cenarios.find(c => String(c.codigo) === val);
                        setCenarioFiscalNome(c?.nome || '');
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o cenário fiscal..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="troca">Troca (sem Omie)</SelectItem>
                        {cenarios.map(c => (
                          <SelectItem key={c.codigo} value={String(c.codigo)}>
                            {c.codigo} - {c.nome} {c.padrao ? '(Padrão)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
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
              {/* Resumo do pedido */}
              {itensLocal.length > 0 && (
                <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="text-sm">
                    <span className="font-semibold text-green-800">{itensLocal.length} item(ns)</span>
                    <span className="text-green-600 mx-2">•</span>
                    <span className="text-green-600">{itensLocal.reduce((s, i) => s + i.quantidade, 0)} unid.</span>
                  </div>
                  <div className="text-lg font-bold text-green-800">
                    R$ {totalPedido.toFixed(2).replace('.', ',')}
                  </div>
                </div>
              )}

              <ProdutoCardList
                produtos={produtos}
                precosAll={precosAll}
                tabelaPrecoId={tabelaPrecoId}
                itensLocal={itensLocal}
                onUpdateQuantidade={handleUpdateQuantidade}
                onAddTrocaItem={handleAddTrocaItem}
                onRemoveTrocaItem={handleRemoveTrocaItem}
                motivosTroca={motivosTroca}
                isTroca={isTroca}
              />
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