import React, { useState, useEffect, useMemo } from 'react';
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
  Loader2, RefreshCw, DollarSign, Eye, List, X, Pencil
} from 'lucide-react';
import { toast } from 'sonner';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import CancelarPedidoModal from './CancelarPedidoModal';
import DebitosClienteModal from './DebitosClienteModal';
import PedidoAgrupado from './PedidoAgrupado';
import PedidoPdf from './PedidoPdf';
import PedidoPdfMultiplo from './PedidoPdfMultiplo';
import PedidoPreviewSelecionado from './PedidoPreviewSelecionado';
import SelecionarEntidadeModal from './SelecionarEntidadeModal';
import useDragSelect from './useDragSelect';
import useColumnOrder from './useColumnOrder';
import useColumnResize from './useColumnResize';
import PedidoCellRenderer, { formatDate, formatCurrency } from './PedidoCellRenderer';
import BatchResultToast from './BatchResultToast';

const LOCAL_TIMEZONE = 'America/Fortaleza';

const getTodayFilterDate = () => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LOCAL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
};

const getLocalDateFromIso = (value) => {
  if (!value) return '';
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LOCAL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
};

const formatNumeroPedidoBusca = (pedido) => {
  if (!pedido?.numero_pedido) return '';
  if (pedido.tipo !== 'troca') return String(pedido.numero_pedido);
  const digits = String(pedido.numero_pedido).replace(/\D/g, '');
  return `${digits.padStart(5, '0')}T`;
};

