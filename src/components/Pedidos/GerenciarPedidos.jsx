import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Search, Loader2, Unlock, Lock, Printer, Pencil, FileText,
  Trash2, DollarSign, Undo2, AlertTriangle, Filter, ChevronUp, ChevronDown
} from 'lucide-react';
import { toast } from 'sonner';
import DebitosClienteModal from './DebitosClienteModal';
import PedidoPdf from './PedidoPdf';
import PedidoAgrupado from './PedidoAgrupado.jsx';
import CancelarPedidoModal from './CancelarPedidoModal';

const STATUS_COLORS = {
  pendente:  { bg: 'bg-red-100 text-red-700 border-red-300', dot: 'bg-red-500' },
  enviado:   { bg: 'bg-blue-100 text-blue-700 border-blue-300', dot: 'bg-blue-500' },
  liberado:  { bg: 'bg-green-100 text-green-700 border-green-300', dot: 'bg-green-500' },
  faturado:  { bg: 'bg-yellow-100 text-yellow-800 border-yellow-400', dot: 'bg-yellow-500' },
  cancelado: { bg: 'bg-neutral-200 text-neutral-800 border-neutral-400', dot: 'bg-neutral-700' },
};

const STATUS_LABELS = {
  pendente: 'PENDENTE', enviado: 'ENVIADO', liberado: 'LIBERADO',
  faturado: 'FATURADO', cancelado: 'CANCELADO'
};

const TIPO_LABELS = { venda: 'VENDA', troca: 'TROCA', bonificacao: 'BONIFICAÇÃO' };

