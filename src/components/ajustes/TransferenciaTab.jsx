import React, { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeftRight, Loader2, Truck, Search, X, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from '@/components/ui/dialog';
import SeletorCargaBusca from './SeletorCargaBusca';

export default function TransferenciaTab() {
  const queryClient = useQueryClient();

  // Filtros principais
  const [cargaOrigemId, setCargaOrigemId] = useState('');
  const [filtroPedido, setFiltroPedido] = useState('');
  const [periodoInicio, setPeriodoInicio] = useState('');
  const [periodoFim, setPeriodoFim] = useState('');

  // Seleção
  const [selecionados, setSelecionados] = useState([]); // array de codigo_pedido
  const [motivo, setMotivo] = useState('');

  // Pop-up destino
  const [destinoOpen, setDestinoOpen] = useState(false);
  const [cargaDestinoId, setCargaDestinoId] = useState('');
  const [filtroDestinoCarga, setFiltroDestinoCarga] = useState('');
  const [periodoDestinoInicio, setPeriodoDestinoInicio] = useState('');
  const [periodoDestinoFim, setPeriodoDestinoFim] = useState('');
  const [transferindo, setTransferindo] = useState(false);

  // REGRA: transferência só após faturamento (etapa Omie 60).
  // Cargas elegíveis: status 'faturada' / 'em_rota' com pelo menos 1 pedido em etapa 60.
  // Sincroniza com Omie pra garantir que numero_nf/etapa estão atualizados.
  const { data: cargas = [], isFetching: sincronizandoCargas } = useQuery({
    queryKey: ['cargas', 'transferencia'],
    queryFn: async () => {
      const todas = await base44.entities.Carga.filter(
        { status_carga: { $in: ['faturada', 'em_rota'] } },
        '-data_carga',
        500
      );
      return todas.filter(c => (c.pedidos_omie || []).length > 0);
    },
    staleTime: 60_000
  });

  const cargaOrigem = useMemo(() => cargas.find(c => c.id === cargaOrigemId), [cargas, cargaOrigemId]);

  // Pedidos da carga origem — APENAS faturados (etapa 60), filtrados pela busca
  const pedidosOrigem = useMemo(() => {
    if (!cargaOrigem) return [];
    const lista = cargaOrigem.pedidos_omie || [];
    const termo = filtroPedido.trim().toLowerCase();
    return lista.filter(p => {
      if (termo) {
        const blob = [p.numero_pedido, p.numero_nf, p.nome_cliente, p.nome_fantasia, p.codigo_pedido, p.cidade]
          .filter(Boolean).join(' ').toLowerCase();
        if (!blob.includes(termo)) return false;
      }
      return true;
    });
  }, [cargaOrigem, filtroPedido]);

  // Reseta seleção ao trocar a carga
  useEffect(() => { setSelecionados([]); }, [cargaOrigemId]);

  // Cargas destino filtradas (por número/data) — exclui a origem
  const cargasDestinoFiltradas = useMemo(() => {
    const termo = filtroDestinoCarga.trim().toLowerCase();
    return cargas
      .filter(c => c.id !== cargaOrigemId)
      .filter(c => {
        if (termo) {
          const blob = [c.numero_carga, c.motorista_nome, c.rota_nome, c.veiculo_placa]
            .filter(Boolean).join(' ').toLowerCase();
          if (!blob.includes(termo)) return false;
        }
        if (periodoDestinoInicio && c.data_carga < periodoDestinoInicio) return false;
        if (periodoDestinoFim && c.data_carga > periodoDestinoFim) return false;
        return true;
      });
  }, [cargas, cargaOrigemId, filtroDestinoCarga, periodoDestinoInicio, periodoDestinoFim]);

  // Cargas origem filtradas por período (filtro adicional para localizar a carga rápido)
  const cargasOrigemFiltradas = useMemo(() => {
    return cargas.filter(c => {
      if (periodoInicio && c.data_carga < periodoInicio) return false;
      if (periodoFim && c.data_carga > periodoFim) return false;
      return true;
    });
  }, [cargas, periodoInicio, periodoFim]);

  const toggleSelecionado = (codigo) => {
    setSelecionados(prev =>
      prev.includes(codigo) ? prev.filter(x => x !== codigo) : [...prev, codigo]
    );
  };

  const toggleTodos = () => {
    if (selecionados.length === pedidosOrigem.length) setSelecionados([]);
    else setSelecionados(pedidosOrigem.map(p => String(p.codigo_pedido)));
  };

  const abrirDestino = () => {
    if (!cargaOrigemId) { toast.error('Selecione a carga de origem'); return; }
    if (selecionados.length === 0) { toast.error('Selecione ao menos um pedido para transferir'); return; }
    setCargaDestinoId('');
    setFiltroDestinoCarga('');
    setPeriodoDestinoInicio('');
    setPeriodoDestinoFim('');
    setDestinoOpen(true);
  };

  const finalizarTransferencia = async () => {
    if (!cargaDestinoId) { toast.error('Selecione a carga de destino'); return; }
    setTransferindo(true);
    try {
      const { data } = await base44.functions.invoke('transferirPedidoCarga', {
        pedidos_codigos_omie: selecionados,
        carga_origem_id: cargaOrigemId,
        carga_destino_id: cargaDestinoId,
        motivo
      });
      if (data?.sucesso) {
        toast.success(`${data.transferidos} pedido(s) transferido(s)`);
        setSelecionados([]);
        setMotivo('');
        setDestinoOpen(false);
        queryClient.invalidateQueries({ queryKey: ['cargas'] });
        queryClient.invalidateQueries({ queryKey: ['cargas', 'transferencia'] });
      } else {
        toast.error(data?.error || 'Erro ao transferir');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setTransferindo(false);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5 text-indigo-500" />
              Transferência entre Cargas
            </span>
            <div className="flex items-center gap-2">
              {sincronizandoCargas && (
                <span className="text-xs font-normal text-slate-500 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Carregando...
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['cargas', 'transferencia'] })}
                disabled={sincronizandoCargas}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Atualizar
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* FILTROS */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <SeletorCargaBusca
                cargas={cargasOrigemFiltradas}
                cargaSelecionadaId={cargaOrigemId}
                onChange={(c) => setCargaOrigemId(c?.id || '')}
                label="Carga de Origem (Faturada)"
                placeholder="Digite nº carga, motorista, rota, cliente ou nº pedido..."
              />
            </div>
            <div>
              <Label>Saída de</Label>
              <Input type="date" value={periodoInicio} onChange={(e) => setPeriodoInicio(e.target.value)} />
            </div>
            <div>
              <Label>Saída até</Label>
              <Input type="date" value={periodoFim} onChange={(e) => setPeriodoFim(e.target.value)} />
            </div>
            <div className="md:col-span-4">
              <Label className="flex items-center gap-1.5"><Search className="w-4 h-4" /> Filtrar Pedido (dentro da carga selecionada)</Label>
              <Input
                placeholder="Nº pedido, NF, cliente, cidade..."
                value={filtroPedido}
                onChange={(e) => setFiltroPedido(e.target.value)}
                disabled={!cargaOrigemId}
              />
            </div>
          </div>

          {/* TABELA DE PEDIDOS */}
          {cargaOrigemId && (
            <>
              <div className="text-xs text-slate-500">
                {pedidosOrigem.length} pedido(s) na carga • {selecionados.length} selecionado(s)
              </div>
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="p-2 w-10">
                        <Checkbox
                          checked={pedidosOrigem.length > 0 && selecionados.length === pedidosOrigem.length}
                          onCheckedChange={toggleTodos}
                        />
                      </th>
                      <th className="p-2 text-left">Pedido</th>
                      <th className="p-2 text-left">NF</th>
                      <th className="p-2 text-left">Cliente</th>
                      <th className="p-2 text-left">Cidade</th>
                      <th className="p-2 text-right">Qtd Itens</th>
                      <th className="p-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidosOrigem.length === 0 ? (
                      <tr><td colSpan="7" className="p-6 text-center text-slate-400">Nenhum pedido encontrado.</td></tr>
                    ) : pedidosOrigem.map(p => {
                      const cod = String(p.codigo_pedido);
                      const checked = selecionados.includes(cod);
                      return (
                        <tr key={cod} className={`border-t hover:bg-slate-50 ${checked ? 'bg-indigo-50' : ''}`}>
                          <td className="p-2"><Checkbox checked={checked} onCheckedChange={() => toggleSelecionado(cod)} /></td>
                          <td className="p-2 font-medium">{p.numero_pedido || '-'}</td>
                          <td className="p-2">{p.numero_nf || '-'}</td>
                          <td className="p-2">{p.nome_fantasia || p.nome_cliente || '-'}</td>
                          <td className="p-2">{p.cidade || '-'}</td>
                          <td className="p-2 text-right">{p.quantidade_itens || '-'}</td>
                          <td className="p-2 text-right">R$ {Number(p.valor_total_pedido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div>
                <Label>Motivo da transferência</Label>
                <Textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Opcional" />
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setSelecionados([]); setMotivo(''); }}>Limpar</Button>
                <Button onClick={abrirDestino} disabled={selecionados.length === 0} className="bg-indigo-600 hover:bg-indigo-700">
                  <ArrowLeftRight className="w-4 h-4 mr-2" />
                  Iniciar Transferência ({selecionados.length})
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* POP-UP DE DESTINO */}
      <Dialog open={destinoOpen} onOpenChange={setDestinoOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-indigo-500" />
              Selecionar Carga de Destino
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div className="md:col-span-3">
                <Label>Buscar carga</Label>
                <Input
                  placeholder="Nº carga, motorista, rota, placa..."
                  value={filtroDestinoCarga}
                  onChange={(e) => setFiltroDestinoCarga(e.target.value)}
                />
              </div>
              <div>
                <Label>Saída de</Label>
                <Input type="date" value={periodoDestinoInicio} onChange={(e) => setPeriodoDestinoInicio(e.target.value)} />
              </div>
              <div>
                <Label>Saída até</Label>
                <Input type="date" value={periodoDestinoFim} onChange={(e) => setPeriodoDestinoFim(e.target.value)} />
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto border rounded-lg">
              {cargasDestinoFiltradas.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-sm">Nenhuma carga encontrada.</div>
              ) : cargasDestinoFiltradas.map(c => (
                <label
                  key={c.id}
                  className={`flex items-center gap-3 p-3 border-b cursor-pointer hover:bg-slate-50 ${cargaDestinoId === c.id ? 'bg-indigo-50' : ''}`}
                >
                  <input
                    type="radio"
                    name="destino"
                    checked={cargaDestinoId === c.id}
                    onChange={() => setCargaDestinoId(c.id)}
                  />
                  <div className="flex-1 text-sm">
                    <div className="font-medium">Carga {c.numero_carga} • {c.data_carga}</div>
                    <div className="text-xs text-slate-500">
                      {c.motorista_nome || 'Sem motorista'} • {c.rota_nome || 'Sem rota'} • {c.veiculo_placa || '-'}
                      • {c.quantidade_pedidos || 0} pedidos • {c.status_carga}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDestinoOpen(false)} disabled={transferindo}>
              <X className="w-4 h-4 mr-2" />Cancelar
            </Button>
            <Button onClick={finalizarTransferencia} disabled={!cargaDestinoId || transferindo} className="bg-indigo-600 hover:bg-indigo-700">
              {transferindo && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Finalizar Transferência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}