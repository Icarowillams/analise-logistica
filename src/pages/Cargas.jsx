import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Truck, Loader2, Trash2, FileText, Receipt, ClipboardList, MapPinned, FileSignature, X, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DataTable from '@/components/ui/DataTable';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import DocumentosCargaModal from '@/components/cargas/documentos/DocumentosCargaModal';
import { toast } from 'sonner';

// status_carga é LOCAL e binário:
//  - montagem = em preparação (ainda não enviada ao Omie)
//  - faturada = enviada ao Omie
// O ciclo fiscal detalhado (cancelada, rejeitada, em rota...) permanece no Omie/entidades de espelho.
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
  const [documento, setDocumento] = useState(null); // { tipo: 'lista' | 'romaneio', carga }
  const [filtroNumero, setFiltroNumero] = useState('');
  const [filtroDataInicial, setFiltroDataInicial] = useState('');
  const [filtroDataFinal, setFiltroDataFinal] = useState('');
  const [sincronizando, setSincronizando] = useState(false);

  // 1️⃣ Carrega cargas direto do banco — RÁPIDO (sem chamada ao Omie)
  const { data: cargasTodas = [], isLoading } = useQuery({
    queryKey: ['cargas'],
    queryFn: () => base44.entities.Carga.list('-created_date', 500),
    refetchOnWindowFocus: true
  });

  // 2️⃣ Sincroniza status com Omie em BACKGROUND (não bloqueia a UI)
  useEffect(() => {
    let cancelado = false;
    base44.functions.invoke('sincronizarStatusCargasOmie', { list_limit: 500, sync_limit: 50 })
      .then(() => {
        if (!cancelado) queryClient.invalidateQueries({ queryKey: ['cargas'] });
      })
      .catch((e) => console.warn('[Cargas] sync Omie em background falhou:', e?.message));
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Exibe todas as cargas criadas (inclusive em montagem), para permitir faturamento a qualquer momento.
  // Aplica filtros locais por número e período de saída (data_carga).
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

  // 🔄 FORÇA sincronização em massa — reconsulta no Omie e reclassifica cStat (autorizada/rejeitada/denegada/cancelada).
  // Se houver seleção, sincroniza apenas as selecionadas; senão sincroniza as cargas filtradas/visíveis.
  const forcarSincronizacao = async () => {
    const alvos = selecionadas.length > 0
      ? selecionadas
      : cargas.slice(0, 100).map(c => c.id);

    if (alvos.length === 0) {
      toast.error('Nenhuma carga para sincronizar');
      return;
    }

    setSincronizando(true);
    const toastId = toast.loading(`Reconsultando ${alvos.length} carga(s) no Omie…`);
    try {
      const { data } = await base44.functions.invoke('sincronizarStatusCargasOmie', {
        carga_ids: alvos,
        list_limit: 500,
        sync_limit: alvos.length
      });
      if (data?.error) throw new Error(data.error);
      toast.success(`${data?.sincronizadas || 0} carga(s) atualizada(s) com status real do Omie`, { id: toastId, duration: 8000 });
      queryClient.invalidateQueries({ queryKey: ['cargas'] });
    } catch (e) {
      toast.error(`Falha ao sincronizar: ${e.message}`, { id: toastId });
    }
    setSincronizando(false);
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

  const excluir = async () => {
    if (!excluindo) return;
    try {
      const carga = excluindo;
      const pedidosOmie = carga.pedidos_omie || [];
      const pedidosInternos = carga.pedidos_internos || [];
      const trocas = carga.pedidos_troca || [];

      // 1) Reverter etapa no Omie: 50 → 20 (Pedido Liberado)
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

      // 2) Reverter pedidos locais (vendas Omie + D1 internos): voltar para liberado/pendente, sem carga
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

      // 3) Reverter trocas (desvincular carga/motorista)
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

      // 4) Excluir carga
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
              <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setExcluindo(row)} title="Desfazer carga (apenas se não faturada)">
                <Trash2 className="w-3.5 h-3.5" />
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
            <p className="text-sm text-slate-500">Cargas com status consultado direto no Omie</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={forcarSincronizacao}
            disabled={sincronizando || faturandoLote}
            variant="outline"
            className="border-blue-300 text-blue-700 hover:bg-blue-50"
            title={selecionadas.length > 0
              ? `Reconsultar status real no Omie das ${selecionadas.length} carga(s) selecionada(s)`
              : 'Reconsultar status real no Omie das cargas visíveis (máx. 100)'}
          >
            {sincronizando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Atualizar status Omie
            {selecionadas.length > 0 ? ` (${selecionadas.length})` : ''}
          </Button>
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