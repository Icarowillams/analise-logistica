import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Truck, Loader2, Trash2, FileText, Receipt, ClipboardList, MapPinned, FileSignature, X, Unlock, ArrowLeftRight, Pencil, Play, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DataTable from '@/components/ui/DataTable';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import DocumentosCargaModal from '@/components/cargas/documentos/DocumentosCargaModal';
import StatusProcessamentoOmie from '@/components/cargas/StatusProcessamentoOmie';
import SoltarCargaDialog from '@/components/cargas/SoltarCargaDialog';
import EditarCargaModal from '@/components/cargas/EditarCargaModal';
import TransferirPedidosCargaModal from '@/components/cargas/TransferirPedidosCargaModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

// status_carga é LOCAL e binário:
//  - montagem = em preparação (ainda não enviada ao Omie)
//  - faturada = enviada ao Omie
const FATURAVEL = ['montagem'];

const STATUS_COLORS = {
  montagem: 'bg-slate-200 text-slate-700',
  faturada: 'bg-green-100 text-green-800'
};

const STATUS_LABEL = {
  montagem: 'montagem',
  faturada: 'faturada'
};

export default function Cargas() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [faturando, setFaturando] = useState(null);
  const [excluindo, setExcluindo] = useState(null);
  const [selecionadas, setSelecionadas] = useState([]);
  const [faturandoLote, setFaturandoLote] = useState(false);
  const [documento, setDocumento] = useState(null);
  const [soltando, setSoltando] = useState(null);
  const [editando, setEditando] = useState(null);
  const [transferindo, setTransferindo] = useState(null);
  const [filtroNumero, setFiltroNumero] = useState('');
  const [filtroDataInicial, setFiltroDataInicial] = useState('');
  const [filtroDataFinal, setFiltroDataFinal] = useState('');
  const [abaAtiva, setAbaAtiva] = useState('montagem');
  const [processandoFila, setProcessandoFila] = useState(false);
  const [modalPrevisao, setModalPrevisao] = useState({ open: false, carga: null });
  const [novaPrevisao, setNovaPrevisao] = useState('');
  const [salvandoPrevisao, setSalvandoPrevisao] = useState(false);

  // Carrega cargas direto do banco local — ZERO chamadas ao Omie
  // Padrão: últimos 60 dias. staleTime evita refetches excessivos.
  const { data: cargasTodas = [], isLoading } = useQuery({
    queryKey: ['cargas'],
    queryFn: () => base44.entities.Carga.list('-created_date', 200),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false
  });

  // Batch: carrega TODOS os itens de fila de cargas em andamento/erro/parcial em UMA query
  const cargasComFilaIds = useMemo(() =>
    cargasTodas.filter(c => ['em_andamento', 'parcial', 'erro'].includes(c.processamento_omie_status)).map(c => c.id),
    [cargasTodas]
  );
  const { data: todosItensFila = [] } = useQuery({
    queryKey: ['fila-carga-batch', cargasComFilaIds.join(',')],
    queryFn: async () => {
      if (cargasComFilaIds.length === 0) return [];
      // Busca todos os itens de fila de uma vez
      const itens = await base44.entities.FilaCargaOmie.filter({}, '-created_date', 500);
      return itens.filter(i => cargasComFilaIds.includes(i.carga_id));
    },
    enabled: cargasComFilaIds.length > 0,
    staleTime: 30 * 1000,
    refetchInterval: cargasComFilaIds.length > 0 ? 30000 : false
  });

  // Mapa pré-computado: carga_id → itens da fila
  const filaMap = useMemo(() => {
    const map = {};
    for (const item of todosItensFila) {
      if (!map[item.carga_id]) map[item.carga_id] = [];
      map[item.carga_id].push(item);
    }
    return map;
  }, [todosItensFila]);

  const cargasFiltradas = useMemo(() => {
    return cargasTodas.filter(c => {
      if (filtroNumero.trim()) {
        const termo = filtroNumero.trim().toLowerCase();
        if (!String(c.numero_carga || '').toLowerCase().includes(termo)) return false;
      }
      if (filtroDataInicial && (c.data_carga || '') < filtroDataInicial) return false;
      if (filtroDataFinal && (c.data_carga || '') > filtroDataFinal) return false;
      return true;
    });
  }, [cargasTodas, filtroNumero, filtroDataInicial, filtroDataFinal]);

  const totalMontagem = useMemo(() => cargasFiltradas.filter(c => c.status_carga === 'montagem').length, [cargasFiltradas]);
  const totalFaturadas = useMemo(() => cargasFiltradas.filter(c => c.status_carga === 'faturada').length, [cargasFiltradas]);

  const cargas = useMemo(
    () => cargasFiltradas.filter(c => c.status_carga === abaAtiva),
    [cargasFiltradas, abaAtiva]
  );

  const limparFiltros = () => {
    setFiltroNumero('');
    setFiltroDataInicial('');
    setFiltroDataFinal('');
  };
  const temFiltro = !!(filtroNumero || filtroDataInicial || filtroDataFinal);

  const extrairMensagemErro = (e) => {
    // Captura mensagem detalhada do backend (422 ou qualquer status)
    const respData = e?.response?.data || e?.data;
    if (respData?.error) return respData.error;
    if (respData?.pedidos_incompletos?.length > 0) {
      return respData.pedidos_incompletos.map(p => `Pedido ${p.numero_pedido}: falta ${p.faltando}`).join('\n');
    }
    const msg = e?.message || 'Erro desconhecido';
    if (msg.includes('status code')) return `Erro no servidor. Tente novamente ou contate o suporte.`;
    return msg;
  };

  const faturar = async (carga) => {
    if (!confirm(`Faturar a carga ${carga.numero_carga}?`)) return;

    setFaturando(carga.id);
    try {
      const { data } = await base44.functions.invoke('faturarCargaOmie', { carga_id: carga.id });
      if (data?.error || data?.sucesso === false) throw new Error(data?.error || 'Erro ao faturar carga');
      toast.success(data?.mensagem || `Carga ${carga.numero_carga} faturada com sucesso.`);
      queryClient.invalidateQueries({ queryKey: ['cargas'] });
    } catch (e) {
      toast.error(extrairMensagemErro(e), { duration: 8000 });
    }
    setFaturando(null);
  };

  const faturarLote = async () => {
    const cargasFaturar = cargas.filter(c => selecionadas.includes(c.id) && FATURAVEL.includes(c.status_carga));
    if (cargasFaturar.length === 0) {
      toast.error('Nenhuma carga selecionada está em status que permita faturamento');
      return;
    }

    if (!confirm(`Faturar ${cargasFaturar.length} carga(s)?`)) return;

    setFaturandoLote(true);
    try {
      for (const carga of cargasFaturar) {
        const { data } = await base44.functions.invoke('faturarCargaOmie', { carga_id: carga.id });
        if (data?.error || data?.sucesso === false) throw new Error(data?.error || `Erro ao faturar carga ${carga.numero_carga}`);
      }
      toast.success(`${cargasFaturar.length} carga(s) faturada(s) com sucesso.`);
    } catch (e) {
      toast.error(extrairMensagemErro(e), { duration: 8000 });
    }

    queryClient.invalidateQueries({ queryKey: ['cargas'] });
    setSelecionadas([]);
    setFaturandoLote(false);
  };

  const toggleSelecionada = (id) => {
    setSelecionadas(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleTodas = () => {
    const faturaveis = cargas.filter(c => FATURAVEL.includes(c.status_carga)).map(c => c.id);
    setSelecionadas(prev => prev.length === faturaveis.length ? [] : faturaveis);
  };

  // Verifica se a carga tem fila de processamento Omie ativa
  const cargaEmProcessamento = (carga) => {
    const procStatus = carga.processamento_omie_status;
    return ['em_andamento'].includes(procStatus) ||
      (procStatus === 'parcial' && (carga.processamento_omie_total || 0) > 0);
  };

  // Cancela itens pendentes/processando da fila antes de excluir
  const cancelarFilaCarga = async (cargaId) => {
    const itens = await base44.entities.FilaCargaOmie.filter({ carga_id: cargaId }, '-created_date', 500);
    const ativos = itens.filter(i => ['pendente', 'processando'].includes(i.status));
    for (const item of ativos) {
      await base44.entities.FilaCargaOmie.update(item.id, {
        status: 'erro',
        erro_log: 'Cancelado: carga excluída pelo usuário'
      });
    }
    return ativos.length;
  };

  const excluir = async () => {
    if (!excluindo) return;
    try {
      const carga = excluindo;

      // PROTEÇÃO: Se carga está em processamento Omie, cancelar fila primeiro
      if (cargaEmProcessamento(carga)) {
        const cancelados = await cancelarFilaCarga(carga.id);
        if (cancelados > 0) {
          toast.info(`${cancelados} item(ns) da fila cancelados antes da exclusão.`);
        }
        // Atualiza status da carga para refletir o cancelamento
        await base44.entities.Carga.update(carga.id, { processamento_omie_status: 'erro' });
      }

      const pedidosOmie = carga.pedidos_omie || [];
      const pedidosInternos = carga.pedidos_internos || [];
      const trocas = carga.pedidos_troca || [];

      if (pedidosOmie.length > 0) {
        try {
          await base44.functions.invoke('trocarEtapaPedidoOmie', {
            pedidos: pedidosOmie.map(p => ({
              codigo_pedido: p.codigo_pedido,
              codigo_pedido_integracao: p.codigo_pedido_integracao,
              numero_pedido: p.numero_pedido,
              etapa: '20'
            }))
          });
        } catch (e) { console.warn('Falha reverter etapa Omie:', e.message); }
      }

      for (const p of [...pedidosOmie, ...pedidosInternos]) {
        try {
          let pedidoId = p.pedido_id;
          if (!pedidoId && p.codigo_pedido) {
            const locais = await base44.entities.Pedido.filter({ omie_codigo_pedido: String(p.codigo_pedido) }, '-created_date', 1);
            pedidoId = locais?.[0]?.id;
          }
          if (!pedidoId) continue;
          const isD1 = !p.codigo_pedido;
          await base44.entities.Pedido.update(pedidoId, {
            carga_id: null,
            numero_carga: null,
            status: isD1 ? 'pendente' : 'liberado',
            status_logistico: 'aguardando',
            etapa: isD1 ? 'comercial' : 'faturamento'
          });
        } catch (e) { console.warn('Falha reverter pedido:', e.message); }
      }

      for (const t of trocas) {
        try {
          if (t.pedido_troca_id) {
            await base44.entities.PedidoTroca.update(t.pedido_troca_id, { carga_id: null, motorista_id: null, status: 'aprovado' });
          }
          let pedidoTrocaId = t.pedido_id;
          if (!pedidoTrocaId && t.numero_pedido) {
            const locais = await base44.entities.Pedido.filter({ numero_pedido: t.numero_pedido, tipo: 'troca' }, '-created_date', 1);
            pedidoTrocaId = locais?.[0]?.id;
          }
          if (pedidoTrocaId) {
            await base44.entities.Pedido.update(pedidoTrocaId, {
              carga_id: null,
              numero_carga: null,
              status: 'liberado',
              status_logistico: 'aguardando',
              etapa: 'faturamento'
            });
          }
        } catch (e) { console.warn('Falha reverter troca:', e.message); }
      }

      await base44.entities.Carga.delete(carga.id);
      toast.success(`Carga ${carga.numero_carga} desfeita — pedidos voltaram para Liberado`);
      queryClient.invalidateQueries({ queryKey: ['cargas'] });
    } catch (e) {
      toast.error(e.message);
    }
    setExcluindo(null);
  };

  const processarFilaAgora = async () => {
    setProcessandoFila(true);
    try {
      const { data } = await base44.functions.invoke('processarFilaCargaOmie', {});
      if (data?.abortado) {
        toast.warning(data.mensagem || data.motivo || 'Fila não processada no momento. Tente novamente em breve.');
      } else {
        const proc = data?.processados ?? 0;
        const msg = data?.orfaos_limpos
          ? `${proc} processados, ${data.orfaos_limpos} órfãos limpos`
          : `${proc} pedidos processados`;
        toast.success(msg);
      }
      queryClient.invalidateQueries({ queryKey: ['cargas'] });
      queryClient.invalidateQueries({ queryKey: ['fila-carga-batch'] });
    } catch (e) {
      toast.error(e.message);
    }
    setProcessandoFila(false);
  };

  const temPendentesNaFila = todosItensFila.some(i => i.status === 'pendente' || i.status === 'processando');

  const cargasTravadas = useMemo(() => {
    const DEZ_MINUTOS = 10 * 60 * 1000;
    return cargasTodas.filter(c => {
      if (c.processamento_omie_status !== 'processando' &&
          c.processamento_omie_status !== 'em_andamento') return false;
      const itensDestaCarga = todosItensFila.filter(i =>
        i.carga_id === c.id && i.status === 'processando'
      );
      if (itensDestaCarga.length === 0) return false;
      const maisAntigo = Math.min(
        ...itensDestaCarga.map(i => new Date(i.updated_date || i.created_date).getTime())
      );
      return Date.now() - maisAntigo > DEZ_MINUTOS;
    });
  }, [cargasTodas, todosItensFila]);

  const alterarPrevisaoCarga = async () => {
    if (!novaPrevisao || !modalPrevisao.carga) return;
    setSalvandoPrevisao(true);
    try {
      const pedidos = (modalPrevisao.carga.pedidos_omie || [])
        .filter(p => p.codigo_pedido)
        .map(p => ({
          codigo_pedido: p.codigo_pedido,
          codigo_pedido_integracao: p.codigo_pedido_integracao || '',
          numero_pedido: p.numero_pedido || ''
        }));
      const { data } = await base44.functions.invoke('alterarPrevisaoFaturamentoOmie', {
        pedidos,
        data_previsao: novaPrevisao
      });
      const resultados = data?.resultados || [];
      const ok = resultados.filter(r => r.sucesso).length;
      const ignorados = resultados.filter(r => r.ignorado).length;
      const fail = resultados.filter(r => !r.sucesso && !r.ignorado).length;
      if (fail === 0 && ignorados === 0) {
        toast.success(`Previsão atualizada em ${ok} pedido(s) no Omie`);
      } else if (fail === 0) {
        toast.success(`${ok} atualizado(s), ${ignorados} ignorado(s) (já em etapa avançada)`);
      } else {
        const errosMsg = resultados.filter(r => !r.sucesso && !r.ignorado).map(r => `${r.numero_pedido}: ${r.mensagem}`).join(', ');
        toast.warning(`${ok} atualizados, ${fail} com erro: ${errosMsg}`, { duration: 8000 });
      }
      setModalPrevisao({ open: false, carga: null });
      setNovaPrevisao('');
      queryClient.invalidateQueries({ queryKey: ['cargas'] });
    } catch (e) {
      toast.error('Erro ao atualizar previsão: ' + e.message);
    }
    setSalvandoPrevisao(false);
  };

  const abrirNotas = (carga) => {
    navigate(`/NotasOmie?carga_id=${carga.id}`);
  };

  const abrirBoletos = (carga) => {
    navigate(`/BoletosOmie?carga_id=${carga.id}`);
  };

  const abrirDocumento = (tipo, carga) => setDocumento({ tipo, carga });

  const faturaveisIds = cargas.filter(c => FATURAVEL.includes(c.status_carga)).map(c => c.id);
  const todasSelecionadas = faturaveisIds.length > 0 && selecionadas.length === faturaveisIds.length;

  const columns = [
    {
      key: 'select',
      label: (
        <Checkbox
          checked={todasSelecionadas}
          onCheckedChange={toggleTodas}
          aria-label="Selecionar todas"
        />
      ),
      width: '40px',
      render: (_, row) => FATURAVEL.includes(row.status_carga) ? (
        <Checkbox
          checked={selecionadas.includes(row.id)}
          onCheckedChange={() => toggleSelecionada(row.id)}
          aria-label="Selecionar"
        />
      ) : null
    },
    { key: 'numero_carga', label: 'Nº', sortable: true, width: '70px' },
    { key: 'data_carga', label: 'Data', sortable: true, width: '100px' },
    { key: 'motorista_nome', label: 'Motorista', width: '160px' },
    { key: 'veiculo_placa', label: 'Veículo', width: '95px' },
    { key: 'rota_nome', label: 'Rota', width: '120px' },
    { key: 'quantidade_pedidos', label: 'Ped.', width: '60px', sortable: true },
    {
      key: 'valor_total',
      label: 'Valor',
      width: '110px',
      sortable: true,
      render: (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    },
    {
      key: 'status_carga',
      label: 'Status',
      width: '160px',
      render: (_, row) => {
        const status = row.status_carga;
        return (
          <Badge className={`${STATUS_COLORS[status] || ''} text-xs`}>{STATUS_LABEL[status] || status}</Badge>
        );
      }
    },
    {
      key: 'processamento_omie_status',
      label: 'Proc. Omie',
      width: '170px',
      render: (_, row) => (
        <StatusProcessamentoOmie
          carga={row}
          itensFila={filaMap[row.id]}
          onReprocessar={() => queryClient.invalidateQueries({ queryKey: ['fila-carga-batch'] })}
        />
      )
    },
    {
      key: 'acoes',
      label: 'Ações',
      width: '260px',
      render: (_, row) => {
        const emMontagem = row.status_carga === 'montagem';
        const jaFaturada = row.status_carga === 'faturada';
        const temPedidos = (row.pedidos_omie?.length || 0) + (row.pedidos_internos?.length || 0) + (row.pedidos_troca?.length || 0) > 0;
        return (
          <div className="flex items-center gap-1 flex-wrap">
            {emMontagem && (
              <Button size="sm" className="h-7 px-2 text-xs" onClick={() => faturar(row)} disabled={faturando === row.id}>
                {faturando === row.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Faturar'}
              </Button>
            )}
            {jaFaturada && (
              <>
                <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => abrirNotas(row)} title="Abrir NFe da carga">
                  <FileText className="w-3.5 h-3.5" />
                </Button>
                <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => abrirBoletos(row)} title="Abrir boletos da carga">
                  <Receipt className="w-3.5 h-3.5" />
                </Button>
                <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => abrirDocumento('romaneio', row)} title="Romaneio de entrega">
                  <MapPinned className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => abrirDocumento('lista', row)} title="Listagem de carregamento">
              <ClipboardList className="w-3.5 h-3.5" />
            </Button>
            {jaFaturada && (row.pedidos_internos || []).length > 0 && (
              <Button size="icon" variant="outline" onClick={() => abrirDocumento('notad1', row)} title="Imprimir Notas D1 (venda interna)" className="h-7 w-7 border-amber-300 text-amber-700 hover:bg-amber-50">
                <FileSignature className="w-3.5 h-3.5" />
              </Button>
            )}
            {/* Previsão de entrega em lote */}
            {(row.pedidos_omie || []).length > 0 && (
              <Button size="icon" variant="outline" className="h-7 w-7 border-cyan-300 text-cyan-700 hover:bg-cyan-50" onClick={() => { setModalPrevisao({ open: true, carga: row }); setNovaPrevisao(''); }} title="Alterar previsão de entrega dos pedidos">
                <CalendarDays className="w-3.5 h-3.5" />
              </Button>
            )}
            {/* Contingência: Editar motorista/veículo/rota */}
            <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setEditando(row)} title="Editar motorista/veículo/rota">
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            {/* Contingência: Transferir pedidos */}
            {temPedidos && (
              <Button size="icon" variant="outline" className="h-7 w-7 border-blue-300 text-blue-700 hover:bg-blue-50" onClick={() => setTransferindo(row)} title="Transferir pedidos para outra carga">
                <ArrowLeftRight className="w-3.5 h-3.5" />
              </Button>
            )}
            {/* Contingência: Soltar carga */}
            {temPedidos && !cargaEmProcessamento(row) && (
              <Button size="icon" variant="outline" className="h-7 w-7 border-orange-300 text-orange-700 hover:bg-orange-50" onClick={() => setSoltando(row)} title="Soltar carga — liberar todos os pedidos">
                <Unlock className="w-3.5 h-3.5" />
              </Button>
            )}
            {emMontagem && (
              <Button
                size="icon"
                variant="outline"
                className="h-7 w-7"
                onClick={() => {
                  if (cargaEmProcessamento(row)) {
                    if (!confirm(`Esta carga está com processamento Omie em andamento.\nA fila será cancelada antes da exclusão.\n\nDeseja continuar?`)) return;
                  }
                  setExcluindo(row);
                }}
                title={cargaEmProcessamento(row)
                  ? 'Carga em processamento — a fila será cancelada antes da exclusão'
                  : 'Desfazer carga (apenas se não faturada)'
                }
              >
                <Trash2 className={`w-3.5 h-3.5 ${cargaEmProcessamento(row) ? 'text-amber-500' : ''}`} />
              </Button>
            )}
          </div>
        );
      }
    }
  ];

  return (
    <div className="space-y-4 w-full">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Truck className="w-8 h-8 text-amber-500" />
          <div>
            <h1 className="text-2xl font-bold">Cargas</h1>
            <p className="text-sm text-slate-500">Dados do espelho local</p>
          </div>
        </div>
        <div className="flex gap-2">
          {temPendentesNaFila && (
            <Button
              onClick={processarFilaAgora}
              disabled={processandoFila}
              variant="outline"
              className="border-amber-400 text-amber-700 hover:bg-amber-50"
            >
              {processandoFila ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              Processar Fila Agora
            </Button>
          )}
          {selecionadas.length > 0 && (
            <Button
              onClick={faturarLote}
              disabled={faturandoLote}
              className="bg-green-600 hover:bg-green-700"
            >
              {faturandoLote ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Faturar {selecionadas.length} selecionada(s)
            </Button>
          )}
        </div>
      </div>

      {cargasTravadas.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 flex items-start gap-2 text-sm text-amber-800">
          <span className="font-semibold">⚠️ Atenção:</span>
          {cargasTravadas.length === 1
            ? `A carga ${cargasTravadas[0].numero_carga} está travada em processamento há mais de 10 minutos.`
            : `${cargasTravadas.length} cargas estão travadas em processamento há mais de 10 minutos.`}
          <span className="ml-1 text-amber-700">
            Aguarde o desbloqueio automático ou contate o suporte.
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
            <div>
              <Label>Nº Carga</Label>
              <Input
                placeholder="Ex: 019"
                value={filtroNumero}
                onChange={(e) => setFiltroNumero(e.target.value)}
              />
            </div>
            <div>
              <Label>Saída de</Label>
              <Input
                type="date"
                value={filtroDataInicial}
                onChange={(e) => setFiltroDataInicial(e.target.value)}
              />
            </div>
            <div>
              <Label>Saída até</Label>
              <Input
                type="date"
                value={filtroDataFinal}
                onChange={(e) => setFiltroDataFinal(e.target.value)}
              />
            </div>
            <div>
              <Button
                variant="outline"
                onClick={limparFiltros}
                disabled={!temFiltro}
                className="w-full"
              >
                <X className="w-4 h-4 mr-2" /> Limpar filtros
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button
          variant={abaAtiva === 'montagem' ? 'default' : 'outline'}
          onClick={() => setAbaAtiva('montagem')}
          className={abaAtiva === 'montagem' ? '' : 'text-slate-600'}
        >
          Em Montagem ({totalMontagem})
        </Button>
        <Button
          variant={abaAtiva === 'faturada' ? 'default' : 'outline'}
          onClick={() => setAbaAtiva('faturada')}
          className={abaAtiva === 'faturada' ? 'bg-green-600 hover:bg-green-700' : 'text-slate-600'}
        >
          Faturadas ({totalFaturadas})
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{cargas.length} cargas registradas{temFiltro ? ` (de ${cargasTodas.length})` : ''}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-slate-500"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
          ) : (
            <div className="text-sm [&_th]:px-2 [&_td]:px-2 [&_td]:py-2 [&_.relative.w-full.overflow-auto]:overflow-x-hidden">
              <DataTable data={cargas} columns={columns} searchable={false} pageSize={50} emptyMessage="Nenhuma carga criada ainda" />
            </div>
          )}
        </CardContent>
      </Card>

      <DeleteConfirmDialog
        open={!!excluindo}
        onOpenChange={() => setExcluindo(null)}
        onConfirm={excluir}
        title="Excluir carga"
        description={`Excluir carga ${excluindo?.numero_carga}? Os pedidos no Omie NÃO serão alterados.`}
      />

      <DocumentosCargaModal
        open={!!documento}
        onOpenChange={() => setDocumento(null)}
        tipo={documento?.tipo}
        carga={documento?.carga}
      />

      <SoltarCargaDialog
        open={!!soltando}
        onOpenChange={() => setSoltando(null)}
        carga={soltando}
        onSolto={() => queryClient.invalidateQueries({ queryKey: ['cargas'] })}
      />

      <EditarCargaModal
        open={!!editando}
        onOpenChange={() => setEditando(null)}
        carga={editando}
        onSalvo={() => queryClient.invalidateQueries({ queryKey: ['cargas'] })}
      />

      <TransferirPedidosCargaModal
        open={!!transferindo}
        onOpenChange={() => setTransferindo(null)}
        carga={transferindo}
        onTransferido={() => queryClient.invalidateQueries({ queryKey: ['cargas'] })}
      />
      <Dialog open={modalPrevisao.open} onOpenChange={(v) => setModalPrevisao(s => ({ ...s, open: v }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar Previsão de Entrega — Carga {modalPrevisao.carga?.numero_carga}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-500">
              Altera a data de previsão de entrega de todos os
              {' '}{(modalPrevisao.carga?.pedidos_omie || []).length} pedido(s) desta carga no Omie.
            </p>
            <div>
              <Label>Nova data de previsão</Label>
              <Input type="date" value={novaPrevisao} onChange={e => setNovaPrevisao(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalPrevisao({ open: false, carga: null })}>
              Cancelar
            </Button>
            <Button onClick={alterarPrevisaoCarga} disabled={!novaPrevisao || salvandoPrevisao}>
              {salvandoPrevisao && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Atualizar no Omie
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}