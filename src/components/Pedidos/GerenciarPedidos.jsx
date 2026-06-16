import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Popover, PopoverContent, PopoverTrigger
} from '@/components/ui/popover';
import {
  Search, ChevronUp, ChevronDown, Unlock, Lock, Printer, XCircle,
  Loader2, RefreshCw, DollarSign, Eye, List, X, Pencil, Link2
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
import PedidoCellRenderer, { formatCurrency } from './PedidoCellRenderer';
import BatchResultToast from './BatchResultToast';
import BuscarClienteModal from './BuscarClienteModal';
import LiberarPedidosModal from './LiberarPedidosModal';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';
import { Switch } from '@/components/ui/switch';
import useAutoRefreshPedidos from './useAutoRefreshPedidos.jsx';

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

const getYesterdayFilterDate = () => {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LOCAL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(yesterday);
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

const normalizeKey = (value) => String(value || '').trim().toLowerCase();
const onlyDigits = (value) => String(value || '').replace(/\D/g, '');

// Janela rígida da tela: só pedidos criados HOJE ou ONTEM (data de criação imutável).
// Borda inferior = ontem 00:00 no fuso local (America/Fortaleza, UTC-3) convertida para UTC.
const getCreatedDateFloorIso = () => {
  const ontem = getYesterdayFilterDate(); // 'YYYY-MM-DD'
  return new Date(`${ontem}T00:00:00.000-03:00`).toISOString();
};

// Bug 1: o período deve filtrar pela data correta conforme o status selecionado.
// Faturado → data_faturamento; Liberado → data_liberacao; Cancelado → data_cancelamento;
// demais → data_envio. Sempre com fallback para data_envio.
const getDataPeriodoPedido = (pedido, statusFilter) => {
  if (statusFilter === 'analise_faturado') return pedido.data_faturamento || pedido.data_envio;
  if (statusFilter === 'analise_liberado') return pedido.data_liberacao || pedido.data_envio;
  if (statusFilter === 'analise_cancelado') return pedido.data_cancelamento || pedido.data_envio;
  return pedido.data_envio;
};
const getClienteCodigo = (cliente) => cliente?.codigo_interno || cliente?.codigo_integracao || cliente?.codigo || cliente?.codigo_omie || '';

// Opções do filtro de status (multi-seleção). value = chave de análise.
const STATUS_OPCOES = [
  { value: 'analise_pendente', label: 'Pendente' },
  { value: 'analise_liberado', label: 'Liberados' },
  { value: 'analise_montagem', label: 'Montagem' },
  { value: 'analise_faturado', label: 'Faturado' },
  { value: 'analise_cancelado', label: 'Cancelado' },
  { value: 'sem_omie', label: 'Sem Omie' },
];

export default function GerenciarPedidos({ onEditPedido }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilters, setStatusFilters] = useState([]); // [] = Todos Status
  const [cenarioFiscalFilter, setCenarioFiscalFilter] = useState('todos');
  const [envioInicio, setEnvioInicio] = useState(() => getTodayFilterDate());
  const [envioFim, setEnvioFim] = useState(() => getTodayFilterDate());
  const [vendedorSearch, setVendedorSearch] = useState('');
  const [vendedorIds, setVendedorIds] = useState([]);
  const [vendedorModalOpen, setVendedorModalOpen] = useState(false);
  const [produtoSearch, setProdutoSearch] = useState('');
  const [produtoIds, setProdutoIds] = useState([]);
  const [produtoModalOpen, setProdutoModalOpen] = useState(false);
  const [clienteCodigo, setClienteCodigo] = useState('');
  const [buscarClienteOpen, setBuscarClienteOpen] = useState(false);
  const [redeFilter, setRedeFilter] = useState('todas');
  const [segmentoFilter, setSegmentoFilter] = useState('todos');
  const [rotaFilter, setRotaFilter] = useState('todas');
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
  const [reconciliarLoading, setReconciliarLoading] = useState(false);
  const [modalLiberar, setModalLiberar] = useState({ open: false, pedidos: [] });


  const { columns, reorder, resetOrder } = useColumnOrder();
  const { colWidths, onResizeStart } = useColumnResize();
  const queryClient = useQueryClient();

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const isAdmin = currentUser?.role === 'admin';

  // Releitura SOMENTE local (sem chamar Omie) — usada pelo auto-refresh.
  const recarregarLocal = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] }),
      queryClient.invalidateQueries({ queryKey: ['gerenciar-pedidos-omie-etapas'] }),
      queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar-faturados-recentes'] })
    ]);
  }, [queryClient]);

  const { enabled: autoRefresh, setEnabled: setAutoRefresh, textoUltima } = useAutoRefreshPedidos(recarregarLocal);

  const recarregarAbaAposAcao = async (resultado = null) => {
    setSelectedIds([]);
    if (resultado) setBatchResult(resultado);
    // Aguarda 1.5s para dar tempo do backend atualizar o espelho PedidoLiberadoOmie
    // antes de recarregar os dados na tela
    await new Promise(r => setTimeout(r, 1500));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] }),
      queryClient.invalidateQueries({ queryKey: ['gerenciar-pedidos-omie-etapas'] }),
      queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar-faturados-recentes'] })
    ]);
  };

  // PERFORMANCE: por padrão carrega só os status ATIVOS (pendente, liberado, montagem)
  // — ~251 registros em vez de 1.475 (5,4s → <0,5s). O filtro por status no SERVIDOR funciona.
  // Faturados/cancelados (84% do volume, já encerrados) são carregados SOB DEMANDA só quando
  // o usuário seleciona esses filtros no dropdown de status.
  const STATUS_ATIVOS = ['pendente', 'enviado', 'liberado', 'montagem'];

  // Status que vêm do servidor SOB DEMANDA (já encerrados, alto volume), com o campo de data usado para filtrar/ordenar.
  const STATUS_ENCERRADOS = { analise_faturado: 'faturado', analise_cancelado: 'cancelado' };
  const CAMPO_DATA_ENCERRADO = { faturado: 'data_faturamento', cancelado: 'data_cancelamento' };

  // Lista de status encerrados marcados (faturado/cancelado) — carregados sob demanda.
  const statusExtras = useMemo(() => {
    return statusFilters.map(s => STATUS_ENCERRADOS[s]).filter(Boolean);
  }, [statusFilters]);

  const yesterdayDate = useMemo(() => getYesterdayFilterDate(), []);
  const todayDate = useMemo(() => getTodayFilterDate(), []);

  // Corte RÍGIDO da janela (sempre em memória): só pedidos criados hoje ou ontem (data local).
  // NÃO usamos filtro de range por created_date na query — esse SDK retorna vazio com
  // operadores de range de data ($gte/$lte), por isso todo o corte é feito aqui.
  const dentroDaJanela = useCallback((p) => {
    const d = getLocalDateFromIso(p.created_date);
    return d === yesterdayDate || d === todayDate;
  }, [yesterdayDate, todayDate]);

  const { data: pedidosAtivos = [], isLoading } = useQuery({
    queryKey: ['pedidos-gerenciar'],
    queryFn: async () => {
      // Carrega por status (filtro de status no servidor FUNCIONA), ordenado por -created_date.
      const listas = await Promise.all(
        STATUS_ATIVOS.map(s => base44.entities.Pedido.filter({ status: s }, '-created_date', 5000))
      );
      return listas.flat();
    },
    staleTime: 30000,
  });

  // Faturados/cancelados — carrega TODOS os status encerrados marcados (uma query por status),
  // ordenado por -created_date. O corte da janela (ontem/hoje) é aplicado em memória depois.
  const { data: pedidosEncerrados = [] } = useQuery({
    queryKey: ['pedidos-gerenciar-encerrados', statusExtras.join('|')],
    queryFn: async () => {
      const listas = await Promise.all(
        statusExtras.map(statusEnc => base44.entities.Pedido.filter({ status: statusEnc }, '-created_date', 5000))
      );
      return listas.flat();
    },
    enabled: statusExtras.length > 0,
    staleTime: 60000,
  });

  // Faturados da visão padrão (sem filtro de status): carrega os mais recentes por -created_date.
  const { data: pedidosFaturadosRecentes = [] } = useQuery({
    queryKey: ['pedidos-gerenciar-faturados-recentes'],
    queryFn: () => base44.entities.Pedido.filter({ status: 'faturado' }, '-created_date', 5000),
    staleTime: 30000,
  });

  const pedidos = useMemo(() => {
    // Merge + dedup por id, aplicando o corte RÍGIDO da janela (ontem/hoje) em memória.
    const mapa = new Map();
    const fonte = statusExtras.length > 0
      ? [...pedidosAtivos, ...pedidosEncerrados]
      : [...pedidosAtivos, ...pedidosFaturadosRecentes];
    fonte.forEach(p => { if (p?.id && dentroDaJanela(p)) mapa.set(p.id, p); });
    return Array.from(mapa.values());
  }, [pedidosAtivos, pedidosEncerrados, pedidosFaturadosRecentes, statusExtras, dentroDaJanela]);

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list(),
    staleTime: 300000,
  });

  const currentUserName = useMemo(() => {
    const funcionario = vendedores.find(v => v.email?.toLowerCase() === currentUser?.email?.toLowerCase());
    return funcionario?.nome || currentUser?.full_name || currentUser?.email || '';
  }, [vendedores, currentUser]);

  // Carrega a base de clientes em UMA única chamada cacheada (staleTime alto).
  // Antes buscava cliente 1-a-1 (centenas de requests) → estourava 429 Too Many Requests
  // e fazia a query de faturados voltar vazia. Agora é 1 request, independente do volume.
  const { data: clientesDosPedidos = [] } = useQuery({
    queryKey: ['clientes-dos-pedidos-gerenciar'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 5000),
    staleTime: 300000,
    refetchOnWindowFocus: false,
  });

  const clientes = useMemo(() => {
    const mapa = new Map();
    clientesDosPedidos.forEach(c => mapa.set(c.id, c));
    return Array.from(mapa.values());
  }, [clientesDosPedidos]);

  const { data: redes = [] } = useQuery({
    queryKey: ['redes-gerenciar'],
    queryFn: () => base44.entities.Rede.list(),
    staleTime: 300000,
  });

  const { data: segmentos = [] } = useQuery({
    queryKey: ['segmentos-gerenciar'],
    queryFn: () => base44.entities.Segmento.list(),
    staleTime: 300000,
  });

  const { data: rotas = [] } = useQuery({
    queryKey: ['rotas-gerenciar'],
    queryFn: () => base44.entities.Rota.list(),
    staleTime: 300000,
  });

  const { data: cenariosFiscaisLocais = [] } = useQuery({
    queryKey: ['cenarios-fiscais-locais-gerenciar'],
    queryFn: () => base44.entities.CenarioFiscalLocal.list(),
    staleTime: 300000,
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos-gerenciar'],
    queryFn: () => base44.entities.Produto.list(),
    staleTime: 300000,
  });

  // Etapas Omie — mapa montado no BACKEND (mapaEtapasOmie, asServiceRole), entregando só os
  // campos necessários (~165KB vs ~2MB do espelho completo). Mesmo formato do antigo buildOmieMap:
  // chaves codigo raw, codigo como int e np:<numero_pedido>.
  const { data: omieMap = {} } = useQuery({
    queryKey: ['gerenciar-pedidos-omie-etapas'],
    queryFn: async () => {
      const res = await base44.functions.invoke('mapaEtapasOmie', {});
      return res?.data?.map || {};
    },
    staleTime: 30000,
    refetchOnWindowFocus: false
  });

  // Subscription em tempo real: atualiza o omieMap instantaneamente quando o espelho muda
  useEffect(() => {
    const unsubscribe = base44.entities.PedidoLiberadoOmie.subscribe(() => {
      queryClient.invalidateQueries({ queryKey: ['gerenciar-pedidos-omie-etapas'] });
    });
    return () => unsubscribe();
  }, [queryClient]);

  // Itens carregados SOB DEMANDA: só quando o usuário usa o filtro de produto.
  // No load inicial NÃO baixa os ~5.700 itens (era o vilão de 18s).
  const filtroProdutoAtivo = produtoIds.length > 0 || !!produtoSearch.trim();

  const { data: pedidoItems = [] } = useQuery({
    queryKey: ['pedidoItems-gerenciar-filtro', produtoIds.join('|'), produtoSearch.trim()],
    queryFn: async () => {
      // Por seleção de produto: filtra no SERVIDOR por produto_id (lotes).
      if (produtoIds.length > 0) {
        const itens = [];
        for (const pid of produtoIds) {
          const lista = await base44.entities.PedidoItem.filter({ produto_id: pid }, '-created_date', 20000);
          itens.push(...lista);
        }
        return itens;
      }
      // Por texto: não há índice de texto no servidor, então carrega itens e filtra no cliente.
      // Só ocorre quando o usuário digita um produto — não no load inicial.
      if (produtoSearch.trim()) {
        return base44.entities.PedidoItem.list('-created_date', 20000);
      }
      return [];
    },
    enabled: filtroProdutoAtivo,
    staleTime: 60000,
  });

  // Preço médio agora usa qtd_total_itens persistido no próprio Pedido (sem varrer PedidoItem).
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
    }).filter(Boolean);

    if (updates.length === 0) return;
    const LOTE = 20;
    const executar = async () => {
      for (let i = 0; i < updates.length; i += LOTE) {
        const lote = updates.slice(i, i + LOTE);
        await Promise.all(
          lote.map(u => base44.entities.Pedido.update(u.id, { cliente_codigo: u.codigo }))
        ).catch(() => {});
        if (i + LOTE < updates.length) {
          await new Promise(r => setTimeout(r, 200));
        }
      }
      queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] });
    };
    executar();
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

      // Cruzamento com etapa real do Omie — tenta múltiplas formas do código
      let omieInfo = null;
      if (pedido.omie_codigo_pedido) {
        const rawCode = String(pedido.omie_codigo_pedido).trim();
        omieInfo = omieMap[rawCode];
        // Fallback: tentar como inteiro puro (ex: "123456.0" → "123456")
        if (!omieInfo) {
          const asInt = String(parseInt(rawCode, 10));
          if (asInt !== 'NaN') omieInfo = omieMap[asInt];
        }
      }
      if (!omieInfo && pedido.numero_pedido) {
        omieInfo = omieMap[`np:${String(pedido.numero_pedido).trim()}`];
      }

      return {
        ...pedido,
        cliente_codigo: codigoCliente,
        cliente_codigo_base: codigoCliente,
        cliente_nome_base: cliente?.razao_social || pedido.cliente_nome,
        cliente_fantasia_base: cliente?.nome_fantasia || pedido.cliente_nome_fantasia,
        cliente_pendencia_financeira: !!cliente?.pendencia_financeira,
        rede_id: cliente?.rede_id || '',
        segmento_id: cliente?.segmento_id || '',
        cliente_rota_id: cliente?.rota_id || '',
        vendedor_id: cliente?.vendedor_id || pedido.vendedor_id || '',
        vendedor_nome: vendedorCliente?.nome || pedido.vendedor_nome || '-',
        usuario_envio: funcionarioEnvio?.nome || pedido.created_by || '-',
        omie_etapa_real: omieInfo?.etapa || null,
        omie_numero_nf: omieInfo?.numero_nf || null,
        omie_status_nf: omieInfo?.status_real || null,
        omie_status_label: omieInfo?.status_label || null,
        // Lê direto do campo persistido no Pedido (soma das quantidades).
        // Fallback para total_itens em pedidos antigos sem o campo.
        qtd_total_itens: pedido.qtd_total_itens || pedido.total_itens || 0,
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
    if (clienteCodigo.trim()) c++;
    if (redeFilter !== 'todas') c++;
    if (segmentoFilter !== 'todos') c++;
    if (rotaFilter !== 'todas') c++;
    if (cenarioFiscalFilter !== 'todos') c++;
    if (cidadeSearch.trim()) c++;
    return c;
  }, [envioInicio, envioFim, vendedorSearch, vendedorIds, produtoSearch, produtoIds, clienteCodigo, redeFilter, segmentoFilter, rotaFilter, cenarioFiscalFilter, cidadeSearch]);

  const clearAllFilters = () => {
    setSearch(''); setStatusFilters([]); setCenarioFiscalFilter('todos');
    setEnvioInicio(''); setEnvioFim('');
    setVendedorSearch(''); setVendedorIds([]);
    setProdutoSearch(''); setProdutoIds([]);
    setClienteCodigo(''); setRedeFilter('todas'); setSegmentoFilter('todos'); setRotaFilter('todas'); setCidadeSearch('');
  };

  // Filter and sort
  const filtered = useMemo(() => {
    // Gerenciar Pedidos: mostra todos os pedidos já enviados, independente do status atual.
    // Apenas pedidos ainda não enviados (status "pendente") ficam fora desta tela.
    let list = pedidosComVendedorCliente.filter(p => p.data_envio || p.status !== 'pendente');

    // Status — MULTI-SELEÇÃO: OR entre os status marcados (união). Lista vazia = Todos Status.
    const STATUS_REAL = {
      'analise_pendente': 'enviado',
      'analise_liberado': 'liberado',
      'analise_montagem': 'montagem',
      'analise_faturado': 'faturado',
      'analise_cancelado': 'cancelado',
    };
    if (statusFilters.length > 0) {
      const statusReais = statusFilters.map(s => STATUS_REAL[s]).filter(Boolean);
      const incluiSemOmie = statusFilters.includes('sem_omie');
      list = list.filter(p =>
        statusReais.includes(p.status) ||
        (incluiSemOmie && (!p.omie_enviado || !p.omie_codigo_pedido))
      );
    }
    if (cenarioFiscalFilter !== 'todos') {
      list = list.filter(p => p.cenario_local_id === cenarioFiscalFilter);
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(p =>
        (p.numero_pedido?.toString() || '').toLowerCase().includes(s) ||
        formatarNumeroPedido(p).toLowerCase().includes(s) ||
        (p.cliente_nome_base || '').toLowerCase().includes(s) ||
        (p.cliente_fantasia_base || '').toLowerCase().includes(s) ||
        (p.cliente_cpf_cnpj || '').includes(s) ||
        (p.cliente_codigo_base || '').toLowerCase().includes(s) ||
        (p.vendedor_nome || '').toLowerCase().includes(s) ||
        (p.numero_carga || '').toLowerCase().includes(s)
      );
    }
    // Período — SEMPRE pela DATA DE CRIAÇÃO do pedido (created_date), que é imutável e não muda
    // com reprocessamento de webhook. Garante que só apareçam pedidos criados dentro da janela.
    const dentroDoPeriodo = (p) => {
      const dataLocal = getLocalDateFromIso(p.created_date);
      if (envioInicio && !(dataLocal && dataLocal >= envioInicio)) return false;
      if (envioFim && !(dataLocal && dataLocal <= envioFim)) return false;
      return true;
    };
    if (envioInicio || envioFim) {
      list = list.filter(dentroDoPeriodo);
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
    // Cliente (código exato)
    if (clienteCodigo.trim()) {
      const codigo = clienteCodigo.trim().toLowerCase();
      list = list.filter(p => (p.cliente_codigo_base || '').toLowerCase() === codigo);
    }
    // Rede
    if (redeFilter !== 'todas') {
      list = list.filter(p => p.rede_id === redeFilter);
    }
    // Segmento
    if (segmentoFilter !== 'todos') {
      list = list.filter(p => p.segmento_id === segmentoFilter);
    }
    // Rota (do cliente)
    if (rotaFilter !== 'todas') {
      list = list.filter(p => p.cliente_rota_id === rotaFilter);
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
  }, [pedidosComVendedorCliente, statusFilters, cenarioFiscalFilter, search, sortField, sortDir, envioInicio, envioFim, vendedorSearch, vendedorIds, produtoSearch, produtoIds, pedidoIdsComProduto, clienteCodigo, redeFilter, segmentoFilter, rotaFilter, cidadeSearch, pedidoItems]);

  // Atualizar: sincroniza espelho com Omie e recarrega dados locais
  const syncEAtualizar = async () => {
    setSyncLoading(true);
    const timeoutId = setTimeout(() => {
      setSyncLoading(false);
      toast.info('A sincronização está demorando mais que o esperado. Os dados serão atualizados automaticamente em breve.');
    }, 25000);
    try {
      // Sincroniza o espelho PedidoLiberadoOmie com o Omie para pegar etapas atualizadas
      const res = await base44.functions.invoke('sincronizarLiberadosOmieRapido', { origem: 'gerenciar_pedidos', forcar_sem_cache: true }).catch(e => {
        console.warn('[GerenciarPedidos] sync espelho falhou:', e?.message);
        return null;
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar'] }),
        queryClient.invalidateQueries({ queryKey: ['gerenciar-pedidos-omie-etapas'] }),
        queryClient.invalidateQueries({ queryKey: ['pedidos-gerenciar-faturados-recentes'] })
      ]);
      if (res?.data?.em_andamento) {
        toast.success('Dados recarregados! Sincronização com Omie já em andamento em segundo plano.');
      } else if (res?.data?.bloqueado) {
        toast.warning('API Omie temporariamente bloqueada — dados locais recarregados. Tente novamente em alguns minutos.');
      } else if (res?.data?.sucesso) {
        const { criados = 0, atualizados = 0 } = res.data;
        toast.success(`Sincronizado: ${atualizados} atualizados, ${criados} novos`);
      } else if (!res) {
        toast.warning('Sem resposta do servidor — dados locais recarregados.');
      } else {
        const motivo = res?.data?.error || 'erro desconhecido';
        toast.warning(`Sincronização falhou: ${motivo}`);
      }
    } finally {
      clearTimeout(timeoutId);
      setSyncLoading(false);
    }
  };

  // Reconciliar Espelhos: reconstrói os espelhos faltantes (Pedido com omie_codigo_pedido sem
  // registro em PedidoLiberadoOmie) consultando o Omie. Se houver um Nº Carga digitado na busca,
  // reconcilia só aquela carga; senão roda em lote (max_cargas: 30).
  const reconciliarEspelhos = async () => {
    setReconciliarLoading(true);
    try {
      const numeroCarga = search.trim();
      const payload = /^\d{1,4}$/.test(numeroCarga)
        ? { numero_carga: numeroCarga }
        : { max_cargas: 30 };

      const res = await base44.functions.invoke('reconciliarEspelhoCargaCompleto', payload);
      const data = res?.data || {};

      if (data.bloqueado) {
        toast.warning('API Omie temporariamente bloqueada. Tente novamente em alguns minutos.');
      } else if (data.sucesso) {
        const { pedidos_atualizados = 0, nfs_vinculadas = 0, cargas_processadas = 0 } = data;
        if (pedidos_atualizados > 0 || nfs_vinculadas > 0) {
          toast.success(`Reconciliado: ${pedidos_atualizados} pedido(s) atualizado(s), ${nfs_vinculadas} NF(s) vinculada(s) em ${cargas_processadas} carga(s).`);
        } else {
          toast.info('Nenhum espelho pendente encontrado para reconciliar.');
        }
        await queryClient.invalidateQueries({ queryKey: ['gerenciar-pedidos-omie-etapas'] });
      } else {
        toast.warning(`Reconciliação falhou: ${data.error || 'erro desconhecido'}`);
      }
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || '';
      if (/bloquead/i.test(msg)) {
        toast.warning('API Omie temporariamente bloqueada (limite de requisições). Tente novamente em alguns minutos.');
      } else {
        toast.error(`Erro ao reconciliar espelhos: ${msg || 'tente novamente em alguns minutos.'}`);
      }
    } finally {
      setReconciliarLoading(false);
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

  // P1 (16/05): consulta bloqueio financeiro do cliente direto no Omie.
  // Usa a função correta `consultarBloqueioFinanceiroOmie` com cliente_id.
  // Retorna { deve_bloquear, titulos, titulos_atrasados, total_debitos, ... }
  const consultarBloqueio = async (clienteId) => {
    if (!clienteId) return null;
    try {
      const res = await base44.functions.invoke('consultarBloqueioFinanceiroOmie', {
        cliente_id: clienteId
      });
      return res.data;
    } catch (e) {
      console.error('Erro ao consultar bloqueio financeiro:', e);
      return null; // Em caso de erro na consulta, não bloquear o fluxo
    }
  };

  // Batch actions
  const handleBatchLiberar = () => {
    const selecionados = pedidosComVendedorCliente.filter(p => selectedIds.includes(p.id));
    const pendentes = selecionados.filter(p => getAnaliseStatus(p) === 'Pendente');

    if (pendentes.length === 0) {
      toast.warning('Selecione ao menos um pedido pendente para liberar');
      return;
    }

    setModalLiberar({ open: true, pedidos: pendentes });
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

  const handleCancelConfirm = async (pedidoOuPedidos, motivo) => {
    const pedidosParaCancelar = Array.isArray(pedidoOuPedidos) ? pedidoOuPedidos : [pedidoOuPedidos].filter(Boolean);
    let cancelados = 0;
    let erros = 0;
    const detalhesErro = [];

    for (const pedido of pedidosParaCancelar) {
      try {
        if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
          let res;
          try {
            res = await base44.functions.invoke('cancelarPedidoOmie', { pedido_id: pedido.id, motivo });
          } catch (invokeErr) {
            // Extrair mensagem real do backend (axios wraps em response.data)
            const backendMsg = invokeErr?.response?.data?.error || invokeErr?.message || 'Erro ao cancelar pedido no Omie';
            throw new Error(backendMsg);
          }
          if (!res.data?.sucesso) {
            throw new Error(res.data?.error || 'Erro ao cancelar pedido no Omie');
          }
        } else {
          await base44.entities.Pedido.update(pedido.id, {
            status: 'cancelado',
            cancelado_por: currentUser?.email,
            cancelado_por_nome: currentUserName,
            data_cancelamento: new Date().toISOString(),
            motivo_cancelamento: motivo,
          });
        }
        cancelados++;
      } catch (e) {
        erros++;
        detalhesErro.push(`Pedido ${pedido.numero_pedido || pedido.id}: ${e.message}`);
      }
    }

    const items = [];
    if (cancelados > 0) items.push({ color: 'green', text: `${cancelados} pedido(s) cancelado(s) com sucesso` });
    if (erros > 0) items.push({ color: 'red', text: `${erros} pedido(s) não puderam ser cancelados:\n${detalhesErro.join('\n')}` });

    await recarregarAbaAposAcao({ title: 'Resultado do Cancelamento', items });
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
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-12 gap-1.5 p-2 bg-white border rounded-lg shrink-0">
        {/* Buscar geral */}
        <div className="col-span-2 sm:col-span-2 lg:col-span-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
            <Input placeholder="Buscar pedido..." value={search} onChange={e => setSearch(e.target.value)} className="pl-7 h-6 text-[10px]" />
          </div>
        </div>
        {/* Status — MULTI-SELEÇÃO (caixinhas) */}
        <div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="h-6 text-[10px] w-full justify-between font-normal px-2">
                <span className="truncate">
                  {statusFilters.length === 0
                    ? 'Todos Status'
                    : statusFilters.length === 1
                      ? STATUS_OPCOES.find(o => o.value === statusFilters[0])?.label
                      : `${statusFilters.length} status`}
                </span>
                <ChevronDown className="w-2.5 h-2.5 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-44 p-1" align="start">
              <button
                className="w-full text-left text-[11px] px-2 py-1.5 rounded hover:bg-slate-100 text-slate-500"
                onClick={() => setStatusFilters([])}
              >
                Todos Status
              </button>
              {STATUS_OPCOES.map(opt => (
                <label key={opt.value} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-100 cursor-pointer text-[11px]">
                  <Checkbox
                    checked={statusFilters.includes(opt.value)}
                    onCheckedChange={(checked) => {
                      setStatusFilters(prev =>
                        checked ? [...prev, opt.value] : prev.filter(s => s !== opt.value)
                      );
                    }}
                  />
                  {opt.label}
                </label>
              ))}
            </PopoverContent>
          </Popover>
        </div>
        {/* Cenário Fiscal (independente 55/D1) */}
        <div>
          <Select value={cenarioFiscalFilter} onValueChange={setCenarioFiscalFilter}>
            <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Cenário Fiscal" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos Cenários</SelectItem>
              {cenariosFiscaisLocais.filter(c => c.status === 'ativo').map(c => (
                <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Envio de — mínimo = ontem (não permite datas anteriores) */}
        <div>
          <Input
            type="date"
            value={envioInicio}
            min={yesterdayDate}
            onChange={e => setEnvioInicio(e.target.value < yesterdayDate ? yesterdayDate : e.target.value)}
            className="h-6 text-[10px]"
            title="Envio de (mínimo: ontem)"
          />
        </div>
        {/* Envio até — mínimo = ontem */}
        <div>
          <Input
            type="date"
            value={envioFim}
            min={yesterdayDate}
            onChange={e => setEnvioFim(e.target.value < yesterdayDate ? yesterdayDate : e.target.value)}
            className="h-6 text-[10px]"
            title="Envio até (mínimo: ontem)"
          />
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
        {/* Cliente — busca EXATA por código + lupa para busca detalhada */}
        <div>
          <div className="flex gap-0.5">
            <Input
              placeholder="Cód. cliente..."
              value={clienteCodigo}
              onChange={e => setClienteCodigo(e.target.value)}
              className="h-6 text-[10px] flex-1 font-mono"
              title="Código exato do cliente"
            />
            <Button variant="outline" size="sm" className="h-6 w-6 p-0 shrink-0" title="Busca detalhada de cliente" onClick={() => setBuscarClienteOpen(true)}>
              <Search className="w-2.5 h-2.5" />
            </Button>
          </div>
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
        {/* Segmento */}
        <div>
          <Select value={segmentoFilter} onValueChange={setSegmentoFilter}>
            <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Segmento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos Segmentos</SelectItem>
              {segmentos.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Rota */}
        <div>
          <Select value={rotaFilter} onValueChange={setRotaFilter}>
            <SelectTrigger className="h-6 text-[10px]"><SelectValue placeholder="Rota" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas Rotas</SelectItem>
              {rotas.filter(r => r.status !== 'inativo').map(r => (
                <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
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
          onClick={syncEAtualizar}
        >
          {syncLoading ? <Loader2 className="w-2.5 h-2.5 mr-0.5 animate-spin" /> : <RefreshCw className="w-2.5 h-2.5 mr-0.5" />} Atualizar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[10px] border-emerald-300 text-emerald-700 hover:bg-emerald-50"
          disabled={reconciliarLoading}
          onClick={reconciliarEspelhos}
          title="Reconstrói espelhos faltantes consultando o Omie (pode demorar). Com um Nº de carga digitado na busca, reconcilia só aquela carga."
        >
          {reconciliarLoading ? <Loader2 className="w-2.5 h-2.5 mr-0.5 animate-spin" /> : <Link2 className="w-2.5 h-2.5 mr-0.5" />} Reconciliar Espelhos
        </Button>
        {/* Auto-refresh (releitura local, sem chamar Omie) */}
        <div className="flex items-center gap-1.5 ml-auto text-[10px] text-slate-500">
          <span className="hidden sm:inline">Atualizado {textoUltima}</span>
          <span className="flex items-center gap-1">
            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} className="scale-75 origin-right" />
            <span className="text-slate-600 font-medium">Auto</span>
          </span>
        </div>
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
          const cancelaveis = selectedPedidos.filter(p => !['cancelado', 'faturado', 'montagem'].includes(p.status));
          if (cancelaveis.length === 0) {
            toast.warning('Nenhum dos pedidos selecionados pode ser cancelado');
            return;
          }
          setCancelPedido(cancelaveis);
          setCancelModalOpen(true);
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
      <BuscarClienteModal
        open={buscarClienteOpen}
        onOpenChange={setBuscarClienteOpen}
        onConfirm={(codigo) => setClienteCodigo(codigo)}
      />
      <LiberarPedidosModal
        isOpen={modalLiberar.open}
        pedidosSelecionados={modalLiberar.pedidos}
        usuarioLogado={currentUser}
        usuarioNome={currentUserName}
        onClose={async () => {
          setModalLiberar({ open: false, pedidos: [] });
          setSelectedIds([]);
          await recarregarAbaAposAcao();
        }}
      />
    </div>
  );
}