import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Loader2, Search, Send, RefreshCw, CheckCircle, XCircle, MapPin } from 'lucide-react';
import { toast } from 'sonner';

export default function EnviarRotasOmie() {
  const [clientes, setClientes] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState('');
  const [resultados, setResultados] = useState(null);

  const consolidar = async () => {
    setLoading(true);
    setResultados(null);
    const res = await base44.functions.invoke('enviarRotasCaractOmie', { action: 'consolidar' });
    setClientes(res.data.clientes || []);
    setStats({
      total: res.data.total_clientes,
      comRota: res.data.total_com_rota,
      semRota: res.data.total_sem_rota,
    });
    setSelectedIds((res.data.clientes || []).map(c => c.cliente_id));
    setLoading(false);
  };

  const enviar = async () => {
    if (selectedIds.length === 0) {
      toast.warning('Selecione ao menos um cliente');
      return;
    }
    setEnviando(true);
    setResultados(null);
    const res = await base44.functions.invoke('enviarRotasCaractOmie', {
      action: 'enviar',
      cliente_ids: selectedIds,
    });
    setResultados(res.data);
    setEnviando(false);
    if (res.data.total_erros === 0) {
      toast.success(`${res.data.total_enviados} cliente(s) enviado(s) com sucesso`);
    } else {
      toast.warning(`${res.data.total_enviados} sucesso, ${res.data.total_erros} erro(s)`);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map(c => c.cliente_id));
    }
  };

  const filtered = clientes.filter(c => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (c.razao_social || '').toLowerCase().includes(s) ||
      (c.nome_fantasia || '').toLowerCase().includes(s) ||
      (c.codigo || '').includes(s) ||
      (c.rota_nome || '').toLowerCase().includes(s);
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <MapPin className="w-5 h-5 text-amber-500" />
            Enviar Rotas ao Omie
          </h1>
          <p className="text-sm text-slate-500">Envia a característica "Rotas" para os clientes no Omie com base no cadastro do Base44</p>
        </div>
      </div>

      {/* Ações */}
      <div className="flex flex-wrap gap-2 items-center">
        <Button onClick={consolidar} disabled={loading} className="bg-amber-500 hover:bg-amber-600 text-white">
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
          Consolidar Dados
        </Button>

        {clientes.length > 0 && (
          <>
            <Button onClick={enviar} disabled={enviando || selectedIds.length === 0} className="bg-green-600 hover:bg-green-700 text-white">
              {enviando ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
              Enviar {selectedIds.length} Selecionado(s)
            </Button>
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 h-8 text-xs" />
            </div>
          </>
        )}
      </div>

      {enviando && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Enviando características para o Omie... Isso pode levar alguns minutos dependendo do volume de clientes.
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

      {/* Resultados do envio */}
      {resultados && (
        <div className="p-3 bg-white border rounded-lg space-y-2">
          <h3 className="font-semibold text-sm">Resultado do Envio</h3>
          <div className="flex gap-4 text-sm">
            <span className="text-green-600 font-medium">✓ {resultados.total_enviados} sucesso</span>
            <span className="text-red-600 font-medium">✗ {resultados.total_erros} erro(s)</span>
          </div>
          {resultados.total_erros > 0 && (
            <div className="max-h-40 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-red-50">
                  <tr>
                    <th className="p-1 text-left">Cliente</th>
                    <th className="p-1 text-left">Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {resultados.resultados.filter(r => r.erro).map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-1">{r.razao_social}</td>
                      <td className="p-1 text-red-600">{r.erro}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tabela de clientes */}
      {clientes.length > 0 && (
        <div className="border rounded-lg overflow-auto bg-white" style={{ maxHeight: '60vh' }}>
          <table className="w-full text-xs">
            <thead className="bg-slate-100 sticky top-0">
              <tr>
                <th className="p-2 w-8">
                  <Checkbox checked={filtered.length > 0 && selectedIds.length === filtered.length} onCheckedChange={toggleAll} />
                </th>
                <th className="p-2 text-left font-medium">Código</th>
                <th className="p-2 text-left font-medium">Razão Social</th>
                <th className="p-2 text-left font-medium">Fantasia</th>
                <th className="p-2 text-left font-medium">CPF/CNPJ</th>
                <th className="p-2 text-left font-medium">Rota</th>
                <th className="p-2 text-left font-medium">Status</th>
                <th className="p-2 text-left font-medium">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const resultado = resultados?.resultados?.find(r => r.cliente_id === c.cliente_id);
                return (
                  <tr key={c.cliente_id} className={`border-t hover:bg-slate-50 ${selectedIds.includes(c.cliente_id) ? 'bg-amber-50' : ''}`}>
                    <td className="p-2">
                      <Checkbox checked={selectedIds.includes(c.cliente_id)} onCheckedChange={() => toggleSelect(c.cliente_id)} />
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
                      {resultado && (
                        resultado.sucesso
                          ? <CheckCircle className="w-4 h-4 text-green-500" />
                          : <span className="text-red-500 text-[10px]" title={resultado.erro}><XCircle className="w-4 h-4 inline" /></span>
                      )}
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