import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, Clock, CheckCircle2, Loader2, RefreshCw, Search, XCircle, Play, ChevronLeft, ChevronRight, Archive } from 'lucide-react';
import { toast } from 'sonner';

const PAGE_SIZE = 25;

const STATUS_CONFIG = {
  pendente:    { label: 'Pendente',    color: 'bg-amber-100 text-amber-800 border-amber-300',  icon: Clock },
  processando: { label: 'Enviando...', color: 'bg-blue-100 text-blue-800 border-blue-300',    icon: Loader2 },
  erro:        { label: 'Erro',        color: 'bg-red-100 text-red-800 border-red-300',        icon: XCircle },
  concluido:   { label: 'Concluído',   color: 'bg-green-100 text-green-800 border-green-300',  icon: CheckCircle2 },
};

const STATUS_ORDER = ['pendente', 'processando', 'erro', 'concluido'];

export default function SupervisaoFilaEnvio() {
  const queryClient = useQueryClient();
  const [acessoNegado, setAcessoNegado] = useState(null); // null=checando, false=ok, true=negado
  // filtroStatus: 'acionaveis' (padrão) | 'pendente' | 'processando' | 'erro' | 'concluido'
  const [filtroStatus, setFiltroStatus] = useState('acionaveis');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(0);
  const [reprocessando, setReprocessando] = useState(false);

  // Restringir acesso: admin ou supervisor
  useEffect(() => {
    base44.auth.me().then(async (user) => {
      if (user?.role === 'admin') { setAcessoNegado(false); return; }
      const vend = await base44.entities.Vendedor.filter({ email: user.email });
      const ehSupervisor = vend[0]?.papeis?.includes('supervisor');
      setAcessoNegado(!ehSupervisor);
    }).catch(() => setAcessoNegado(true));
  }, []);

  // Reset de página ao trocar filtro/busca
  useEffect(() => { setPagina(0); }, [filtroStatus, busca]);

  // ── Contadores totais por status (independentes da página) ──
  const { data: counts = { pendente: 0, processando: 0, erro: 0, concluido: 0 } } = useQuery({
    queryKey: ['fila-envio-counts'],
    queryFn: async () => {
      const [pendente, processando, erro, concluido] = await Promise.all([
        base44.entities.FilaEnvioPedidoOmie.filter({ status: 'pendente' }, '-created_date', 1000),
        base44.entities.FilaEnvioPedidoOmie.filter({ status: 'processando' }, '-created_date', 1000),
        base44.entities.FilaEnvioPedidoOmie.filter({ status: 'erro' }, '-created_date', 1000),
        base44.entities.FilaEnvioPedidoOmie.filter({ status: 'concluido' }, '-created_date', 1000),
      ]);
      return { pendente: pendente.length, processando: processando.length, erro: erro.length, concluido: concluido.length };
    },
    enabled: acessoNegado === false,
    refetchInterval: 20000,
    staleTime: 10000,
  });

  // ── Lista paginada server-side ──
  const { data: pageData = [], isLoading, isFetching } = useQuery({
    queryKey: ['fila-envio-page', filtroStatus, pagina],
    queryFn: async () => {
      const skip = pagina * PAGE_SIZE;
      if (filtroStatus === 'acionaveis') {
        // erro + pendente + processando — busca cada um e mescla, ordenado por created_date desc
        const [erro, pendente, processando] = await Promise.all([
          base44.entities.FilaEnvioPedidoOmie.filter({ status: 'erro' }, '-created_date', 500),
          base44.entities.FilaEnvioPedidoOmie.filter({ status: 'pendente' }, '-created_date', 500),
          base44.entities.FilaEnvioPedidoOmie.filter({ status: 'processando' }, '-created_date', 500),
        ]);
        const todos = [...erro, ...pendente, ...processando]
          .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
        return todos.slice(skip, skip + PAGE_SIZE);
      }
      return base44.entities.FilaEnvioPedidoOmie.filter({ status: filtroStatus }, '-created_date', PAGE_SIZE + skip)
        .then(r => r.slice(skip, skip + PAGE_SIZE));
    },
    enabled: acessoNegado === false,
    refetchInterval: 20000,
    staleTime: 10000,
    placeholderData: keepPreviousData,
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores-supervisao'],
    queryFn: () => base44.entities.Vendedor.list(),
    staleTime: 5 * 60 * 1000,
    enabled: acessoNegado === false,
  });
  const vendedoresMap = Object.fromEntries(vendedores.map(v => [v.id, v.nome]));

  // Total de itens para o filtro atual (para paginação)
  const totalFiltro = filtroStatus === 'acionaveis'
    ? counts.erro + counts.pendente + counts.processando
    : (counts[filtroStatus] ?? 0);
  const totalPaginas = Math.max(1, Math.ceil(totalFiltro / PAGE_SIZE));

  // Busca local sobre a página atual (filtro server-side já reduziu o volume)
  const filaExibida = busca
    ? pageData.filter(item =>
        item.cliente_nome?.toLowerCase().includes(busca.toLowerCase()) ||
        item.numero_pedido?.includes(busca) ||
        item.pedido_id?.includes(busca))
    : pageData;

  const invalidarTudo = () => {
    queryClient.invalidateQueries({ queryKey: ['fila-envio-counts'] });
    queryClient.invalidateQueries({ queryKey: ['fila-envio-page'] });
  };

  // Reprocessar somente erros — sequencial, um por vez, com delay
  const reprocessarErros = async () => {
    const erros = await base44.entities.FilaEnvioPedidoOmie.filter({ status: 'erro' }, '-created_date', 500);
    const reprocessaveis = erros.filter(f => (f.tentativas || 0) < 3);
    if (reprocessaveis.length === 0) { toast.info('Nenhum erro reprocessável (todos já no limite de tentativas)'); return; }
    setReprocessando(true);
    try {
      for (const item of reprocessaveis) {
        await base44.entities.FilaEnvioPedidoOmie.update(item.id, { status: 'pendente', erro_log: null });
        await new Promise(r => setTimeout(r, 400));
      }
      toast.success(`${reprocessaveis.length} pedido(s) reenfileirado(s)`);
      invalidarTudo();
    } finally {
      setReprocessando(false);
    }
  };

  const arquivarErro = async (item) => {
    await base44.entities.FilaEnvioPedidoOmie.delete(item.id);
    toast.success('Registro de erro descartado');
    invalidarTudo();
  };

  const processarFila = async () => {
    try {
      await base44.functions.invoke('processarFilaEnvioPedidoOmie', {});
      toast.success('Processamento da fila iniciado');
      setTimeout(invalidarTudo, 3000);
    } catch (e) {
      toast.error('Erro ao acionar fila: ' + e.message);
    }
  };

  if (acessoNegado === null) {
    return <div className="flex items-center justify-center py-20 text-slate-500"><Loader2 className="w-6 h-6 animate-spin mr-2" /> Verificando acesso...</div>;
  }
  if (acessoNegado) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertCircle className="w-12 h-12 text-red-400 mb-3" />
        <h2 className="text-lg font-semibold text-slate-700">Acesso restrito</h2>
        <p className="text-sm text-slate-500">Esta tela é exclusiva para administradores e supervisores.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Supervisão — Fila de Envio ao Omie</h1>
          <p className="text-sm text-slate-500 mt-0.5">Atualiza automaticamente a cada 20s {isFetching && <span className="text-blue-500">· sincronizando…</span>}</p>
        </div>
        <div className="flex gap-2">
          {counts.erro > 0 && (
            <Button variant="outline" onClick={reprocessarErros} disabled={reprocessando} className="border-red-300 text-red-700 hover:bg-red-50">
              {reprocessando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
              Reprocessar {counts.erro} erro(s)
            </Button>
          )}
          <Button onClick={processarFila} className="bg-green-600 hover:bg-green-700">
            <Play className="w-4 h-4 mr-1" /> Acionar Fila Agora
          </Button>
          <Button variant="outline" onClick={invalidarTudo}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Cards de contagem — totais por status, clicáveis */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {STATUS_ORDER.map((status) => {
          const cfg = STATUS_CONFIG[status];
          const Icon = cfg.icon;
          const ativo = filtroStatus === status || (status === 'erro' && false);
          const destaqueErro = status === 'erro' && counts.erro > 0;
          return (
            <Card
              key={status}
              className={`cursor-pointer border-2 transition-all ${ativo ? 'ring-2 ring-slate-400' : ''} ${destaqueErro ? 'border-red-300 bg-red-50/40' : ''}`}
              onClick={() => setFiltroStatus(filtroStatus === status ? 'acionaveis' : status)}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg border ${cfg.color}`}>
                  <Icon className={`w-5 h-5 ${status === 'processando' ? 'animate-spin' : ''}`} />
                </div>
                <div>
                  <p className={`text-2xl font-bold ${destaqueErro ? 'text-red-700' : ''}`}>{counts[status]}</p>
                  <p className="text-xs text-slate-500">{cfg.label}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="Buscar cliente, nº pedido..." value={busca} onChange={e => setBusca(e.target.value)} className="pl-9" />
        </div>
        <Select value={filtroStatus} onValueChange={setFiltroStatus}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="acionaveis">Acionáveis (erro+pend+proc)</SelectItem>
            <SelectItem value="pendente">Pendente</SelectItem>
            <SelectItem value="processando">Processando</SelectItem>
            <SelectItem value="erro">Erro</SelectItem>
            <SelectItem value="concluido">Concluído</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabela */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm text-slate-600">
            {filtroStatus === 'acionaveis' ? 'Itens que precisam de ação' : STATUS_CONFIG[filtroStatus]?.label} · {totalFiltro} total
          </CardTitle>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={pagina === 0} onClick={() => setPagina(p => Math.max(0, p - 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span>Pág. {pagina + 1} de {totalPaginas}</span>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={pagina + 1 >= totalPaginas} onClick={() => setPagina(p => p + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Carregando...
            </div>
          ) : filaExibida.length === 0 ? (
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
                  {filaExibida.map(item => {
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
                            <div className="flex items-start gap-2">
                              <div className="flex items-start gap-1 flex-1">
                                <AlertCircle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
                                <span className="text-xs text-red-600 break-words">{item.erro_log}</span>
                              </div>
                              {item.status === 'erro' && (
                                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-slate-400 hover:text-red-600" title="Descartar este registro" onClick={() => arquivarErro(item)}>
                                  <Archive className="w-3.5 h-3.5" />
                                </Button>
                              )}
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