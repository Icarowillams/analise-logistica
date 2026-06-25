import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, Loader2, FileSignature, Send, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';

// REGRA DE EXIBIÇÃO: Apenas etapa 50 no Omie.
// status_real é apenas indicador visual (badge) e NÃO filtra exibição.

/**
 * Aba "Emissão de NF-e".
 * Lista pedidos Omie em etapa 50 (Faturar) e permite gerar a NF-e — individual ou em lote.
 * Quando o cliente tem modalidade "BOLETO BANCARIO" no cadastro, o boleto é gerado
 * automaticamente após a emissão da NF.
 */
export default function EmissaoNFTab({ cargaFiltro, ativa = true, onEmissionComplete }) {
  const [filtroCarga, setFiltroCarga] = useState('');
  const [busca, setBusca] = useState('');
  const [selecionados, setSelecionados] = useState(new Set());
  const [emitindo, setEmitindo] = useState(false);
  const [sincronizandoCarga, setSincronizandoCarga] = useState(false);
  const [loteAtivoId, setLoteAtivoId] = useState(null);
  const [loteNotificado, setLoteNotificado] = useState(null);
  // Só carrega após o usuário clicar em "Atualizar lista"
  const [carregamentoIniciado, setCarregamentoIniciado] = useState(false);

  // Fonte principal: espelho local dos pedidos Omie na etapa 50.
  // A carga é usada apenas para exibir/filtrar o número da carga.
  const { data: espelho = [], isLoading, refetch } = useQuery({
    queryKey: ['pedidosEmissaoNfe'],
    queryFn: async () => {
      const pedidos = await base44.entities.PedidoLiberadoOmie.filter({
        etapa: '50'
      }, '-sincronizado_em', 500);

      return pedidos
        .filter(p => !p.numero_nf)
        .map(p => ({
          codigo_pedido: String(p.codigo_pedido),
          numero_pedido: p.numero_pedido,
          valor_total_pedido: p.valor_total_pedido || 0,
          quantidade_itens: p.quantidade_itens || 0,
          nome_cliente: p.nome_cliente || '',
          nome_fantasia: p.nome_fantasia || '',
          cidade: p.cidade || '',
          cliente_id: p.cliente_id || '',
          numero_nf: p.numero_nf || '',
          status_real: p.status_real || '',
          ja_faturado: false
        }));
    },
    enabled: ativa && carregamentoIniciado,
    staleTime: 30000,
    refetchOnWindowFocus: false
  });

  // Pedidos que JÁ têm NF autorizada no log — usados para esconder da lista de "prontos para emissão"
  // mesmo quando o espelho local ainda não foi atualizado (etapa 50 / sem numero_nf).
  const { data: codigosComNf = new Set() } = useQuery({
    queryKey: ['codigosComNfAutorizada'],
    queryFn: async () => {
      const logs = await base44.entities.LogEmissaoNF.filter({ status: 'autorizada' }, '-created_date', 1000);
      return new Set(logs.filter(l => l.numero_nf).map(l => String(l.codigo_pedido)));
    },
    enabled: ativa && carregamentoIniciado,
    staleTime: 30000,
    refetchOnWindowFocus: false
  });

  const { data: cargasRelacionadas = [] } = useQuery({
    queryKey: ['cargasParaEmissaoNfe', espelho.map(p => p.codigo_pedido).join(',')],
    queryFn: () => base44.entities.Carga.list('-created_date', 500),
    enabled: ativa && carregamentoIniciado && espelho.length > 0,
    staleTime: 30000
  });

  const cargaPorPedido = useMemo(() => {
    const codigos = new Set(espelho.map(p => String(p.codigo_pedido)));
    const map = new Map();

    cargasRelacionadas.forEach(c => {
      (c.pedidos_omie || []).forEach(p => {
        const codigo = String(p.codigo_pedido || '');
        if (codigos.has(codigo)) map.set(codigo, { carga: c, pedidoCarga: p });
      });
    });

    return map;
  }, [cargasRelacionadas, espelho]);

  const { data: filasEmissao = [] } = useQuery({
    queryKey: ['filas-emissao-nf-emissao'],
    queryFn: () => base44.entities.FilaEmissaoNF.list('-created_date', 10),
    enabled: ativa,
    refetchInterval: ativa ? 3000 : false
  });

  const filaAtiva = useMemo(() => {
    if (loteAtivoId) return filasEmissao.find(f => f.id === loteAtivoId) || null;
    return filasEmissao.find(f => ['processando', 'executando'].includes(f.status)) || null;
  }, [filasEmissao, loteAtivoId]);

  useEffect(() => {
    if (!filaAtiva || !loteAtivoId || loteNotificado === loteAtivoId) return;
    if (filaAtiva.status === 'concluido' || filaAtiva.status === 'erro') {
      setLoteNotificado(loteAtivoId);
      refetch();
      if (filaAtiva.status === 'concluido') toast.success('Emissão do lote enviada ao Omie. Acompanhe a autorização no Log de Emissão.');
      if (filaAtiva.status === 'erro') toast.error('Lote finalizado com erro. Veja os detalhes abaixo e no Log de Emissão.');
      onEmissionComplete?.(filaAtiva.pedidos || []);
    }
  }, [filaAtiva, loteAtivoId, loteNotificado, refetch, onEmissionComplete]);

  const handleAtualizarLista = () => {
    if (!carregamentoIniciado) {
      setCarregamentoIniciado(true);
    } else {
      refetch();
    }
  };

  // Se veio cargaFiltro pela URL, pré-popula o filtro de carga
  useEffect(() => {
    if (cargaFiltro?.numero_carga) {
      setFiltroCarga(cargaFiltro.numero_carga);
    }
  }, [cargaFiltro]);

  const pedidosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const cargaTermo = filtroCarga.trim();
    return espelho.filter(p => {
      // Esconde pedidos que já têm NF autorizada no log (espelho pode estar desatualizado).
      if (codigosComNf.has(String(p.codigo_pedido))) return false;
      const numCarga = cargaPorPedido.get(String(p.codigo_pedido))?.carga?.numero_carga || '';
      if (cargaTermo && !String(numCarga).includes(cargaTermo)) return false;
      if (!termo) return true;
      return (
        String(p.numero_pedido || '').toLowerCase().includes(termo) ||
        String(p.nome_cliente || '').toLowerCase().includes(termo) ||
        String(p.nome_fantasia || '').toLowerCase().includes(termo) ||
        String(p.codigo_pedido || '').toLowerCase().includes(termo)
      );
    });
  }, [espelho, busca, filtroCarga, cargaPorPedido, codigosComNf]);

  const podeSelecionar = (pedido) => !pedido.ja_faturado && !pedido.numero_nf;

  const todasMarcadas = pedidosFiltrados.length > 0 && pedidosFiltrados.every(p => selecionados.has(p.codigo_pedido));
  const algumaMarcada = selecionados.size > 0;

  const toggleTodas = () => {
    const novo = new Set(selecionados);
    if (todasMarcadas) {
      pedidosFiltrados.forEach(p => novo.delete(p.codigo_pedido));
    } else {
      pedidosFiltrados.filter(podeSelecionar).forEach(p => novo.add(p.codigo_pedido));
    }
    setSelecionados(novo);
  };

  const toggleLinha = (codigo) => {
    const novo = new Set(selecionados);
    const pedido = pedidosFiltrados.find(p => p.codigo_pedido === codigo);
    if (pedido && !podeSelecionar(pedido)) return;
    if (novo.has(codigo)) novo.delete(codigo); else novo.add(codigo);
    setSelecionados(novo);
  };

  const emitirSelecionados = async (codigos) => {
    if (!codigos || codigos.length === 0) {
      toast.warning('Selecione ao menos um pedido para emitir.');
      return;
    }
    setEmitindo(true);
    try {
      const { data } = await base44.functions.invoke('emitirNfsLoteOmie', {
        codigos_pedido: codigos
      });

      setLoteAtivoId(data?.fila_id || null);
      setLoteNotificado(null);
      toast.message(data?.mensagem || 'Faturamento iniciado em background. Acompanhe o progresso na tela.');
      setSelecionados(new Set());
    } catch (e) {
      const msg = e?.response?.data?.error || e?.response?.data?.mensagem || e.message;
      toast.error('Erro ao emitir NFs: ' + msg);
    }
    setEmitindo(false);
  };

  const emitirIndividual = (codigo) => emitirSelecionados([codigo]);
  const emitirLote = () => emitirSelecionados(Array.from(selecionados));

  // Sincroniza o espelho local APENAS dos pedidos da carga filtrada (consulta cada um no Omie).
  // Útil quando o webhook não atualizou e os pedidos da carga não aparecem na lista.
  const sincronizarEspelhoCarga = async () => {
    const numero = filtroCarga.trim();
    if (!numero) {
      toast.warning('Informe o Nº da Carga para sincronizar.');
      return;
    }
    setSincronizandoCarga(true);
    try {
      const { data } = await base44.functions.invoke('reconciliarEspelhoCargaCompleto', { numero_carga: numero });
      if (data?.sucesso) {
        const msg = data.pedidos_atualizados > 0
          ? `Espelho sincronizado: ${data.pedidos_atualizados} pedido(s) atualizado(s), ${data.nfs_vinculadas || 0} NF(s) vinculada(s).`
          : 'Espelho já está atualizado — nenhuma alteração necessária.';
        toast.success(msg);
        if (!carregamentoIniciado) setCarregamentoIniciado(true);
        else refetch();
      } else if (data?.bloqueado) {
        toast.error('API Omie temporariamente bloqueada. Tente novamente mais tarde.');
      } else {
        toast.error('Erro ao sincronizar: ' + (data?.error || 'desconhecido'));
      }
    } catch (e) {
      const msg = e?.response?.data?.error || e.message;
      toast.error('Erro ao sincronizar: ' + msg);
    }
    setSincronizandoCarga(false);
  };

  const formatarValor = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  const StatusHistoricoBadge = ({ status }) => {
    const normalized = String(status || '').toLowerCase();
    if (!normalized || normalized === 'autorizada' || normalized === 'emitida' || normalized === 'aguardando_nf') return null;

    const config = {
      cancelada: { label: 'NF cancelada', title: 'NF anterior cancelada', className: 'bg-amber-100 text-amber-800 border-amber-300' },
      rejeitada: { label: 'NF rejeitada', title: 'NF rejeitada — verificar no Omie', className: 'bg-red-100 text-red-800 border-red-300' },
      denegada: { label: 'NF denegada', title: 'NF denegada', className: 'bg-red-200 text-red-900 border-red-400' }
    }[normalized];

    if (!config) return null;
    return <Badge className={config.className} title={config.title}>{config.label}</Badge>;
  };

  return (
    <div className="space-y-4">
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <b>Como funciona:</b> Lista do espelho local apenas pedidos na <b>etapa 50 — Faturar</b>, sem consultar o Omie em tempo real.
            O número da carga é apenas um filtro opcional e não controla se o pedido aparece.
            Selecione um ou vários e clique em "Emitir NF-e".
            Se o cliente tiver modalidade <b>BOLETO BANCÁRIO</b> no cadastro, o boleto será gerado automaticamente após a emissão.
          </div>
        </CardContent>
      </Card>

      {filaAtiva && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-blue-900">Progresso da emissão</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(() => {
              const total = Number(filaAtiva.total_pedidos || 0);
              const processados = Number(filaAtiva.processados || 0);
              const pct = total > 0 ? Math.round((processados / total) * 100) : 0;
              return (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-blue-900">
                      {filaAtiva.status === 'concluido' ? 'Lote concluído' : filaAtiva.status === 'erro' ? 'Lote com erro' : `Emitindo NF ${Math.min(processados + 1, total)} de ${total}...`}
                    </span>
                    <span className="text-blue-700">{processados}/{total}</span>
                  </div>
                  <Progress value={pct} className="h-2" />
                  {filaAtiva.erros?.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-white p-2 text-xs text-red-700">
                      {filaAtiva.erros.map((e, idx) => (
                        <p key={idx}>Pedido {e.codigo_pedido}: {e.mensagem}</p>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pedidos prontos para faturamento</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div>
              <Label>Buscar (pedido, cliente, código)</Label>
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex: 12345 ou Cliente X" />
            </div>
            <div>
              <Label>Nº Carga</Label>
              <Input value={filtroCarga} onChange={(e) => setFiltroCarga(e.target.value)} placeholder="Ex: 009" />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={handleAtualizarLista} variant="outline" disabled={isLoading} className="flex-1">
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                Atualizar lista
              </Button>
            </div>
          </div>

          {filtroCarga.trim() && (
            <div className="mb-4 flex items-center justify-between gap-3 p-3 rounded-lg border border-cyan-200 bg-cyan-50">
              <div className="text-sm text-cyan-900">
                Pedidos da carga <b>{filtroCarga.trim()}</b> não aparecem? Sincronize o espelho local desta carga direto do Omie.
              </div>
              <Button
                onClick={sincronizarEspelhoCarga}
                disabled={sincronizandoCarga}
                variant="outline"
                className="border-cyan-300 text-cyan-800 hover:bg-cyan-100 whitespace-nowrap"
              >
                {sincronizandoCarga ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Sincronizar espelho da carga
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-slate-600">
              {pedidosFiltrados.length} pedido(s) prontos para emissão
              {algumaMarcada && (
                <span className="ml-2 text-cyan-700 font-medium">({selecionados.size} selecionado{selecionados.size > 1 ? 's' : ''})</span>
              )}
            </div>
            <Button
              onClick={emitirLote}
              disabled={!algumaMarcada || emitindo}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {emitindo ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
              Emitir NF-e em lote ({selecionados.size})
            </Button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-700">
                <tr>
                  <th className="p-2 w-10 text-center">
                    <Checkbox checked={todasMarcadas} onCheckedChange={toggleTodas} aria-label="Selecionar todos" />
                  </th>
                  <th className="p-2 text-left font-semibold">Pedido</th>
                  <th className="p-2 text-left font-semibold">Cliente</th>
                  <th className="p-2 text-left font-semibold">Cidade</th>
                  <th className="p-2 text-left font-semibold">Carga</th>
                  <th className="p-2 text-right font-semibold">Valor</th>
                  <th className="p-2 text-center font-semibold">Itens</th>
                  <th className="p-2 text-center font-semibold">Ação</th>
                </tr>
              </thead>
              <tbody>
                {!carregamentoIniciado ? (
                  <tr><td colSpan="8" className="text-center py-12 text-slate-500">
                    <Search className="w-6 h-6 mx-auto mb-2 text-slate-400" />
                    Clique em <b>"Atualizar lista"</b> para carregar os pedidos prontos para emissão.
                  </td></tr>
                ) : isLoading ? (
                  <tr><td colSpan="8" className="text-center py-12 text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Carregando pedidos...
                  </td></tr>
                ) : pedidosFiltrados.length === 0 ? (
                  <tr><td colSpan="8" className="text-center py-12 text-slate-500">
                    Nenhum pedido na etapa 50 encontrado no Omie
                  </td></tr>
                ) : pedidosFiltrados.map((p) => {
                  const marcado = selecionados.has(p.codigo_pedido);
                  const numCarga = cargaPorPedido.get(String(p.codigo_pedido))?.carga?.numero_carga || '-';
                  return (
                    <tr key={p.codigo_pedido} className={`border-t hover:bg-slate-50/50 transition-colors ${marcado ? 'bg-amber-50/40' : ''}`}>
                      <td className="p-2 text-center">
                        <Checkbox checked={marcado} disabled={!podeSelecionar(p)} onCheckedChange={() => toggleLinha(p.codigo_pedido)} />
                      </td>
                      <td className="p-2 font-medium">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{formatarNumeroPedido(p.numero_pedido)}</span>
                          <StatusHistoricoBadge status={p.status_real} />
                        </div>
                      </td>
                      <td className="p-2">
                        <div>{p.nome_fantasia || p.nome_cliente}</div>
                        {p.nome_fantasia && p.nome_cliente && (
                          <div className="text-xs text-slate-500">{p.nome_cliente}</div>
                        )}
                      </td>
                      <td className="p-2">{p.cidade || '-'}</td>
                      <td className="p-2">
                        {numCarga !== '-' ? <Badge variant="outline">{numCarga}</Badge> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="p-2 text-right">{formatarValor(p.valor_total_pedido)}</td>
                      <td className="p-2 text-center">{p.quantidade_itens || 0}</td>
                      <td className="p-2 text-center">
                        {p.ja_faturado || p.numero_nf ? (
                          <Badge className="bg-green-100 text-green-800 border-green-300">
                            <CheckCircle2 className="w-3 h-3 mr-1" /> NF {p.numero_nf || 'emitida'}
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => emitirIndividual(p.codigo_pedido)}
                            disabled={emitindo}
                          >
                            <FileSignature className="w-4 h-4 mr-1" /> Emitir
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}