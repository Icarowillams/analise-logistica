import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Send, Search, FileText, ShoppingCart, Pencil, Trash2, Loader2, AlertCircle, X, CheckCircle2, Cloud, HardDrive, RefreshCw, Clock } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import PedidoPdf from './PedidoPdf';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';
import StatusFilaEnvio from './StatusFilaEnvio';
import useDebounce from '@/hooks/useDebounce';

export default function EnvioPedidos({ vendedor, onEditPedido }) {
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState('pendentes');
  const [searchText, setSearchText] = useState('');
  const [filtroPeriodoInicio, setFiltroPeriodoInicio] = useState('');
  const [filtroPeriodoFim, setFiltroPeriodoFim] = useState('');
  const [filtroCodCliente, setFiltroCodCliente] = useState('');
  const [enviandoIds, setEnviandoIds] = useState(new Set());
  const [pdfPedidoId, setPdfPedidoId] = useState(null);
  const [enfileirandoTodos, setEnfileirandoTodos] = useState(false);

  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ['pedidos', vendedor.id],
    queryFn: () => base44.entities.Pedido.filter({ vendedor_id: vendedor.id }),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false
  });

  // Carregar itens SOMENTE dos pedidos do vendedor (não do sistema todo)
  const pedidoIds = useMemo(() => pedidos.map(p => p.id), [pedidos]);
  const { data: allItems = [] } = useQuery({
    queryKey: ['pedidoItems-vendedor', vendedor.id, pedidoIds.length],
    queryFn: async () => {
      if (pedidoIds.length === 0) return [];
      const batches = await Promise.all(
        pedidoIds.map(id => base44.entities.PedidoItem.filter({ pedido_id: id }).catch(() => []))
      );
      return batches.flat();
    },
    enabled: pedidoIds.length > 0,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes-envio-pedidos'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 5000),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  // Fila de envio — buscar itens ativos (pendente/processando) + recentes concluídos/erro
  const { data: filaEnvio = [] } = useQuery({
    queryKey: ['fila-envio-pedido-omie', vendedor.id],
    queryFn: () => base44.entities.FilaEnvioPedidoOmie.list('-created_date', 200),
    staleTime: 15 * 1000,
    refetchInterval: 30000,
    refetchOnWindowFocus: false
  });

  // Mapa rápido: pedido_id → item da fila mais recente
  const filaPorPedido = useMemo(() => {
    const mapa = {};
    // Ordenar por created_date desc para pegar o mais recente
    const sorted = [...filaEnvio].sort((a, b) => (b.created_date || '').localeCompare(a.created_date || ''));
    for (const item of sorted) {
      if (!mapa[item.pedido_id]) mapa[item.pedido_id] = item;
    }
    return mapa;
  }, [filaEnvio]);

  // Subscription em tempo real para atualizar a fila
  useEffect(() => {
    const unsub = base44.entities.FilaEnvioPedidoOmie.subscribe((event) => {
      queryClient.invalidateQueries({ queryKey: ['fila-envio-pedido-omie'] });
      // Se concluído, invalidar pedidos também
      if (event.type === 'update' && event.data?.status === 'concluido') {
        queryClient.invalidateQueries({ queryKey: ['pedidos'] });
      }
    });
    return unsub;
  }, [queryClient]);

  const pedidosComCliente = useMemo(() => {
    const mapa = new Map(clientes.map(c => [c.id, c]));
    return pedidos.map(p => {
      const cli = mapa.get(p.cliente_id);
      return {
        ...p,
        cliente_pendencia_financeira: !!cli?.pendencia_financeira,
        cliente_tipo_nota: cli?.tipo_nota || null
      };
    });
  }, [pedidos, clientes]);

  // Determina destino do pedido e o motivo (para badge + tooltip)
  const getDestino = (pedido) => {
    if (pedido.tipo === 'troca') return { omie: false, motivo: 'Pedido do tipo Troca — registrado apenas localmente.' };
    if (pedido.modelo_nota === 'd1') return { omie: false, motivo: 'Modelo da nota é D1 — venda interna, não vai ao Omie.' };
    if (pedido.cliente_tipo_nota === 'D1') return { omie: false, motivo: 'Cliente está marcado como D1 (sem NF) — não vai ao Omie.' };
    return { omie: true, motivo: 'Será enviado ao Omie como Pedido de Venda (etapa 10).' };
  };

  const pendentes = pedidosComCliente.filter(p => p.status === 'pendente' && !p.data_envio);
  const enviados = pedidosComCliente.filter(p => !!p.data_envio);

  const searchDebounced = useDebounce(searchText, 300);

  const filtrarPedidos = (lista) => {
    return lista.filter(p => {
      const s = searchDebounced.toLowerCase();
      const matchSearch = !s || p.cliente_nome?.toLowerCase().includes(s) || p.cliente_codigo?.includes(s) || String(p.numero_pedido || '').includes(s);
      const matchCod = !filtroCodCliente || p.cliente_codigo?.includes(filtroCodCliente);

      let matchPeriodo = true;
      if (filtroPeriodoInicio) {
        const dataRef = p.data_envio ? p.data_envio.split('T')[0] : p.created_date?.split('T')[0];
        if (dataRef < filtroPeriodoInicio) matchPeriodo = false;
      }
      if (filtroPeriodoFim) {
        const dataRef = p.data_envio ? p.data_envio.split('T')[0] : p.created_date?.split('T')[0];
        if (dataRef > filtroPeriodoFim) matchPeriodo = false;
      }

      return matchSearch && matchCod && matchPeriodo;
    });
  };

  const pendentesFiltrados = filtrarPedidos(pendentes);
  const enviadosFiltrados = filtrarPedidos(enviados);

  // Sequência única para pedidos internos: todo não fiscal usa sufixo "D".
  const getNextNumeroLocal = async (pedido) => {
    const allPedidos = await base44.entities.Pedido.list();
    const internos = allPedidos.filter(p => p.numero_pedido && /[DT]$/i.test(String(p.numero_pedido)));
    let maxNum = 0;
    internos.forEach(p => {
      const num = parseInt(String(p.numero_pedido).replace(/\D/g, ''), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    });
    return formatarNumeroPedido({ ...pedido, numero_pedido: String(maxNum + 1).padStart(5, '0') });
  };

  // Pedido é tratado internamente (sem Omie) se for troca OU se modelo da nota for D1
  const isInterno = (pedido) => pedido.tipo === 'troca' || pedido.modelo_nota === 'd1';

  // Executa o envio efetivo — internos são síncronos, externos vão para a fila
  const executarEnvio = async (pedido) => {
    if (enviandoIds.has(pedido.id)) return;
    setEnviandoIds(prev => new Set(prev).add(pedido.id));
    try {
      if (isInterno(pedido)) {
        const numero = await getNextNumeroLocal(pedido);
        await base44.entities.Pedido.update(pedido.id, {
          status: 'enviado',
          numero_pedido: numero,
          data_envio: new Date().toISOString(),
          omie_erro: null
        });
        const tipoLabel = pedido.tipo === 'troca' ? 'Troca' : 'Pedido D1';
        toast.success(`${tipoLabel} #${numero} registrado com sucesso!`);
      } else {
        // Verificar se já está na fila
        const jaTemNaFila = filaEnvio.some(f => f.pedido_id === pedido.id && (f.status === 'pendente' || f.status === 'processando' || f.status === 'erro'));
        if (jaTemNaFila) {
          toast.info('Este pedido já está na fila de envio');
        } else {
          await base44.entities.FilaEnvioPedidoOmie.create({
            pedido_id: pedido.id,
            numero_pedido: pedido.numero_pedido || '',
            cliente_nome: pedido.cliente_nome || '',
            vendedor_id: vendedor.id,
            operacao: 'enviar',
            status: 'pendente',
            tentativas: 0
          });
          queryClient.invalidateQueries({ queryKey: ['fila-envio-pedido-omie'] });
          toast.success('Pedido enfileirado para envio ao Omie. O processamento ocorre em background.');
        }
      }
      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
    } catch (err) {
      toast.error('Erro ao enfileirar pedido: ' + err.message);
    } finally {
      setEnviandoIds(prev => { const n = new Set(prev); n.delete(pedido.id); return n; });
    }
  };

  // Envio livre: débito financeiro não bloqueia envio ao Omie.
  const enviarPedido = async (pedido) => {
    if (!pedido.data_previsao_entrega && !isInterno(pedido)) {
      toast.error(`Pedido de ${pedido.cliente_nome} não tem Data de Previsão de Entrega. Edite o pedido para informar.`);
      return;
    }
    return executarEnvio(pedido);
  };

  // ========== ENVIAR TODOS via FILA ASSÍNCRONA ==========
  const enviarTodos = async () => {
    if (pendentes.length === 0) return;
    setEnfileirandoTodos(true);

    // Separar internos (D1/Troca) dos que vão pro Omie
    const internos = pendentes.filter(p => isInterno(p));
    const externos = pendentes.filter(p => !isInterno(p) && p.data_previsao_entrega);
    const semData = pendentes.filter(p => !isInterno(p) && !p.data_previsao_entrega);

    let internosSucesso = 0;

    // 1. Internos (rápido, local) — continua síncrono pois não vai ao Omie
    for (const pedido of internos) {
      const numero = await getNextNumeroLocal(pedido);
      await base44.entities.Pedido.update(pedido.id, {
        status: 'enviado',
        numero_pedido: numero,
        data_envio: new Date().toISOString(),
        omie_erro: null
      });
      internosSucesso++;
    }

    // 2. Externos: enfileirar na FilaEnvioPedidoOmie (evitar duplicatas)
    const pedidosIdsJaNaFila = new Set(
      filaEnvio
        .filter(f => f.status === 'pendente' || f.status === 'processando' || f.status === 'erro')
        .map(f => f.pedido_id)
    );

    const aEnfileirar = externos.filter(p => !pedidosIdsJaNaFila.has(p.id));
    const jaNaFila = externos.length - aEnfileirar.length;

    if (aEnfileirar.length > 0) {
      const registros = aEnfileirar.map(p => ({
        pedido_id: p.id,
        numero_pedido: p.numero_pedido || '',
        cliente_nome: p.cliente_nome || '',
        vendedor_id: vendedor.id,
        operacao: 'enviar',
        status: 'pendente',
        tentativas: 0,
        usuario_email: ''
      }));
      await base44.entities.FilaEnvioPedidoOmie.bulkCreate(registros);
    }

    queryClient.invalidateQueries({ queryKey: ['pedidos'] });
    queryClient.invalidateQueries({ queryKey: ['fila-envio-pedido-omie'] });

    const msgs = [];
    if (internosSucesso > 0) msgs.push(`${internosSucesso} interno(s) registrado(s)`);
    if (aEnfileirar.length > 0) msgs.push(`${aEnfileirar.length} pedido(s) enfileirado(s) para envio ao Omie`);
    if (jaNaFila > 0) msgs.push(`${jaNaFila} já estavam na fila`);
    if (semData.length > 0) msgs.push(`${semData.length} sem data de previsão (ignorados)`);

    toast.success(msgs.join('. ') + '. O processamento ocorre em background.');

    setEnfileirandoTodos(false);
  };

  // Reprocessar erros
  const reprocessarErros = async () => {
    const erros = filaEnvio.filter(f => f.status === 'erro' && (f.tentativas || 0) < 3);
    if (erros.length === 0) {
      toast.info('Nenhum erro reprocessável (todos já atingiram 3 tentativas)');
      return;
    }
    for (const item of erros) {
      await base44.entities.FilaEnvioPedidoOmie.update(item.id, { status: 'pendente', erro_log: null });
    }
    queryClient.invalidateQueries({ queryKey: ['fila-envio-pedido-omie'] });
    toast.success(`${erros.length} pedido(s) reenfileirado(s) para reprocessamento`);
  };

  const excluirPedido = async (pedido) => {
    if (!confirm('Excluir este pedido?')) return;
    // Delete items first
    const items = allItems.filter(i => i.pedido_id === pedido.id);
    for (const item of items) {
      await base44.entities.PedidoItem.delete(item.id);
    }
    await base44.entities.Pedido.delete(pedido.id);
    queryClient.invalidateQueries({ queryKey: ['pedidos'] });
    queryClient.invalidateQueries({ queryKey: ['pedidoItems-all'] });
    toast.success('Pedido excluído');
  };

  // Relatório agrupado
  const exportarRelatorio = () => {
    const pedidosFiltrados = enviadosFiltrados;
    const itemsEnviados = allItems.filter(i => pedidosFiltrados.some(p => p.id === i.pedido_id));

    // Agrupar por produto
    const agrupado = {};
    itemsEnviados.forEach(item => {
      if (!agrupado[item.produto_id]) {
        agrupado[item.produto_id] = { codigo: item.produto_codigo, nome: item.produto_nome, quantidade: 0, valor_total: 0 };
      }
      agrupado[item.produto_id].quantidade += item.quantidade;
      agrupado[item.produto_id].valor_total += item.valor_total;
    });

    const linhas = Object.values(agrupado);
    const totalGeral = linhas.reduce((s, l) => s + l.valor_total, 0);

    let csv = 'Código;Produto;Quantidade;Valor Total\n';
    linhas.forEach(l => {
      csv += `${l.codigo};${l.nome};${l.quantidade};${l.valor_total.toFixed(2)}\n`;
    });
    csv += `\n;;TOTAL GERAL;${totalGeral.toFixed(2)}\n`;

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'relatorio_pedidos.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Relatório exportado!');
  };

  if (pdfPedidoId) {
    return (
      <div className="space-y-4">
        <button onClick={() => setPdfPedidoId(null)} className="text-sm text-blue-600 hover:underline">← Voltar</button>
        <PedidoPdf pedidoId={pdfPedidoId} />
      </div>
    );
  }

  const PedidoCard = ({ pedido, showEnviar }) => {
    const modeloLabel = pedido.modelo_nota === 'd1' ? 'D1' : pedido.modelo_nota === '55' ? '55' : 'NFCe';
    const dataEmissao = pedido.data_envio ? new Date(pedido.data_envio).toLocaleString('pt-BR') : new Date(pedido.created_date).toLocaleString('pt-BR');
    const items = allItems.filter(i => i.pedido_id === pedido.id);

    return (
      <Card className={`mb-3 ${pedido.omie_erro ? 'border-red-300 bg-red-50/50' : ''}`}>
        <CardContent className="p-4 space-y-2">
          <div className="flex justify-between items-start">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm">
                {pedido.cliente_codigo} - {pedido.cliente_nome}
                {pedido.cliente_pendencia_financeira && <Badge className="ml-2 border border-amber-300 bg-amber-100 text-[10px] text-amber-800">Pendência Financeira</Badge>}
              </p>
              <p className="text-xs text-slate-500">{pedido.cliente_nome_fantasia}</p>
            </div>
            {pedido.status === 'enviado' && (
              <Badge className="bg-green-500 shrink-0 ml-2">Enviado</Badge>
            )}
            {pedido.status === 'pendente' && !pedido.omie_erro && !filaPorPedido[pedido.id] && (
              <Badge className="bg-amber-500 shrink-0 ml-2">Pendente</Badge>
            )}
            {pedido.status === 'pendente' && !pedido.omie_erro && filaPorPedido[pedido.id] && (
              <span className="shrink-0 ml-2">
                <StatusFilaEnvio filaItem={filaPorPedido[pedido.id]} />
              </span>
            )}
            {pedido.status === 'pendente' && pedido.omie_erro && (
              <Badge className="bg-red-500 shrink-0 ml-2">Erro Omie</Badge>
            )}
          </div>
          
          {/* Alerta de erro do Omie */}
          {pedido.omie_erro && (
            <div className="flex items-start gap-2 p-2.5 bg-red-100 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-red-700">Falha no envio ao Omie:</p>
                <p className="text-xs text-red-600 break-words">{pedido.omie_erro}</p>
              </div>
              <button 
                onClick={async (e) => {
                  e.stopPropagation();
                  await base44.entities.Pedido.update(pedido.id, { omie_erro: null });
                  queryClient.invalidateQueries({ queryKey: ['pedidos'] });
                }}
                className="text-red-400 hover:text-red-600 shrink-0"
                title="Limpar erro"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          
          <div className="text-xs text-slate-600 space-y-0.5">
            {!pedido.data_previsao_entrega && !isInterno(pedido) && (
              <p className="text-red-600 font-semibold">⚠ Sem data de previsão de entrega</p>
            )}
            <p>Pgto: {pedido.plano_pagamento_nome || '-'}</p>
            <p>Itens: {items.length} | Vl. Total: R$ {(pedido.valor_total || 0).toFixed(2)}</p>
            <p>Modelo: {modeloLabel} | Emissão: {dataEmissao}</p>
            {pedido.numero_pedido && <p>Pedido Nº: {formatarNumeroPedido(pedido)}</p>}
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <Badge variant="outline" className="text-[10px]">{pedido.tipo === 'troca' ? 'Troca' : 'Pré-venda'}</Badge>
            {pedido.tipo === 'troca' && <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-700">Troca</Badge>}
            {pedido.modelo_nota === 'd1' && pedido.tipo !== 'troca' && (
              <Badge variant="outline" className="text-[10px] border-purple-300 text-purple-700">D1 — Interno (sem Omie)</Badge>
            )}
            {(() => {
              const destino = getDestino(pedido);
              return (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {destino.omie ? (
                        <Badge className="text-[10px] bg-green-600 hover:bg-green-600 cursor-help gap-1">
                          <Cloud className="w-3 h-3" /> Omie
                        </Badge>
                      ) : (
                        <Badge className="text-[10px] bg-slate-400 hover:bg-slate-400 cursor-help gap-1">
                          <HardDrive className="w-3 h-3" /> Interno — não vai ao Omie
                        </Badge>
                      )}
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[240px] text-xs">{destino.motivo}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })()}
          </div>
          <div className="flex gap-2 pt-2">
            {showEnviar && (
              <>
                <Button size="sm" variant="outline" onClick={() => onEditPedido(pedido.id)} className="text-xs">
                  <Pencil className="w-3 h-3 mr-1" /> Editar
                </Button>
                <Button 
                  size="sm" 
                  onClick={() => enviarPedido(pedido)} 
                  disabled={enviandoIds.has(pedido.id) || enfileirandoTodos || (filaPorPedido[pedido.id] && (filaPorPedido[pedido.id].status === 'pendente' || filaPorPedido[pedido.id].status === 'processando'))} 
                  className="text-xs bg-green-600 hover:bg-green-700"
                >
                  <Send className="w-3 h-3 mr-1" /> 
                  {enviandoIds.has(pedido.id) ? 'Enfileirando...' : 
                   filaPorPedido[pedido.id]?.status === 'pendente' ? 'Na fila' :
                   filaPorPedido[pedido.id]?.status === 'processando' ? 'Enviando...' : 'Enviar'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPdfPedidoId(pedido.id)} className="text-xs">
                  <FileText className="w-3 h-3 mr-1" /> PDF
                </Button>
                <Button size="sm" variant="ghost" className="text-xs text-red-500" onClick={() => excluirPedido(pedido)}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </>
            )}
            {!showEnviar && (
              <Button size="sm" variant="outline" onClick={() => setPdfPedidoId(pedido.id)} className="text-xs">
                <FileText className="w-3 h-3 mr-1" /> PDF
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="pendentes">Pendentes ({pendentes.length})</TabsTrigger>
          <TabsTrigger value="enviados">Enviados ({enviados.length})</TabsTrigger>
        </TabsList>

        <div className="mt-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Buscar..." value={searchText} onChange={(e) => setSearchText(e.target.value)} className="pl-10" />
          </div>

          {subTab === 'enviados' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Input type="date" placeholder="De" value={filtroPeriodoInicio} onChange={(e) => setFiltroPeriodoInicio(e.target.value)} />
              <Input type="date" placeholder="Até" value={filtroPeriodoFim} onChange={(e) => setFiltroPeriodoFim(e.target.value)} />
              <Input placeholder="Cód. Cliente" value={filtroCodCliente} onChange={(e) => setFiltroCodCliente(e.target.value)} />
              <Button variant="outline" onClick={exportarRelatorio} className="text-xs">
                <FileText className="w-3 h-3 mr-1" /> Relatório
              </Button>
            </div>
          )}
        </div>

        <TabsContent value="pendentes">
          {(() => {
            const pendentesNaFila = filaEnvio.filter(f => f.status === 'pendente' || f.status === 'processando').length;
            if (pendentesNaFila <= 10) return null;
            return (
              <Alert className="mb-4 border-amber-300 bg-amber-50">
                <AlertCircle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800 text-sm font-medium">
                  ⚠️ Fila cheia ({pendentesNaFila} pedidos aguardando). Aguarde ~10 minutos antes de enviar mais.
                </AlertDescription>
              </Alert>
            );
          })()}
          {pendentes.length > 0 && (
            <Button onClick={enviarTodos} disabled={enfileirandoTodos} className="w-full mb-4 bg-gradient-to-r from-green-500 to-green-600">
              <Send className="w-4 h-4 mr-2" />
              {enfileirandoTodos ? 'Enfileirando...' : `Enviar Todos (${pendentes.length})`}
            </Button>
          )}
          {/* Painel de status da fila */}
          {(() => {
            const nFila = filaEnvio.filter(f => f.status === 'pendente').length;
            const nProcessando = filaEnvio.filter(f => f.status === 'processando').length;
            const nErros = filaEnvio.filter(f => f.status === 'erro').length;
            if (nFila === 0 && nProcessando === 0 && nErros === 0) return null;
            return (
              <div className="mb-4 p-3 bg-slate-50 border rounded-lg space-y-2">
                <div className="flex flex-wrap justify-between items-center text-xs font-medium gap-2">
                  <div className="flex items-center gap-3">
                    {nFila > 0 && (
                      <span className="flex items-center gap-1 text-amber-700">
                        <Clock className="w-3 h-3" /> {nFila} na fila
                      </span>
                    )}
                    {nProcessando > 0 && (
                      <span className="flex items-center gap-1 text-blue-700">
                        <Loader2 className="w-3 h-3 animate-spin" /> {nProcessando} enviando
                      </span>
                    )}
                    {nErros > 0 && (
                      <span className="flex items-center gap-1 text-red-700">
                        <AlertCircle className="w-3 h-3" /> {nErros} com erro
                      </span>
                    )}
                  </div>
                  {nErros > 0 && (
                    <Button size="sm" variant="outline" onClick={reprocessarErros} className="text-xs h-7">
                      <RefreshCw className="w-3 h-3 mr-1" /> Reprocessar erros
                    </Button>
                  )}
                </div>
                {(nFila > 0 || nProcessando > 0) && (
                  <p className="text-[11px] text-slate-500">
                    Os pedidos são enviados automaticamente em background, um por vez, a cada 5 segundos.
                  </p>
                )}
              </div>
            );
          })()}
          {pendentesFiltrados.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>Nenhum Pedido encontrado</p>
            </div>
          ) : (
            pendentesFiltrados.map(p => <PedidoCard key={p.id} pedido={p} showEnviar />)
          )}
        </TabsContent>

        <TabsContent value="enviados">
          {enviadosFiltrados.length === 0 ? (
            <div className="text-center py-16 text-slate-500">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>Nenhum Pedido enviado encontrado</p>
            </div>
          ) : (
            enviadosFiltrados.map(p => <PedidoCard key={p.id} pedido={p} showEnviar={false} />)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}