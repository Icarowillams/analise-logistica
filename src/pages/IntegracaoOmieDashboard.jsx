import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Activity, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Plug, Zap, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import SaudeIntegracaoOmie from '@/components/integracao/SaudeIntegracaoOmie';

export default function IntegracaoOmieDashboard() {
  const qc = useQueryClient();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState('all');
  const [filtroCall, setFiltroCall] = useState('');
  const [logDetalhe, setLogDetalhe] = useState(null);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['logsOmie'],
    queryFn: () => base44.entities.LogIntegracaoOmie.list('-created_date', 200),
    refetchInterval: 10000
  });

  const stats = useMemo(() => {
    const ultimas24h = logs.filter(l => {
      const d = new Date(l.created_date);
      return Date.now() - d.getTime() < 24 * 60 * 60 * 1000;
    });
    const sucessos = ultimas24h.filter(l => l.status === 'sucesso').length;
    const erros = ultimas24h.filter(l => l.status === 'erro').length;
    const totalMs = ultimas24h.reduce((acc, l) => acc + (l.duracao_ms || 0), 0);
    const avgMs = ultimas24h.length ? Math.round(totalMs / ultimas24h.length) : 0;
    return {
      total: ultimas24h.length,
      sucessos,
      erros,
      taxa: ultimas24h.length ? Math.round((sucessos / ultimas24h.length) * 100) : 100,
      avgMs
    };
  }, [logs]);

  const logsFiltrados = useMemo(() => {
    return logs.filter(l => {
      if (filtroStatus !== 'all' && l.status !== filtroStatus) return false;
      if (filtroCall && !l.call?.toLowerCase().includes(filtroCall.toLowerCase())) return false;
      return true;
    });
  }, [logs, filtroStatus, filtroCall]);

  const testarConexao = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await base44.functions.invoke('testarConexaoOmie', {});
      setTestResult(res.data);
      if (res.data?.ok) {
        toast.success('✅ Conexão Omie OK!');
      } else {
        toast.error('❌ ' + (res.data?.error || 'Falha'));
      }
      qc.invalidateQueries(['logsOmie']);
    } catch (e) {
      // Axios joga erro quando status != 2xx — precisamos ler o payload para ver o diagnóstico
      const payload = e?.response?.data || { ok: false, error: e.message };
      setTestResult(payload);
      toast.error('❌ ' + (payload.error || e.message));
    } finally {
      setTesting(false);
    }
  };

  const statusColor = (s) => ({
    sucesso: 'bg-green-100 text-green-700 border-green-300',
    erro: 'bg-red-100 text-red-700 border-red-300',
    warning: 'bg-amber-100 text-amber-700 border-amber-300'
  }[s] || 'bg-slate-100 text-slate-600');

  const formatDate = (d) => new Date(d).toLocaleString('pt-BR');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg">
            <Plug className="h-6 w-6 text-neutral-900" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Integração Omie</h1>
            <p className="text-sm text-neutral-500">Monitoramento e auditoria de chamadas</p>
          </div>
        </div>
        <Button onClick={testarConexao} disabled={testing} className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold">
          {testing ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
          Testar Conexão
        </Button>
      </div>

      {testResult && (
        <Card className={testResult.ok ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'}>
          <CardContent className="pt-4">
            {testResult.ok ? (
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <p className="font-semibold text-green-900">Conexão estabelecida com sucesso!</p>
                  <p className="text-sm text-green-800 mt-1">
                    <strong>{testResult.empresa?.razao_social}</strong> · CNPJ: {testResult.empresa?.cnpj} · {testResult.duracao_ms}ms
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold text-red-900">Falha na conexão</p>
                  <p className="text-sm text-red-800 mt-1">{testResult.error}</p>
                  {testResult.code && <p className="text-xs text-red-700 mt-1">Código: {testResult.code}</p>}
                  {testResult.debug && (
                    <div className="mt-3 p-3 bg-red-100 border border-red-300 rounded text-xs text-red-900 space-y-1">
                      <p className="font-semibold">Diagnóstico:</p>
                      <p>• OMIE_APP_KEY presente no ambiente: <strong>{String(testResult.debug.appKey_presente)}</strong></p>
                      <p>• OMIE_APP_SECRET presente no ambiente: <strong>{String(testResult.debug.appSecret_presente)}</strong></p>
                      <p>• Vars OMIE visíveis: <code>{(testResult.debug.env_vars_omie || []).join(', ') || '(nenhuma)'}</code></p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <SaudeIntegracaoOmie />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-500 uppercase">Total (24h)</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{stats.total}</p>
              </div>
              <Activity className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-500 uppercase">Sucessos</p>
                <p className="text-2xl font-bold text-green-600 mt-1">{stats.sucessos}</p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-500 uppercase">Erros</p>
                <p className="text-2xl font-bold text-red-600 mt-1">{stats.erros}</p>
                <p className="text-xs text-slate-500 mt-1">Taxa sucesso: {stats.taxa}%</p>
              </div>
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-500 uppercase">Tempo médio</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{stats.avgMs}ms</p>
              </div>
              <Clock className="w-8 h-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Logs recentes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 mb-4 flex-wrap">
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="sucesso">Sucesso</SelectItem>
                <SelectItem value="erro">Erro</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Filtrar por call (ex: UpsertCliente)"
              value={filtroCall}
              onChange={e => setFiltroCall(e.target.value)}
              className="max-w-xs"
            />
            <Button variant="outline" onClick={() => qc.invalidateQueries(['logsOmie'])}>
              <RefreshCw className="w-4 h-4 mr-2" /> Atualizar
            </Button>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left p-2 text-xs font-semibold text-slate-600">Data</th>
                  <th className="text-left p-2 text-xs font-semibold text-slate-600">Call</th>
                  <th className="text-left p-2 text-xs font-semibold text-slate-600">Operação</th>
                  <th className="text-left p-2 text-xs font-semibold text-slate-600">Status</th>
                  <th className="text-left p-2 text-xs font-semibold text-slate-600">Duração</th>
                  <th className="text-left p-2 text-xs font-semibold text-slate-600">Erro</th>
                  <th className="text-left p-2 text-xs font-semibold text-slate-600">Usuário</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={7} className="p-4 text-center text-slate-400">Carregando…</td></tr>
                )}
                {!isLoading && logsFiltrados.length === 0 && (
                  <tr><td colSpan={7} className="p-8 text-center text-slate-400">Nenhum log encontrado</td></tr>
                )}
                {logsFiltrados.map(l => (
                  <tr key={l.id} className="border-b hover:bg-amber-50 cursor-pointer" onClick={() => setLogDetalhe(l)}>
                    <td className="p-2 text-xs text-slate-600 whitespace-nowrap">{formatDate(l.created_date)}</td>
                    <td className="p-2 font-mono text-xs">{l.call}</td>
                    <td className="p-2 text-xs text-slate-600">{l.operacao || '-'}</td>
                    <td className="p-2"><Badge className={statusColor(l.status)}>{l.status}</Badge></td>
                    <td className="p-2 text-xs text-slate-500">{l.duracao_ms ? `${l.duracao_ms}ms` : '-'}</td>
                    <td className="p-2 text-xs text-red-600 max-w-xs truncate">{l.mensagem_erro || '-'}</td>
                    <td className="p-2 text-xs text-slate-500">{l.usuario_email || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog detalhe log */}
      <Dialog open={!!logDetalhe} onOpenChange={(o) => !o && setLogDetalhe(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {logDetalhe?.status === 'sucesso' ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <AlertTriangle className="w-5 h-5 text-red-600" />}
              {logDetalhe?.call}
            </DialogTitle>
          </DialogHeader>
          {logDetalhe && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-slate-500">Endpoint:</span> <code className="text-xs">{logDetalhe.endpoint}</code></div>
                <div><span className="text-slate-500">Operação:</span> {logDetalhe.operacao || '-'}</div>
                <div><span className="text-slate-500">Status:</span> <Badge className={statusColor(logDetalhe.status)}>{logDetalhe.status}</Badge></div>
                <div><span className="text-slate-500">Duração:</span> {logDetalhe.duracao_ms}ms · {logDetalhe.tentativas} tentativa(s)</div>
                <div><span className="text-slate-500">Entidade:</span> {logDetalhe.entidade_tipo || '-'} {logDetalhe.entidade_id ? `(${logDetalhe.entidade_id})` : ''}</div>
                <div><span className="text-slate-500">Usuário:</span> {logDetalhe.usuario_email || '-'}</div>
              </div>
              {logDetalhe.mensagem_erro && (
                <div className="p-3 bg-red-50 border border-red-200 rounded">
                  <p className="text-xs font-semibold text-red-800">Erro {logDetalhe.codigo_erro}</p>
                  <p className="text-sm text-red-700 mt-1">{logDetalhe.mensagem_erro}</p>
                </div>
              )}
              {logDetalhe.payload_enviado && (
                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-1">Payload enviado</p>
                  <pre className="p-2 bg-slate-900 text-slate-100 rounded text-xs overflow-x-auto max-h-60">{logDetalhe.payload_enviado}</pre>
                </div>
              )}
              {logDetalhe.payload_resposta && (
                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-1">Resposta Omie</p>
                  <pre className="p-2 bg-slate-900 text-slate-100 rounded text-xs overflow-x-auto max-h-60">{logDetalhe.payload_resposta}</pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}