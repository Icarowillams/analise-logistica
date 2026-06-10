import React, { useState, useMemo, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, RefreshCw, CheckCircle2, XCircle, Clock, Zap, AlertTriangle, Wifi, WifiOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const STATUS_CONFIG = {
  pendente:     { label: 'Pendente',    className: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: Clock },
  processando:  { label: 'Processando', className: 'bg-blue-100 text-blue-800 border-blue-200',    icon: Zap },
  concluido:    { label: 'Concluído',   className: 'bg-green-100 text-green-800 border-green-200', icon: CheckCircle2 },
  erro:         { label: 'Erro',        className: 'bg-red-100 text-red-800 border-red-200',       icon: XCircle },
};

const formatDate = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export default function LogFilaCarga() {
  const [itens, setItens] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [filtroCarga, setFiltroCarga] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [novosIds, setNovosIds] = useState(new Set());
  const novosTimers = useRef({});

  // Carga inicial
  const carregarItens = async () => {
    setIsLoading(true);
    try {
      const dados = await base44.entities.FilaCargaOmie.list('-created_date', 500);
      setItens(dados);
      setIsOnline(true);
    } catch (e) {
      setIsOnline(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    carregarItens();
  }, []);

  // Subscription em tempo real
  useEffect(() => {
    const unsubscribe = base44.entities.FilaCargaOmie.subscribe((event) => {
      setIsOnline(true);

      if (event.type === 'create') {
        setItens(prev => {
          // Evita duplicatas
          if (prev.find(i => i.id === event.id)) return prev;
          return [event.data, ...prev];
        });
        // Marca como "novo" por 4s para animar
        setNovosIds(prev => new Set([...prev, event.id]));
        if (novosTimers.current[event.id]) clearTimeout(novosTimers.current[event.id]);
        novosTimers.current[event.id] = setTimeout(() => {
          setNovosIds(prev => { const s = new Set(prev); s.delete(event.id); return s; });
        }, 4000);

      } else if (event.type === 'update') {
        setItens(prev => prev.map(i => i.id === event.id ? { ...i, ...event.data } : i));

      } else if (event.type === 'delete') {
        setItens(prev => prev.filter(i => i.id !== event.id));
      }
    });

    return () => {
      unsubscribe();
      Object.values(novosTimers.current).forEach(clearTimeout);
    };
  }, []);

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
    pendente:    itens.filter(i => i.status === 'pendente').length,
    processando: itens.filter(i => i.status === 'processando').length,
    concluido:   itens.filter(i => i.status === 'concluido').length,
    erro:        itens.filter(i => i.status === 'erro').length,
  }), [itens]);

  const emProcessamento = useMemo(() =>
    itens.filter(i => i.status === 'processando'),
  [itens]);

  return (
    <div className="space-y-4">

      {/* Header com indicador tempo real */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isOnline ? (
            <span className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block" />
              <Wifi className="w-3 h-3" />
              Tempo real ativo
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-1">
              <WifiOff className="w-3 h-3" />
              Sem conexão
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={carregarItens} disabled={isLoading} className="h-7 text-xs">
          <RefreshCw className={`w-3 h-3 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
          Recarregar
        </Button>
      </div>

      {/* Painel "Em processamento agora" */}
      {emProcessamento.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-blue-600 animate-pulse" />
            <span className="text-sm font-semibold text-blue-800">
              {emProcessamento.length} pedido{emProcessamento.length > 1 ? 's' : ''} sendo processado{emProcessamento.length > 1 ? 's' : ''} agora
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {emProcessamento.map(item => (
              <div key={item.id} className="flex items-center gap-2 bg-white border border-blue-200 rounded-md px-2.5 py-1.5 text-xs shadow-sm">
                <Loader2 className="w-3 h-3 text-blue-600 animate-spin flex-shrink-0" />
                <div>
                  <span className="font-bold text-blue-800">Carga {item.numero_carga}</span>
                  <span className="text-slate-400 mx-1">·</span>
                  <span className="font-mono text-slate-700">{item.numero_pedido || item.codigo_pedido_omie || '—'}</span>
                  {item.cliente_nome && (
                    <>
                      <span className="text-slate-400 mx-1">·</span>
                      <span className="text-slate-600 max-w-[120px] truncate">{item.cliente_nome}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cards de contagem */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
          const Icon = cfg.icon;
          const ativo = filtroStatus === key;
          return (
            <button
              key={key}
              onClick={() => setFiltroStatus(ativo ? '' : key)}
              className={`rounded-lg border p-3 text-left transition-all hover:shadow-sm ${cfg.className} ${ativo ? 'ring-2 ring-offset-1 ring-slate-500 shadow-md' : ''}`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`w-4 h-4 ${key === 'processando' && contadores[key] > 0 ? 'animate-pulse' : ''}`} />
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
                <th className="text-left px-3 py-2 font-medium text-slate-600 w-[110px]">Pedido</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Cliente</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 w-[80px]">Operação</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 w-[100px]">Status</th>
                <th className="text-center px-3 py-2 font-medium text-slate-600 w-[40px]">Tent.</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 w-[130px]">Criado</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600 w-[130px]">Processado</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Erro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {itensFiltrados.map(item => {
                const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pendente;
                const Icon = cfg.icon;
                const isNovo = novosIds.has(item.id);
                const isProcessando = item.status === 'processando';

                return (
                  <tr
                    key={item.id}
                    className={[
                      'transition-colors duration-700',
                      isNovo     ? 'bg-cyan-50 animate-pulse'  : '',
                      isProcessando && !isNovo ? 'bg-blue-50/50' : '',
                      !isNovo && !isProcessando ? 'hover:bg-slate-50' : ''
                    ].join(' ')}
                  >
                    <td className="px-3 py-2 font-mono font-semibold text-slate-700">{item.numero_carga || '—'}</td>
                    <td className="px-3 py-2 font-mono text-slate-600">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span>{item.numero_pedido || item.codigo_pedido_omie || '—'}</span>
                        {isProcessando && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-blue-600 font-medium bg-blue-50 border border-blue-200 rounded px-1 py-0.5">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" /> processando
                          </span>
                        )}
                        {isNovo && !isProcessando && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-cyan-700 font-medium bg-cyan-50 border border-cyan-200 rounded px-1 py-0.5">
                            novo
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-700 max-w-[160px] truncate" title={item.cliente_nome}>{item.cliente_nome || '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{item.operacao || '—'}</td>
                    <td className="px-3 py-2">
                      <Badge className={`${cfg.className} text-[10px] flex items-center gap-1 w-fit border`}>
                        <Icon className={`w-3 h-3 ${isProcessando ? 'animate-spin' : ''}`} />
                        {cfg.label}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-center text-slate-600">{item.tentativas ?? 0}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{formatDate(item.created_date)}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{formatDate(item.processado_em)}</td>
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