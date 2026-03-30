import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  Loader2, RefreshCw, DollarSign, Eye, List, X
} from 'lucide-react';
import { toast } from 'sonner';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import CancelarPedidoModal from './CancelarPedidoModal';
import DebitosClienteModal from './DebitosClienteModal';
import PedidoAgrupado from './PedidoAgrupado';
import PedidoPdf from './PedidoPdf';
import SelecionarEntidadeModal from './SelecionarEntidadeModal';
import useDragSelect from './useDragSelect';
import useColumnOrder from './useColumnOrder';
import useColumnResize from './useColumnResize';
import PedidoCellRenderer, { formatDate, formatCurrency, OMIE_TO_ANALISE } from './PedidoCellRenderer';
import BatchResultToast from './BatchResultToast';



const OMIE_STATUS_CACHE_KEY = 'gerenciar-pedidos-omie-status-cache-v1';
const OMIE_STATUS_CACHE_TTL_MS = 10 * 60 * 1000;
const OMIE_STATUS_AUTO_LIMIT = 60;
const OMIE_STATUS_REFRESH_LIMIT = 60;

const getTodayFilterDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const readOmieStatusCache = () => {
  if (typeof window === 'undefined') return {};

  try {
    return JSON.parse(window.localStorage.getItem(OMIE_STATUS_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
};

const writeOmieStatusCache = (cache) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(OMIE_STATUS_CACHE_KEY, JSON.stringify(cache));
};

export default function GerenciarPedidos({ onEditPedido }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [tipoFilter, setTipoFilter] = useState('todos');
  const [envioInicio, setEnvioInicio] = useState(() => getTodayFilterDate());
  const [envioFim, setEnvioFim] = useState(() => getTodayFilterDate());
  const [vendedorSearch, setVendedorSearch] = useState('');
  const [vendedorIds, setVendedorIds] = useState([]);
  const [vendedorModalOpen, setVendedorModalOpen] = useState(false);
  const [produtoSearch, setProdutoSearch] = useState('');
  const [produtoIds, setProdutoIds] = useState([]);
  const [produtoModalOpen, setProdutoModalOpen] = useState(false);
  const [clienteSearch, setClienteSearch] = useState('');
  const [cidadeSearch, setCidadeSearch] = useState('');
  const [showFilters, setShowFilters] = useState(true);
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
  const [omieStatuses, setOmieStatuses] = useState({});
  const [omieStatusLoading, setOmieStatusLoading] = useState(false);
  const omieStatusRequestsRef = useRef(new Set());
  const initialFetchDoneRef = useRef(false);
  const [batchResult, setBatchResult] = useState(null);
  const [carregamentos, setCarregamentos] = useState({});
  const carregamentoFetchedRef = useRef(new Set());


  const { columns, reorder, resetOrder } = useColumnOrder();
  const { colWidths, onResizeStart } = useColumnResize();
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  useEffect(() => {
    const cache = readOmieStatusCache();
    const now = Date.now();
    const validEntries = Object.entries(cache).filter(([, value]) => now - value.fetchedAt < OMIE_STATUS_CACHE_TTL_MS);

    setOmieStatuses(Object.fromEntries(validEntries.map(([pedidoId, value]) => [pedidoId, value.data])));
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

  const fetchOmieStatuses = async (pedidosList, { force = false, silent = false } = {}) => {
    const cache = readOmieStatusCache();
    const now = Date.now();

    // Status finais não mudam — nunca re-consultar
    const STATUS_FINAIS = ['Faturado', 'Cancelado', 'Excluído no Omie', 'Entrega'];
    // Status locais finais — também não re-consultar
    const STATUS_LOCAIS_FINAIS = ['faturado', 'cancelado'];
    const pedidosOmie = (pedidosList || [])
    .filter(p => p.omie_enviado && p.omie_codigo_pedido && p.tipo !== 'troca')
    .filter(p => {
        // Pedidos com status local final nunca precisam de consulta Omie
        if (STATUS_LOCAIS_FINAIS.includes(p.status)) return false;
        if (omieStatusRequestsRef.current.has(p.id)) return false;
        const cached = cache[p.id];
        // Pedidos em status final no Omie nunca precisam ser re-consultados
        if (cached?.data?.etapa_label && STATUS_FINAIS.includes(cached.data.etapa_label)) return false;
        if (force) return true;
        return !cached || (now - cached.fetchedAt) >= OMIE_STATUS_CACHE_TTL_MS;
      });

    if (pedidosOmie.length === 0) return;

    if (!silent) setOmieStatusLoading(true);
    const allResults = {};

    for (let i = 0; i < pedidosOmie.length; i += 10) {
      const currentBatch = pedidosOmie.slice(i, i + 10);
      const batch = currentBatch.map(p => ({
        pedido_id: p.id,
        omie_codigo_pedido: p.omie_codigo_pedido
      }));

      currentBatch.forEach(p => omieStatusRequestsRef.current.add(p.id));

      try {
        const res = await base44.functions.invoke('consultarStatusPedidosOmie', { omie_codigos: batch });
        if (res.data?.resultados) {
          Object.assign(allResults, res.data.resultados);
        }
      } catch (e) {
        console.error('Erro ao consultar status Omie (lote):', e);
        currentBatch.forEach(p => {
          allResults[p.id] = { erro: true, etapa_label: null };
        });
      } finally {
        currentBatch.forEach(p => omieStatusRequestsRef.current.delete(p.id));
      }
    }

    const updatedCache = { ...cache };
    const updatedStatuses = {};
    let successCount = 0;
    let errorCount = 0;

    Object.entries(allResults).forEach(([pedidoId, result]) => {
      const previousStatus = omieStatuses[pedidoId] || cache[pedidoId]?.data || null;

      if (result?.api_bloqueada && previousStatus && !previousStatus?.erro) {
        errorCount += 1;
        const blockedStatus = { ...previousStatus, api_bloqueada: true, mensagem_erro: result.mensagem_erro || null };
        updatedCache[pedidoId] = { data: blockedStatus, fetchedAt: Date.now() };
        updatedStatuses[pedidoId] = blockedStatus;
        return;
      }

      updatedCache[pedidoId] = { data: result, fetchedAt: Date.now() };

      if (result?.erro) {
        errorCount += 1;
        updatedStatuses[pedidoId] = result;
        return;
      }

      successCount += 1;
      updatedStatuses[pedidoId] = result;
    });

    writeOmieStatusCache(updatedCache);
    setOmieStatuses(prev => ({ ...prev, ...updatedStatuses }));
    if (!silent) setOmieStatusLoading(false);

    if (!silent && successCount > 0) {
      toast.success(`Status Omie atualizado para ${successCount} pedido(s)`);
    }

    if (!silent && successCount === 0 && errorCount > 0) {
      toast.warning('O Omie limitou a consulta repetida; mantive os últimos status salvos.');
    }
  };

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
    // Gerenciar Pedidos: NÃO mostra pedidos com status "pendente" (não enviados)
    // Pedidos não enviados ficam em "Emissão de Pedidos" > "Envio de Pedidos"
    let list = pedidos.filter(p => p.status !== 'pendente');

    if (statusFilter !== 'todos') {
    const analiseFilterMap = {
      'analise_pendente': 'Pendente',
      'analise_liberado': 'Liberados',
      'analise_montagem': 'Montagem',
      'analise_faturado': 'Faturado',
      'analise_cancelado': 'Cancelado',
    };
      if (statusFilter === 'sem_omie') {
        list = list.filter(p => !p.omie_enviado || !p.omie_codigo_pedido);
      } else if (analiseFilterMap[statusFilter]) {
        const targetLabel = analiseFilterMap[statusFilter];
        list = list.filter(p => {
          // Status locais finais prevalecem sobre cache Omie
          const localFinalMap = { cancelado: 'Cancelado', faturado: 'Faturado' };
          if (localFinalMap[p.status]) {
            return localFinalMap[p.status] === targetLabel;
          }
          const omie = omieStatuses[p.id];
          if (!omie) return false;
          const analiseLabel = OMIE_TO_ANALISE[omie.etapa_label] || omie.etapa_label;
          return analiseLabel === targetLabel;
        });
      }
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

  // Fetch carregamentos do Logística Control para pedidos em Faturado/Montagem
  const fetchCarregamentos = async (pedidoIds) => {
    const idsNovos = pedidoIds.filter(id => !carregamentoFetchedRef.current.has(id));
    if (idsNovos.length === 0) return;
    idsNovos.forEach(id => carregamentoFetchedRef.current.add(id));
    try {
      const res = await base44.functions.invoke('consultarCarregamentoLogistico', { pedido_ids: idsNovos });
      if (res.data?.carregamentos) {
        setCarregamentos(prev => ({ ...prev, ...res.data.carregamentos }));
      }
    } catch (e) {
      console.error('Erro ao consultar carregamentos:', e);
    }
  };

  // Quando omieStatuses mudam, identificar pedidos Faturado/Montagem e buscar carregamentos
  useEffect(() => {
    const pedidosFatMont = pedidos.filter(p => {
      if (p.status === 'pendente') return false;
      const omie = omieStatuses[p.id];
      const omieLabel = (omie && !omie.erro && !omie.api_bloqueada) ? omie.etapa_label : null;
      const analise = omieLabel ? (OMIE_TO_ANALISE[omieLabel] || omieLabel) : null;
      const localMap = { montagem: 'Montagem', faturado: 'Faturado' };
      const statusFinal = analise || localMap[p.status] || null;
      return ['Faturado', 'Montagem'].includes(statusFinal);
    });
    if (pedidosFatMont.length > 0) {
      fetchCarregamentos(pedidosFatMont.map(p => p.id));
    }
  }, [omieStatuses, pedidos]);

  // Pedidos que precisam de consulta Omie (baseado nos pedidos carregados, NÃO no filtered que depende de omieStatuses)
  const pedidosParaConsultaOmie = useMemo(() => {
    return pedidos
      .filter(p => p.status !== 'pendente')
      .filter(p => p.omie_enviado && p.omie_codigo_pedido && p.tipo !== 'troca');
  }, [pedidos]);

  // Consulta automática apenas UMA vez quando os pedidos carregam
  useEffect(() => {
    if (initialFetchDoneRef.current) return;
    if (pedidosParaConsultaOmie.length > 0) {
      initialFetchDoneRef.current = true;
      fetchOmieStatuses(pedidosParaConsultaOmie, { silent: true });
    }
  }, [pedidosParaConsultaOmie]);

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

  // Drag-select: selecionar arrastando o mouse pelas linhas
  const { onRowMouseDown, onRowMouseEnter, onMouseUp } = useDragSelect(
    filtered.map(p => p.id),
    setSelectedIds
  );

  // Helper: resolve o status de análise real do pedido
  const getAnaliseStatus = (p) => {
    const localMap = { pendente: 'Pendente', enviado: 'Pendente', liberado: 'Liberados', montagem: 'Montagem', faturado: 'Faturado', cancelado: 'Cancelado' };
    // Status locais finais (cancelado/faturado) SEMPRE prevalecem sobre cache Omie
    if (p.status === 'cancelado' || p.status === 'faturado') {
      return localMap[p.status] || p.status;
    }
    if (p.tipo === 'troca') {
      return localMap[p.status] || p.status;
    }
    const omie = omieStatuses[p.id];
    if (omie && !omie.erro && !omie.api_bloqueada && omie.etapa_label) {
      return OMIE_TO_ANALISE[omie.etapa_label] || omie.etapa_label;
    }
    return localMap[p.status] || p.status;
  };

  // Batch actions
  const handleBatchLiberar = async () => {
    setBatchAction('liberando');
    const allSelected = pedidos.filter(p => selectedIds.includes(p.id));

    let liberados = 0;
    let jaLiberados = 0;
    let naoAlteraveis = 0;
    const naoAlteravelLabels = [];

    for (const p of allSelected) {
      const analise = getAnaliseStatus(p);
      if (analise === 'Pendente') {
        // Pode liberar
        const updateData = {
          status: 'liberado',
          liberado_por: currentUser?.email,
          liberado_por_nome: currentUser?.full_name,
          data_liberacao: new Date().toISOString(),
        };
        await base44.entities.Pedido.update(p.id, updateData);
        if (p.omie_enviado && p.omie_codigo_pedido && p.tipo !== 'troca') {
          try {
            await base44.functions.invoke('liberarPedidoOmie', { pedido_id: p.id });
          } catch (e) {
            console.error('Erro ao liberar no Omie:', e);
          }
        }
        liberados++;
      } else if (analise === 'Liberados') {
        jaLiberados++;
      } else {
        // Montagem, Faturado, Cancelado — não pode alterar
        naoAlteraveis++;
        if (!naoAlteravelLabels.includes(analise)) naoAlteravelLabels.push(analise);
      }
    }

    const items = [];
    if (liberados > 0) items.push({ color: 'green', text: `${liberados} pedido(s) liberado(s) com sucesso` });
    if (jaLiberados > 0) items.push({ color: 'yellow', text: `${jaLiberados} pedido(s) já liberado(s), sem alteração` });
    if (naoAlteraveis > 0) items.push({ color: 'red', text: `${naoAlteraveis} pedido(s) em ${naoAlteravelLabels.join('/')} não puderam ser alterados` });

    setBatchResult({ title: 'Resultado da Liberação', items });
    setSelectedIds([]);
    setBatchAction(null);
    await queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] });
    // Re-consultar apenas os pedidos que foram alterados
    const alterados = pedidos.filter(p => allSelected.some(s => s.id === p.id) && p.omie_enviado && p.omie_codigo_pedido && p.tipo !== 'troca');
    if (alterados.length > 0) {
      setTimeout(() => fetchOmieStatuses(alterados, { force: true }), 1500);
    }
  };

  const handleBatchBloquear = async () => {
    setBatchAction('bloqueando');
    const allSelected = pedidos.filter(p => selectedIds.includes(p.id));

    let bloqueados = 0;
    let jaPendentes = 0;
    let naoAlteraveis = 0;
    const naoAlteravelLabels = [];

    for (const p of allSelected) {
      const analise = getAnaliseStatus(p);
      if (analise === 'Liberados') {
        // Pode bloquear (reverter para pendente/enviado)
        await base44.entities.Pedido.update(p.id, {
          status: 'enviado',
          liberado_por: null,
          liberado_por_nome: null,
          data_liberacao: null,
        });
        if (p.omie_enviado && p.omie_codigo_pedido && p.tipo !== 'troca') {
          try {
            await base44.functions.invoke('liberarPedidoOmie', { pedido_id: p.id, etapa: '10' });
          } catch (e) {
            console.error('Erro ao reverter no Omie:', e);
          }
        }
        bloqueados++;
      } else if (analise === 'Pendente') {
        jaPendentes++;
      } else {
        // Montagem, Faturado, Cancelado — não pode alterar
        naoAlteraveis++;
        if (!naoAlteravelLabels.includes(analise)) naoAlteravelLabels.push(analise);
      }
    }

    const items = [];
    if (bloqueados > 0) items.push({ color: 'green', text: `${bloqueados} pedido(s) bloqueado(s) com sucesso` });
    if (jaPendentes > 0) items.push({ color: 'yellow', text: `${jaPendentes} pedido(s) já pendente(s), sem alteração` });
    if (naoAlteraveis > 0) items.push({ color: 'red', text: `${naoAlteraveis} pedido(s) em ${naoAlteravelLabels.join('/')} não puderam ser alterados` });

    setBatchResult({ title: 'Resultado do Bloqueio', items });
    setSelectedIds([]);
    setBatchAction(null);
    await queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] });
    // Re-consultar apenas os pedidos que foram alterados
    const alterados = pedidos.filter(p => allSelected.some(s => s.id === p.id) && p.omie_enviado && p.omie_codigo_pedido && p.tipo !== 'troca');
    if (alterados.length > 0) {
      setTimeout(() => fetchOmieStatuses(alterados, { force: true }), 1500);
    }
  };

  const handleCancelConfirm = async (pedido, motivo) => {
    // Se o pedido foi enviado ao Omie, usa a função backend que valida a etapa
    if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
      const res = await base44.functions.invoke('cancelarPedidoOmie', { pedido_id: pedido.id, motivo });
      if (!res.data?.sucesso) {
        // Lançar erro para o modal exibir a mensagem
        throw new Error(res.data?.error || 'Erro ao cancelar pedido no Omie');
      }
      toast.success(res.data.mensagem || 'Pedido cancelado com sucesso');
    } else {
      // Pedido não foi enviado ao Omie, cancelar apenas localmente
      await base44.entities.Pedido.update(pedido.id, {
        status: 'cancelado',
        cancelado_por: currentUser?.email,
        cancelado_por_nome: currentUser?.full_name,
        data_cancelamento: new Date().toISOString(),
        motivo_cancelamento: motivo,
      });
      toast.success('Pedido cancelado');
    }
    queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] });
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
    <div className="space-y-1.5">
      {/* Filters - compact */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-1.5 p-2 bg-white border rounded-lg">
        {/* Buscar geral */}
        <div className="col-span-2 sm:col-span-2 lg:col-span-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
            <Input placeholder="Buscar pedido..." value={search} onChange={e => setSearch(e.target.value)} className="pl-7 h-6 text-[10px]" />
          </div>
        </div>
        {/* Status */}
        <div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos Status</SelectItem>
              <SelectItem value="analise_pendente">Pendente</SelectItem>
              <SelectItem value="analise_liberado">Liberados</SelectItem>
              <SelectItem value="analise_montagem">Montagem</SelectItem>
              <SelectItem value="analise_faturado">Faturado</SelectItem>
              <SelectItem value="analise_cancelado">Cancelado</SelectItem>
              <SelectItem value="sem_omie">Sem Omie</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Tipo */}
        <div>
          <Select value={tipoFilter} onValueChange={setTipoFilter}>
            <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos Tipos</SelectItem>
              <SelectItem value="venda">Venda</SelectItem>
              <SelectItem value="troca">Troca</SelectItem>
              <SelectItem value="bonificacao">Bonificação</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {/* Envio de */}
        <div>
          <Input type="date" value={envioInicio} onChange={e => setEnvioInicio(e.target.value)} className="h-6 text-[10px]" title="Envio de" />
        </div>
        {/* Envio até */}
        <div>
          <Input type="date" value={envioFim} onChange={e => setEnvioFim(e.target.value)} className="h-6 text-[10px]" title="Envio até" />
        </div>
        {/* Vendedor */}
        <div>
          <div className="flex gap-0.5">
            <Input placeholder="Vendedor..." value={vendedorSearch} onChange={e => { setVendedorSearch(e.target.value); setVendedorIds([]); }} className="h-6 text-[10px] flex-1" />
            <Button variant="outline" size="sm" className="h-6 w-6 p-0 shrink-0" title="Selecionar" onClick={() => setVendedorModalOpen(true)}>
              <List className="w-2.5 h-2.5" />
            </Button>
          </div>
        </div>
        {/* Cliente */}
        <div>
          <Input placeholder="Cliente..." value={clienteSearch} onChange={e => setClienteSearch(e.target.value)} className="h-6 text-[10px]" />
        </div>
        {/* Cidade */}
        <div>
          <Input placeholder="Cidade..." value={cidadeSearch} onChange={e => setCidadeSearch(e.target.value)} className="h-6 text-[10px]" />
        </div>
      </div>
      {/* Row 2: Produto + actions */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <div className="flex gap-0.5">
          <Input placeholder="Produto..." value={produtoSearch} onChange={e => { setProdutoSearch(e.target.value); setProdutoIds([]); }} className="h-6 text-[10px] w-32" />
          <Button variant="outline" size="sm" className="h-6 w-6 p-0 shrink-0" title="Selecionar" onClick={() => setProdutoModalOpen(true)}>
            <List className="w-2.5 h-2.5" />
          </Button>
        </div>
        {(vendedorIds.length > 0 || produtoIds.length > 0 || activeFilterCount > 0) && (
          <Button variant="ghost" size="sm" className="h-6 text-[10px] text-red-500 px-2" onClick={clearAllFilters}>
            <X className="w-2.5 h-2.5 mr-0.5" /> Limpar
          </Button>
        )}
        <Button
          size="sm"
          className="h-6 px-2 text-[10px] bg-blue-600 hover:bg-blue-700 text-white"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] });
            // Consultar apenas os pedidos visíveis na tela filtrada
            const visiveisOmie = filtered.filter(p => p.omie_enviado && p.omie_codigo_pedido && p.tipo !== 'troca');
            if (visiveisOmie.length > 0) {
              fetchOmieStatuses(visiveisOmie, { force: true });
            }
          }}
        >
          <RefreshCw className="w-2.5 h-2.5 mr-0.5" /> Atualizar
        </Button>
        {omieStatusLoading && (
          <span className="text-[9px] text-amber-600 flex items-center gap-0.5">
            <Loader2 className="w-2.5 h-2.5 animate-spin" /> Omie...
          </span>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto bg-white" style={{ height: 'calc(100vh - 280px)', minHeight: '250px' }}>
          <table className="text-[11px] border-collapse table-fixed" style={{ minWidth: '100%' }}>
            <DragDropContext onDragEnd={(result) => {
              if (!result.destination) return;
              reorder(result.source.index, result.destination.index);
            }}>
              <Droppable droppableId="columns" direction="horizontal">
                {(droppableProvided) => (
                  <thead className="bg-slate-100 sticky top-0 z-20">
                    <tr ref={droppableProvided.innerRef} {...droppableProvided.droppableProps}>
                      <th className="px-1.5 py-1 border-r border-slate-200" style={{ width: 32, minWidth: 32, maxWidth: 32 }}>
                        <Checkbox
                          checked={filtered.length > 0 && selectedIds.length === filtered.length}
                          onCheckedChange={toggleSelectAll}
                        />
                      </th>
                      {columns.map((col, index) => (
                        <Draggable key={col.id} draggableId={col.id} index={index}>
                          {(provided, snapshot) => (
                            <th
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              className={`relative text-left font-medium text-slate-600 whitespace-nowrap select-none border-r border-slate-200 overflow-hidden ${snapshot.isDragging ? 'bg-amber-100 shadow-lg z-50' : ''}`}
                              style={{ ...provided.draggableProps.style, width: colWidths[col.id] ? colWidths[col.id] : 100, minWidth: 40 }}
                            >
                              <span
                                {...provided.dragHandleProps}
                                className="block px-1.5 py-1 cursor-grab hover:text-slate-900"
                                onClick={() => { if (!snapshot.isDragging) toggleSort(col.field); }}
                              >
                                {col.label}
                                {sortField === col.field && (
                                  sortDir === 'asc'
                                    ? <ChevronUp className="w-2.5 h-2.5 inline ml-0.5" />
                                    : <ChevronDown className="w-2.5 h-2.5 inline ml-0.5" />
                                )}
                              </span>
                              {/* Resize handle */}
                              <div
                                className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-amber-400 active:bg-amber-500 z-10"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  const thEl = e.currentTarget.parentElement;
                                  onResizeStart(e, col.id, thEl?.offsetWidth || 100);
                                }}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </th>
                          )}
                        </Draggable>
                      ))}
                      {droppableProvided.placeholder}
                      <th className="px-1.5 py-1 text-left font-medium text-slate-600 whitespace-nowrap" style={{ width: 70, minWidth: 70 }}>Ações</th>
                    </tr>
                  </thead>
                )}
              </Droppable>
            </DragDropContext>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={columns.length + 2} className="p-6 text-center text-slate-400">Nenhum pedido encontrado</td></tr>
              ) : (
                filtered.map(p => (
                  <tr
                    key={p.id}
                    className={`border-t hover:bg-slate-50 ${selectedIds.includes(p.id) ? 'bg-amber-50' : ''}`}
                    style={{ userSelect: 'none' }}
                    onMouseDown={(e) => onRowMouseDown(e, p.id, selectedIds.includes(p.id))}
                    onMouseEnter={() => onRowMouseEnter(p.id)}
                    onMouseUp={onMouseUp}
                  >
                    <td className="px-1 py-0 border-r border-slate-100" style={{ width: 32, minWidth: 32, maxWidth: 32 }}>
                      <Checkbox
                        checked={selectedIds.includes(p.id)}
                        onCheckedChange={() => toggleSelect(p.id)}
                      />
                    </td>
                    {columns.map(col => (
                      <td key={col.id} className="px-1 py-0 border-r border-slate-100 overflow-hidden whitespace-nowrap text-ellipsis" style={{ width: colWidths[col.id] || 100, minWidth: 40, maxWidth: colWidths[col.id] || 100 }}>
                        <PedidoCellRenderer col={col} p={p} omie={omieStatuses[p.id]} omieRequestPending={omieStatusRequestsRef.current.has(p.id)} carregamentos={carregamentos} />
                      </td>
                    ))}
                    <td className="px-1 py-0" style={{ width: 70, minWidth: 70 }}>
                      <div className="flex gap-0.5">
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0" title="Ver pedido" onClick={() => setViewPedidoId(p.id)}>
                          <Eye className="w-2.5 h-2.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0" title="Débitos" onClick={() => { setDebitosCliente({ id: p.cliente_id, nome: p.cliente_nome }); setDebitosOpen(true); }}>
                          <DollarSign className="w-2.5 h-2.5" />
                        </Button>
                        {p.status !== 'cancelado' && p.status !== 'faturado' && p.status !== 'montagem' && (
                          <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-red-500" title="Cancelar" onClick={() => { setCancelPedido(p); setCancelModalOpen(true); }}>
                            <XCircle className="w-2.5 h-2.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-slate-500">
        {filtered.length} pedido(s) • Valor total: {formatCurrency(filtered.reduce((s, p) => s + (p.valor_total || 0), 0))}
        {Object.keys(omieStatuses).length > 0 && (
          <span className="ml-2 text-green-600">• Status Omie: {Object.keys(omieStatuses).length} com status</span>
        )}
      </div>

      {/* Batch actions - fixed bottom */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-0 left-0 lg:left-72 right-0 z-30 flex flex-wrap items-center gap-2 px-4 py-3 bg-amber-50 border-t border-amber-300 shadow-lg">
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

      {/* Batch result toast */}
      {batchResult && (
        <BatchResultToast results={batchResult} onClose={() => setBatchResult(null)} />
      )}

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
      <SelecionarEntidadeModal
        open={vendedorModalOpen}
        onOpenChange={setVendedorModalOpen}
        title="Selecionar Vendedor(es)"
        items={vendedores.filter(v => v.status === 'ativo')}
        selectedIds={vendedorIds}
        onConfirm={(ids) => { setVendedorIds(ids); setVendedorSearch(''); }}
        columns={[
          { field: 'nome', label: 'Nome' },
          { field: 'email', label: 'Email' },
          { field: 'funcao', label: 'Função' },
        ]}
      />
      <SelecionarEntidadeModal
        open={produtoModalOpen}
        onOpenChange={setProdutoModalOpen}
        title="Selecionar Produto(s)"
        items={produtos.filter(p => p.status === 'ativo')}
        selectedIds={produtoIds}
        onConfirm={(ids) => { setProdutoIds(ids); setProdutoSearch(''); }}
        columns={[
          { field: 'codigo', label: 'Código' },
          { field: 'nome', label: 'Nome' },
        ]}
      />
    </div>
  );
}