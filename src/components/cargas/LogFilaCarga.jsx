import React, { useState, useMemo, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, CheckCircle2, XCircle, Clock, Zap, AlertTriangle, RefreshCw, Trash2, X, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';

const STATUS_CONFIG = {
  pendente:    { label: 'Pendente',    bg: 'bg-yellow-100 text-yellow-800', icon: Clock },
  processando: { label: 'Processando', bg: 'bg-blue-100 text-blue-800',    icon: Zap },
  concluido:   { label: 'Concluído',   bg: 'bg-green-100 text-green-800',  icon: CheckCircle2 },
  erro:        { label: 'Erro',        bg: 'bg-red-100 text-red-800',      icon: XCircle },
};

const fmt = (d) => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';

export default function LogFilaCarga() {
  const [itens, setItens] = useState([]);
  const [cargas, setCargas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroBusca, setFiltroBusca] = useState('');
  const [online, setOnline] = useState(true);
  const [modalOrfaos, setModalOrfaos] = useState(false);
  const [reenviando, setReenviando] = useState(null); // id do item ou 'carga:<numero>' em reenvio

  const reenviarItem = async (item) => {
    setReenviando(item.id);
    try {
      const res = await base44.functions.invoke('reenviarItemFilaCarga', { item_id: item.id });
      toast.success(res?.data?.mensagem || 'Pedido reenviado para processamento.');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Falha ao reenviar pedido.');
    } finally {
      setReenviando(null);
    }
  };

  const reenviarErrosDaCarga = async (carga_id, numero_carga) => {
    setReenviando(`carga:${numero_carga}`);
    try {
      const res = await base44.functions.invoke('reenviarItemFilaCarga', { carga_id, apenas_erros: true });
      toast.success(res?.data?.mensagem || 'Pedidos com erro reenviados.');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Falha ao reenviar pedidos.');
    } finally {
      setReenviando(null);
    }
  };

  const carregar = async () => {
    setCarregando(true);
    try {
      const [dados, cargasDados] = await Promise.all([
        base44.entities.FilaCargaOmie.list('-created_date', 500),
        base44.entities.Carga.list('-created_date', 1000),
      ]);
      setItens(dados);
      setCargas(cargasDados);
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

  // IDs de cargas existentes
  const cargaIdsExistentes = useMemo(() => new Set(cargas.map(c => c.id)), [cargas]);

  // Itens órfãos = carga_id não existe mais no banco
  const itensOrfaos = useMemo(() =>
    itens.filter(i => i.carga_id && !cargaIdsExistentes.has(i.carga_id)),
    [itens, cargaIdsExistentes]
  );

  // Agrupar órfãos por número de carga
  const orfaosPorCarga = useMemo(() => {
    const map = {};
    for (const i of itensOrfaos) {
      const key = i.numero_carga || i.carga_id;
      if (!map[key]) map[key] = [];
      map[key].push(i);
    }
    return map;
  }, [itensOrfaos]);

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
        String(item.codigo_pedido_omie || '').toLowerCase().includes(t)
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
        <div className="flex gap-2">
          {contadores.erro > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50"
              disabled={reenviando === 'carga:todos'}
              onClick={async () => {
                // Reenvia todos os itens com erro de todas as cargas (cada um pela sua carga)
                const errosPorCarga = {};
                itens.filter(i => i.status === 'erro' && i.carga_id).forEach(i => { errosPorCarga[i.carga_id] = i.numero_carga; });
                setReenviando('carga:todos');
                try {
                  let total = 0;
                  for (const [cid, num] of Object.entries(errosPorCarga)) {
                    const res = await base44.functions.invoke('reenviarItemFilaCarga', { carga_id: cid, apenas_erros: true });
                    total += res?.data?.reenfileirados || 0;
                  }
                  toast.success(`${total} pedido(s) com erro reenviado(s) para processamento.`);
                } catch (e) {
                  toast.error(e?.response?.data?.error || 'Falha ao reenviar pedidos.');
                } finally {
                  setReenviando(null);
                }
              }}
            >
              <RotateCw className={`w-3 h-3 mr-1 ${reenviando === 'carga:todos' ? 'animate-spin' : ''}`} />
              Reenviar {contadores.erro} com erro
            </Button>
          )}
          {itensOrfaos.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs border-orange-300 text-orange-700 hover:bg-orange-50" onClick={() => setModalOrfaos(true)}>
              <Trash2 className="w-3 h-3 mr-1" />
              {itensOrfaos.length} órfão{itensOrfaos.length > 1 ? 's' : ''} (cargas excluídas)
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={carregar} disabled={carregando}>
            <RefreshCw className={`w-3 h-3 mr-1 ${carregando ? 'animate-spin' : ''}`} /> Recarregar
          </Button>
        </div>
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
                Carga <b>{item.numero_carga}</b> · {item.numero_pedido ? formatarNumeroPedido(item.numero_pedido) : (item.codigo_pedido_omie || '—')}
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
          placeholder="Buscar por carga ou pedido..."
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
                <th className="text-left px-3 py-2 font-medium w-[95px]">Status</th>
                <th className="text-center px-3 py-2 font-medium w-[50px]">Tent.</th>
                <th className="text-left px-3 py-2 font-medium w-[125px]">Criado</th>
                <th className="text-left px-3 py-2 font-medium w-[125px]">Processado</th>
                <th className="text-left px-3 py-2 font-medium">Erro</th>
                <th className="text-center px-3 py-2 font-medium w-[90px]">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtrados.map(item => {
                const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pendente;
                const Icon = cfg.icon;
                const isOrfao = item.carga_id && !cargaIdsExistentes.has(item.carga_id);
                return (
                  <tr key={item.id} className={
                    item.status === 'processando' ? 'bg-blue-50/60' :
                    isOrfao ? 'bg-orange-50/50' :
                    'hover:bg-slate-50'
                  }>
                    <td className="px-3 py-2 font-mono font-semibold text-slate-700">
                      {item.numero_carga || '—'}
                      {isOrfao && <span className="ml-1 text-orange-400" title="Carga excluída">✕</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600">{item.numero_pedido ? formatarNumeroPedido(item.numero_pedido) : (item.codigo_pedido_omie || '—')}</td>
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
                    <td className="px-3 py-2 text-center">
                      {item.status !== 'concluido' && item.status !== 'processando' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px] border-amber-300 text-amber-700 hover:bg-amber-50"
                          disabled={reenviando === item.id}
                          onClick={() => reenviarItem(item)}
                          title="Reenviar este pedido para o Omie (mesma carga)"
                        >
                          <RotateCw className={`w-3 h-3 mr-1 ${reenviando === item.id ? 'animate-spin' : ''}`} />
                          Reenviar
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de itens órfãos */}
      <Dialog open={modalOrfaos} onOpenChange={setModalOrfaos}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-700">
              <Trash2 className="w-5 h-5" />
              Pedidos de Cargas Excluídas ({itensOrfaos.length} registros)
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500 -mt-2">
            Estes registros pertencem a cargas que foram excluídas do sistema. Os pedidos abaixo existiram na fila mas a carga-mãe não existe mais.
          </p>
          <div className="space-y-3 mt-2">
            {Object.entries(orfaosPorCarga).map(([numeroCarga, pedidos]) => (
              <div key={numeroCarga} className="rounded-lg border border-orange-200 bg-orange-50">
                <div className="px-3 py-2 border-b border-orange-200 flex items-center justify-between">
                  <span className="text-sm font-semibold text-orange-800">
                    Carga {numeroCarga} — excluída
                  </span>
                  <Badge className="bg-orange-100 text-orange-700 text-[10px] border-0">
                    {pedidos.length} pedido{pedidos.length > 1 ? 's' : ''}
                  </Badge>
                </div>
                <div className="divide-y divide-orange-100">
                  {pedidos.map(item => {
                    const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pendente;
                    const Icon = cfg.icon;
                    return (
                      <div key={item.id} className="px-3 py-2 flex items-center gap-3 text-xs">
                        <span className="font-mono text-slate-700 w-20">{item.numero_pedido ? formatarNumeroPedido(item.numero_pedido) : (item.codigo_pedido_omie || '—')}</span>
                        <Badge className={`${cfg.bg} text-[10px] flex items-center gap-1 border-0`}>
                          <Icon className="w-3 h-3" />
                          {cfg.label}
                        </Badge>
                        <span className="text-slate-400">{fmt(item.created_date)}</span>
                        {item.erro_log && (
                          <span className="text-red-500 truncate flex-1" title={item.erro_log}>
                            <AlertTriangle className="w-3 h-3 inline mr-1" />{item.erro_log}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}