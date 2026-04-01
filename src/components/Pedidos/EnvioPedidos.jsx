import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Send, Search, FileText, ShoppingCart, Pencil, Trash2, Loader2, AlertCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import PedidoPdf from './PedidoPdf';

export default function EnvioPedidos({ vendedor, onEditPedido }) {
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState('pendentes');
  const [searchText, setSearchText] = useState('');
  const [filtroPeriodoInicio, setFiltroPeriodoInicio] = useState('');
  const [filtroPeriodoFim, setFiltroPeriodoFim] = useState('');
  const [filtroCodCliente, setFiltroCodCliente] = useState('');
  const [enviandoTodos, setEnviandoTodos] = useState(false);
  const [enviandoId, setEnviandoId] = useState(null);
  const [pdfPedidoId, setPdfPedidoId] = useState(null);

  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ['pedidos', vendedor.id],
    queryFn: () => base44.entities.Pedido.filter({ vendedor_id: vendedor.id })
  });

  const { data: allItems = [] } = useQuery({
    queryKey: ['pedidoItems-all'],
    queryFn: () => base44.entities.PedidoItem.list()
  });

  const pendentes = pedidos.filter(p => p.status === 'pendente' && !p.data_envio);
  const enviados = pedidos.filter(p => !!p.data_envio);

  const filtrarPedidos = (lista) => {
    return lista.filter(p => {
      const s = searchText.toLowerCase();
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

  const getNextNumeroTroca = async () => {
    const allPedidos = await base44.entities.Pedido.list();
    const trocas = allPedidos.filter(p => p.tipo === 'troca' && p.numero_pedido);
    let maxNum = 0;
    trocas.forEach(p => {
      const num = parseInt(String(p.numero_pedido).replace(/\D/g, ''), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    });
    return String(maxNum + 1).padStart(5, '0') + 'T';
  };

  const enviarPedido = async (pedido) => {
    setEnviandoId(pedido.id);
    try {
      if (pedido.tipo === 'troca') {
        // Trocas: gerar número sequencial local com sufixo T
        const numero = await getNextNumeroTroca();
        await base44.entities.Pedido.update(pedido.id, {
          status: 'enviado',
          numero_pedido: numero,
          data_envio: new Date().toISOString(),
          omie_erro: null
        });

        // Enviar ao backend (trocas não vão para Omie, mas registra envio)
        try {
          await base44.functions.invoke('enviarPedidoOmie', { pedido_id: pedido.id });
        } catch (_) { /* trocas não precisam do Omie */ }

        toast.success(`Troca #${numero} enviada com sucesso!`);
      } else {
        // Vendas: enviar ao Omie PRIMEIRO, só marcar como enviado se der sucesso
        let omieOk = false;
        let erroMsg = '';
        let numeroPedidoOmie = null;
        try {
          const response = await base44.functions.invoke('enviarPedidoOmie', { pedido_id: pedido.id });
          const result = response.data;
          if (result.sucesso) {
            omieOk = true;
            numeroPedidoOmie = result.numero_pedido_omie;
          } else {
            erroMsg = result.erro || 'Erro desconhecido no Omie';
          }
        } catch (omieErr) {
          erroMsg = omieErr?.response?.data?.error || omieErr.message || 'Falha na comunicação com o Omie';
        }

        if (omieOk) {
          await base44.entities.Pedido.update(pedido.id, {
            status: 'enviado',
            data_envio: new Date().toISOString(),
            omie_erro: null
          });
          toast.success(`Pedido ${numeroPedidoOmie ? '#' + numeroPedidoOmie : ''} enviado ao Omie com sucesso!`);
        } else {
          await base44.entities.Pedido.update(pedido.id, {
            status: 'pendente',
            numero_pedido: null,
            data_envio: null,
            omie_erro: erroMsg
          });
          toast.error(`Erro ao enviar pedido ao Omie: ${erroMsg}`);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['pedidos'] });
    } catch (err) {
      toast.error('Erro ao enviar pedido: ' + err.message);
    } finally {
      setEnviandoId(null);
    }
  };

  const enviarTodos = async () => {
    if (pendentes.length === 0) return;
    setEnviandoTodos(true);
    let sucessoCount = 0;
    let erroCount = 0;
    const erroMsgs = [];
    
    for (const pedido of pendentes) {
      if (pedido.tipo === 'troca') {
        // Trocas: gerar número sequencial local com sufixo T
        const numero = await getNextNumeroTroca();
        await base44.entities.Pedido.update(pedido.id, {
          status: 'enviado',
          numero_pedido: numero,
          data_envio: new Date().toISOString(),
          omie_erro: null
        });
        try {
          await base44.functions.invoke('enviarPedidoOmie', { pedido_id: pedido.id });
        } catch (_) { /* trocas não precisam do Omie */ }
        sucessoCount++;
      } else {
        // Vendas: enviar ao Omie PRIMEIRO, só marcar como enviado se der sucesso
        let omieOk = false;
        let erroMsg = '';
        try {
          const response = await base44.functions.invoke('enviarPedidoOmie', { pedido_id: pedido.id });
          if (response.data.sucesso) {
            omieOk = true;
          } else {
            erroMsg = response.data.erro || 'Erro desconhecido no Omie';
          }
        } catch (omieErr) {
          erroMsg = omieErr?.response?.data?.error || omieErr.message || 'Falha na comunicação com o Omie';
        }

        if (omieOk) {
          await base44.entities.Pedido.update(pedido.id, {
            status: 'enviado',
            data_envio: new Date().toISOString(),
            omie_erro: null
          });
          sucessoCount++;
        } else {
          await base44.entities.Pedido.update(pedido.id, {
            status: 'pendente',
            numero_pedido: null,
            data_envio: null,
            omie_erro: erroMsg
          });
          erroCount++;
          erroMsgs.push(`${pedido.cliente_nome}: ${erroMsg}`);
        }
      }
    }
    
    queryClient.invalidateQueries({ queryKey: ['pedidos'] });
    
    if (erroCount > 0 && sucessoCount > 0) {
      toast.warning(`${sucessoCount} enviados, ${erroCount} com erro no Omie`);
    } else if (erroCount > 0 && sucessoCount === 0) {
      toast.error(`Nenhum pedido enviado. ${erroCount} com erro no Omie`);
    } else {
      toast.success(`${sucessoCount} pedidos enviados com sucesso!`);
    }
    setEnviandoTodos(false);
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
              <p className="font-semibold text-sm">{pedido.cliente_codigo} - {pedido.cliente_nome}</p>
              <p className="text-xs text-slate-500">{pedido.cliente_nome_fantasia}</p>
            </div>
            {pedido.status === 'enviado' && (
              <Badge className="bg-green-500 shrink-0 ml-2">Enviado</Badge>
            )}
            {pedido.status === 'pendente' && !pedido.omie_erro && (
              <Badge className="bg-amber-500 shrink-0 ml-2">Pendente</Badge>
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
            <p>Pgto: {pedido.plano_pagamento_nome || '-'}</p>
            <p>Itens: {items.length} | Vl. Total: R$ {(pedido.valor_total || 0).toFixed(2)}</p>
            <p>Modelo: {modeloLabel} | Emissão: {dataEmissao}</p>
            {pedido.numero_pedido && <p>Pedido Nº: {pedido.numero_pedido}</p>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="outline" className="text-[10px]">{pedido.tipo === 'troca' ? 'Troca' : 'Pré-venda'}</Badge>
            {pedido.tipo === 'troca' && <Badge variant="outline" className="text-[10px] border-orange-300 text-orange-700">Troca</Badge>}
          </div>
          <div className="flex gap-2 pt-2">
            {showEnviar && (
              <>
                <Button size="sm" variant="outline" onClick={() => onEditPedido(pedido.id)} className="text-xs">
                  <Pencil className="w-3 h-3 mr-1" /> Editar
                </Button>
                <Button size="sm" onClick={() => enviarPedido(pedido)} disabled={enviandoId === pedido.id} className="text-xs bg-green-600 hover:bg-green-700">
                  <Send className="w-3 h-3 mr-1" /> {enviandoId === pedido.id ? 'Enviando...' : 'Enviar'}
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
          {pendentes.length > 0 && (
            <Button onClick={enviarTodos} disabled={enviandoTodos} className="w-full mb-4 bg-gradient-to-r from-green-500 to-green-600">
              <Send className="w-4 h-4 mr-2" />
              {enviandoTodos ? 'Enviando...' : `Enviar Todos (${pendentes.length})`}
            </Button>
          )}
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