import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Search, ChevronUp, ChevronDown, Unlock, Lock, Printer, XCircle,
  Loader2, Filter, RefreshCw, DollarSign, Eye, List, X
} from 'lucide-react';
import { toast } from 'sonner';
import CancelarPedidoModal from './CancelarPedidoModal';
import DebitosClienteModal from './DebitosClienteModal';
import PedidoAgrupado from './PedidoAgrupado';
import PedidoPdf from './PedidoPdf';
import SelecionarEntidadeModal from './SelecionarEntidadeModal';

const STATUS_COLORS = {
  pendente: { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300', dot: 'bg-red-500' },
  enviado: { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300', dot: 'bg-orange-500' },
  liberado: { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300', dot: 'bg-green-500' },
  faturado: { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300', dot: 'bg-yellow-500' },
  cancelado: { bg: 'bg-gray-200', text: 'text-gray-800', border: 'border-gray-400', dot: 'bg-gray-700' },
};

const STATUS_LABELS = {
  pendente: 'Pendente',
  enviado: 'Enviado',
  liberado: 'Liberado',
  faturado: 'Faturado',
  cancelado: 'Cancelado',
};

export default function GerenciarPedidos({ onEditPedido }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [tipoFilter, setTipoFilter] = useState('todos');
  const [envioInicio, setEnvioInicio] = useState('');
  const [envioFim, setEnvioFim] = useState('');
  const [vendedorSearch, setVendedorSearch] = useState('');
  const [vendedorIds, setVendedorIds] = useState([]);
  const [vendedorModalOpen, setVendedorModalOpen] = useState(false);
  const [produtoSearch, setProdutoSearch] = useState('');
  const [produtoIds, setProdutoIds] = useState([]);
  const [produtoModalOpen, setProdutoModalOpen] = useState(false);
  const [clienteSearch, setClienteSearch] = useState('');
  const [cidadeSearch, setCidadeSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [sortField, setSortField] = useState('created_date');
  const [sortDir, setSortDir] = useState('desc');
  const [selectedIds, setSelectedIds] = useState([]);
  const [batchAction, setBatchAction] = useState(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelPedido, setCancelPedido] = useState(null);
  const [debitosOpen, setDebitosOpen] = useState(false);
  const [debitosCliente, setDebitosCliente] = useState({ id: null, nome: '' });
  const [showAgrupado, setShowAgrupado] = useState(false);
  const [viewPedidoId, setViewPedidoId] = useState(null);

  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const isAdmin = currentUser?.role === 'admin';

  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ['pedidos-gerenciar'],
    queryFn: () => base44.entities.Pedido.list('-created_date', 5000),
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list(),
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos-gerenciar'],
    queryFn: () => base44.entities.Produto.list(),
  });

  const { data: pedidoItems = [] } = useQuery({
    queryKey: ['pedidoItems-gerenciar'],
    queryFn: () => base44.entities.PedidoItem.list(),
    enabled: produtoIds.length > 0,
  });

  const vendedoresMap = useMemo(() => {
    const m = {};
    vendedores.forEach(v => { m[v.id] = v; });
    return m;
  }, [vendedores]);

  // Pedido IDs que contêm os produtos selecionados
  const pedidoIdsComProduto = useMemo(() => {
    if (produtoIds.length === 0) return null;
    const ids = new Set();
    pedidoItems.forEach(item => {
      if (produtoIds.includes(item.produto_id)) ids.add(item.pedido_id);
    });
    return ids;
  }, [produtoIds, pedidoItems]);

  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (envioInicio || envioFim) c++;
    if (vendedorSearch.trim() || vendedorIds.length) c++;
    if (produtoSearch.trim() || produtoIds.length) c++;
    if (clienteSearch.trim()) c++;
    if (cidadeSearch.trim()) c++;
    return c;
  }, [envioInicio, envioFim, vendedorSearch, vendedorIds, produtoSearch, produtoIds, clienteSearch, cidadeSearch]);

  const clearAllFilters = () => {
    setSearch(''); setStatusFilter('todos'); setTipoFilter('todos');
    setEnvioInicio(''); setEnvioFim('');
    setVendedorSearch(''); setVendedorIds([]);
    setProdutoSearch(''); setProdutoIds([]);
    setClienteSearch(''); setCidadeSearch('');
  };

  // Filter and sort
  const filtered = useMemo(() => {
    let list = [...pedidos];

    if (statusFilter !== 'todos') {
      list = list.filter(p => p.status === statusFilter);
    }
    if (tipoFilter !== 'todos') {
      list = list.filter(p => p.tipo === tipoFilter);
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(p =>
        (p.numero_pedido?.toString() || '').includes(s) ||
        (p.cliente_nome || '').toLowerCase().includes(s) ||
        (p.cliente_nome_fantasia || '').toLowerCase().includes(s) ||
        (p.cliente_cpf_cnpj || '').includes(s) ||
        (p.cliente_codigo || '').toLowerCase().includes(s) ||
        (p.vendedor_nome || '').toLowerCase().includes(s) ||
        (p.numero_carga || '').toLowerCase().includes(s)
      );
    }
    // Período de envio
    if (envioInicio) {
      list = list.filter(p => p.data_envio && p.data_envio.split('T')[0] >= envioInicio);
    }
    if (envioFim) {
      list = list.filter(p => p.data_envio && p.data_envio.split('T')[0] <= envioFim);
    }
    // Vendedor (texto ou seleção)
    if (vendedorIds.length > 0) {
      list = list.filter(p => vendedorIds.includes(p.vendedor_id));
    } else if (vendedorSearch.trim()) {
      const vs = vendedorSearch.toLowerCase();
      list = list.filter(p => (p.vendedor_nome || '').toLowerCase().includes(vs));
    }
    // Produto (seleção por tabela)
    if (pedidoIdsComProduto) {
      list = list.filter(p => pedidoIdsComProduto.has(p.id));
    } else if (produtoSearch.trim()) {
      // Filtro texto: busca nos itens carregados ou no nome genérico
      const ps = produtoSearch.toLowerCase();
      const matchingPedidoIds = new Set();
      pedidoItems.forEach(item => {
        if ((item.produto_nome || '').toLowerCase().includes(ps) || (item.produto_codigo || '').includes(ps)) {
          matchingPedidoIds.add(item.pedido_id);
        }
      });
      if (matchingPedidoIds.size > 0) {
        list = list.filter(p => matchingPedidoIds.has(p.id));
      }
    }
    // Cliente (texto)
    if (clienteSearch.trim()) {
      const cs = clienteSearch.toLowerCase();
      list = list.filter(p =>
        (p.cliente_nome || '').toLowerCase().includes(cs) ||
        (p.cliente_nome_fantasia || '').toLowerCase().includes(cs) ||
        (p.cliente_codigo || '').includes(cs)
      );
    }
    // Cidade (texto)
    if (cidadeSearch.trim()) {
      const ci = cidadeSearch.toLowerCase();
      list = list.filter(p => (p.cliente_cidade || '').toLowerCase().includes(ci));
    }

    list.sort((a, b) => {
      let va = a[sortField];
      let vb = b[sortField];
      if (va == null) va = '';
      if (vb == null) vb = '';
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      const sa = String(va).toLowerCase();
      const sb = String(vb).toLowerCase();
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });

    return list;
  }, [pedidos, statusFilter, tipoFilter, search, sortField, sortDir, envioInicio, envioFim, vendedorSearch, vendedorIds, produtoSearch, produtoIds, pedidoIdsComProduto, clienteSearch, cidadeSearch, pedidoItems]);

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 inline ml-0.5" />
      : <ChevronDown className="w-3 h-3 inline ml-0.5" />;
  };

  // Selection
  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map(p => p.id));
    }
  };

  // Batch actions
  const handleBatchLiberar = async () => {
    setBatchAction('liberando');
    const selected = pedidos.filter(p => selectedIds.includes(p.id) && (p.status === 'pendente' || p.status === 'enviado'));
    let count = 0;
    for (const p of selected) {
      await base44.entities.Pedido.update(p.id, {
        status: 'liberado',
        liberado_por: currentUser?.email,
        liberado_por_nome: currentUser?.full_name,
        data_liberacao: new Date().toISOString(),
      });
      count++;
    }
    toast.success(`${count} pedido(s) liberado(s)`);
    setSelectedIds([]);
    setBatchAction(null);
    queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] });
  };

  const handleBatchBloquear = async () => {
    setBatchAction('bloqueando');
    const selected = pedidos.filter(p => selectedIds.includes(p.id) && p.status === 'liberado');
    let count = 0;
    for (const p of selected) {
      await base44.entities.Pedido.update(p.id, {
        status: 'pendente',
        liberado_por: null,
        liberado_por_nome: null,
        data_liberacao: null,
      });
      count++;
    }
    toast.success(`${count} pedido(s) revertido(s) para pendente`);
    setSelectedIds([]);
    setBatchAction(null);
    queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] });
  };

  const handleCancelConfirm = async (pedido, motivo) => {
    await base44.entities.Pedido.update(pedido.id, {
      status: 'cancelado',
      cancelado_por: currentUser?.email,
      cancelado_por_nome: currentUser?.full_name,
      data_cancelamento: new Date().toISOString(),
      motivo_cancelamento: motivo,
    });
    if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
      await base44.functions.invoke('cancelarPedidoOmie', { pedido_id: pedido.id });
    }
    toast.success('Pedido cancelado');
    queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] });
  };

  const formatDate = (d) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('pt-BR');
  };

  const formatCurrency = (v) => {
    if (v == null) return '-';
    return 'R$ ' + Number(v).toFixed(2).replace('.', ',');
  };

  // Show agrupado view
  if (showAgrupado) {
    return <PedidoAgrupado pedidoIds={selectedIds} onVoltar={() => setShowAgrupado(false)} />;
  }

  // Show single PDF
  if (viewPedidoId) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => setViewPedidoId(null)}>Voltar</Button>
        <PedidoPdf pedidoId={viewPedidoId} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters - Row 1 */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="Buscar geral..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 h-8 text-xs" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos Status</SelectItem>
            <SelectItem value="pendente">Pendente</SelectItem>
            <SelectItem value="enviado">Enviado</SelectItem>
            <SelectItem value="liberado">Liberado</SelectItem>
            <SelectItem value="faturado">Faturado</SelectItem>
            <SelectItem value="cancelado">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tipoFilter} onValueChange={setTipoFilter}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos Tipos</SelectItem>
            <SelectItem value="venda">Venda</SelectItem>
            <SelectItem value="troca">Troca</SelectItem>
            <SelectItem value="bonificacao">Bonificação</SelectItem>
          </SelectContent>
        </Select>
        <Button variant={showFilters ? 'default' : 'outline'} size="sm" className="h-8 text-xs" onClick={() => setShowFilters(!showFilters)}>
          <Filter className="w-3 h-3 mr-1" /> Filtros {activeFilterCount > 0 && <Badge className="ml-1 h-4 w-4 p-0 flex items-center justify-center text-[9px] bg-amber-500">{activeFilterCount}</Badge>}
        </Button>
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-red-500" onClick={clearAllFilters}>
            <X className="w-3 h-3 mr-1" /> Limpar filtros
          </Button>
        )}
        <Button variant="outline" size="sm" className="h-8" onClick={() => queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] })}>
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>

      {/* Filters - Row 2 (expandable) */}
      {showFilters && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-3 bg-white border rounded-lg">
          {/* Período envio */}
          <div>
            <label className="text-[10px] font-medium text-slate-500 mb-1 block">Envio de</label>
            <Input type="date" value={envioInicio} onChange={e => setEnvioInicio(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <label className="text-[10px] font-medium text-slate-500 mb-1 block">Envio até</label>
            <Input type="date" value={envioFim} onChange={e => setEnvioFim(e.target.value)} className="h-8 text-xs" />
          </div>

          {/* Vendedor */}
          <div>
            <label className="text-[10px] font-medium text-slate-500 mb-1 block">Vendedor</label>
            <div className="flex gap-1">
              <Input placeholder="Nome..." value={vendedorSearch} onChange={e => { setVendedorSearch(e.target.value); setVendedorIds([]); }} className="h-8 text-xs flex-1" />
              <Button variant="outline" size="sm" className="h-8 w-8 p-0 shrink-0" title="Selecionar na tabela" onClick={() => setVendedorModalOpen(true)}>
                <List className="w-3 h-3" />
              </Button>
            </div>
            {vendedorIds.length > 0 && <p className="text-[10px] text-amber-600 mt-0.5">{vendedorIds.length} selecionado(s)</p>}
          </div>

          {/* Produto */}
          <div>
            <label className="text-[10px] font-medium text-slate-500 mb-1 block">Produto</label>
            <div className="flex gap-1">
              <Input placeholder="Nome/Cód..." value={produtoSearch} onChange={e => { setProdutoSearch(e.target.value); setProdutoIds([]); }} className="h-8 text-xs flex-1" />
              <Button variant="outline" size="sm" className="h-8 w-8 p-0 shrink-0" title="Selecionar na tabela" onClick={() => setProdutoModalOpen(true)}>
                <List className="w-3 h-3" />
              </Button>
            </div>
            {produtoIds.length > 0 && <p className="text-[10px] text-amber-600 mt-0.5">{produtoIds.length} selecionado(s)</p>}
          </div>

          {/* Cliente */}
          <div>
            <label className="text-[10px] font-medium text-slate-500 mb-1 block">Cliente</label>
            <Input placeholder="Nome/Cód..." value={clienteSearch} onChange={e => setClienteSearch(e.target.value)} className="h-8 text-xs" />
          </div>

          {/* Cidade */}
          <div>
            <label className="text-[10px] font-medium text-slate-500 mb-1 block">Cidade</label>
            <Input placeholder="Cidade..." value={cidadeSearch} onChange={e => setCidadeSearch(e.target.value)} className="h-8 text-xs" />
          </div>
        </div>
      )}

      {/* Batch actions */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <span className="text-sm font-medium text-amber-800">{selectedIds.length} selecionado(s)</span>
          <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={handleBatchLiberar} disabled={!!batchAction}>
            {batchAction === 'liberando' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Unlock className="w-3 h-3 mr-1" />}
            Liberar
          </Button>
          <Button size="sm" variant="outline" onClick={handleBatchBloquear} disabled={!!batchAction}>
            {batchAction === 'bloqueando' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Lock className="w-3 h-3 mr-1" />}
            Bloquear
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowAgrupado(true)}>
            <Printer className="w-3 h-3 mr-1" /> Imprimir Agrupado
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>Limpar</Button>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto bg-white" style={{ maxHeight: '75vh' }}>
          <table className="w-full text-xs">
            <thead className="bg-slate-100 sticky top-0">
              <tr>
                <th className="p-2 w-8">
                  <Checkbox
                    checked={filtered.length > 0 && selectedIds.length === filtered.length}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                <ThSort label="Nº" field="numero_pedido" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Tipo" field="tipo" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Status" field="status" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Cliente" field="cliente_nome" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Fantasia" field="cliente_nome_fantasia" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="CPF/CNPJ" field="cliente_cpf_cnpj" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Cidade" field="cliente_cidade" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Vendedor" field="vendedor_nome" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Plano Pgto" field="plano_pagamento_nome" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Tab. Preço" field="tabela_preco_nome" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Itens" field="total_itens" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Valor" field="valor_total" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Prev. Entrega" field="data_previsao_entrega" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Nº Carga" field="numero_carga" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Liberado por" field="liberado_por_nome" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Dt. Liberação" field="data_liberacao" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Cancelado por" field="cancelado_por_nome" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Dt. Cancelamento" field="data_cancelamento" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Motivo Cancel." field="motivo_cancelamento" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Dt. Envio" field="data_envio" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <ThSort label="Dt. Criação" field="created_date" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <th className="p-2 text-left font-medium text-slate-600 whitespace-nowrap">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={23} className="p-8 text-center text-slate-400">Nenhum pedido encontrado</td></tr>
              ) : (
                filtered.map(p => {
                  const sc = STATUS_COLORS[p.status] || STATUS_COLORS.pendente;
                  return (
                    <tr key={p.id} className={`border-t hover:bg-slate-50 ${selectedIds.includes(p.id) ? 'bg-amber-50' : ''}`}>
                      <td className="p-2">
                        <Checkbox
                          checked={selectedIds.includes(p.id)}
                          onCheckedChange={() => toggleSelect(p.id)}
                        />
                      </td>
                      <td className="p-2 font-medium">{p.numero_pedido || '-'}</td>
                      <td className="p-2 capitalize">{p.tipo || '-'}</td>
                      <td className="p-2">
                        <Badge className={`${sc.bg} ${sc.text} ${sc.border} border text-[10px]`}>
                          {STATUS_LABELS[p.status] || p.status}
                        </Badge>
                      </td>
                      <td className="p-2 max-w-[150px] truncate" title={p.cliente_nome}>{p.cliente_nome || '-'}</td>
                      <td className="p-2 max-w-[120px] truncate" title={p.cliente_nome_fantasia}>{p.cliente_nome_fantasia || '-'}</td>
                      <td className="p-2 whitespace-nowrap">{p.cliente_cpf_cnpj || '-'}</td>
                      <td className="p-2">{p.cliente_cidade || '-'}</td>
                      <td className="p-2">{p.vendedor_nome || '-'}</td>
                      <td className="p-2 max-w-[100px] truncate" title={p.plano_pagamento_nome}>{p.plano_pagamento_nome || '-'}</td>
                      <td className="p-2 max-w-[100px] truncate" title={p.tabela_preco_nome}>{p.tabela_preco_nome || '-'}</td>
                      <td className="p-2 text-center">{p.total_itens || 0}</td>
                      <td className="p-2 text-right font-medium whitespace-nowrap">{formatCurrency(p.valor_total)}</td>
                      <td className="p-2 whitespace-nowrap">{formatDate(p.data_previsao_entrega)}</td>
                      <td className="p-2">{p.numero_carga || '-'}</td>
                      <td className="p-2">{p.liberado_por_nome || '-'}</td>
                      <td className="p-2 whitespace-nowrap">{formatDate(p.data_liberacao)}</td>
                      <td className="p-2">{p.cancelado_por_nome || '-'}</td>
                      <td className="p-2 whitespace-nowrap">{formatDate(p.data_cancelamento)}</td>
                      <td className="p-2 max-w-[120px] truncate" title={p.motivo_cancelamento}>{p.motivo_cancelamento || '-'}</td>
                      <td className="p-2 whitespace-nowrap">{formatDate(p.data_envio)}</td>
                      <td className="p-2 whitespace-nowrap">{formatDate(p.created_date)}</td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Ver pedido" onClick={() => setViewPedidoId(p.id)}>
                            <Eye className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Débitos" onClick={() => { setDebitosCliente({ id: p.cliente_id, nome: p.cliente_nome }); setDebitosOpen(true); }}>
                            <DollarSign className="w-3 h-3" />
                          </Button>
                          {p.status !== 'cancelado' && p.status !== 'faturado' && (
                            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500" title="Cancelar" onClick={() => { setCancelPedido(p); setCancelModalOpen(true); }}>
                              <XCircle className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-slate-500">
        {filtered.length} pedido(s) • Valor total: {formatCurrency(filtered.reduce((s, p) => s + (p.valor_total || 0), 0))}
      </div>

      {/* Modals */}
      <CancelarPedidoModal
        open={cancelModalOpen}
        onOpenChange={setCancelModalOpen}
        pedido={cancelPedido}
        onConfirm={handleCancelConfirm}
      />
      <DebitosClienteModal
        open={debitosOpen}
        onOpenChange={setDebitosOpen}
        clienteId={debitosCliente.id}
        clienteNome={debitosCliente.nome}
      />
    </div>
  );
}

function ThSort({ label, field, sortField, sortDir, onSort }) {
  return (
    <th
      className="p-2 text-left font-medium text-slate-600 whitespace-nowrap cursor-pointer hover:text-slate-900 select-none"
      onClick={() => onSort(field)}
    >
      {label}
      {sortField === field && (
        sortDir === 'asc'
          ? <ChevronUp className="w-3 h-3 inline ml-0.5" />
          : <ChevronDown className="w-3 h-3 inline ml-0.5" />
      )}
    </th>
  );
}