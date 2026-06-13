import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Workflow, RefreshCw, Search, Plus, FileBarChart, Truck, ExternalLink, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import KanbanColumn from '@/components/operacao/KanbanColumn';
import CardPedidoKanban from '@/components/operacao/CardPedidoKanban';
import ConfirmarAcaoModal from '@/components/operacao/ConfirmarAcaoModal';
import { useOperacaoOmie } from '@/components/operacao/useOperacaoOmie';

// === Espelho fiel das etapas Omie (ListarEtapasFaturamento) ===
const ETAPAS = {
  '10': { label: 'Pedido de Venda', color: 'amber',   border: '#f59e0b' },
  '20': { label: 'Liberados',       color: 'blue',    border: '#3b82f6' },
  '50': { label: 'Faturar',         color: 'orange',  border: '#f97316' },
  '60': { label: 'Faturado',        color: 'emerald', border: '#22c55e' },
};
const FLUXO = ['10', '20', '50', '60'];

// Cores de status NF (etapa 60)
const STATUS_NF = {
  emitida:        { border: '#22c55e' },
  rejeitada:      { border: '#ef4444' },
  cancelada:      { border: '#64748b' },
  denegada:       { border: '#dc2626' },
  aguardando_nf:  { border: '#f59e0b' }
};

function formatarData(d) {
  if (!d) return '';
  const partes = d.split('/');
  if (partes.length !== 3) return d;
  const data = new Date(`${partes[2]}-${partes[1]}-${partes[0]}T12:00:00`);
  if (isNaN(data.getTime())) return d;
  const dia = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][data.getDay()];
  return `${partes[0]}/${partes[1]} ${dia}`;
}

function tempoDecorrido(timestamp) {
  if (!timestamp) return '—';
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 5) return 'agora';
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  return `${Math.floor(diff / 3600)}h`;
}

