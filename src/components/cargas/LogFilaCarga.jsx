import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, CheckCircle2, XCircle, Clock, Zap, AlertTriangle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const STATUS_CONFIG = {
  pendente:    { label: 'Pendente',    bg: 'bg-yellow-100 text-yellow-800', icon: Clock },
  processando: { label: 'Processando', bg: 'bg-blue-100 text-blue-800',    icon: Zap },
  concluido:   { label: 'Concluído',   bg: 'bg-green-100 text-green-800',  icon: CheckCircle2 },
  erro:        { label: 'Erro',        bg: 'bg-red-100 text-red-800',      icon: XCircle },
};

const fmt = (d) => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

export default function LogFilaCarga() {
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroBusca, setFiltroBusca] = useState('');
  const [online, setOnline] = useState(true);

  const carregar = async () => {
    setCarregando(true);
    try {
      const dados = await base44.entities.FilaCargaOmie.list('-created_date', 500);
      setItens(dados);
      setOnline(true);
    } catch { setOnline(false); }
    finally { setCarregando(false); }
  };

  useEffect(() => { carregar(); }, []);

  // Tempo real via subscribe
  useEffect(() => {
    const unsub = base44.entities.FilaCargaOmie.subscribe((ev) => {
      setOnline(true);
      if (ev.type === 'create') {
        setItens(prev => prev.find(i => i.id === ev.id) ? prev : [ev.data, ...prev]);
      } else if (ev.type === 'update') {
        setItens(prev => prev.map(i => i.id === ev.id ? { ...i, ...ev.data } : i));
      } else if (ev.type === 'delete') {
        setItens(prev => prev.filter(i => i.id !== ev.id));
      }
    });
    return unsub;
  }, []);

  const contadores = useMemo(() => ({
    pendente:    itens.filter(i => i.status === 'pendente').length,
    processando: itens.filter(i => i.status === 'processando').length,
    concluido:   itens.filter(i => i.status === 'concluido').length,
    erro:        itens.filter(i => i.status === 'erro').length,
  }), [itens]);

  const emProcessamento = useMemo(() => itens.filter(i => i.status === 'processando'), [itens]);

  const filtrados = useMemo(() => itens.filter(item => {
    if (filtroStatus && item.status !== filtroStatus) return false;
    if (filtroBusca.trim()) {
      const t = filtroBusca.trim().toLowerCase();
      return (
        String(item.numero_carga || '').toLowerCase().includes(t) ||
        String(item.numero_pedido || '').toLowerCase().includes(t) ||
        String(item.cliente_nome || '').toLowerCase().includes(t)
      );
    }
    return true;
  }), [itens, filtroStatus, filtroBusca]);

  return (
    <div className="space-y-4">

      {/* Barra superior */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full inline-block ${online ? 'bg-green-500 animate-pulse' : 'bg-slate-400'}`} />
          <span className="text-xs text-slate-500">{online ? 'Atualização em tempo real' : 'Sem conexão'}</span>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={carregar} disabled={carregando}>
          <RefreshCw className={`w-3 h-3 mr-1 ${carregando ? 'animate-spin' : ''}`} /> Recarregar
        </Button>
      </div>

      {/* Sendo processado agora */}
      {emProcessamento.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
          <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-blue-800">
            <Loader2 className="w-4 h-4 animate-spin" />
            {emProcessamento.length} pedido{emProcessamento.length > 1 ? 's' : ''} sendo processado{emProcessamento.length > 1 ? 's' : ''} agora
          </div>
          <div className="flex flex-wrap gap-2">
            {emProcessamento.map(item => (
              <span key={item.id} className="text-xs bg-white border border-blue-200 rounded px-2 py-1 text-slate-700 font-mono">
                Carga <b>{item.numero_carga}</b> · {item.numero_pedido || item.codigo_pedido_omie || '—'}
                {item.cliente_nome ? ` · ${item.cliente_nome}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Contadores */}
      <div className="grid grid-cols-4 gap-2">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
          const Icon = cfg.icon;
          return (
            <button
              key={key}
              onClick={() => setFiltroStatus(filtroStatus === key ? '' : key)}
              className={`rounded-lg border px-3 py-2 text-left transition-all ${cfg.bg} ${filtroStatus === key ? 'ring-2 ring-slate-500 ring-offset-1' : 'opacity-80 hover:opacity-100'}`}
            >
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <Icon className="w-3.5 h-3.5" />
                {cfg.label}
              </div>
              <div className="text-xl font-bold mt-0.5">{contadores[key]}</div>
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="flex gap-2 items-center">
        <Input
          placeholder="Buscar por carga, pedido ou cliente..."
          value={filtroBusca}
          onChange={e => setFiltroBusca(e.target.value)}
          className="h-8 text-sm flex-1"
        />
        <select
          value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">Todos os status</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="text-xs text-slate-400">{filtrados.length} de {itens.length} registros</div>

      {/* Tabela */}
      {carregando ? (
        <div className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-slate-400" /></div>
      ) : filtrados.length === 0 ? (
        <div className="py-12 text-center text-sm text-slate-400">Nenhum item encontrado</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2 font-medium w-[65px]">Carga</th>
                <th className="text-left px-3 py-2 font-medium w-[100px]">Pedido</th>
                <th className="text-left px-3 py-2 font-medium">Cliente</th>
                <th className="text-left px-3 py-2 font-medium w-[95px]">Status</th>
                <th className="text-center px-3 py-2 font-medium w-[50px]">Tent.</th>
                <th className="text-left px-3 py-2 font-medium w-[125px]">Criado</th>
                <th className="text-left px-3 py-2 font-medium w-[125px]">Processado</th>
                <th className="text-left px-3 py-2 font-medium">Erro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtrados.map(item => {
                const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pendente;
                const Icon = cfg.icon;
                return (
                  <tr key={item.id} className={item.status === 'processando' ? 'bg-blue-50/60' : 'hover:bg-slate-50'}>
                    <td className="px-3 py-2 font-mono font-semibold text-slate-700">{item.numero_carga || '—'}</td>
                    <td className="px-3 py-2 font-mono text-slate-600">{item.numero_pedido || item.codigo_pedido_omie || '—'}</td>
                    <td className="px-3 py-2 text-slate-700 max-w-[160px] truncate" title={item.cliente_nome}>{item.cliente_nome || '—'}</td>
                    <td className="px-3 py-2">
                      <Badge className={`${cfg.bg} text-[10px] flex items-center gap-1 w-fit border-0`}>
                        <Icon className={`w-3 h-3 ${item.status === 'processando' ? 'animate-spin' : ''}`} />
                        {cfg.label}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-center text-slate-600">{item.tentativas ?? 0}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmt(item.created_date)}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmt(item.processado_em)}</td>
                    <td className="px-3 py-2 text-red-600 max-w-[200px]">
                      {item.erro_log
                        ? <span title={item.erro_log} className="truncate block max-w-[180px]"><AlertTriangle className="w-3 h-3 inline mr-1" />{item.erro_log}</span>
                        : '—'}
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