function formatDt(v) {
  if (!v) return '-';
  return new Date(v).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function formatCurrency(v) {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function GerenciarPedidos({ onEditPedido }) {
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroVendedor, setFiltroVendedor] = useState('todos');
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroPeriodoInicio, setFiltroPeriodoInicio] = useState('');
  const [filtroPeriodoFim, setFiltroPeriodoFim] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [acaoEmLote, setAcaoEmLote] = useState(false);
  const [mostrarAgrupado, setMostrarAgrupado] = useState(false);
  const [pdfPedidoId, setPdfPedidoId] = useState(null);
  const [debitosOpen, setDebitosOpen] = useState(false);
  const [debitosClienteId, setDebitosClienteId] = useState(null);
  const [debitosClienteNome, setDebitosClienteNome] = useState('');
  const [cancelarPedido, setCancelarPedido] = useState(null);
  const [cancelarOpen, setCancelarOpen] = useState(false);
  const [liberandoId, setLiberandoId] = useState(null);
  const [tornandoPendenteId, setTornandoPendenteId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [sortField, setSortField] = useState('created_date');
  const [sortDir, setSortDir] = useState('desc');

  React.useEffect(() => { base44.auth.me().then(setCurrentUser).catch(() => {}); }, []);

  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ['todos-pedidos'],
    queryFn: () => base44.entities.Pedido.list('-created_date', 5000)
  });

  const { data: allItems = [] } = useQuery({
    queryKey: ['pedidoItems-all-gestao'],
    queryFn: () => base44.entities.PedidoItem.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  // Items count map
  const itemsCountMap = useMemo(() => {
    const map = {};
    allItems.forEach(i => { map[i.pedido_id] = (map[i.pedido_id] || 0) + 1; });
    return map;
  }, [allItems]);

  // Filtro
  const pedidosFiltrados = useMemo(() => {
    let result = pedidos.filter(p => {
      if (filtroStatus !== 'todos' && p.status !== filtroStatus) return false;
      if (filtroVendedor !== 'todos' && p.vendedor_id !== filtroVendedor) return false;
      if (filtroTipo !== 'todos' && p.tipo !== filtroTipo) return false;
      const s = searchText.toLowerCase();
      if (s) {
        const match = p.cliente_nome?.toLowerCase().includes(s) ||
          p.cliente_nome_fantasia?.toLowerCase().includes(s) ||
          p.cliente_codigo?.includes(s) ||
          p.cliente_cpf_cnpj?.includes(s) ||
          String(p.numero_pedido || '').includes(s) ||
          p.vendedor_nome?.toLowerCase().includes(s);
        if (!match) return false;
      }
      if (filtroPeriodoInicio) {
        const d = (p.data_envio || p.created_date || '').split('T')[0];
        if (d < filtroPeriodoInicio) return false;
      }
      if (filtroPeriodoFim) {
        const d = (p.data_envio || p.created_date || '').split('T')[0];
        if (d > filtroPeriodoFim) return false;
      }
      return true;
    });

    // Sort
    result.sort((a, b) => {
      let va = a[sortField] ?? '';
      let vb = b[sortField] ?? '';
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      va = String(va).toLowerCase();
      vb = String(vb).toLowerCase();
      return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });

    return result;
  }, [pedidos, filtroStatus, filtroVendedor, filtroTipo, searchText, filtroPeriodoInicio, filtroPeriodoFim, sortField, sortDir]);

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 inline ml-0.5" /> : <ChevronDown className="w-3 h-3 inline ml-0.5" />;
  };

  // Seleção
  const toggleSelect = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleSelectAll = () => {
    setSelectedIds(prev => prev.length === pedidosFiltrados.length ? [] : pedidosFiltrados.map(p => p.id));
  };

  // Ações individuais
  const liberarPedido = async (pedido) => {
    setLiberandoId(pedido.id);
    try {
      const response = await base44.functions.invoke('consultarDebitosOmie', { cliente_id: pedido.cliente_id });
      const debitos = response.data;
      let pendenciaIgnorada = false;
      if (debitos.tem_pendencia) {
        const confirmar = window.confirm(
          `⚠️ ATENÇÃO: Cliente com pendência financeira!\n${debitos.titulos_atrasados} título(s) atrasado(s)\nTotal: R$ ${(debitos.total_debitos || 0).toFixed(2)}\n\nLiberar mesmo assim?`
        );
        if (!confirmar) { setLiberandoId(null); return; }
        pendenciaIgnorada = true;
      }
      let omieOk = true;
      if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
        const faturarResp = await base44.functions.invoke('faturarPedidoOmie', { pedido_id: pedido.id, etapa: "20" });
        if (!faturarResp.data?.sucesso) { omieOk = false; toast.error('Falha ao mover etapa no Omie: ' + (faturarResp.data?.erro || '')); }
      }
      if (omieOk) {
        const vendedor = vendedores.find(v => v.email?.toLowerCase() === currentUser?.email?.toLowerCase());
        await base44.entities.Pedido.update(pedido.id, {
          status: 'liberado', liberado_por: currentUser?.email || '',
          liberado_por_nome: vendedor?.nome || currentUser?.full_name || currentUser?.email || '',
          data_liberacao: new Date().toISOString(), pendencia_financeira_ignorada: pendenciaIgnorada
        });
        if (pedido.tipo === 'troca') {
          const itemsTroca = allItems.filter(i => i.pedido_id === pedido.id);
          for (const item of itemsTroca) {
            await base44.entities.Troca.create({
              data: new Date().toISOString().split('T')[0], cliente_id: pedido.cliente_id, cliente_nome: pedido.cliente_nome,
              produto_original_id: item.produto_id, produto_original_nome: item.produto_nome,
              produto_novo_id: item.produto_id, produto_novo_nome: item.produto_nome,
              motivo_id: item.motivo_troca_id || '', motivo_descricao: item.motivo_troca_descricao || '',
              vendedor_id: pedido.vendedor_id, vendedor_nome: pedido.vendedor_nome,
              venda_original_id: pedido.id, quantidade: item.quantidade,
              valor_unitario: item.valor_unitario || 0, observacoes: pedido.observacoes || ''
            });
          }
        }
        toast.success('Pedido liberado!');
      }
      queryClient.invalidateQueries({ queryKey: ['todos-pedidos'] });
    } catch (err) { toast.error('Erro: ' + err.message); }
    finally { setLiberandoId(null); }
  };

  const tornarPendente = async (pedido) => {
    if (!confirm('Tornar pedido pendente novamente?')) return;
    setTornandoPendenteId(pedido.id);
    try {
      let omieOk = true;
      if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
        const resp = await base44.functions.invoke('faturarPedidoOmie', { pedido_id: pedido.id, etapa: "10" });
        if (!resp.data?.sucesso) { omieOk = false; toast.error('Falha Omie: ' + (resp.data?.erro || '')); }
      }
      if (omieOk) {
        await base44.entities.Pedido.update(pedido.id, {
          status: 'pendente', liberado_por: null, liberado_por_nome: null, data_liberacao: null, pendencia_financeira_ignorada: false
        });
        if (pedido.tipo === 'troca' && pedido.status === 'liberado') {
          const trocas = await base44.entities.Troca.filter({ venda_original_id: pedido.id });
          for (const t of trocas) await base44.entities.Troca.delete(t.id);
        }
        queryClient.invalidateQueries({ queryKey: ['todos-pedidos'] });
        toast.success('Pedido retornado para Pendente');
      }
    } finally { setTornandoPendenteId(null); }
  };

  const handleCancelarPedido = async (pedido, motivo) => {
    const resp = await base44.functions.invoke('cancelarPedidoOmie', { pedido_id: pedido.id, motivo });
    if (resp.data?.sucesso) toast.success(resp.data.mensagem);
    else toast.error('Erro: ' + (resp.data?.erro || resp.data?.error));
    queryClient.invalidateQueries({ queryKey: ['todos-pedidos'] });
  };

  // Ações em lote
  const liberarSelecionados = async () => {
    const lista = pedidosFiltrados.filter(p => selectedIds.includes(p.id) && (p.status === 'enviado' || p.status === 'pendente'));
    if (!lista.length) { toast.error('Nenhum pedido Enviado/Pendente selecionado'); return; }
    if (!confirm(`Liberar ${lista.length} pedido(s)?`)) return;
    setAcaoEmLote(true);
    let ok = 0;
    for (const p of lista) { try { await liberarPedido(p); ok++; } catch {} }
    setAcaoEmLote(false); setSelectedIds([]);
    queryClient.invalidateQueries({ queryKey: ['todos-pedidos'] });
  };

  const bloquearSelecionados = async () => {
    const lista = pedidosFiltrados.filter(p => selectedIds.includes(p.id) && (p.status === 'enviado' || p.status === 'liberado'));
    if (!lista.length) { toast.error('Nenhum pedido Enviado/Liberado selecionado'); return; }
    if (!confirm(`Bloquear ${lista.length} pedido(s)?`)) return;
    setAcaoEmLote(true);
    for (const p of lista) {
      try {
        if (p.omie_enviado && p.omie_codigo_pedido) {
          const r = await base44.functions.invoke('faturarPedidoOmie', { pedido_id: p.id, etapa: "10" });
          if (!r.data?.sucesso) continue;
        }
        await base44.entities.Pedido.update(p.id, { status: 'pendente', liberado_por: null, liberado_por_nome: null, data_liberacao: null, pendencia_financeira_ignorada: false });
        if (p.tipo === 'troca' && p.status === 'liberado') {
          const trocas = await base44.entities.Troca.filter({ venda_original_id: p.id });
          for (const t of trocas) await base44.entities.Troca.delete(t.id);
        }
      } catch {}
    }
    setAcaoEmLote(false); setSelectedIds([]);
    queryClient.invalidateQueries({ queryKey: ['todos-pedidos'] });
    toast.success('Pedidos bloqueados!');
  };

  // Views
  if (mostrarAgrupado) return <PedidoAgrupado pedidoIds={selectedIds} onVoltar={() => setMostrarAgrupado(false)} />;
  if (pdfPedidoId) return (
    <div className="space-y-4">
      <button onClick={() => setPdfPedidoId(null)} className="text-sm text-blue-600 hover:underline">← Voltar</button>
      <PedidoPdf pedidoId={pdfPedidoId} />
    </div>
  );

  const totalValor = pedidosFiltrados.reduce((s, p) => s + (p.valor_total || 0), 0);

  const COLUMNS = [
    { key: 'numero_pedido', label: 'Nº PEDIDO', w: 'w-20' },
    { key: 'cliente_codigo', label: 'COD CLI', w: 'w-20' },
    { key: 'cliente_nome', label: 'RAZÃO SOCIAL', w: 'min-w-[160px]' },
    { key: 'cliente_nome_fantasia', label: 'FANTASIA', w: 'min-w-[120px]' },
    { key: 'status', label: 'STATUS', w: 'w-24' },
    { key: 'numero_carga', label: 'Nº CARGA', w: 'w-20' },
    { key: 'created_date', label: 'DT LANÇAMENTO', w: 'w-36' },
    { key: 'data_previsao_entrega', label: 'DT PREV ENTREGA', w: 'w-28' },
    { key: 'cliente_cpf_cnpj', label: 'CPF/CNPJ', w: 'w-32' },
    { key: 'vendedor_nome', label: 'VENDEDOR', w: 'min-w-[120px]' },
    { key: 'tipo', label: 'TIPO', w: 'w-24' },
    { key: 'valor_total', label: 'VALOR NOTA', w: 'w-24' },
    { key: '_preco_medio', label: 'PREÇO MÉDIO', w: 'w-24' },
    { key: '_total_itens', label: 'ITENS', w: 'w-16' },
    { key: 'observacoes', label: 'OBS', w: 'min-w-[100px]' },
    { key: 'liberado_por_nome', label: 'FUNC LIBERAÇÃO', w: 'min-w-[100px]' },
    { key: 'data_liberacao', label: 'DT LIBERAÇÃO', w: 'w-36' },
    { key: 'cancelado_por_nome', label: 'FUNC CANCELAMENTO', w: 'min-w-[110px]' },
    { key: 'data_cancelamento', label: 'DT CANCELAMENTO', w: 'w-36' },
    { key: 'motivo_cancelamento', label: 'MOT CANCELAMENTO', w: 'min-w-[120px]' },
  ];

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="bg-white rounded-xl p-3 shadow-sm border space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-600"><Filter className="w-4 h-4" /> Filtros</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <div className="relative col-span-2 sm:col-span-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Buscar..." value={searchText} onChange={e => setSearchText(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
          <Select value={filtroStatus} onValueChange={setFiltroStatus}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos Status</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="enviado">Enviado</SelectItem>
              <SelectItem value="liberado">Liberado</SelectItem>
              <SelectItem value="faturado">Faturado</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filtroVendedor} onValueChange={setFiltroVendedor}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Vendedor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos Vendedores</SelectItem>
              {vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filtroTipo} onValueChange={setFiltroTipo}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos Tipos</SelectItem>
              <SelectItem value="venda">Venda</SelectItem>
              <SelectItem value="troca">Troca</SelectItem>
              <SelectItem value="bonificacao">Bonificação</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={filtroPeriodoInicio} onChange={e => setFiltroPeriodoInicio(e.target.value)} className="h-8 text-xs" />
          <Input type="date" value={filtroPeriodoFim} onChange={e => setFiltroPeriodoFim(e.target.value)} className="h-8 text-xs" />
        </div>
      </div>

      {/* Resumo */}
      <div className="flex flex-wrap gap-3 text-xs">
        <div className="bg-white rounded-lg px-3 py-2 border shadow-sm"><span className="text-slate-500">Total:</span> <span className="font-bold">{pedidosFiltrados.length}</span></div>
        <div className="bg-red-50 rounded-lg px-3 py-2 border border-red-200"><span className="text-red-600">Pendentes:</span> <span className="font-bold text-red-700">{pedidosFiltrados.filter(p => p.status === 'pendente').length}</span></div>
        <div className="bg-blue-50 rounded-lg px-3 py-2 border border-blue-200"><span className="text-blue-600">Enviados:</span> <span className="font-bold text-blue-700">{pedidosFiltrados.filter(p => p.status === 'enviado').length}</span></div>
        <div className="bg-green-50 rounded-lg px-3 py-2 border border-green-200"><span className="text-green-600">Liberados:</span> <span className="font-bold text-green-700">{pedidosFiltrados.filter(p => p.status === 'liberado').length}</span></div>
        <div className="bg-yellow-50 rounded-lg px-3 py-2 border border-yellow-300"><span className="text-yellow-700">Faturados:</span> <span className="font-bold text-yellow-800">{pedidosFiltrados.filter(p => p.status === 'faturado').length}</span></div>
        <div className="bg-white rounded-lg px-3 py-2 border shadow-sm"><span className="text-slate-500">Valor:</span> <span className="font-bold text-green-700">{formatCurrency(totalValor)}</span></div>
      </div>

      {/* Barra de ações em lote */}
      {selectedIds.length > 0 && (
        <div className="sticky top-0 z-20 bg-white border rounded-xl p-2 shadow-lg flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-700">{selectedIds.length} selecionado(s)</span>
          <Button size="sm" onClick={liberarSelecionados} disabled={acaoEmLote} className="bg-green-600 hover:bg-green-700 text-xs h-7">
            {acaoEmLote ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Unlock className="w-3 h-3 mr-1" />} Liberar
          </Button>
          <Button size="sm" onClick={bloquearSelecionados} disabled={acaoEmLote} className="bg-orange-500 hover:bg-orange-600 text-xs h-7">
            {acaoEmLote ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Lock className="w-3 h-3 mr-1" />} Bloquear
          </Button>
          <Button size="sm" onClick={() => { if (!selectedIds.length) return; setMostrarAgrupado(true); }} className="bg-red-500 hover:bg-red-600 text-xs h-7">
            <Printer className="w-3 h-3 mr-1" /> Imprimir
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])} className="text-xs h-7 text-slate-500">Limpar</Button>
        </div>
      )}

      {/* Tabela */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>
      ) : pedidosFiltrados.length === 0 ? (
        <div className="text-center py-16 text-slate-400"><FileText className="w-10 h-10 mx-auto mb-2" /><p className="text-sm">Nenhum pedido encontrado</p></div>
      ) : (
        <div className="bg-white rounded-xl border shadow-sm overflow-x-auto">
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b">
                <th className="px-1.5 py-2 sticky left-0 bg-slate-100 z-10">
                  <Checkbox checked={selectedIds.length === pedidosFiltrados.length && pedidosFiltrados.length > 0} onCheckedChange={toggleSelectAll} />
                </th>
                <th className="px-1.5 py-2 text-[10px] font-bold text-slate-600">AÇÕES</th>
                {COLUMNS.map(col => (
                  <th key={col.key} className={`px-1.5 py-2 text-[10px] font-bold text-slate-600 cursor-pointer select-none whitespace-nowrap ${col.w}`}
                    onClick={() => !col.key.startsWith('_') && toggleSort(col.key)}>
                    {col.label}
                    {!col.key.startsWith('_') && <SortIcon field={col.key} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pedidosFiltrados.map((p, idx) => {
                const isSelected = selectedIds.includes(p.id);
                const sc = STATUS_COLORS[p.status] || STATUS_COLORS.pendente;
                const itemCount = itemsCountMap[p.id] || p.total_itens || 0;
                const precoMedio = itemCount > 0 ? (p.valor_total || 0) / itemCount : 0;

                return (
                  <tr key={p.id} className={`border-b hover:bg-slate-50 transition-colors ${isSelected ? 'bg-blue-50' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                    <td className="px-1.5 py-1.5 sticky left-0 bg-inherit z-10">
                      <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(p.id)} />
                    </td>
                    <td className="px-1.5 py-1.5 whitespace-nowrap">
                      <div className="flex gap-0.5">
                        {(p.status === 'enviado' || p.status === 'pendente') && (
                          <button onClick={() => liberarPedido(p)} disabled={liberandoId === p.id}
                            className="p-1 rounded hover:bg-green-100 text-green-600" title="Liberar">
                            {liberandoId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlock className="w-3 h-3" />}
                          </button>
                        )}
                        {p.status === 'liberado' && (
                          <button onClick={() => tornarPendente(p)} disabled={tornandoPendenteId === p.id}
                            className="p-1 rounded hover:bg-amber-100 text-amber-600" title="Pendente">
                            {tornandoPendenteId === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                          </button>
                        )}
                        {p.status !== 'cancelado' && (
                          <button onClick={() => onEditPedido(p.id)} className="p-1 rounded hover:bg-blue-100 text-blue-600" title="Editar">
                            <Pencil className="w-3 h-3" />
                          </button>
                        )}
                        <button onClick={() => setPdfPedidoId(p.id)} className="p-1 rounded hover:bg-slate-200 text-slate-600" title="PDF">
                          <FileText className="w-3 h-3" />
                        </button>
                        <button onClick={() => { setDebitosClienteId(p.cliente_id); setDebitosClienteNome(p.cliente_nome); setDebitosOpen(true); }}
                          className="p-1 rounded hover:bg-purple-100 text-purple-600" title="Débitos">
                          <DollarSign className="w-3 h-3" />
                        </button>
                        {p.status !== 'cancelado' && (
                          <button onClick={() => { setCancelarPedido(p); setCancelarOpen(true); }}
                            className="p-1 rounded hover:bg-red-100 text-red-500" title="Cancelar">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-1.5 py-1.5 font-bold text-center">{p.numero_pedido || '-'}</td>
                    <td className="px-1.5 py-1.5 text-center">{p.cliente_codigo || '-'}</td>
                    <td className="px-1.5 py-1.5 truncate max-w-[180px]" title={p.cliente_nome}>{p.cliente_nome || '-'}</td>
                    <td className="px-1.5 py-1.5 truncate max-w-[140px]" title={p.cliente_nome_fantasia}>{p.cliente_nome_fantasia || '-'}</td>
                    <td className="px-1.5 py-1.5 text-center">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border ${sc.bg}`}>
                        {STATUS_LABELS[p.status] || p.status?.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-1.5 py-1.5 text-center">{p.numero_carga || '-'}</td>
                    <td className="px-1.5 py-1.5 whitespace-nowrap">{formatDt(p.data_envio || p.created_date)}</td>
                    <td className="px-1.5 py-1.5 whitespace-nowrap">{p.data_previsao_entrega || '-'}</td>
                    <td className="px-1.5 py-1.5 whitespace-nowrap">{p.cliente_cpf_cnpj || '-'}</td>
                    <td className="px-1.5 py-1.5 truncate max-w-[120px]" title={p.vendedor_nome}>{p.vendedor_nome || '-'}</td>
                    <td className="px-1.5 py-1.5 text-center font-medium">{TIPO_LABELS[p.tipo] || p.tipo?.toUpperCase() || '-'}</td>
                    <td className="px-1.5 py-1.5 text-right font-medium">{formatCurrency(p.valor_total)}</td>
                    <td className="px-1.5 py-1.5 text-right">{formatCurrency(precoMedio)}</td>
                    <td className="px-1.5 py-1.5 text-center">{itemCount}</td>
                    <td className="px-1.5 py-1.5 truncate max-w-[120px]" title={p.observacoes}>{p.observacoes || '-'}</td>
                    <td className="px-1.5 py-1.5 truncate max-w-[110px]">{p.liberado_por_nome || '-'}</td>
                    <td className="px-1.5 py-1.5 whitespace-nowrap">{formatDt(p.data_liberacao)}</td>
                    <td className="px-1.5 py-1.5 truncate max-w-[110px]">{p.cancelado_por_nome || '-'}</td>
                    <td className="px-1.5 py-1.5 whitespace-nowrap">{formatDt(p.data_cancelamento)}</td>
                    <td className="px-1.5 py-1.5 truncate max-w-[140px]" title={p.motivo_cancelamento}>{p.motivo_cancelamento || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <DebitosClienteModal open={debitosOpen} onOpenChange={setDebitosOpen} clienteId={debitosClienteId} clienteNome={debitosClienteNome} />
      <CancelarPedidoModal open={cancelarOpen} onOpenChange={setCancelarOpen} pedido={cancelarPedido} onConfirm={handleCancelarPedido} />
    </div>
  );
}