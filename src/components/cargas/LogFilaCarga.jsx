import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, RefreshCw, CheckCircle2, XCircle, Clock, Loader, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const STATUS_CONFIG = {
  pendente:     { label: 'Pendente',     className: 'bg-yellow-100 text-yellow-800', icon: Clock },
  processando:  { label: 'Processando',  className: 'bg-blue-100 text-blue-800',    icon: Loader },
  concluido:    { label: 'Concluído',    className: 'bg-green-100 text-green-800',  icon: CheckCircle2 },
  erro:         { label: 'Erro',         className: 'bg-red-100 text-red-800',      icon: XCircle },
};

export default function LogFilaCarga() {
  const [filtroCarga, setFiltroCarga] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');

  const { data: itens = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['log-fila-carga'],
    queryFn: () => base44.entities.FilaCargaOmie.list('-created_date', 500),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false
  });

  const itensFiltrados = useMemo(() => {
    return itens.filter(item => {
      if (filtroStatus && item.status !== filtroStatus) return false;
      if (filtroCarga.trim()) {
        const termo = filtroCarga.trim().toLowerCase();
        if (
          !String(item.numero_carga || '').toLowerCase().includes(termo) &&
          !String(item.numero_pedido || '').toLowerCase().includes(termo) &&
          !String(item.cliente_nome || '').toLowerCase().includes(termo)
        ) return false;
      }
      return true;
    });
  }, [itens, filtroStatus, filtroCarga]);

  const contadores = useMemo(() => ({
    pendente: itens.filter(i => i.status === 'pendente').length,
    processando: itens.filter(i => i.status === 'processando').length,
    concluido: itens.filter(i => i.status === 'concluido').length,
    erro: itens.filter(i => i.status === 'erro').length,
  }), [itens]);

  const formatDate = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
          const Icon = cfg.icon;
          return (
            <button
              key={key}
              onClick={() => setFiltroStatus(filtroStatus === key ? '' : key)}
              className={`rounded-lg border p-3 text-left transition-all hover:shadow-sm ${filtroStatus === key ? 'ring-2 ring-offset-1 ring-slate-400' : ''} ${cfg.className} bg-opacity-50`}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4" />
                <span className="text-xs font-medium">{cfg.label}</span>
              </div>
              <div className="text-2xl font-bold mt-1">{contadores[key]}</div>
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <Label className="text-xs">Buscar (carga / pedido / cliente)</Label>
          <Input
            placeholder="Ex: 165, 00001, Mercadinho..."
            value={filtroCarga}
            onChange={e => setFiltroCarga(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Status</Label>
          <select
            value={filtroStatus}
            onChange={e => setFiltroStatus(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Todos</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="h-8">
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      <div className="text-xs text-slate-500">{itensFiltrados.length} de {itens.length} registros</div>

      {/* Tabela */}
      {isLoading ? (
        <div className="py-12 text-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
      ) : itensFiltrados.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm">Nenhum item encontrado</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-slate-600 w-[70px]">Carga</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 w-[90px]">Pedido</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Cliente</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 w-[80px]">Operação</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 w-[90px]">Status</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 w-[40px] text-center">Tent.</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 w-[120px]">Criado em</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 w-[120px]">Processado em</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Erro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {itensFiltrados.map(item => {
                const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pendente;
                const Icon = cfg.icon;
                return (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono font-semibold text-slate-700">{item.numero_carga || '—'}</td>
                    <td className="px-3 py-2 font-mono text-slate-600">{item.numero_pedido || '—'}</td>
                    <td className="px-3 py-2 text-slate-700 max-w-[160px] truncate" title={item.cliente_nome}>{item.cliente_nome || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{item.operacao || '—'}</td>
                    <td className="px-3 py-2">
                      <Badge className={`${cfg.className} text-[10px] flex items-center gap-1 w-fit`}>
                        <Icon className="w-3 h-3" />
                        {cfg.label}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-center text-slate-600">{item.tentativas ?? 0}</td>
                    <td className="px-3 py-2 text-slate-500">{formatDate(item.created_date)}</td>
                    <td className="px-3 py-2 text-slate-500">{formatDate(item.processado_em)}</td>
                    <td className="px-3 py-2 text-red-600 max-w-[200px]">
                      {item.erro_log ? (
                        <span title={item.erro_log} className="truncate block max-w-[180px]">
                          <AlertTriangle className="w-3 h-3 inline mr-1" />{item.erro_log}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}