import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, Clock, CheckCircle2, Loader2, RefreshCw, Search, XCircle, Play } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_CONFIG = {
  pendente:    { label: 'Pendente',    color: 'bg-amber-100 text-amber-800 border-amber-300',  icon: Clock },
  processando: { label: 'Enviando...',  color: 'bg-blue-100 text-blue-800 border-blue-300',    icon: Loader2 },
  concluido:   { label: 'Concluído',   color: 'bg-green-100 text-green-800 border-green-300',  icon: CheckCircle2 },
  erro:        { label: 'Erro',        color: 'bg-red-100 text-red-800 border-red-300',        icon: XCircle },
};

export default function SupervisaoFilaEnvio() {
  const queryClient = useQueryClient();
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroVendedor, setFiltroVendedor] = useState('todos');
  const [busca, setBusca] = useState('');

  const { data: fila = [], isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['supervisao-fila-envio'],
    queryFn: () => base44.entities.FilaEnvioPedidoOmie.list('-created_date', 500),
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores-supervisao'],
    queryFn: () => base44.entities.Vendedor.list(),
    staleTime: 5 * 60 * 1000,
  });

  // Subscrição em tempo real
  useEffect(() => {
    const unsub = base44.entities.FilaEnvioPedidoOmie.subscribe(() => {
      queryClient.invalidateQueries({ queryKey: ['supervisao-fila-envio'] });
    });
    return unsub;
  }, [queryClient]);

  const vendedoresMap = Object.fromEntries(vendedores.map(v => [v.id, v.nome]));

  const filaFiltrada = fila.filter(item => {
    const matchStatus = filtroStatus === 'todos' || item.status === filtroStatus;
    const matchVendedor = filtroVendedor === 'todos' || item.vendedor_id === filtroVendedor;
    const matchBusca = !busca ||
      item.cliente_nome?.toLowerCase().includes(busca.toLowerCase()) ||
      item.numero_pedido?.includes(busca) ||
      item.pedido_id?.includes(busca);
    return matchStatus && matchVendedor && matchBusca;
  });

  const counts = {
    pendente:    fila.filter(f => f.status === 'pendente').length,
    processando: fila.filter(f => f.status === 'processando').length,
    concluido:   fila.filter(f => f.status === 'concluido').length,
    erro:        fila.filter(f => f.status === 'erro').length,
  };

  const reprocessarErros = async () => {
    const erros = fila.filter(f => f.status === 'erro' && (f.tentativas || 0) < 3);
    if (erros.length === 0) { toast.info('Nenhum erro reprocessável'); return; }
    for (const item of erros) {
      await base44.entities.FilaEnvioPedidoOmie.update(item.id, { status: 'pendente', erro_log: null });
    }
    queryClient.invalidateQueries({ queryKey: ['supervisao-fila-envio'] });
    toast.success(`${erros.length} pedido(s) reenfileirado(s)`);
  };

  const processarFila = async () => {
    try {
      await base44.functions.invoke('processarFilaEnvioPedidoOmie', {});
      toast.success('Processamento da fila iniciado');
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['supervisao-fila-envio'] }), 3000);
    } catch (e) {
      toast.error('Erro ao acionar fila: ' + e.message);
    }
  };

  const ultimaAtt = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('pt-BR') : '--';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Supervisão — Fila de Envio ao Omie</h1>
          <p className="text-sm text-slate-500 mt-0.5">Atualizado às {ultimaAtt} · atualiza a cada 10s</p>
        </div>
        <div className="flex gap-2">
          {counts.erro > 0 && (
            <Button variant="outline" onClick={reprocessarErros} className="border-red-300 text-red-700 hover:bg-red-50">
              <RefreshCw className="w-4 h-4 mr-1" /> Reprocessar {counts.erro} erro(s)
            </Button>
          )}
          <Button onClick={processarFila} className="bg-green-600 hover:bg-green-700">
            <Play className="w-4 h-4 mr-1" /> Acionar Fila Agora
          </Button>
          <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ['supervisao-fila-envio'] })}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(counts).map(([status, count]) => {
          const cfg = STATUS_CONFIG[status];
          const Icon = cfg.icon;
          return (
            <Card
              key={status}
              className={`cursor-pointer border-2 transition-all ${filtroStatus === status ? 'ring-2 ring-slate-400' : ''}`}
              onClick={() => setFiltroStatus(filtroStatus === status ? 'todos' : status)}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg border ${cfg.color}`}>
                  <Icon className={`w-5 h-5 ${status === 'processando' ? 'animate-spin' : ''}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold">{count}</p>
                  <p className="text-xs text-slate-500">{cfg.label}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="Buscar cliente, nº pedido..." value={busca} onChange={e => setBusca(e.target.value)} className="pl-9" />
        </div>
        <Select value={filtroStatus} onValueChange={setFiltroStatus}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="pendente">Pendente</SelectItem>
            <SelectItem value="processando">Processando</SelectItem>
            <SelectItem value="concluido">Concluído</SelectItem>
            <SelectItem value="erro">Erro</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtroVendedor} onValueChange={setFiltroVendedor}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Vendedor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os vendedores</SelectItem>
            {vendedores.map(v => (
              <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-slate-600">
            {filaFiltrada.length} registro(s) exibido(s) de {fila.length} total
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando...
            </div>
          ) : filaFiltrada.length === 0 ? (
            <div className="text-center py-12 text-slate-400">Nenhum item encontrado</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Cliente</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Vendedor</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Nº Pedido</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Tentativas</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Cód. Omie</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Criado em</th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600">Erro</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filaFiltrada.map(item => {
                    const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pendente;
                    const Icon = cfg.icon;
                    const criadoEm = item.created_date ? new Date(item.created_date).toLocaleString('pt-BR') : '-';
                    return (
                      <tr key={item.id} className={`hover:bg-slate-50 ${item.status === 'erro' ? 'bg-red-50/40' : ''}`}>
                        <td className="px-4 py-3 font-medium">{item.cliente_nome || '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{vendedoresMap[item.vendedor_id] || item.vendedor_id?.slice(0,8) || '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{item.numero_pedido || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
                            <Icon className={`w-3 h-3 ${item.status === 'processando' ? 'animate-spin' : ''}`} />
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-slate-600">{item.tentativas ?? 0}</td>
                        <td className="px-4 py-3 text-slate-600 font-mono text-xs">{item.codigo_pedido_omie || '-'}</td>
                        <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{criadoEm}</td>
                        <td className="px-4 py-3 max-w-xs">
                          {item.erro_log && (
                            <div className="flex items-start gap-1">
                              <AlertCircle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
                              <span className="text-xs text-red-600 break-words">{item.erro_log}</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}