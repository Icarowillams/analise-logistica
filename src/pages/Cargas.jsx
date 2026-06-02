import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Truck, Loader2, Trash2, FileText, Receipt, ClipboardList, MapPinned, FileSignature, X } from 'lucide-react';
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
  const [filtroNumero, setFiltroNumero] = useState('');
  const [filtroDataInicial, setFiltroDataInicial] = useState('');
  const [filtroDataFinal, setFiltroDataFinal] = useState('');

  // Carrega cargas direto do banco local — ZERO chamadas ao Omie
  // Padrão: últimos 60 dias. staleTime evita refetches excessivos.
  const { data: cargasTodas = [], isLoading } = useQuery({
    queryKey: ['cargas'],
    queryFn: () => base44.entities.Carga.list('-created_date', 200),
    staleTime: 30 * 1000,
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
    staleTime: 15 * 1000,
    refetchInterval: cargasComFilaIds.length > 0 ? 15000 : false
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

  const cargas = useMemo(() => {
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

  const limparFiltros = () => {
    setFiltroNumero('');
    setFiltroDataInicial('');
    setFiltroDataFinal('');
  };
  const temFiltro = !!(filtroNumero || filtroDataInicial || filtroDataFinal);

  const faturar = async (carga) => {
    if (!confirm(`Faturar a carga ${carga.numero_carga}?`)) return;

    setFaturando(carga.id);
    try {
      const { data } = await base44.functions.invoke('faturarCargaOmie', { carga_id: carga.id });
      if (data?.error || data?.sucesso === false) throw new Error(data?.error || 'Erro ao faturar carga');
      toast.success(data?.mensagem || `Carga ${carga.numero_carga} faturada com sucesso.`);
      queryClient.invalidateQueries({ queryKey: ['cargas'] });
    } catch (e) {
      toast.error(e.message);
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
      toast.error(e.message);
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
      width: '180px',
      render: (_, row) => {
        const emMontagem = row.status_carga === 'montagem';
        const jaFaturada = row.status_carga === 'faturada';
        return (
          <div className="flex items-center gap-1">
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
    </div>
  );
}