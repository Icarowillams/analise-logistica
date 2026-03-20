import React, { useState, useMemo, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Loader2, Search, Send, RefreshCw, CheckCircle, XCircle, MapPin,
  Square, AlertTriangle, Ban
} from 'lucide-react';
import { toast } from 'sonner';

const BATCH_SIZE = 20;

export default function EnviarRotasOmie() {
  const [clientes, setClientes] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState('');

  // Envio em lotes
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState({ total: 0, processados: 0, sucesso: 0, erros: 0, loteAtual: 0, totalLotes: 0 });
  const [resultadosMap, setResultadosMap] = useState({}); // { [cliente_id]: { sucesso: true } | { erro: 'msg' } }
  const [errosLog, setErrosLog] = useState([]);
  const cancelarRef = useRef(false);

  const consolidar = async () => {
    setLoading(true);
    setResultadosMap({});
    setErrosLog([]);
    setProgresso({ total: 0, processados: 0, sucesso: 0, erros: 0, loteAtual: 0, totalLotes: 0 });
    const res = await base44.functions.invoke('enviarRotasCaractOmie', { action: 'consolidar' });
    const data = res.data;
    setClientes(data.clientes || []);
    setStats({
      total: data.total_clientes,
      comRota: data.total_com_rota,
      semRota: data.total_sem_rota,
    });
    setSelectedIds((data.clientes || []).map(c => c.cliente_id));
    setLoading(false);
  };

  const enviar = async () => {
    if (selectedIds.length === 0) {
      toast.warning('Selecione ao menos um cliente');
      return;
    }

    cancelarRef.current = false;
    setEnviando(true);
    setResultadosMap({});
    setErrosLog([]);

    // Montar lista com dados necessários
    const clientesMap = {};
    clientes.forEach(c => { clientesMap[c.cliente_id] = c; });
    const lista = selectedIds
      .map(id => clientesMap[id])
      .filter(Boolean)
      .map(c => ({ cliente_id: c.cliente_id, rota_nome: c.rota_nome, razao_social: c.razao_social }));

    const totalLotes = Math.ceil(lista.length / BATCH_SIZE);
    setProgresso({ total: lista.length, processados: 0, sucesso: 0, erros: 0, loteAtual: 0, totalLotes });

    let totalSucesso = 0;
    let totalErros = 0;

    for (let i = 0; i < lista.length; i += BATCH_SIZE) {
      if (cancelarRef.current) {
        toast.info('Envio cancelado pelo usuário');
        break;
      }

      const loteNum = Math.floor(i / BATCH_SIZE) + 1;
      const lote = lista.slice(i, i + BATCH_SIZE);

      setProgresso(prev => ({ ...prev, loteAtual: loteNum }));

      try {
        const res = await base44.functions.invoke('enviarRotasCaractOmie', {
          action: 'enviar_lote',
          cliente_ids: lote.map(c => ({ cliente_id: c.cliente_id, rota_nome: c.rota_nome })),
        });

        const data = res.data;
        totalSucesso += data.total_enviados || 0;
        totalErros += data.total_erros || 0;

        // Atualizar resultados individuais
        const newResults = {};
        const newErros = [];
        (data.resultados || []).forEach(r => {
          newResults[r.cliente_id] = r.sucesso ? { sucesso: true } : { erro: r.erro };
          if (r.erro) {
            const clienteInfo = lista.find(c => c.cliente_id === r.cliente_id);
            newErros.push({ cliente_id: r.cliente_id, razao_social: clienteInfo?.razao_social || r.cliente_id, erro: r.erro });
          }
        });

        setResultadosMap(prev => ({ ...prev, ...newResults }));
        if (newErros.length > 0) {
          setErrosLog(prev => [...prev, ...newErros]);
        }
      } catch (e) {
        // Marcar todo o lote como erro
        totalErros += lote.length;
        const newResults = {};
        const newErros = [];
        lote.forEach(c => {
          newResults[c.cliente_id] = { erro: e.message || 'Erro de rede' };
          newErros.push({ cliente_id: c.cliente_id, razao_social: c.razao_social, erro: e.message || 'Erro de rede' });
        });
        setResultadosMap(prev => ({ ...prev, ...newResults }));
        setErrosLog(prev => [...prev, ...newErros]);
      }

      const processados = Math.min(i + BATCH_SIZE, lista.length);
      setProgresso(prev => ({
        ...prev,
        processados,
        sucesso: totalSucesso,
        erros: totalErros,
      }));
    }

    setEnviando(false);

    if (cancelarRef.current) return;

    if (totalErros === 0) {
      toast.success(`${totalSucesso} cliente(s) enviado(s) com sucesso!`);
    } else {
      toast.warning(`${totalSucesso} sucesso, ${totalErros} erro(s)`);
    }
  };

  const cancelarEnvio = () => {
    cancelarRef.current = true;
  };

  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  const filtered = useMemo(() => {
    return clientes.filter(c => {
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return (c.razao_social || '').toLowerCase().includes(s) ||
        (c.nome_fantasia || '').toLowerCase().includes(s) ||
        (c.codigo || '').includes(s) ||
        (c.rota_nome || '').toLowerCase().includes(s);
    });
  }, [clientes, search]);

  const toggleAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map(c => c.cliente_id));
    }
  };

  const progressPercent = progresso.total > 0 ? Math.round((progresso.processados / progresso.total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <MapPin className="w-5 h-5 text-amber-500" />
          Enviar Rotas ao Omie
        </h1>
        <p className="text-sm text-slate-500">
          Envia a característica "Rotas" para os clientes no Omie via API (AlterarCaractCliente / IncluirCaractCliente)
        </p>
      </div>

      {/* Ações */}
      <div className="flex flex-wrap gap-2 items-center">
        <Button onClick={consolidar} disabled={loading || enviando} className="bg-amber-500 hover:bg-amber-600 text-white">
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
          Consolidar Dados
        </Button>

        {clientes.length > 0 && !enviando && (
          <>
            <Button onClick={enviar} disabled={selectedIds.length === 0} className="bg-green-600 hover:bg-green-700 text-white">
              <Send className="w-4 h-4 mr-1" />
              Enviar {selectedIds.length} Selecionado(s)
            </Button>
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 h-8 text-xs" />
            </div>
          </>
        )}

        {enviando && (
          <Button onClick={cancelarEnvio} variant="destructive" size="sm">
            <Ban className="w-4 h-4 mr-1" />
            Cancelar Envio
          </Button>
        )}
      </div>

      {/* Progresso do envio */}
      {(enviando || progresso.processados > 0) && progresso.total > 0 && (
        <div className="p-4 bg-white border rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              {enviando && <Loader2 className="w-4 h-4 animate-spin text-amber-500" />}
              {enviando ? 'Enviando...' : 'Envio Concluído'}
            </h3>
            <span className="text-xs text-slate-500">
              Lote {progresso.loteAtual} de {progresso.totalLotes}
            </span>
          </div>

          <Progress value={progressPercent} className="h-3" />

          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-600">
              {progresso.processados} / {progresso.total} processados ({progressPercent}%)
            </span>
            <div className="flex gap-3">
              <span className="text-green-600 font-medium flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> {progresso.sucesso}
              </span>
              <span className="text-red-600 font-medium flex items-center gap-1">
                <XCircle className="w-3 h-3" /> {progresso.erros}
              </span>
            </div>
          </div>

          {enviando && (
            <p className="text-[10px] text-slate-400">
              Processando em lotes de {BATCH_SIZE} clientes com intervalo de 350ms (rate limit Omie)...
            </p>
          )}
        </div>
      )}

      {/* Erros detalhados */}
      {errosLog.length > 0 && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-2">
          <h3 className="font-semibold text-sm text-red-800 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" />
            {errosLog.length} Erro(s)
          </h3>
          <div className="max-h-40 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-red-100 sticky top-0">
                <tr>
                  <th className="p-1.5 text-left font-medium text-red-800">Cliente</th>
                  <th className="p-1.5 text-left font-medium text-red-800">Erro</th>
                </tr>
              </thead>
              <tbody>
                {errosLog.map((r, i) => (
                  <tr key={i} className="border-t border-red-100">
                    <td className="p-1.5 text-red-700">{r.razao_social}</td>
                    <td className="p-1.5 text-red-600">{r.erro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border rounded-lg p-3 text-center">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-xs text-slate-500">Total Clientes</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-700">{stats.comRota}</div>
            <div className="text-xs text-green-600">Com Rota</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-700">{stats.semRota}</div>
            <div className="text-xs text-red-600">Sem Rota</div>
          </div>
        </div>
      )}

      {/* Tabela de clientes */}
      {clientes.length > 0 && (
        <div className="border rounded-lg overflow-auto bg-white" style={{ maxHeight: '55vh' }}>
          <table className="w-full text-xs">
            <thead className="bg-slate-100 sticky top-0">
              <tr>
                <th className="p-2 w-8">
                  <Checkbox
                    checked={filtered.length > 0 && selectedIds.length === filtered.length}
                    onCheckedChange={toggleAll}
                    disabled={enviando}
                  />
                </th>
                <th className="p-2 text-left font-medium">Código</th>
                <th className="p-2 text-left font-medium">Razão Social</th>
                <th className="p-2 text-left font-medium">Fantasia</th>
                <th className="p-2 text-left font-medium">CPF/CNPJ</th>
                <th className="p-2 text-left font-medium">Rota</th>
                <th className="p-2 text-left font-medium">Status</th>
                <th className="p-2 text-left font-medium w-20">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const resultado = resultadosMap[c.cliente_id];
                return (
                  <tr
                    key={c.cliente_id}
                    className={`border-t hover:bg-slate-50 ${
                      resultado?.sucesso ? 'bg-green-50/50' :
                      resultado?.erro ? 'bg-red-50/50' :
                      selectedIds.includes(c.cliente_id) ? 'bg-amber-50' : ''
                    }`}
                  >
                    <td className="p-2">
                      <Checkbox
                        checked={selectedIds.includes(c.cliente_id)}
                        onCheckedChange={() => toggleSelect(c.cliente_id)}
                        disabled={enviando}
                      />
                    </td>
                    <td className="p-2">{c.codigo || '-'}</td>
                    <td className="p-2 max-w-[200px] truncate">{c.razao_social}</td>
                    <td className="p-2 max-w-[150px] truncate">{c.nome_fantasia || '-'}</td>
                    <td className="p-2">{c.cpf_cnpj || '-'}</td>
                    <td className="p-2">
                      <Badge className="bg-blue-100 text-blue-800 border-blue-300 border text-[10px]">{c.rota_nome}</Badge>
                    </td>
                    <td className="p-2 capitalize">{c.status || '-'}</td>
                    <td className="p-2">
                      {resultado ? (
                        resultado.sucesso ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <span className="text-red-500" title={resultado.erro}>
                            <XCircle className="w-4 h-4" />
                          </span>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {clientes.length > 0 && (
        <div className="text-xs text-slate-500">
          {filtered.length} cliente(s) com rota • {selectedIds.length} selecionado(s)
        </div>
      )}
    </div>
  );
}