const normalizeKey = (value) => String(value || '').trim().toLowerCase();
const onlyDigits = (value) => String(value || '').replace(/\D/g, '');
const getClienteCodigo = (cliente) => cliente?.codigo_interno || cliente?.codigo_integracao || cliente?.codigo || cliente?.codigo_omie || '';

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
  const [redeFilter, setRedeFilter] = useState('todas');
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
  const [viewPedidoAnaliticoId, setViewPedidoAnaliticoId] = useState(null);
  const [viewPedidoAnaliticoIds, setViewPedidoAnaliticoIds] = useState(null);
  const [batchResult, setBatchResult] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);


  const { columns, reorder, resetOrder } = useColumnOrder();
  const { colWidths, onResizeStart } = useColumnResize();
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

  const currentUserName = useMemo(() => {
    const funcionario = vendedores.find(v => v.email?.toLowerCase() === currentUser?.email?.toLowerCase());
    return funcionario?.nome || currentUser?.full_name || currentUser?.email || '';
  }, [vendedores, currentUser]);

  const { data: clientesBase = [] } = useQuery({
    queryKey: ['clientes-gerenciar'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 5000),
  });

  const pedidoClienteIds = useMemo(() => [...new Set(pedidos.map(p => p.cliente_id).filter(Boolean))], [pedidos]);

  const { data: clientesDosPedidos = [] } = useQuery({
    queryKey: ['clientes-dos-pedidos-gerenciar', pedidoClienteIds.join('|')],
    queryFn: async () => {
      if (pedidoClienteIds.length === 0) return [];
      const listas = await Promise.all(pedidoClienteIds.map(id => base44.entities.Cliente.filter({ id }, '-created_date', 1)));
      return listas.flat();
    },
    enabled: pedidoClienteIds.length > 0,
  });

  const clientes = useMemo(() => {
    const mapa = new Map();
    [...clientesBase, ...clientesDosPedidos].forEach(c => mapa.set(c.id, c));
    return Array.from(mapa.values());
  }, [clientesBase, clientesDosPedidos]);

  const { data: redes = [] } = useQuery({
    queryKey: ['redes-gerenciar'],
    queryFn: () => base44.entities.Rede.list(),
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos-gerenciar'],
    queryFn: () => base44.entities.Produto.list(),
  });

  // Etapas Omie em tempo real — busca em paralelo as 4 etapas + faturados
  const { data: omieMap = {} } = useQuery({
    queryKey: ['gerenciar-pedidos-omie-etapas'],
    queryFn: async () => {
      const etapas = ['10', '20', '50'];
      const resultados = await Promise.all([
        ...etapas.map(et =>
          base44.functions.invoke('buscarPedidosOmie', {
            etapa: et,
            registros_por_pagina: 100,
            buscar_todas_paginas: true
          }).then(r => ({ etapa: et, pedidos: r.data?.pedidos || [] })).catch(() => ({ etapa: et, pedidos: [] }))
        ),
        base44.functions.invoke('consultarStatusFaturamentoOmie', {
          registros_por_pagina: 100,
          buscar_todas_paginas: true
        }).then(r => ({ etapa: '60', pedidos: r.data?.pedidos || [] })).catch(() => ({ etapa: '60', pedidos: [] }))
      ]);
      const map = {};
      resultados.forEach(({ etapa, pedidos }) => {
        pedidos.forEach(p => {
          const key = String(p.codigo_pedido);
          map[key] = { etapa, ...p };
          if (p.numero_pedido) map[`np:${p.numero_pedido}`] = { etapa, ...p };
        });
      });
      return map;
    },
    staleTime: 30000,
    refetchOnWindowFocus: false
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

  const clientesLookup = useMemo(() => {
    const byId = new Map();
    const byCodigo = new Map();
    const byCpfCnpj = new Map();
    const byNome = new Map();

    clientes.forEach(c => {
      byId.set(c.id, c);
      [c.codigo, c.codigo_interno, c.codigo_integracao, c.codigo_omie, getClienteCodigo(c)].filter(Boolean).forEach(codigo => {
        byCodigo.set(normalizeKey(codigo), c);
      });
      const cpfCnpj = onlyDigits(c.cnpj_cpf);
      if (cpfCnpj) byCpfCnpj.set(cpfCnpj, c);
      [c.razao_social, c.nome_fantasia].filter(Boolean).forEach(nome => byNome.set(normalizeKey(nome), c));
    });

    return { byId, byCodigo, byCpfCnpj, byNome };
  }, [clientes]);

  useEffect(() => {
    if (!pedidos.length || !clientes.length) return;
    const updates = pedidos.map(p => {
      const cliente = clientesLookup.byId.get(p.cliente_id)
        || clientesLookup.byCodigo.get(normalizeKey(p.cliente_codigo))
        || clientesLookup.byCpfCnpj.get(onlyDigits(p.cliente_cpf_cnpj))
        || clientesLookup.byNome.get(normalizeKey(p.cliente_nome))
        || clientesLookup.byNome.get(normalizeKey(p.cliente_nome_fantasia));
      const codigo = p.cliente_codigo || getClienteCodigo(cliente);
      return (!p.cliente_codigo && codigo) ? { id: p.id, codigo } : null;
    }).filter(Boolean).slice(0, 100);

    if (updates.length === 0) return;
    Promise.all(updates.map(u => base44.entities.Pedido.update(u.id, { cliente_codigo: u.codigo })))
      .then(() => queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] }))
      .catch(() => {});
  }, [pedidos, clientes, clientesLookup, queryClient]);

  const pedidosComVendedorCliente = useMemo(() => {
    return pedidos.map((pedido) => {
      const cliente = clientesLookup.byId.get(pedido.cliente_id)
        || clientesLookup.byCodigo.get(normalizeKey(pedido.cliente_codigo))
        || clientesLookup.byCpfCnpj.get(onlyDigits(pedido.cliente_cpf_cnpj))
        || clientesLookup.byNome.get(normalizeKey(pedido.cliente_nome))
        || clientesLookup.byNome.get(normalizeKey(pedido.cliente_nome_fantasia));
      const codigoCliente = pedido.cliente_codigo || getClienteCodigo(cliente);
      const vendedorCliente = cliente?.vendedor_id ? vendedoresMap[cliente.vendedor_id] : null;
      const funcionarioEnvio = vendedores.find(v => v.email?.toLowerCase() === pedido.created_by?.toLowerCase());

      // Cruzamento com etapa real do Omie
      let omieInfo = null;
      if (pedido.omie_codigo_pedido) omieInfo = omieMap[String(pedido.omie_codigo_pedido)];
      if (!omieInfo && pedido.numero_pedido) omieInfo = omieMap[`np:${pedido.numero_pedido}`];

      return {
        ...pedido,
        cliente_codigo: codigoCliente,
        cliente_codigo_base: codigoCliente,
        cliente_nome_base: cliente?.razao_social || pedido.cliente_nome,
        cliente_fantasia_base: cliente?.nome_fantasia || pedido.cliente_nome_fantasia,
        rede_id: cliente?.rede_id || '',
        vendedor_id: cliente?.vendedor_id || pedido.vendedor_id || '',
        vendedor_nome: vendedorCliente?.nome || pedido.vendedor_nome || '-',
        usuario_envio: funcionarioEnvio?.nome || pedido.created_by || '-',
        omie_etapa_real: omieInfo?.etapa || null,
        omie_numero_nf: omieInfo?.numero_nf || null,
        omie_status_nf: omieInfo?.status_real || null,
        omie_status_label: omieInfo?.status_label || null,
      };
    });
  }, [pedidos, clientesLookup, vendedoresMap, vendedores, omieMap]);

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
    if (redeFilter !== 'todas') c++;
    if (cidadeSearch.trim()) c++;
    return c;
  }, [envioInicio, envioFim, vendedorSearch, vendedorIds, produtoSearch, produtoIds, clienteSearch, redeFilter, cidadeSearch]);

  const clearAllFilters = () => {
    setSearch(''); setStatusFilter('todos'); setTipoFilter('todos');
    setEnvioInicio(''); setEnvioFim('');
    setVendedorSearch(''); setVendedorIds([]);
    setProdutoSearch(''); setProdutoIds([]);
    setClienteSearch(''); setRedeFilter('todas'); setCidadeSearch('');
  };

  // Filter and sort
  const filtered = useMemo(() => {
    // Gerenciar Pedidos: mostra todos os pedidos já enviados, independente do status atual.
    // Apenas pedidos ainda não enviados (status "pendente") ficam fora desta tela.
    let list = pedidosComVendedorCliente.filter(p => p.data_envio || p.status !== 'pendente');

    if (statusFilter !== 'todos') {
      const statusFilterMap = {
        'analise_pendente': ['enviado'],
        'analise_liberado': ['liberado'],
        'analise_montagem': ['montagem'],
        'analise_faturado': ['faturado'],
        'analise_cancelado': ['cancelado'],
      };
      if (statusFilter === 'sem_omie') {
        list = list.filter(p => !p.omie_enviado || !p.omie_codigo_pedido);
      } else if (statusFilterMap[statusFilter]) {
        const targetStatuses = statusFilterMap[statusFilter];
        list = list.filter(p => targetStatuses.includes(p.status));
      }
    }
    if (tipoFilter !== 'todos') {
      list = list.filter(p => p.tipo === tipoFilter);
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(p =>
        (p.numero_pedido?.toString() || '').toLowerCase().includes(s) ||
        formatNumeroPedidoBusca(p).toLowerCase().includes(s) ||
        (p.cliente_nome_base || '').toLowerCase().includes(s) ||
        (p.cliente_fantasia_base || '').toLowerCase().includes(s) ||
        (p.cliente_cpf_cnpj || '').includes(s) ||
        (p.cliente_codigo_base || '').toLowerCase().includes(s) ||
        (p.vendedor_nome || '').toLowerCase().includes(s) ||
        (p.numero_carga || '').toLowerCase().includes(s)
      );
    }
    // Período de envio
    if (envioInicio) {
      list = list.filter(p => {
        const dataEnvioLocal = getLocalDateFromIso(p.data_envio);
        return dataEnvioLocal && dataEnvioLocal >= envioInicio;
      });
    }
    if (envioFim) {
      list = list.filter(p => {
        const dataEnvioLocal = getLocalDateFromIso(p.data_envio);
        return dataEnvioLocal && dataEnvioLocal <= envioFim;
      });
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
        (p.cliente_nome_base || '').toLowerCase().includes(cs) ||
        (p.cliente_fantasia_base || '').toLowerCase().includes(cs) ||
        (p.cliente_codigo_base || '').includes(cs)
      );
    }
    // Rede
    if (redeFilter !== 'todas') {
      list = list.filter(p => p.rede_id === redeFilter);
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
  }, [pedidosComVendedorCliente, statusFilter, tipoFilter, search, sortField, sortDir, envioInicio, envioFim, vendedorSearch, vendedorIds, produtoSearch, produtoIds, pedidoIdsComProduto, clienteSearch, redeFilter, cidadeSearch, pedidoItems]);

  // Verificar cancelamentos de pedidos faturados no Omie
  const syncFaturadosOmie = async () => {
    const faturados = pedidos.filter(p => p.status === 'faturado' && p.omie_enviado && p.omie_codigo_pedido && p.tipo !== 'troca');
    if (faturados.length === 0) return;
    try {
      setSyncLoading(true);
      const res = await base44.functions.invoke('sincronizarStatusPedidosOmie', {});
      if (res.data?.atualizados > 0) {
        queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] });
        toast.success(`${res.data.atualizados} pedido(s) faturado(s) atualizado(s) via Omie`);
      }
    } catch (e) {
      console.error('Erro ao sincronizar faturados:', e);
    } finally {
      setSyncLoading(false);
    }
  };

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
  const { onRowMouseDown, onRowMouseEnter, onMouseMove, onMouseUp } = useDragSelect(
    filtered.map(p => p.id),
    setSelectedIds
  );

  // Helper: resolve o status de análise do pedido (agora 100% local)
  const getAnaliseStatus = (p) => {
    const localMap = { pendente: 'Pendente', enviado: 'Pendente', liberado: 'Liberados', montagem: 'Montagem', faturado: 'Faturado', cancelado: 'Cancelado' };
    return localMap[p.status] || p.status;
  };

  // Consultar bloqueio financeiro de um cliente pelo código
  const consultarBloqueio = async (codigoCliente) => {
    if (!codigoCliente) return null;
    try {
      const res = await base44.functions.invoke('consultarBloqueioFinanceiro', {
        acao: 'consultar',
        codigo: codigoCliente
      });
      return res.data;
    } catch (e) {
      console.error('Erro ao consultar bloqueio financeiro:', e);
      return null; // Em caso de erro na consulta, não bloquear o fluxo
    }
  };

  // Batch actions
  const handleBatchLiberar = async () => {
    setBatchAction('liberando');
    const allSelected = pedidos.filter(p => selectedIds.includes(p.id));

    let liberados = 0;
    let jaLiberados = 0;
    let naoAlteraveis = 0;
    let bloqueadosFinanceiro = 0;
    let errosOmie = 0;
    const naoAlteravelLabels = [];
    const clientesBloqueados = [];
    const clientesErroOmie = [];

    for (const p of allSelected) {
      const analise = getAnaliseStatus(p);
      if (analise === 'Pendente') {
        // Verificar bloqueio financeiro antes de liberar
        const codigoCliente = p.cliente_codigo_base || p.cliente_codigo;
        if (codigoCliente) {
          const bloqueio = await consultarBloqueio(codigoCliente);
          if (bloqueio && bloqueio.bloqueado === true) {
            bloqueadosFinanceiro++;
            const nomeCliente = p.cliente_nome_base || p.cliente_nome || codigoCliente;
            const motivo = bloqueio.cliente?.motivo || bloqueio.mensagem || 'Bloqueio financeiro';
            const tipoBloqueio = bloqueio.cliente?.tipo_bloqueio || 'financeiro';
            clientesBloqueados.push(`${nomeCliente} (${codigoCliente}) - ${tipoBloqueio}: ${motivo}`);
            continue;
          }
        }

        // Pode liberar — primeiro tenta no Omie, depois atualiza localmente
        if (p.omie_enviado && p.omie_codigo_pedido && p.tipo !== 'troca') {
          try {
            const res = await base44.functions.invoke('liberarPedidoOmie', { pedido_id: p.id });
            if (res.data && !res.data.sucesso && res.data.erro) {
              errosOmie++;
              const nomeCliente = p.cliente_nome_base || p.cliente_nome || p.cliente_codigo;
              clientesErroOmie.push(`${nomeCliente}: ${res.data.erro}`);
              continue; // Não libera localmente se o Omie rejeitou
            }
          } catch (e) {
            errosOmie++;
            const nomeCliente = p.cliente_nome_base || p.cliente_nome || p.cliente_codigo;
            clientesErroOmie.push(`${nomeCliente}: ${e.message}`);
            continue; // Não libera localmente se houve erro
          }
        }
        const updateData = {
          status: 'liberado',
          liberado_por: currentUser?.email,
          liberado_por_nome: currentUserName,
          data_liberacao: new Date().toISOString(),
        };
        await base44.entities.Pedido.update(p.id, updateData);
        liberados++;
      } else if (analise === 'Liberados') {
        jaLiberados++;
      } else {
        naoAlteraveis++;
        if (!naoAlteravelLabels.includes(analise)) naoAlteravelLabels.push(analise);
      }
    }

    const items = [];
    if (liberados > 0) items.push({ color: 'green', text: `${liberados} pedido(s) liberado(s) com sucesso` });
    if (bloqueadosFinanceiro > 0) items.push({ color: 'red', text: `${bloqueadosFinanceiro} pedido(s) BLOQUEADO(S) financeiramente:\n${clientesBloqueados.join('\n')}` });
    if (errosOmie > 0) items.push({ color: 'red', text: `${errosOmie} pedido(s) com ERRO no Omie (não liberados):\n${clientesErroOmie.join('\n')}` });
    if (jaLiberados > 0) items.push({ color: 'yellow', text: `${jaLiberados} pedido(s) já liberado(s), sem alteração` });
    if (naoAlteraveis > 0) items.push({ color: 'red', text: `${naoAlteraveis} pedido(s) em ${naoAlteravelLabels.join('/')} não puderam ser alterados` });

    setBatchResult({ title: 'Resultado da Liberação', items });
    setSelectedIds([]);
    setBatchAction(null);
    await queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] });
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
        // Pode bloquear — primeiro tenta reverter no Omie
        if (p.omie_enviado && p.omie_codigo_pedido && p.tipo !== 'troca') {
          try {
            const res = await base44.functions.invoke('liberarPedidoOmie', { pedido_id: p.id, etapa: '10' });
            if (res.data && !res.data.sucesso && res.data.erro) {
              naoAlteraveis++;
              if (!naoAlteravelLabels.includes('Erro Omie')) naoAlteravelLabels.push('Erro Omie');
              continue;
            }
          } catch (e) {
            naoAlteraveis++;
            if (!naoAlteravelLabels.includes('Erro Omie')) naoAlteravelLabels.push('Erro Omie');
            continue;
          }
        }
        await base44.entities.Pedido.update(p.id, {
          status: 'enviado',
          liberado_por: null,
          liberado_por_nome: null,
          data_liberacao: null,
        });
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
        cancelado_por_nome: currentUserName,
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
        <PedidoAgrupado pedidoIds={[viewPedidoId]} onVoltar={() => setViewPedidoId(null)} />
      </div>
    );
  }

  if (viewPedidoAnaliticoIds && viewPedidoAnaliticoIds.length > 0) {
    return <PedidoPdfMultiplo pedidoIds={viewPedidoAnaliticoIds} onVoltar={() => setViewPedidoAnaliticoIds(null)} />;
  }

  if (viewPedidoAnaliticoId) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => setViewPedidoAnaliticoId(null)}>Voltar</Button>
        <PedidoPdf pedidoId={viewPedidoAnaliticoId} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] gap-1.5">
      {/* Filters - compact (FIXO no topo) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-10 gap-1.5 p-2 bg-white border rounded-lg shrink-0">
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
        {/* Rede */}
        <div>
          <Select value={redeFilter} onValueChange={setRedeFilter}>
            <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Rede" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas Redes</SelectItem>
              {redes.filter(r => r.status === 'ativo').map(rede => (
                <SelectItem key={rede.id} value={rede.id}>{rede.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Cidade */}
        <div>
          <Input placeholder="Cidade..." value={cidadeSearch} onChange={e => setCidadeSearch(e.target.value)} className="h-6 text-[10px]" />
        </div>
      </div>
      {/* Row 2: Produto + actions (FIXO) */}
      <div className="flex flex-wrap gap-1.5 items-center shrink-0">
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
          disabled={syncLoading}
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] });
            syncFaturadosOmie();
          }}
        >
          {syncLoading ? <Loader2 className="w-2.5 h-2.5 mr-0.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5 mr-0.5" />} Atualizar
        </Button>
      </div>

      {/* Table — área rolável que ocupa o espaço restante */}
      {isLoading ? (
        <div className="flex justify-center py-12 flex-1">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      ) : (
        <div className="border rounded-lg overflow-auto bg-white cursor-default select-none flex-1 min-h-0" onMouseMove={onMouseMove} onMouseUp={onMouseUp}>
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
                    data-drag-select-id={p.id}
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
                        <PedidoCellRenderer col={col} p={p} />
                      </td>
                    ))}
                    <td className="px-1 py-0" style={{ width: 70, minWidth: 70 }}>
                      <div className="flex gap-0.5">
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0" title="Ver pedido analítico" onClick={() => setViewPedidoAnaliticoId(p.id)}>
                          <Eye className="w-2.5 h-2.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0" title="Débitos" onClick={() => { setDebitosCliente({ id: p.cliente_id, nome: p.cliente_nome }); setDebitosOpen(true); }}>
                          <DollarSign className="w-2.5 h-2.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Contagem (FIXO) */}
      <div className="text-xs text-slate-500 shrink-0">
        {filtered.length} pedido(s) • Valor total: {formatCurrency(filtered.reduce((s, p) => s + (p.valor_total || 0), 0))}
      </div>

      {/* Pré-visualização dos produtos — SEMPRE VISÍVEL, altura fixa */}
      <div className="shrink-0">
        <PedidoPreviewSelecionado pedidoId={selectedIds.length === 1 ? selectedIds[0] : null} />
      </div>

      {/* Barra de ações — SEMPRE VISÍVEL no rodapé */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-300 rounded-lg shadow-sm">
        <span className="text-sm font-medium text-amber-800">
          {selectedIds.length > 0 ? `${selectedIds.length} selecionado(s)` : 'Nenhum selecionado'}
        </span>
        <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={handleBatchLiberar} disabled={!!batchAction || selectedIds.length === 0}>
          {batchAction === 'liberando' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Unlock className="w-3 h-3 mr-1" />}
          Liberar
        </Button>
        <Button size="sm" variant="outline" onClick={handleBatchBloquear} disabled={!!batchAction || selectedIds.length === 0}>
          {batchAction === 'bloqueando' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Lock className="w-3 h-3 mr-1" />}
          Bloquear
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowAgrupado(true)} disabled={selectedIds.length === 0}>
          <Printer className="w-3 h-3 mr-1" /> Imprimir Agrupado
        </Button>
        <Button size="sm" variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50" disabled={selectedIds.length === 0} onClick={() => {
          if (selectedIds.length === 1) {
            setViewPedidoAnaliticoId(selectedIds[0]);
          } else if (selectedIds.length > 1) {
            setViewPedidoAnaliticoIds([...selectedIds]);
          }
        }}>
          <Printer className="w-3 h-3 mr-1" /> Analítico ({selectedIds.length})
        </Button>
        {(() => {
          const canEdit = selectedIds.length === 1;
          const selectedPedido = canEdit ? pedidos.find(p => p.id === selectedIds[0]) : null;
          const analise = selectedPedido ? getAnaliseStatus(selectedPedido) : null;
          const editavel = canEdit && selectedPedido && ['Pendente', 'Liberados'].includes(analise);
          return (
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white" disabled={!editavel || !!batchAction} onClick={() => { if (editavel) onEditPedido(selectedIds[0]); }}>
              <Pencil className="w-3 h-3 mr-1" /> Editar
            </Button>
          );
        })()}
        <Button size="sm" variant="destructive" disabled={!!batchAction || selectedIds.length === 0} onClick={() => {
          const selectedPedidos = pedidos.filter(p => selectedIds.includes(p.id));
          const cancelavel = selectedPedidos.find(p => !['cancelado', 'faturado', 'montagem'].includes(p.status));
          if (selectedIds.length === 1 && cancelavel) {
            setCancelPedido(cancelavel);
            setCancelModalOpen(true);
          } else if (selectedIds.length > 1) {
            if (cancelavel) { setCancelPedido(cancelavel); setCancelModalOpen(true); }
            else toast.warning('Nenhum dos pedidos selecionados pode ser cancelado');
          }
        }}>
          <XCircle className="w-3 h-3 mr-1" /> Cancelar
        </Button>
        {selectedIds.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>Limpar</Button>
        )}
      </div>

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