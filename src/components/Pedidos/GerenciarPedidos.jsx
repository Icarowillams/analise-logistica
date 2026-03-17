import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Search, CheckCircle2, Trash2, Pencil, Eye, DollarSign,
  Loader2, AlertTriangle, Undo2, Lock, Unlock, FileText, Filter, Send, CloudOff
} from 'lucide-react';
import { toast } from 'sonner';
import DebitosClienteModal from './DebitosClienteModal';
import PedidoPdf from './PedidoPdf';
import CancelarPedidoModal from './CancelarPedidoModal';

export default function GerenciarPedidos({ onEditPedido }) {
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroVendedor, setFiltroVendedor] = useState('todos');
  const [filtroPeriodoInicio, setFiltroPeriodoInicio] = useState('');
  const [filtroPeriodoFim, setFiltroPeriodoFim] = useState('');
  const [debitosClienteId, setDebitosClienteId] = useState(null);
  const [debitosClienteNome, setDebitosClienteNome] = useState('');
  const [debitosOpen, setDebitosOpen] = useState(false);
  const [liberandoId, setLiberandoId] = useState(null);
  const [enviandoOmieId, setEnviandoOmieId] = useState(null);
  const [pdfPedidoId, setPdfPedidoId] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [cancelarPedido, setCancelarPedido] = useState(null);
  const [cancelarOpen, setCancelarOpen] = useState(false);

  React.useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

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

  // Filtrar apenas pedidos enviados (e liberados para visualização)
  const pedidosFiltrados = useMemo(() => {
    return pedidos.filter(p => {
      // Filtro de status
      if (filtroStatus !== 'todos' && p.status !== filtroStatus) return false;

      // Filtro de vendedor
      if (filtroVendedor !== 'todos' && p.vendedor_id !== filtroVendedor) return false;

      // Filtro de busca
      const s = searchText.toLowerCase();
      if (s) {
        const matchSearch = p.cliente_nome?.toLowerCase().includes(s) ||
          p.cliente_codigo?.includes(s) ||
          String(p.numero_pedido || '').includes(s) ||
          p.vendedor_nome?.toLowerCase().includes(s);
        if (!matchSearch) return false;
      }

      // Filtro de período
      if (filtroPeriodoInicio) {
        const dataRef = p.data_envio ? p.data_envio.split('T')[0] : p.created_date?.split('T')[0];
        if (dataRef < filtroPeriodoInicio) return false;
      }
      if (filtroPeriodoFim) {
        const dataRef = p.data_envio ? p.data_envio.split('T')[0] : p.created_date?.split('T')[0];
        if (dataRef > filtroPeriodoFim) return false;
      }

      return true;
    });
  }, [pedidos, filtroStatus, filtroVendedor, searchText, filtroPeriodoInicio, filtroPeriodoFim]);

  const liberarPedido = async (pedido) => {
    setLiberandoId(pedido.id);
    try {
      // Consultar débitos do cliente no Omie
      const response = await base44.functions.invoke('consultarDebitosOmie', { cliente_id: pedido.cliente_id });
      const debitos = response.data;

      let pendenciaIgnorada = false;
      if (debitos.tem_pendencia) {
        const confirmar = window.confirm(
          `⚠️ ATENÇÃO: O cliente ${pedido.cliente_nome || pedido.cliente_codigo} está com pendência financeira!\n\n` +
          `- ${debitos.titulos_atrasados} título(s) atrasado(s)\n` +
          `- Total em débito: R$ ${(debitos.total_debitos || 0).toFixed(2)}\n\n` +
          `Deseja liberar o pedido mesmo assim?`
        );

        if (!confirmar) {
          setLiberandoId(null);
          return;
        }
        pendenciaIgnorada = true;
      }

      // Se o pedido está no Omie, primeiro tentar mover a etapa
      let omieOk = true;
      let omieErroMsg = '';
      if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
        try {
          const faturarResp = await base44.functions.invoke('faturarPedidoOmie', { pedido_id: pedido.id, etapa: "20" });
          const faturarResult = faturarResp.data;
          if (!faturarResult.sucesso) {
            omieOk = false;
            omieErroMsg = faturarResult.erro || 'Erro desconhecido';
          }
        } catch (omieErr) {
          omieOk = false;
          omieErroMsg = omieErr?.response?.data?.error || omieErr.message || 'Falha na comunicação com o Omie';
        }
      }

      // Só atualizar status para liberado APÓS sucesso no Omie (ou se não tem Omie)
      if (omieOk) {
        await base44.entities.Pedido.update(pedido.id, {
          status: 'liberado',
          liberado_por: currentUser?.email || '',
          data_liberacao: new Date().toISOString(),
          pendencia_financeira_ignorada: pendenciaIgnorada
        });

        // Registrar na aba "Análise de Trocas" após o faturamento (liberação)
        if (pedido.tipo === 'troca') {
          try {
            const itemsTroca = allItems.filter(i => i.pedido_id === pedido.id);
            for (const item of itemsTroca) {
              await base44.entities.Troca.create({
                data: new Date().toISOString().split('T')[0],
                cliente_id: pedido.cliente_id,
                cliente_nome: pedido.cliente_nome,
                produto_original_id: item.produto_id,
                produto_original_nome: item.produto_nome,
                produto_novo_id: item.produto_id,
                produto_novo_nome: item.produto_nome,
                motivo_id: item.motivo_troca_id || '',
                motivo_descricao: item.motivo_troca_descricao || '',
                vendedor_id: pedido.vendedor_id,
                vendedor_nome: pedido.vendedor_nome,
                venda_original_id: pedido.id,
                quantidade: item.quantidade,
                valor_unitario: item.valor_unitario || 0,
                observacoes: pedido.observacoes || ''
              });
            }
          } catch(e) {
            console.error('Erro ao registrar troca na analise', e);
          }
        }

        if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
          toast.success('Pedido liberado e movido para Pedidos Liberados no Omie!');
        } else {
          toast.success('Pedido liberado!');
        }
      } else {
        // Omie falhou — NÃO liberar localmente
        toast.error(`Falha ao mover etapa no Omie: ${omieErroMsg}. Pedido NÃO foi liberado.`);
      }

      queryClient.invalidateQueries({ queryKey: ['todos-pedidos'] });
    } catch (err) {
      toast.error('Erro ao liberar pedido: ' + err.message);
    } finally {
      setLiberandoId(null);
    }
  };

  const [tornandoPendenteId, setTornandoPendenteId] = useState(null);

  const tornarPendente = async (pedido) => {
    if (!confirm('Deseja tornar este pedido pendente novamente?')) return;
    setTornandoPendenteId(pedido.id);
    try {
      // Se o pedido está no Omie, primeiro tentar voltar a etapa
      let omieOk = true;
      let omieErroMsg = '';
      if (pedido.omie_enviado && pedido.omie_codigo_pedido) {
        try {
          const resp = await base44.functions.invoke('faturarPedidoOmie', { pedido_id: pedido.id, etapa: "10" });
          const result = resp.data;
          if (!result.sucesso) {
            omieOk = false;
            omieErroMsg = result.erro || 'Erro desconhecido';
          }
        } catch (omieErr) {
          omieOk = false;
          omieErroMsg = omieErr?.response?.data?.error || omieErr.message || 'Falha na comunicação com o Omie';
        }
      }

      if (omieOk) {
        await base44.entities.Pedido.update(pedido.id, {
          status: 'enviado',
          liberado_por: null,
          data_liberacao: null,
          pendencia_financeira_ignorada: false
        });

        if (pedido.tipo === 'troca') {
          try {
             const trocasCriadas = await base44.entities.Troca.filter({ venda_original_id: pedido.id });
             for (const t of trocasCriadas) {
               await base44.entities.Troca.delete(t.id);
             }
          } catch(e) { console.error('Erro ao deletar troca na analise', e); }
        }

        queryClient.invalidateQueries({ queryKey: ['todos-pedidos'] });
        toast.success('Pedido retornado para Enviado (etapa 10 no Omie)');
      } else {
        toast.error(`Falha ao voltar etapa no Omie: ${omieErroMsg}. Pedido NÃO foi alterado.`);
      }
    } finally {
      setTornandoPendenteId(null);
    }
  };

  const handleCancelarPedido = async (pedido, motivo) => {
    try {
      const resp = await base44.functions.invoke('cancelarPedidoOmie', { pedido_id: pedido.id, motivo });
      const result = resp.data;
      if (result.sucesso) {
        toast.success(result.mensagem);
      } else {
        toast.error('Erro: ' + (result.erro || result.error));
      }
      queryClient.invalidateQueries({ queryKey: ['todos-pedidos'] });
    } catch (err) {
      toast.error('Erro ao cancelar: ' + (err?.response?.data?.erro || err.message));
      queryClient.invalidateQueries({ queryKey: ['todos-pedidos'] });
    }
  };

  const enviarParaFaturar = async (pedido) => {
    if (!pedido.omie_enviado || !pedido.omie_codigo_pedido) {
      toast.error('Este pedido ainda não foi enviado ao Omie');
      return;
    }
    if (!confirm(`Mover o pedido #${pedido.numero_pedido || ''} do cliente ${pedido.cliente_nome} para Faturar no Omie?`)) return;
    
    setEnviandoOmieId(pedido.id);
    try {
      const response = await base44.functions.invoke('faturarPedidoOmie', { pedido_id: pedido.id });
      const result = response.data;
      
      if (result.sucesso) {
        toast.success('Pedido movido para Faturar no Omie!');
      } else {
        toast.error(`Erro Omie: ${result.erro}`);
      }
      queryClient.invalidateQueries({ queryKey: ['todos-pedidos'] });
    } catch (err) {
      toast.error('Erro ao faturar no Omie: ' + (err?.response?.data?.erro || err.message));
    } finally {
      setEnviandoOmieId(null);
    }
  };

  const verDebitos = (pedido) => {
    setDebitosClienteId(pedido.cliente_id);
    setDebitosClienteNome(pedido.cliente_nome || pedido.cliente_codigo);
    setDebitosOpen(true);
  };

  if (pdfPedidoId) {
    return (
      <div className="space-y-4">
        <button onClick={() => setPdfPedidoId(null)} className="text-sm text-blue-600 hover:underline">← Voltar</button>
        <PedidoPdf pedidoId={pdfPedidoId} />
      </div>
    );
  }

  const statusConfig = {
    pendente: { label: 'Pendente', class: 'bg-amber-500' },
    enviado: { label: 'Enviado', class: 'bg-blue-500' },
    liberado: { label: 'Liberado', class: 'bg-green-500' },
    cancelado: { label: 'Cancelado', class: 'bg-red-500' }
  };

  const totalValor = pedidosFiltrados.reduce((s, p) => s + (p.valor_total || 0), 0);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-700">Filtros</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input placeholder="Buscar..." value={searchText} onChange={(e) => setSearchText(e.target.value)} className="pl-10" />
          </div>
          <Select value={filtroStatus} onValueChange={setFiltroStatus}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os Status</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="enviado">Enviado</SelectItem>
              <SelectItem value="liberado">Liberado</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filtroVendedor} onValueChange={setFiltroVendedor}>
            <SelectTrigger><SelectValue placeholder="Vendedor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos Vendedores</SelectItem>
              {vendedores.map(v => (
                <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input type="date" placeholder="De" value={filtroPeriodoInicio} onChange={(e) => setFiltroPeriodoInicio(e.target.value)} />
          <Input type="date" placeholder="Até" value={filtroPeriodoFim} onChange={(e) => setFiltroPeriodoFim(e.target.value)} />
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg p-3 border border-slate-100 shadow-sm text-center">
          <p className="text-xs text-slate-500">Total Pedidos</p>
          <p className="text-xl font-bold text-slate-900">{pedidosFiltrados.length}</p>
        </div>
        <div className="bg-white rounded-lg p-3 border border-amber-100 shadow-sm text-center">
          <p className="text-xs text-slate-500">Pendentes</p>
          <p className="text-xl font-bold text-amber-600">{pedidosFiltrados.filter(p => p.status === 'pendente').length}</p>
        </div>
        <div className="bg-white rounded-lg p-3 border border-blue-100 shadow-sm text-center">
          <p className="text-xs text-slate-500">Enviados</p>
          <p className="text-xl font-bold text-blue-600">{pedidosFiltrados.filter(p => p.status === 'enviado').length}</p>
        </div>
        <div className="bg-white rounded-lg p-3 border border-green-100 shadow-sm text-center">
          <p className="text-xs text-slate-500">Valor Total</p>
          <p className="text-xl font-bold text-green-600">R$ {totalValor.toFixed(2)}</p>
        </div>
      </div>

      {/* Lista de pedidos */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
        </div>
      ) : pedidosFiltrados.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p>Nenhum pedido encontrado</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pedidosFiltrados.map(pedido => {
            const items = allItems.filter(i => i.pedido_id === pedido.id);
            const dataEmissao = pedido.data_envio
              ? new Date(pedido.data_envio).toLocaleString('pt-BR')
              : new Date(pedido.created_date).toLocaleString('pt-BR');
            const sc = statusConfig[pedido.status] || statusConfig.pendente;

            return (
              <Card key={pedido.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm">
                        {pedido.cliente_codigo} - {pedido.cliente_nome}
                      </p>
                      <p className="text-xs text-slate-500">{pedido.cliente_nome_fantasia}</p>
                      <p className="text-xs text-slate-400">Vendedor: {pedido.vendedor_nome}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <Badge className={sc.class}>{sc.label}</Badge>
                      {pedido.pendencia_financeira_ignorada && (
                        <Badge className="bg-orange-500 text-xs" title="Pendência financeira ignorada">
                          <AlertTriangle className="w-3 h-3" />
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="text-xs text-slate-600 space-y-0.5 mb-3">
                    <p>Pgto: {pedido.plano_pagamento_nome || '-'} | Itens: {items.length} | Vl: R$ {(pedido.valor_total || 0).toFixed(2)}</p>
                    <p>Data: {dataEmissao} {pedido.numero_pedido ? `| Nº ${pedido.numero_pedido}` : ''}</p>
                    <p>Tipo: {pedido.tipo === 'troca' ? 'Troca' : 'Venda'} | Modelo: {pedido.modelo_nota === 'd1' ? 'D1' : pedido.modelo_nota === '55' ? '55' : 'NFCe'}</p>
                    {pedido.omie_enviado && (
                      <p className="text-green-600 font-medium">✓ Omie: {pedido.omie_codigo_pedido || 'Enviado'}</p>
                    )}
                    {pedido.omie_erro && !pedido.omie_enviado && (
                      <p className="text-red-500 text-[10px]">Omie erro: {pedido.omie_erro}</p>
                    )}
                    {pedido.status === 'cancelado' && (
                      <div className="text-red-600 text-[10px] mt-1">
                        <p className="font-semibold">✕ Cancelado por: {vendedores.find(v => v.email?.toLowerCase() === pedido.cancelado_por?.toLowerCase())?.nome || pedido.cancelado_por || '-'}</p>
                        <p>Data: {pedido.data_cancelamento ? new Date(pedido.data_cancelamento).toLocaleString('pt-BR') : '-'}</p>
                        <p>Motivo: {pedido.motivo_cancelamento || '-'}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {/* Consultar Débitos */}
                    <Button size="sm" variant="outline" onClick={() => verDebitos(pedido)} className="text-xs">
                      <DollarSign className="w-3 h-3 mr-1" /> Débitos
                    </Button>

                    {/* Liberar pedido (só se enviado e não cancelado) */}
                    {pedido.status === 'enviado' && (
                      <Button
                        size="sm"
                        onClick={() => liberarPedido(pedido)}
                        disabled={liberandoId === pedido.id}
                        className="text-xs bg-green-600 hover:bg-green-700"
                      >
                        {liberandoId === pedido.id ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Unlock className="w-3 h-3 mr-1" />
                        )}
                        Liberar
                      </Button>
                    )}

                    {pedido.status === 'liberado' && (
                      <Badge className="bg-green-100 text-green-700 text-[10px]">
                        ✓ Liberado
                      </Badge>
                    )}

                    {/* Voltar para Enviado (se liberado) */}
                    {pedido.status === 'liberado' && (
                      <Button size="sm" variant="outline" onClick={() => tornarPendente(pedido)} disabled={tornandoPendenteId === pedido.id} className="text-xs text-amber-700 border-amber-200 hover:bg-amber-50">
                        {tornandoPendenteId === pedido.id ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Undo2 className="w-3 h-3 mr-1" />
                        )}
                        Pendente
                      </Button>
                    )}

                    {/* Editar (se não cancelado) */}
                    {pedido.status !== 'cancelado' && (
                      <Button size="sm" variant="outline" onClick={() => onEditPedido(pedido.id)} className="text-xs">
                        <Pencil className="w-3 h-3 mr-1" /> Editar
                      </Button>
                    )}

                    {/* PDF */}
                    <Button size="sm" variant="outline" onClick={() => setPdfPedidoId(pedido.id)} className="text-xs">
                      <FileText className="w-3 h-3 mr-1" /> PDF
                    </Button>

                    {/* Cancelar (não disponível se já cancelado) */}
                    {pedido.status !== 'cancelado' && (
                      <Button size="sm" variant="ghost" onClick={() => { setCancelarPedido(pedido); setCancelarOpen(true); }} className="text-xs text-red-500 hover:text-red-700">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <DebitosClienteModal
        open={debitosOpen}
        onOpenChange={setDebitosOpen}
        clienteId={debitosClienteId}
        clienteNome={debitosClienteNome}
      />

      <CancelarPedidoModal
        open={cancelarOpen}
        onOpenChange={setCancelarOpen}
        pedido={cancelarPedido}
        onConfirm={handleCancelarPedido}
      />
    </div>
  );
}