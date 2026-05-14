import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem
} from '@/components/ui/select';
import { RefreshCw, Loader2, CheckCircle2, XCircle, AlertCircle, ScrollText, X, Wand2 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

/**
 * Log de Emissão de NF-e — histórico persistente de TODAS as tentativas
 * de emissão feitas via Omie (autorizadas, rejeitadas, pendentes e erros).
 *
 * Lê da entidade LogEmissaoNF (uma linha por pedido emitido).
 * Mostra o motivo SEFAZ (xMotivo) e o cStat retornado.
 */
export default function LogEmissaoNFTab({ ativa = true }) {
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const [filtroCarga, setFiltroCarga] = useState('');
  const [filtroCodCliente, setFiltroCodCliente] = useState('');
  const [filtroFantasia, setFiltroFantasia] = useState('');
  const [filtroPedido, setFiltroPedido] = useState('');
  const [filtroNF, setFiltroNF] = useState('');
  const [dataIni, setDataIni] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [resolvendo, setResolvendo] = useState(false);

  const { data: logs = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['logEmissaoNF'],
    queryFn: () => base44.entities.LogEmissaoNF.list('-created_date', 500),
    enabled: ativa,
    staleTime: 15000
  });

  // Carrega Clientes para enriquecer com codigo_interno e nome_fantasia (join local)
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientesParaLogNF'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 5000),
    enabled: ativa,
    staleTime: 5 * 60 * 1000
  });

  const clientePorId = useMemo(() => {
    const m = new Map();
    clientes.forEach(c => m.set(c.id, c));
    return m;
  }, [clientes]);

  // Enriquece cada log com dados do cliente
  const logsEnriquecidos = useMemo(() => {
    return logs.map(l => {
      const c = l.cliente_id ? clientePorId.get(l.cliente_id) : null;
      return {
        ...l,
        codigo_interno: c?.codigo_interno || '',
        nome_fantasia: c?.nome_fantasia || ''
      };
    });
  }, [logs, clientePorId]);

  const limparFiltros = () => {
    setFiltroStatus('todos');
    setBusca('');
    setFiltroCarga('');
    setFiltroCodCliente('');
    setFiltroFantasia('');
    setFiltroPedido('');
    setFiltroNF('');
    setDataIni('');
    setDataFim('');
  };

  const logsFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const cargaT = filtroCarga.trim().toLowerCase();
    const codT = filtroCodCliente.trim().toLowerCase();
    const fantT = filtroFantasia.trim().toLowerCase();
    const pedT = filtroPedido.trim().toLowerCase();
    const nfT = filtroNF.trim().toLowerCase();
    const ini = dataIni ? new Date(dataIni + 'T00:00:00') : null;
    const fim = dataFim ? new Date(dataFim + 'T23:59:59') : null;

    return logsEnriquecidos.filter(l => {
      if (filtroStatus !== 'todos' && l.status !== filtroStatus) return false;

      if (cargaT && !String(l.numero_carga || '').toLowerCase().includes(cargaT)) return false;
      if (codT && String(l.codigo_interno || '').toLowerCase() !== codT) return false;
      if (fantT && !String(l.nome_fantasia || '').toLowerCase().includes(fantT)) return false;
      if (pedT && !String(l.numero_pedido || l.codigo_pedido || '').toLowerCase().includes(pedT)) return false;
      if (nfT && !String(l.numero_nf || '').toLowerCase().includes(nfT)) return false;

      if (ini || fim) {
        if (!l.created_date) return false;
        const d = new Date(l.created_date);
        if (ini && d < ini) return false;
        if (fim && d > fim) return false;
      }

      if (!termo) return true;
      return (
        String(l.numero_pedido || '').toLowerCase().includes(termo) ||
        String(l.codigo_pedido || '').toLowerCase().includes(termo) ||
        String(l.numero_nf || '').toLowerCase().includes(termo) ||
        String(l.cliente_nome || '').toLowerCase().includes(termo) ||
        String(l.nome_fantasia || '').toLowerCase().includes(termo) ||
        String(l.codigo_interno || '').toLowerCase().includes(termo) ||
        String(l.numero_carga || '').toLowerCase().includes(termo) ||
        String(l.mensagem || '').toLowerCase().includes(termo)
      );
    });
  }, [logsEnriquecidos, filtroStatus, busca, filtroCarga, filtroCodCliente, filtroFantasia, filtroPedido, filtroNF, dataIni, dataFim]);

  const stats = useMemo(() => {
    const s = { autorizada: 0, rejeitada: 0, pendente: 0, erro: 0 };
    logs.forEach(l => { if (s[l.status] !== undefined) s[l.status]++; });
    return s;
  }, [logs]);

  // Consulta ATIVAMENTE o Omie para resolver os logs pendentes (fallback do webhook)
  const resolverPendentes = async () => {
    setResolvendo(true);
    try {
      const resp = await base44.functions.invoke('atualizarStatusLogsPendentes', {});
      const r = resp?.data || {};
      if (r?.sucesso) {
        const partes = [];
        if (r.autorizados > 0) partes.push(`${r.autorizados} autorizada(s)`);
        if (r.rejeitados > 0) partes.push(`${r.rejeitados} rejeitada(s)`);
        if (r.ainda_pendentes > 0) partes.push(`${r.ainda_pendentes} ainda pendente(s)`);
        if (r.boletos_disparados > 0) partes.push(`${r.boletos_disparados} boleto(s) disparado(s)`);
        if (partes.length === 0) {
          toast.info('Nenhuma pendência para atualizar');
        } else {
          toast.success(`Processados ${r.processados} pedido(s): ${partes.join(', ')}`);
        }
        refetch();
      } else {
        toast.error('Erro: ' + (r?.error || 'falha desconhecida'));
      }
    } catch (e) {
      toast.error('Falha: ' + e.message);
    }
    setResolvendo(false);
  };

  const StatusBadge = ({ status }) => {
    if (status === 'autorizada') return <Badge className="bg-green-100 text-green-800 border-green-300"><CheckCircle2 className="w-3 h-3 mr-1" /> Autorizada</Badge>;
    if (status === 'rejeitada') return <Badge className="bg-red-100 text-red-800 border-red-300"><XCircle className="w-3 h-3 mr-1" /> Rejeitada</Badge>;
    if (status === 'pendente') return <Badge className="bg-amber-100 text-amber-800 border-amber-300"><AlertCircle className="w-3 h-3 mr-1" /> Pendente</Badge>;
    return <Badge className="bg-gray-200 text-gray-800 border-gray-400"><XCircle className="w-3 h-3 mr-1" /> Erro</Badge>;
  };

  return (
    <div className="space-y-4">
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="py-3 text-sm text-blue-900 flex items-start gap-2">
          <ScrollText className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <b>Log persistente de emissão.</b> Cada linha registra uma tentativa de emissão de NF-e — com o motivo retornado pela SEFAZ (autorizada, rejeitada com o xMotivo do erro, pendente ou erro de comunicação).
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-center">
          <div className="text-2xl font-bold text-green-700">{stats.autorizada}</div>
          <div className="text-xs text-green-600">Autorizadas</div>
        </div>
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-center">
          <div className="text-2xl font-bold text-red-700">{stats.rejeitada}</div>
          <div className="text-xs text-red-600">Rejeitadas</div>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-center">
          <div className="text-2xl font-bold text-amber-700">{stats.pendente}</div>
          <div className="text-xs text-amber-600">Pendentes</div>
        </div>
        <div className="rounded-lg bg-gray-100 border border-gray-300 p-3 text-center">
          <div className="text-2xl font-bold text-gray-700">{stats.erro}</div>
          <div className="text-xs text-gray-600">Erros</div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Histórico de emissões ({logsFiltrados.length})</span>
            <div className="flex gap-2">
              {stats.pendente > 0 && (
                <Button
                  size="sm"
                  className="bg-amber-500 hover:bg-amber-600 text-white"
                  onClick={resolverPendentes}
                  disabled={resolvendo}
                >
                  {resolvendo ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Wand2 className="w-4 h-4 mr-2" />}
                  Resolver {stats.pendente} pendente(s)
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                {isFetching ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Atualizar
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <Label>Buscar geral</Label>
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Cliente, mensagem, cStat..." />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="autorizada">Autorizadas</SelectItem>
                  <SelectItem value="rejeitada">Rejeitadas</SelectItem>
                  <SelectItem value="pendente">Pendentes</SelectItem>
                  <SelectItem value="erro">Erros</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Nº Carga</Label>
              <Input value={filtroCarga} onChange={(e) => setFiltroCarga(e.target.value)} placeholder="Ex: 009" />
            </div>
            <div>
              <Label>Cód. cliente (exato)</Label>
              <Input value={filtroCodCliente} onChange={(e) => setFiltroCodCliente(e.target.value)} placeholder="Ex: 1234" />
            </div>
            <div>
              <Label>Nome fantasia</Label>
              <Input value={filtroFantasia} onChange={(e) => setFiltroFantasia(e.target.value)} placeholder="Mercado X..." />
            </div>
            <div>
              <Label>Nº Pedido</Label>
              <Input value={filtroPedido} onChange={(e) => setFiltroPedido(e.target.value)} placeholder="Ex: 00005D" />
            </div>
            <div>
              <Label>Nº NF</Label>
              <Input value={filtroNF} onChange={(e) => setFiltroNF(e.target.value)} placeholder="Ex: 12345" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Emissão de</Label>
                <Input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} />
              </div>
              <div>
                <Label>até</Label>
                <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="flex justify-end mb-4">
            <Button size="sm" variant="ghost" onClick={limparFiltros}>
              <X className="w-4 h-4 mr-1" /> Limpar filtros
            </Button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-700">
                <tr>
                  <th className="p-2 text-left font-semibold">Data</th>
                  <th className="p-2 text-left font-semibold">Pedido</th>
                  <th className="p-2 text-left font-semibold">NF</th>
                  <th className="p-2 text-left font-semibold">Cliente</th>
                  <th className="p-2 text-left font-semibold">Carga</th>
                  <th className="p-2 text-center font-semibold">Status</th>
                  <th className="p-2 text-center font-semibold">cStat</th>
                  <th className="p-2 text-left font-semibold">Motivo / Mensagem SEFAZ</th>
                  <th className="p-2 text-left font-semibold">Usuário</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan="9" className="text-center py-12 text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Carregando histórico...
                  </td></tr>
                ) : logsFiltrados.length === 0 ? (
                  <tr><td colSpan="9" className="text-center py-12 text-slate-500">
                    Nenhum registro encontrado
                  </td></tr>
                ) : logsFiltrados.map((l) => (
                  <tr key={l.id} className="border-t hover:bg-slate-50/50 transition-colors">
                    <td className="p-2 text-xs whitespace-nowrap">
                      {l.created_date ? format(new Date(l.created_date), 'dd/MM/yyyy HH:mm') : '-'}
                    </td>
                    <td className="p-2 font-medium">{l.numero_pedido || l.codigo_pedido}</td>
                    <td className="p-2">
                      {l.numero_nf
                        ? <Badge className="bg-green-100 text-green-800 border-green-300">{l.numero_nf}</Badge>
                        : <span className="text-slate-400">—</span>
                      }
                      {l.boleto_gerado && <div className="text-xs text-blue-600 mt-0.5">+ boleto</div>}
                    </td>
                    <td className="p-2">
                      <div className="font-medium">{l.nome_fantasia || l.cliente_nome || '-'}</div>
                      {l.nome_fantasia && l.cliente_nome && (
                        <div className="text-xs text-slate-500">{l.cliente_nome}</div>
                      )}
                      {l.codigo_interno && (
                        <div className="text-xs text-slate-400 font-mono">cód {l.codigo_interno}</div>
                      )}
                    </td>
                    <td className="p-2">
                      {l.numero_carga ? <Badge variant="outline">{l.numero_carga}</Badge> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="p-2 text-center"><StatusBadge status={l.status} /></td>
                    <td className="p-2 text-center font-mono text-xs">{l.codigo_sefaz || '-'}</td>
                    <td className="p-2 text-xs max-w-md">
                      <div className={l.status === 'rejeitada' || l.status === 'erro' ? 'text-red-700' : 'text-slate-600'}>
                        {l.mensagem || '-'}
                      </div>
                    </td>
                    <td className="p-2 text-xs text-slate-600">{l.usuario_nome || l.usuario_email || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}