export default function Operacao() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [busca, setBusca] = useState('');
  const [acaoPendente, setAcaoPendente] = useState(null);
  const [executando, setExecutando] = useState(false);
  const [tick, setTick] = useState(0);

  // Tick a cada segundo só pra atualizar o "atualizado há Xs"
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  const { queries, refetchAll, lastFullUpdate, isAnyLoading, totalGeral, valorGeral } = useOperacaoOmie();

  const { data: cargas = [], isLoading: loadingCargas, refetch: refetchCargas } = useQuery({
    queryKey: ['cargasOperacao'],
    queryFn: () => base44.entities.Carga.list('-created_date', 100),
    staleTime: 30000
  });

  // Clientes: lookup codigo_omie → codigo_interno
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientesOperacao'],
    queryFn: () => base44.entities.Cliente.list('-updated_date', 2000),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false
  });
  const clienteLookup = useMemo(() => {
    const map = {};
    for (const c of clientes) {
      if (c.codigo_omie) map[String(c.codigo_omie)] = c.codigo_interno || '';
    }
    return map;
  }, [clientes]);

  // Filtro de busca + ordenação por data prevista
  const filtrarOrdenar = (lista) => {
    const t = busca.trim().toLowerCase();
    let r = lista;
    if (t) {
      r = lista.filter(p =>
        (p.numero_pedido || '').toString().toLowerCase().includes(t) ||
        (p.nome_fantasia || '').toLowerCase().includes(t) ||
        (p.nome_cliente || '').toLowerCase().includes(t) ||
        (p.cliente_nome || '').toLowerCase().includes(t) ||
        (p.cliente_cpf_cnpj || '').includes(t) ||
        (p.numero_nf || '').toString().includes(t) ||
        (p.cliente_cidade || '').toLowerCase().includes(t) ||
        (p.rota_nome || '').toLowerCase().includes(t) ||
        (p.vendedor_nome || '').toLowerCase().includes(t) ||
        (clienteLookup[String(p.codigo_cliente)] || '').toLowerCase().includes(t)
      );
    }
    // Ordena por data prevista (mais antiga primeiro)
    return [...r].sort((a, b) => {
      const da = (a.data_previsao || '').split('/').reverse().join('');
      const db = (b.data_previsao || '').split('/').reverse().join('');
      return da.localeCompare(db);
    });
  };

  const valorColuna = (etapa) => {
    return (queries[etapa].data || []).reduce((s, p) => s + (Number(p.valor_total_pedido) || 0), 0);
  };

  // Solicita confirmação de movimentação
  const solicitarMover = (pedido, etapaAtual, etapaDestino) => {
    if (etapaAtual === etapaDestino) return;
    const de = ETAPAS[etapaAtual];
    const para = ETAPAS[etapaDestino];
    if (!para) return;

    if (etapaDestino === '60') {
      setAcaoPendente({
        tipo: 'emitir_nf',
        titulo: 'Emitir Nota Fiscal?',
        descricao: 'Isso vai disparar a emissão da NF-e no Omie. A NF é processada pela SEFAZ e em alguns minutos o pedido aparece em "Faturado".',
        de: de?.label || etapaAtual,
        para: 'Emitir NF-e',
        badgeColor: 'emerald',
        perigo: true,
        pedido,
        payload: { etapaDestino, etapaAtual }
      });
      return;
    }

    setAcaoPendente({
      tipo: 'mover_etapa',
      titulo: `Mover pedido para ${para.label}?`,
      descricao: `O pedido será movido no Omie da etapa "${de?.label || etapaAtual}" para "${para.label}".`,
      de: de?.label || etapaAtual,
      para: para.label,
      badgeColor: para.color,
      perigo: false,
      pedido,
      payload: { etapaDestino, etapaAtual }
    });
  };

  const executarAcao = async () => {
    if (!acaoPendente) return;
    setExecutando(true);
    try {
      if (acaoPendente.tipo === 'mover_etapa') {
        const resp = await base44.functions.invoke('trocarEtapaPedidoOmie', {
          codigo_pedido: acaoPendente.pedido.codigo_pedido,
          codigo_pedido_integracao: acaoPendente.pedido.codigo_pedido_integracao,
          etapa: acaoPendente.payload.etapaDestino
        }).catch(err => { throw new Error(err?.response?.data?.error || err.message); });

        const data = resp?.data;
        if (!data?.sucesso) throw new Error(data?.error || data?.resposta?.cDescStatus || 'Omie rejeitou a mudança de etapa');
        toast.success(`Pedido ${acaoPendente.pedido.numero_pedido} movido para ${acaoPendente.para}`, { description: 'Webhook Omie atualizará em segundos.' });
      }

      if (acaoPendente.tipo === 'emitir_nf') {
        // Validação prévia
        const validacao = await base44.functions.invoke('emitirNfPedidoOmie', {
          codigo_pedido: acaoPendente.pedido.codigo_pedido,
          codigo_pedido_integracao: acaoPendente.pedido.codigo_pedido_integracao,
          validar_apenas: true
        }).catch(err => { throw new Error(err?.response?.data?.error || err.message); });
        const valData = validacao?.data;
        if (valData?.cCodStatus === '1' || /n[ãa]o \u00e9 poss[ií]vel faturar/i.test(valData?.cDescStatus || '')) {
          throw new Error(valData?.cDescStatus || 'Pedido não pode ser faturado');
        }

        // Faturar
        const resp = await base44.functions.invoke('emitirNfPedidoOmie', {
          codigo_pedido: acaoPendente.pedido.codigo_pedido,
          codigo_pedido_integracao: acaoPendente.pedido.codigo_pedido_integracao
        }).catch(err => { throw new Error(err?.response?.data?.error || err.message); });
        const data = resp?.data;
        if (!data?.sucesso) throw new Error(data?.error || 'Omie rejeitou a emissão da NF');
        toast.success(`NF do pedido ${acaoPendente.pedido.numero_pedido} enviada para emissão`, {
          description: data.cDescStatus || 'Webhook NFe atualizará quando SEFAZ processar.',
          duration: 8000
        });
      }
      setAcaoPendente(null);
    } catch (e) {
      toast.error(e.message || 'Erro ao mover pedido', { duration: 8000 });
    } finally {
      setExecutando(false);
    }
  };

  // Drag and drop
  const onDragStart = (e, pedido, etapaOrigem) => {
    e.dataTransfer.setData('pedido', JSON.stringify(pedido));
    e.dataTransfer.setData('etapa', etapaOrigem);
  };
  const onDrop = (e, etapaDestino) => {
    const pedido = JSON.parse(e.dataTransfer.getData('pedido') || '{}');
    const etapaOrigem = e.dataTransfer.getData('etapa');
    if (pedido.codigo_pedido) solicitarMover(pedido, etapaOrigem, etapaDestino);
  };

  const renderCards = (etapa) => {
    const lista = filtrarOrdenar(queries[etapa].data || []);
    const proximaEtapa = FLUXO[FLUXO.indexOf(etapa) + 1];
    const proxLabel = proximaEtapa ? ETAPAS[proximaEtapa]?.label : null;
    const proxColor = proximaEtapa ? ETAPAS[proximaEtapa]?.color : 'amber';

    return lista.map(p => {
      const corStatus = etapa === '60' ? STATUS_NF[p.status_real] : null;
      const borderColor = corStatus?.border || ETAPAS[etapa].border;
      const origemLabel = etapa === '60'
        ? (p.status_label || 'Faturado')
        : `Etapa Omie ${p.etapa || etapa}`;

      const codInterno = clienteLookup[String(p.codigo_cliente)] || '';
      return (
        <CardPedidoKanban
          key={p.codigo_pedido}
          pedido={{
            ...p,
            data_previsao: formatarData(p.data_previsao),
            cliente_nome: p.nome_fantasia || p.nome_cliente,
            cliente_cidade: p.cidade,
            rota_nome: p.rota_nome || p.rota_cliente,
            codigo_interno: codInterno
          }}
          borderColor={borderColor}
          origemLabel={origemLabel}
          draggable
          onDragStart={(e) => onDragStart(e, p, etapa)}
          acaoLabel={etapa !== '60' && proxLabel ? `Avançar para ${proxLabel}` : null}
          acaoColor={proxColor}
          onAvancar={etapa !== '60' && proximaEtapa ? () => solicitarMover(p, etapa, proximaEtapa) : null}
        />
      );
    });
  };

  // Cargas montadas/fechadas/prontas — aguardando faturamento
  const cargasParaFaturar = cargas.filter(c => ['montagem', 'fechada', 'conferindo', 'pronta'].includes(c.status_carga));
  const cargasParaFaturarFiltradas = busca.trim()
    ? cargasParaFaturar.filter(c =>
        (c.motorista_nome || '').toLowerCase().includes(busca.toLowerCase()) ||
        (c.numero_carga || '').includes(busca)
      )
    : cargasParaFaturar;

  // Cargas em rota / entregues
  const cargasEntrega = cargas.filter(c => ['em_rota', 'entregue', 'finalizada', 'faturada'].includes(c.status_carga));
  const cargasFiltradas = busca.trim()
    ? cargasEntrega.filter(c =>
        (c.motorista_nome || '').toLowerCase().includes(busca.toLowerCase()) ||
        (c.numero_carga || '').includes(busca)
      )
    : cargasEntrega;

  const recarregarTudo = async () => {
    toast.info('Reconciliando espelho com Omie...', { description: 'Uso apenas se algum webhook falhou.' });
    await refetchAll();
    refetchCargas();
    toast.success('Espelho reconciliado.');
  };

  const segundosDesdeUpdate = Math.floor((Date.now() - lastFullUpdate) / 1000);
  // referencia tick pra forçar re-render
  void tick;

  return (
    <div className="space-y-3 max-w-[1900px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg">
            <Workflow className="h-6 w-6 text-neutral-900" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Operação Completa</h1>
            <p className="text-sm text-neutral-500">
              Espelho fiel do Omie · {totalGeral} pedidos · R$ {valorGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Status sync — sempre real-time via webhook */}
          <div className="flex items-center gap-2 bg-emerald-50 rounded-lg px-3 py-1.5 border border-emerald-200">
            <Wifi className={`w-3.5 h-3.5 ${isAnyLoading ? 'text-amber-500 animate-pulse' : 'text-emerald-600'}`} />
            <span className="text-xs text-emerald-700 font-semibold">
              {isAnyLoading ? 'Sincronizando...' : `Real-time · atualizado há ${tempoDecorrido(lastFullUpdate)}`}
            </span>
          </div>

          <div className="relative w-56">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Pedido, cliente, NF, cidade..."
              className="pl-9 h-9"
              value={busca}
              onChange={e => setBusca(e.target.value)}
            />
          </div>

          <Button variant="outline" onClick={recarregarTudo} className="h-9" disabled={isAnyLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isAnyLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Kanban */}
      <div className="flex gap-3 overflow-x-auto pb-3">
        <KanbanColumn
          titulo="1. Pedido de Venda"
          headerColor="amber"
          badge="Aguardando liberação"
          count={filtrarOrdenar(queries['10'].data || []).length}
          valorTotal={valorColuna('10')}
          loading={queries['10'].isLoading}
          acceptDrop
          onDrop={(e) => onDrop(e, '10')}
          footer={
            <div className="space-y-2">
              <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white" onClick={() => navigate('/EmissaoPedidos')}>
                <Plus className="w-4 h-4 mr-1" /> Novo Pedido
              </Button>
              <Button variant="outline" className="w-full border-blue-300 text-blue-700 hover:bg-blue-50" onClick={() => navigate('/GerenciarPedidosPage')}>
                <ExternalLink className="w-4 h-4 mr-1" /> Liberar Pedidos
              </Button>
            </div>
          }
        >
          {renderCards('10')}
        </KanbanColumn>

        <KanbanColumn
          titulo="2. Liberados"
          headerColor="blue"
          badge="Prontos pra carga"
          count={filtrarOrdenar(queries['20'].data || []).length}
          valorTotal={valorColuna('20')}
          loading={queries['20'].isLoading}
          acceptDrop
          onDrop={(e) => onDrop(e, '20')}
          footer={
            <Button className="w-full bg-blue-500 hover:bg-blue-600 text-white" onClick={() => navigate('/MontagemCarga')}>
              <FileBarChart className="w-4 h-4 mr-1" /> Montar Carga
            </Button>
          }
        >
          {renderCards('20')}
        </KanbanColumn>

        <KanbanColumn
          titulo="3. Em Carga"
          headerColor="orange"
          badge="Cargas aguardando faturar"
          count={cargasParaFaturarFiltradas.length}
          loading={loadingCargas}
          footer={
            <Button className="w-full bg-orange-500 hover:bg-orange-600 text-white" onClick={() => navigate('/Cargas')}>
              <Truck className="w-4 h-4 mr-1" /> Faturar Cargas
            </Button>
          }
        >
          {cargasParaFaturarFiltradas.map(c => (
            <CardPedidoKanban
              key={c.id}
              pedido={{
                numero_pedido: `Carga ${c.numero_carga || c.id.slice(-4)}`,
                codigo_pedido: c.id,
                cliente_nome: c.motorista_nome || 'Sem motorista',
                cliente_cidade: `${c.quantidade_pedidos || 0} pedidos${c.veiculo_placa ? ` · ${c.veiculo_placa}` : ''}`,
                valor_total_pedido: c.valor_total,
                data_previsao: c.data_carga ? new Date(c.data_carga + 'T12:00:00').toLocaleDateString('pt-BR') : ''
              }}
              borderColor="#f97316"
              origemLabel={`Status: ${c.status_carga}`}
              onClick={() => navigate('/Cargas')}
            />
          ))}
        </KanbanColumn>

        <KanbanColumn
          titulo="4. Faturar (NF)"
          headerColor="amber"
          badge="Pedidos prontos pra NF"
          count={filtrarOrdenar(queries['50'].data || []).length}
          valorTotal={valorColuna('50')}
          loading={queries['50'].isLoading}
          acceptDrop
          onDrop={(e) => onDrop(e, '50')}
        >
          {renderCards('50')}
        </KanbanColumn>

        <KanbanColumn
          titulo="5. Faturado"
          headerColor="emerald"
          badge="NF emitida (90 dias)"
          count={filtrarOrdenar(queries['60'].data || []).length}
          valorTotal={valorColuna('60')}
          loading={queries['60'].isLoading}
          footer={
            <Button variant="outline" className="w-full" onClick={() => navigate('/NotasOmie')}>
              <ExternalLink className="w-4 h-4 mr-1" /> Ver NFs
            </Button>
          }
        >
          {renderCards('60')}
        </KanbanColumn>

        <KanbanColumn
          titulo="Entrega"
          headerColor="indigo"
          badge="Cargas em rota"
          count={cargasFiltradas.length}
          loading={loadingCargas}
          footer={
            <Button variant="outline" className="w-full" onClick={() => navigate('/Cargas')}>
              <Truck className="w-4 h-4 mr-1" /> Ver cargas
            </Button>
          }
        >
          {cargasFiltradas.map(c => (
            <CardPedidoKanban
              key={c.id}
              pedido={{
                numero_pedido: c.numero_carga,
                codigo_pedido: c.id,
                cliente_nome: c.motorista_nome || 'Sem motorista',
                cliente_cidade: c.veiculo_placa ? `Veículo ${c.veiculo_placa}` : null,
                valor_total_pedido: c.valor_total,
                data_previsao: c.data_carga ? new Date(c.data_carga + 'T12:00:00').toLocaleDateString('pt-BR') : ''
              }}
              borderColor="#6366f1"
              origemLabel={`Status: ${c.status_carga}`}
              onClick={() => navigate('/Cargas')}
            />
          ))}
        </KanbanColumn>
      </div>

      <ConfirmarAcaoModal
        open={!!acaoPendente}
        onOpenChange={(o) => !o && setAcaoPendente(null)}
        acao={acaoPendente}
        onConfirmar={executarAcao}
        loading={executando}
      />
    </div>
  );
}