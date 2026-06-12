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

// Regra de prioridade de preço (escopo Omie):
// 1. AcaoPromocional ativa (status=ativa, dentro do período, vinculada ao cliente OU à tabela do cliente)
// 2. PrecoProduto.valor_acao se ativacao_acao=true (e dentro do período)
// 3. PrecoProduto.valor_unitario
function getAcoesAtivasParaCliente(acoes, clienteId, tabelaClienteId) {
  const hoje = new Date().toISOString().split('T')[0];
  return acoes.filter(a => {
    if (a.status !== 'ativa') return false;
    if (a.data_inicio > hoje || a.data_fim < hoje) return false;
    // Se a ação está vinculada a uma tabela específica, ela só vale para clientes daquela tabela
    if (a.tabela_id && a.tabela_id !== tabelaClienteId) return false;
    // Se tem lista de clientes, precisa estar nela
    if (a.clientes_ids && a.clientes_ids.length > 0) {
      return a.clientes_ids.includes(clienteId);
    }
    // Sem lista de clientes E (sem tabela OU tabela igual à do cliente) → vale para todos
    return true;
  });
}

export default function PedidoFormulario({ cliente, tipo, vendedor, editingPedidoId, onVoltar, permissaoCenariosFiscais }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('pedido');
  const [salvando, setSalvando] = useState(false);
  const [pedidoId, setPedidoId] = useState(editingPedidoId || null);

  // Pedido fields
  const [planoPagamentoId, setPlanoPagamentoId] = useState(cliente.plano_pagamento_id || '');
  const [tabelaPrecoId, setTabelaPrecoId] = useState(cliente.tabela_id || '');
  const [modeloNota, setModeloNota] = useState(
    tipo === 'troca' ? 'd1' : (cliente.tipo_nota === 'D1' ? 'd1' : '55')
  );
  const [dataPrevisaoEntrega, setDataPrevisaoEntrega] = useState('');
  const [numeroPedidoCompra, setNumeroPedidoCompra] = useState('');
  const [dadosAdicionaisNf, setDadosAdicionaisNf] = useState('');
  const [observacoesAdicionaisNf, setObservacoesAdicionaisNf] = useState('');

  // Product tab fields
  const [itensLocal, setItensLocal] = useState([]);
  // Cenário Fiscal Local — sempre usado (D1 ou 55). Para 55, contém o cenário Omie vinculado.
  const [cenarioLocalId, setCenarioLocalId] = useState('');
  const [cenarioFiscalCodigo, setCenarioFiscalCodigo] = useState('');
  const [cenarioFiscalNome, setCenarioFiscalNome] = useState('');

  const { data: planosPagamento = [], isLoading: loadingPlanos } = useQuery({
    queryKey: ['planosPagamento'],
    queryFn: () => base44.entities.PlanoPagamento.list(),
    staleTime: 10 * 60 * 1000,
  });

  // Busca o cliente DIRETO do banco ao abrir o formulário — evita usar versão
  // desatualizada do cache (lista de clientes fica 15 min em cache).
  const { data: clienteFresco } = useQuery({
    queryKey: ['cliente-fresco', cliente.id],
    queryFn: async () => {
      const r = await base44.entities.Cliente.filter({ id: cliente.id });
      return r[0] || null;
    },
    staleTime: 0,
  });

  // Preenche plano/tabela com os dados frescos caso o cache esteja vazio/antigo
  useEffect(() => {
    if (!clienteFresco) return;
    setPlanoPagamentoId(prev => prev || clienteFresco.plano_pagamento_id || '');
    setTabelaPrecoId(prev => prev || clienteFresco.tabela_id || '');
  }, [clienteFresco]);

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

  const { data: acoesPromocionais = [] } = useQuery({
    queryKey: ['acoesPromocionais'],
    queryFn: () => base44.entities.AcaoPromocional.list()
  });

  const acoesCliente = useMemo(() => {
    return getAcoesAtivasParaCliente(acoesPromocionais, cliente.id, tabelaPrecoId);
  }, [acoesPromocionais, cliente.id, tabelaPrecoId]);

  const isNotaD1 = modeloNota === 'd1' || tipo === 'troca' || cliente.tipo_nota === 'D1';

  const { data: motivosTroca = [] } = useQuery({
    queryKey: ['motivosTroca'],
    queryFn: () => base44.entities.MotivoTroca.list()
  });

  // Cenários Fiscais Locais — usados em ambos os fluxos (D1 e 55).
  // Para Nota 55: o cenário Omie vinculado (cenario_omie_codigo) é enviado ao Omie.
  // Para Nota D1: opera totalmente interno (não envia ao Omie).
  const { data: cenariosLocais = [], isLoading: loadingCenarios } = useQuery({
    queryKey: ['cenariosFiscaisLocais'],
    queryFn: () => base44.entities.CenarioFiscalLocal.filter({ status: 'ativo' })
  });

  // Cenários disponíveis: mostra TODOS (venda, bonificação, troca, etc.)
  // Se o usuário escolher um cenário tipo "troca", o pedido vira automaticamente Troca (D1, sem Omie).
  const cenariosDisponiveis = useMemo(() => cenariosLocais, [cenariosLocais]);

  const cenarioLocalAtual = cenariosLocais.find(c => c.id === cenarioLocalId);
  const isTroca = cenarioLocalAtual?.tipo_operacao === 'troca' || tipo === 'troca';

  // Pré-selecionar cenário padrão (apenas pedidos novos)
  // Regra: sempre prioriza um cenário do tipo "venda" — independentemente do modelo (D1 ou 55) e da origem (interno ou Omie).
  // Exceção: se o pedido for explicitamente uma "troca", começa com cenário de troca.
  useEffect(() => {
    if (cenariosDisponiveis.length > 0 && !cenarioLocalId && !editingPedidoId) {
      const tipoAlvo = tipo === 'troca' ? 'troca' : 'venda';
      const padrao =
        cenariosDisponiveis.find(c => c.tipo_operacao === tipoAlvo && c.padrao) ||
        cenariosDisponiveis.find(c => c.tipo_operacao === tipoAlvo) ||
        cenariosDisponiveis.find(c => c.padrao) ||
        cenariosDisponiveis[0];
      if (padrao) {
        setCenarioLocalId(padrao.id);
        // Para Nota 55, popula o código Omie vinculado
        if (!isNotaD1 && padrao.cenario_omie_codigo) {
          setCenarioFiscalCodigo(String(padrao.cenario_omie_codigo));
          setCenarioFiscalNome(padrao.cenario_omie_nome || padrao.nome);
        }
      }
    }
  }, [cenariosDisponiveis.length, isNotaD1, tipo]);

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
      // Fallback para o cadastro do cliente quando o pedido salvo não tem plano/tabela
      // (ex.: pedidos antigos ou importados do Omie sem esses campos)
      setPlanoPagamentoId(existingPedido.plano_pagamento_id || cliente.plano_pagamento_id || '');
      setTabelaPrecoId(existingPedido.tabela_preco_id || cliente.tabela_id || '');
      setModeloNota(existingPedido.modelo_nota || (tipo === 'troca' ? 'd1' : (cliente.tipo_nota === 'D1' ? 'd1' : '55')));
      setDataPrevisaoEntrega(existingPedido.data_previsao_entrega || '');
      setNumeroPedidoCompra(existingPedido.numero_pedido_compra || '');
      // Separar observações livres do texto automático (prefixo "Pedido Nº: ...")
      const rawDados = existingPedido.dados_adicionais_nf || '';
      setDadosAdicionaisNf(rawDados);
      const prefixRegex = /^Pedido Nº: .+?(\s*\|\s*|$)/;
      const match = rawDados.match(prefixRegex);
      if (match) {
        setObservacoesAdicionaisNf(rawDados.slice(match[0].length).trim());
      } else {
        setObservacoesAdicionaisNf(rawDados);
      }
      if (existingPedido.cenario_local_id) {
        setCenarioLocalId(existingPedido.cenario_local_id);
      }
      if (existingPedido.cenario_fiscal_codigo) {
        setCenarioFiscalCodigo(String(existingPedido.cenario_fiscal_codigo));
        setCenarioFiscalNome(existingPedido.cenario_fiscal_nome || '');
      }
    }
  }, [existingPedido]);

  // Sincroniza plano/tabela com o cadastro do cliente em pedidos NOVOS,
  // caso o objeto cliente chegue/atualize com esses campos após a montagem inicial.
  useEffect(() => {
    if (editingPedidoId) return;
    if (!planoPagamentoId && cliente.plano_pagamento_id) setPlanoPagamentoId(cliente.plano_pagamento_id);
    if (!tabelaPrecoId && cliente.tabela_id) setTabelaPrecoId(cliente.tabela_id);
  }, [cliente.plano_pagamento_id, cliente.tabela_id, editingPedidoId]);

  // Flag para controlar se já inicializou os itens do pedido
  const [itensInitialized, setItensInitialized] = useState(false);

  // Função para calcular o preço atualizado de um item — segue prioridade Omie:
  // 1) AcaoPromocional do cliente/tabela (com período válido)
  // 2) PrecoProduto.valor_acao (se ativacao_acao=true e periodo_acao_fim >= hoje)
  // 3) PrecoProduto.valor_unitario (preço base da tabela)
  const calcularPrecoAtual = (item) => {
    const hoje = new Date().toISOString().split('T')[0];
    let precoAtual = item.valor_unitario;

    // 1) Ação promocional ativa para este produto
    const acaoClienteItem = acoesCliente.find(a => a.produto_id === item.produto_id);
    if (acaoClienteItem && acaoClienteItem.valor_acao > 0) {
      return acaoClienteItem.valor_acao;
    }

    // 2/3) Preço da tabela
    if (precosAll.length > 0) {
      const precoTabela = precosAll.find(p => p.produto_id === item.produto_id);
      if (precoTabela) {
        const periodoOk = !precoTabela.periodo_acao_fim || precoTabela.periodo_acao_fim >= hoje;
        const acaoVigente = precoTabela.ativacao_acao && precoTabela.valor_acao > 0 && periodoOk;
        const precoNovo = acaoVigente ? precoTabela.valor_acao : precoTabela.valor_unitario;
        if (precoNovo > 0) precoAtual = precoNovo;
      }
    }
    return precoAtual;
  };

  // Inicializa itens ao carregar o pedido existente
  useEffect(() => {
    if (existingItems.length > 0 && !itensInitialized) {
      setItensLocal(existingItems.map(item => {
        const precoAtual = calcularPrecoAtual(item);
        return {
          dbId: item.id,
          produto_id: item.produto_id,
          produto_codigo: item.produto_codigo,
          produto_nome: item.produto_nome,
          quantidade: item.quantidade,
          valor_unitario: precoAtual,
          valor_total: item.quantidade * precoAtual,
          motivo_troca_id: item.motivo_troca_id || '',
          motivo_troca_descricao: item.motivo_troca_descricao || ''
        };
      }));
      setItensInitialized(true);
    }
  }, [existingItems, precosAll, acoesCliente]);

  // Atualiza preços dos itens quando precosAll ou acoesCliente mudam DEPOIS da inicialização
  useEffect(() => {
    if (itensInitialized && itensLocal.length > 0 && (precosAll.length > 0 || acoesCliente.length > 0)) {
      setItensLocal(prev => prev.map(item => {
        const precoAtual = calcularPrecoAtual(item);
        if (precoAtual !== item.valor_unitario) {
          return {
            ...item,
            valor_unitario: precoAtual,
            valor_total: item.quantidade * precoAtual
          };
        }
        return item;
      }));
    }
  }, [precosAll, acoesCliente, itensInitialized]);

  const planoAtual = planosPagamento.find(p => p.id === planoPagamentoId);
  const tabelaAtual = tabelasPreco.find(t => t.id === tabelaPrecoId);
  const clienteSemTabela = !tabelaPrecoId;

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

  // Número do pedido (o que aparece em Gerenciar Pedidos)
  const numeroPedidoAtual = existingPedido?.numero_pedido || '';

  // Monta o texto final do campo "Dados Adicionais NF" combinando o ID do pedido + observações livres
  const buildDadosAdicionaisNf = () => {
    const partes = [];
    if (numeroPedidoAtual) {
      partes.push(`Pedido Nº: ${numeroPedidoAtual}`);
    }
    if (observacoesAdicionaisNf.trim()) {
      partes.push(observacoesAdicionaisNf.trim());
    }
    return partes.join(' | ');
  };

  // Preview do texto que será salvo
  const previewDadosNf = buildDadosAdicionaisNf();

  const salvarPedido = async () => {
    if (!dataPrevisaoEntrega) {
      toast.error('Informe a Data de Previsão de Entrega');
      return;
    }
    if (!cenarioLocalId || !cenarioLocalAtual) {
      toast.error('Selecione o Cenário Fiscal Local (Venda, Bonificação ou Troca)');
      setActiveTab('pedido');
      return;
    }
    if (itensLocal.length === 0) {
      toast.error('Adicione pelo menos um item ao pedido');
      return;
    }
    setSalvando(true);

    const planoObj = planosPagamento.find(p => p.id === planoPagamentoId);
    const tabelaObj = tabelasPreco.find(t => t.id === tabelaPrecoId);
    const codigoCliente = cliente.codigo_interno || cliente.codigo_integracao || cliente.codigo || '';

    // O tipo do pedido (interno) reflete o tipo_operacao do cenário fiscal escolhido.
    // Ex: cenário "Bonificações" (tipo_operacao=bonificacao) → pedido tipo "bonificacao".
    // Fallback: se o cenário não tiver tipo_operacao mapeado, usa o tipo original.
    const tipoOperacaoCenario = cenarioLocalAtual?.tipo_operacao;
    const tiposValidos = ['venda', 'troca', 'bonificacao', 'devolucao'];
    const tipoFinal = isTroca
      ? 'troca'
      : (tipoOperacaoCenario && tiposValidos.includes(tipoOperacaoCenario) ? tipoOperacaoCenario : tipo);

    const pedidoData = {
      tipo: tipoFinal,
      cliente_id: cliente.id,
      cliente_codigo: codigoCliente,
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
      rota_id: cliente.rota_id || null,
      rota_nome: cliente.rota_nome || '',
      plano_pagamento_id: planoPagamentoId,
      plano_pagamento_nome: planoObj?.nome || '',
      tabela_preco_id: tabelaPrecoId,
      tabela_preco_nome: tabelaObj?.nome || '',
      modelo_nota: (tipoFinal === 'troca' || cliente.tipo_nota === 'D1') ? 'd1' : modeloNota,
      cenario_local_id: cenarioLocalId || null,
      cenario_local_nome: cenarioLocalAtual?.nome || null,
      cenario_local_tipo: cenarioLocalAtual?.tipo_operacao || null,
      // Código Omie só vai para Nota 55; o nome é sempre preenchido para aparecer em relatórios/PDF.
      cenario_fiscal_codigo: (!isNotaD1 && cenarioFiscalCodigo && !isNaN(Number(cenarioFiscalCodigo)) && Number(cenarioFiscalCodigo) > 0) ? Number(cenarioFiscalCodigo) : null,
      cenario_fiscal_nome: (!isNotaD1 && cenarioFiscalNome) ? cenarioFiscalNome : (cenarioLocalAtual?.nome || null),
      data_previsao_entrega: dataPrevisaoEntrega,
      numero_pedido_compra: numeroPedidoCompra,
      dados_adicionais_nf: buildDadosAdicionaisNf(),
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
      // Persiste motivo da troca sempre que houver (id OU descrição) — é o que aparece
      // na coluna "Motivo" da Nota D1 e nos relatórios.
      if (item.motivo_troca_id || item.motivo_troca_descricao) {
        itemData.motivo_troca_id = item.motivo_troca_id || '';
        itemData.motivo_troca_descricao = item.motivo_troca_descricao || '';
      }
      await base44.entities.PedidoItem.create(itemData);
    }

    // Se o pedido já foi enviado ao Omie, sincronizar alterações
    if (pedidoId && existingPedido?.omie_codigo_pedido) {
      try {
        const resp = await base44.functions.invoke('editarPedidoOmie', { pedido_id: savedPedidoId });
        const result = resp.data;
        if (result.sucesso) {
          toast.success('Pedido salvo e atualizado no Omie!');
        } else {
          toast.warning(`Pedido salvo, mas erro ao atualizar no Omie: ${result.erro}`);
        }
      } catch (omieErr) {
        toast.error('Erro ao atualizar pedido no Omie. Verifique em Gerenciar Pedidos.');
      }
    } else {
      toast.success('Pedido salvo com sucesso!');
    }

    queryClient.invalidateQueries({ queryKey: ['pedidos'] });
    queryClient.invalidateQueries({ queryKey: ['pedido-items'] });
    queryClient.invalidateQueries({ queryKey: ['todos-pedidos'] });
    queryClient.invalidateQueries({ queryKey: ['pedidoItems-all-gestao'] });
    queryClient.invalidateQueries({ queryKey: ['pedidoItems-all'] });
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
              {isTroca ? 'Troca' : 'Venda'} - {cliente.codigo_interno || cliente.codigo_integracao || cliente.codigo || '-'} - {cliente.nome_fantasia || cliente.razao_social}
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
                <p className="text-sm font-medium">{cliente.codigo_interno || cliente.codigo_integracao || cliente.codigo || '-'} - {cliente.razao_social}</p>
              </div>
              <div>
                <Label className="text-xs text-slate-500">Endereço</Label>
                <p className="text-sm">{[cliente.endereco, cliente.numero, cliente.bairro, cliente.cidade, cliente.estado].filter(Boolean).join(', ')}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-slate-500">Plano de Pagamento</Label>
                  <p className="text-sm font-medium">
                    {planoAtual?.nome
                      ? planoAtual.nome
                      : (loadingPlanos && planoPagamentoId)
                        ? <span className="text-slate-400 italic">Carregando...</span>
                        : '-'}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-slate-500">Tabela de Preço</Label>
                  <p className="text-sm font-medium">{tabelaAtual?.nome || '-'}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-slate-500">Modelo da Nota</Label>
                  <p className="text-sm font-medium">{isNotaD1 ? 'D1' : modeloNota === 'nfce' ? 'NFCe' : '55'}</p>
                </div>
                <div>
                  <Label>Data Previsão de Entrega <span className="text-red-500">*</span></Label>
                  <Input type="date" value={dataPrevisaoEntrega} onChange={(e) => setDataPrevisaoEntrega(e.target.value)} className={!dataPrevisaoEntrega ? 'border-red-300' : ''} />
                  {!dataPrevisaoEntrega && <p className="text-xs text-red-500 mt-1">Obrigatório</p>}
                </div>
              </div>
              <div>
                <Label className="text-xs text-slate-500">
                  Cenário Fiscal Local <span className="text-red-500">*</span>
                  {isNotaD1 ? (
                    <span className="ml-2 text-[10px] text-orange-600 font-medium">(D1 — operação interna)</span>
                  ) : (
                    <span className="ml-2 text-[10px] text-blue-600 font-medium">(55 — envia ao Omie)</span>
                  )}
                </Label>
                {loadingCenarios ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Carregando cenários...
                  </div>
                ) : (
                  <Select
                    value={cenarioLocalId}
                    onValueChange={(val) => {
                      const found = cenariosLocais.find(c => c.id === val);
                      const novoIsTroca = found?.tipo_operacao === 'troca';
                      const tipoAtual = cenarioLocalAtual?.tipo_operacao;
                      // Se mudou entre Venda <-> Troca e já tem itens, limpa (UIs são incompatíveis)
                      if (itensLocal.length > 0 && tipoAtual && (novoIsTroca !== (tipoAtual === 'troca'))) {
                        const ok = window.confirm(
                          novoIsTroca
                            ? 'Mudar para Troca vai limpar os itens já adicionados (a Troca exige motivo por item). Deseja continuar?'
                            : 'Mudar para Venda vai limpar os itens da troca. Deseja continuar?'
                        );
                        if (!ok) return;
                        setItensLocal([]);
                      }
                      setCenarioLocalId(val);
                      if (found) {
                        const ehD1 = novoIsTroca; // Troca sempre força D1
                        if (!ehD1 && found.cenario_omie_codigo) {
                          setCenarioFiscalCodigo(String(found.cenario_omie_codigo));
                          setCenarioFiscalNome(found.cenario_omie_nome || found.nome);
                        } else {
                          setCenarioFiscalCodigo('');
                          setCenarioFiscalNome('');
                        }
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o cenário fiscal local..." />
                    </SelectTrigger>
                    <SelectContent>
                      {cenariosDisponiveis.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome} {c.padrao ? '(Padrão)' : ''}
                          {!isNotaD1 && c.cenario_omie_nome ? ` → Omie: ${c.cenario_omie_nome}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {!isNotaD1 && cenarioLocalAtual && !cenarioLocalAtual.cenario_omie_codigo && (
                  <p className="text-[10px] text-amber-600 mt-1">
                    ⚠ Este cenário local não tem um cenário Omie vinculado. Vincule em Cadastros → Cenários Fiscais Locais.
                  </p>
                )}
                {!isNotaD1 && cenarioLocalAtual?.tipo_operacao === 'bonificacao' && (
                  <div className="mt-2 p-2 rounded border border-amber-300 bg-amber-50 text-[11px] text-amber-800 leading-snug">
                    <p className="font-semibold mb-0.5">⚠ Atenção — Bonificação</p>
                    <p>
                      Confirme no Omie se o cenário fiscal vinculado{cenarioLocalAtual.cenario_omie_nome ? ` (${cenarioLocalAtual.cenario_omie_nome})` : ''} está com o <strong>CFOP correto</strong>: <strong>5910</strong> (bonificação dentro do estado) ou <strong>6910</strong> (interestadual).
                      Sem CFOP configurado, a NF-e <strong>não será emitida</strong>.
                    </p>
                  </div>
                )}
              </div>
              <div>
                <Label>Nº Pedido Compra</Label>
                <Input value={numeroPedidoCompra} onChange={(e) => setNumeroPedidoCompra(e.target.value)} placeholder="Número do pedido de compra do cliente" />
              </div>
              <div>
                <Label>Dados Adicionais para a Nota Fiscal</Label>
                <div className="space-y-2">
                  {numeroPedidoAtual ? (
                    <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
                      <span className="font-medium">Automático:</span> Pedido Nº: {numeroPedidoAtual}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                      O Nº do Pedido será incluído automaticamente após o envio ao Omie.
                    </div>
                  )}
                  <Input 
                    value={observacoesAdicionaisNf} 
                    onChange={(e) => setObservacoesAdicionaisNf(e.target.value)} 
                    placeholder="Observações adicionais para a DANFE..." 
                  />
                  {previewDadosNf && (
                    <p className="text-[10px] text-slate-400 italic">
                      Texto final na NF: {previewDadosNf}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab Produto */}
        <TabsContent value="produto">
          <Card>
            <CardContent className="pt-4 space-y-4">
              {/* Resumo do pedido — sempre visível e fixo no topo da aba */}
              <div className="sticky top-0 z-10 flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg shadow-sm">
                <div className="text-sm">
                  <span className="font-semibold text-green-800">{itensLocal.length} item(ns)</span>
                  <span className="text-green-600 mx-2">•</span>
                  <span className="text-green-600">{itensLocal.reduce((s, i) => s + i.quantidade, 0)} unid.</span>
                </div>
                <div className="text-lg font-bold text-green-800">
                  R$ {totalPedido.toFixed(2).replace('.', ',')}
                </div>
              </div>

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
                bloquearSemTabela={clienteSemTabela}
                acoesCliente={acoesCliente}
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