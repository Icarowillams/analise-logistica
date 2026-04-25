import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Workflow, RefreshCw, Search, Plus, FileBarChart, Truck, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import KanbanColumn from '@/components/operacao/KanbanColumn';
import KanbanCard from '@/components/operacao/KanbanCard';
import ConfirmarAcaoModal from '@/components/operacao/ConfirmarAcaoModal';

// Mapa de etapas e cores
const ETAPAS = {
  '10': { label: 'Pedido de Venda', color: 'amber',   border: '#f59e0b' },
  '20': { label: 'Liberados',       color: 'blue',    border: '#3b82f6' },
  '50': { label: 'Faturar',         color: 'orange',  border: '#f97316' },
  '60': { label: 'Faturado',        color: 'emerald', border: '#22c55e' },
};

const FLUXO = ['10', '20', '50', '60']; // ordem de avanço

function formatarData(d) {
  if (!d) return '';
  const partes = d.split('/');
  if (partes.length !== 3) return d;
  const data = new Date(`${partes[2]}-${partes[1]}-${partes[0]}T12:00:00`);
  const dia = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][data.getDay()];
  return `${partes[0]}/${partes[1]} ${dia}`;
}

export default function Operacao() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState('');
  const [acaoPendente, setAcaoPendente] = useState(null);
  const [executando, setExecutando] = useState(false);

  const fetchEtapa = async (etapa) => {
    const { data } = await base44.functions.invoke('buscarPedidosOmie', { etapa, registros_por_pagina: 50 });
    return data?.pedidos || [];
  };

  const fetchFaturados = async () => {
    const { data } = await base44.functions.invoke('consultarStatusFaturamentoOmie', { registros_por_pagina: 50 });
    return data?.pedidos || [];
  };

  const queries = {
    '10': useQuery({ queryKey: ['operacaoOmie', '10'], queryFn: () => fetchEtapa('10'), staleTime: 30000, refetchOnWindowFocus: false }),
    '20': useQuery({ queryKey: ['operacaoOmie', '20'], queryFn: () => fetchEtapa('20'), staleTime: 30000, refetchOnWindowFocus: false }),
    '50': useQuery({ queryKey: ['operacaoOmie', '50'], queryFn: () => fetchEtapa('50'), staleTime: 30000, refetchOnWindowFocus: false }),
    '60': useQuery({ queryKey: ['operacaoOmie', '60-status'], queryFn: fetchFaturados, staleTime: 30000, refetchOnWindowFocus: false }),
  };

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes-mini'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 3000),
    staleTime: 60000
  });

  const { data: cargas = [], isLoading: loadingCargas, refetch: refetchCargas } = useQuery({
    queryKey: ['cargasOperacao'],
    queryFn: () => base44.entities.Carga.list('-created_date', 100),
    staleTime: 30000
  });

  const clientePorCodigo = useMemo(() => {
    const map = {};
    clientes.forEach(c => { if (c.codigo_omie) map[String(c.codigo_omie)] = c; });
    return map;
  }, [clientes]);

  const enriquecer = (p) => {
    const cli = clientePorCodigo[p.codigo_cliente];
    return { ...p, cliente_nome: cli?.nome_fantasia || cli?.razao_social || `Cliente ${p.codigo_cliente}` };
  };

  const filtrar = (lista) => {
    const enrich = lista.map(enriquecer);
    if (!busca.trim()) return enrich;
    const t = busca.toLowerCase();
    return enrich.filter(p =>
      p.numero_pedido?.toString().includes(t) ||
      p.cliente_nome.toLowerCase().includes(t)
    );
  };

  // Solicita confirmação para mover pedido para qualquer etapa
  const solicitarMover = (pedido, etapaAtual, etapaDestino) => {
    if (etapaAtual === etapaDestino) return;

    const de = ETAPAS[etapaAtual];
    const para = ETAPAS[etapaDestino];
    if (!para) return;

    // Aviso especial para faturamento (60) — ainda permite, mas alerta
    const ehFaturar = etapaDestino === '60';

    setAcaoPendente({
      tipo: 'mover_etapa',
      titulo: `Mover pedido para ${para.label}?`,
      descricao: ehFaturar
        ? 'Atenção: ao mover para "Faturado" o Omie irá tentar emitir a NF-e automaticamente. Tem certeza?'
        : `O pedido será movido no Omie da etapa "${de?.label || etapaAtual}" para "${para.label}".`,
      de: de?.label || etapaAtual,
      para: para.label,
      badgeColor: para.color,
      perigo: ehFaturar,
      pedido,
      payload: { etapaDestino, etapaAtual }
    });
  };

  // Confirma e executa
  const executarAcao = async () => {
    if (!acaoPendente) return;
    setExecutando(true);

    try {
      if (acaoPendente.tipo === 'mover_etapa') {
        let resp;
        try {
          resp = await base44.functions.invoke('trocarEtapaPedidoOmie', {
            codigo_pedido: acaoPendente.pedido.codigo_pedido,
            codigo_pedido_integracao: acaoPendente.pedido.codigo_pedido_integracao,
            etapa: acaoPendente.payload.etapaDestino
          });
        } catch (httpErr) {
          // Quando function retorna status >= 400, o SDK lança — extrai a mensagem do Omie
          const msgOmie = httpErr?.response?.data?.error || httpErr?.message || 'Erro desconhecido no Omie';
          throw new Error(msgOmie);
        }
        const data = resp?.data;
        if (!data?.sucesso) {
          throw new Error(data?.error || data?.resposta?.cDescStatus || 'O Omie rejeitou a alteração de etapa');
        }
        toast.success(`Pedido ${acaoPendente.pedido.numero_pedido} movido para ${acaoPendente.para}`);
        queryClient.invalidateQueries({ queryKey: ['operacaoOmie'] });
      }
      setAcaoPendente(null);
    } catch (e) {
      toast.error(e.message || 'Erro ao mover pedido', { duration: 8000 });
    } finally {
      setExecutando(false);
    }
  };

  // Drag and drop entre colunas
  const onDragStart = (e, pedido, etapaOrigem) => {
    e.dataTransfer.setData('pedido', JSON.stringify(pedido));
    e.dataTransfer.setData('etapa', etapaOrigem);
  };

  const onDrop = (e, etapaDestino) => {
    const pedido = JSON.parse(e.dataTransfer.getData('pedido') || '{}');
    const etapaOrigem = e.dataTransfer.getData('etapa');
    if (pedido.codigo_pedido) solicitarMover(pedido, etapaOrigem, etapaDestino);
  };

  const STATUS_CORES = {
    emitida:        { border: '#22c55e', origem: 'NF emitida' },
    rejeitada:      { border: '#ef4444', origem: 'NF rejeitada' },
    cancelada:      { border: '#64748b', origem: 'NF cancelada' },
    denegada:       { border: '#dc2626', origem: 'NF denegada' },
    aguardando_nf:  { border: '#f59e0b', origem: 'Aguardando NF' }
  };

  const renderCards = (etapa) => {
    const lista = filtrar(queries[etapa].data || []);
    const proximaEtapa = FLUXO[FLUXO.indexOf(etapa) + 1];
    const proxLabel = proximaEtapa ? ETAPAS[proximaEtapa]?.label : null;
    const proxColor = proximaEtapa ? ETAPAS[proximaEtapa]?.color : 'amber';

    return lista.map(p => {
      // Coluna Faturado usa status real (NF) em vez de "Omie"
      const corStatus = etapa === '60' ? STATUS_CORES[p.status_real] : null;
      const borderColor = corStatus?.border || ETAPAS[etapa].border;
      const origem = etapa === '60' ? (p.status_label || corStatus?.origem || 'Faturado') : 'Omie';

      return (
        <KanbanCard
          key={p.codigo_pedido}
          numero={p.numero_pedido}
          titulo={p.cliente_nome}
          valor={p.valor_total_pedido}
          data={formatarData(p.data_previsao)}
          borderColor={borderColor}
          origem={origem}
          draggable
          onDragStart={(e) => onDragStart(e, p, etapa)}
          acaoLabel={etapa !== '60' && proxLabel ? `Avançar para ${proxLabel}` : null}
          acaoColor={proxColor}
          onAvancar={etapa !== '60' && proximaEtapa ? () => solicitarMover(p, etapa, proximaEtapa) : null}
        />
      );
    });
  };

  const cargasEntrega = cargas.filter(c => ['em_rota', 'entregue', 'finalizada'].includes(c.status_carga));
  const cargasFiltradas = busca.trim()
    ? cargasEntrega.filter(c => (c.motorista_nome || '').toLowerCase().includes(busca.toLowerCase()) || c.numero_carga?.includes(busca))
    : cargasEntrega;

  const recarregarTudo = () => {
    Object.values(queries).forEach(q => q.refetch());
    refetchCargas();
    toast.info('Atualizando dados do Omie...');
  };

  return (
    <div className="space-y-4 max-w-[1900px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg">
            <Workflow className="h-6 w-6 text-neutral-900" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Operação Completa</h1>
            <p className="text-sm text-neutral-500">Arraste cards entre quaisquer colunas — o pedido é movido no Omie automaticamente</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Pesquisar..."
              className="pl-9 h-9"
              value={busca}
              onChange={e => setBusca(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={recarregarTudo} className="h-9">
            <RefreshCw className="w-4 h-4 mr-2" />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Kanban */}
      <div className="flex gap-3 overflow-x-auto pb-3">
        <KanbanColumn
          titulo="Pedido de Venda"
          headerColor="amber"
          badge="Em digitação"
          count={filtrar(queries['10'].data || []).length}
          loading={queries['10'].isLoading}
          acceptDrop
          onDrop={(e) => onDrop(e, '10')}
          footer={
            <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white" onClick={() => navigate('/EmissaoPedidos')}>
              <Plus className="w-4 h-4 mr-1" /> Novo Pedido
            </Button>
          }
        >
          {renderCards('10')}
        </KanbanColumn>

        <KanbanColumn
          titulo="Liberados"
          headerColor="blue"
          badge="Aprovados"
          count={filtrar(queries['20'].data || []).length}
          loading={queries['20'].isLoading}
          acceptDrop
          onDrop={(e) => onDrop(e, '20')}
          footer={
            <Button variant="outline" className="w-full" onClick={() => navigate('/AjustesPedidos')}>
              <ExternalLink className="w-4 h-4 mr-1" /> Ajustar pedidos
            </Button>
          }
        >
          {renderCards('20')}
        </KanbanColumn>

        <KanbanColumn
          titulo="Faturar"
          headerColor="orange"
          badge="Prontos para NF"
          count={filtrar(queries['50'].data || []).length}
          loading={queries['50'].isLoading}
          acceptDrop
          onDrop={(e) => onDrop(e, '50')}
          footer={
            <Button className="w-full bg-orange-500 hover:bg-orange-600 text-white" onClick={() => navigate('/MontagemCarga')}>
              <FileBarChart className="w-4 h-4 mr-1" /> Montar Carga
            </Button>
          }
        >
          {renderCards('50')}
        </KanbanColumn>

        <KanbanColumn
          titulo="Faturado"
          headerColor="emerald"
          badge="NF emitida"
          count={filtrar(queries['60'].data || []).length}
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
            <KanbanCard
              key={c.id}
              numero={c.numero_carga}
              titulo={c.motorista_nome || 'Sem motorista'}
              subtitulo={c.veiculo_placa ? `Veículo ${c.veiculo_placa}` : ''}
              valor={c.valor_total}
              data={c.data_carga ? new Date(c.data_carga + 'T12:00:00').toLocaleDateString('pt-BR') : ''}
              borderColor="#6366f1"
              origem={`Status: ${c.status_carga}`}
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