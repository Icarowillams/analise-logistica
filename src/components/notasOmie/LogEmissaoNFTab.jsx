import React, { useEffect, useMemo, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem
} from '@/components/ui/select';
import { RefreshCw, Loader2, CheckCircle2, XCircle, AlertCircle, ScrollText, X, Wand2, Search } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { formatNumeroPedido } from '@/lib/formatarNumeroPedido';

/**
 * Log de Emissão de NF-e — histórico persistente de TODAS as tentativas
 * de emissão feitas via Omie (autorizadas, rejeitadas, pendentes e erros).
 *
 * Status resolvido SOB DEMANDA: ao abrir a aba (e no botão "Resolver pendentes"),
 * os logs pendentes/erro VISÍVEIS são reconsultados ao vivo no Omie via
 * reconsultarStatusNFsPendentes — em lotes pequenos, atualizando a UI conforme chega.
 * Não há automação por trás; o status sempre reflete o Omie real ao abrir a tela.
 */

// Teto de pedidos reconsultados por abertura/clique (evita varrer tudo).
const TETO_RECONSULTA = 24;
// Lote por chamada à função backend = 1 → consultas estritamente sequenciais, sem rajada.
// O backend serializa internamente com ~9s entre consultas; aqui processamos 1 pedido por chamada.
const LOTE_RECONSULTA = 1;

export default function LogEmissaoNFTab({ ativa = true, cargaFiltro, autoConsultarCodigos = [] }) {
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const [filtroCarga, setFiltroCarga] = useState('');
  const [filtroCodCliente, setFiltroCodCliente] = useState('');
  const [filtroFantasia, setFiltroFantasia] = useState('');
  const [filtroPedido, setFiltroPedido] = useState('');
  const [filtroNF, setFiltroNF] = useState('');
  const [dataIni, setDataIni] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [buscandoNoOmie, setBuscandoNoOmie] = useState(false);
  const [resolvendo, setResolvendo] = useState(false);
  const [progresso, setProgresso] = useState({ feito: 0, total: 0 });
  const [reconsultandoCod, setReconsultandoCod] = useState(null);
  const [erroDetalhe, setErroDetalhe] = useState(null);
  const autoResolveKeyRef = useRef('');

  const { data: logs = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['logEmissaoNF'],
    queryFn: () => base44.entities.LogEmissaoNF.list('-created_date', 500),
    enabled: ativa,
    staleTime: 15000
  });

  // Carrega SÓ os clientes referenciados pelos logs (por cliente_id) para enriquecer
  // com codigo_interno e nome_fantasia — não a base inteira.
  const clienteIdsLogs = useMemo(
    () => [...new Set(logs.map(l => l.cliente_id).filter(Boolean))],
    [logs]
  );
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientesParaLogNF', clienteIdsLogs],
    enabled: ativa && clienteIdsLogs.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const LOTE = 100;
      const out = [];
      for (let i = 0; i < clienteIdsLogs.length; i += LOTE) {
        const lote = clienteIdsLogs.slice(i, i + LOTE);
        const res = await base44.entities.Cliente.filter(
          { id: { $in: lote } }, '-created_date', LOTE, ['id', 'codigo_interno', 'nome_fantasia']
        );
        out.push(...res);
      }
      return out;
    }
  });

  const clientePorId = useMemo(() => {
    const m = new Map();
    clientes.forEach(c => m.set(c.id, c));
    return m;
  }, [clientes]);

  // Carrega Pedidos recentes para FALLBACK instantâneo de Nº NF e nome — sem esperar o
  // write-through do LogEmissaoNF nem precisar sair/voltar da aba. Cruzamento 100% local.
  const { data: pedidos = [] } = useQuery({
    queryKey: ['pedidosParaLogNF'],
    queryFn: () => base44.entities.Pedido.filter(
      { faturado: true }, '-data_faturamento', 500,
      ['numero_pedido', 'numero_nota_fiscal', 'cliente_nome', 'cliente_nome_fantasia', 'numero_carga', 'omie_codigo_pedido']
    ),
    enabled: ativa,
    staleTime: 15000
  });

  const pedidoPorNumero = useMemo(() => {
    const m = new Map();
    pedidos.forEach(p => {
      const chave = formatNumeroPedido(p.numero_pedido || '');
      if (chave) m.set(chave, p);
    });
    return m;
  }, [pedidos]);

  // Índice por código Omie (omie_codigo_pedido) — para casar o log pela chave mais confiável.
  const pedidoPorCodigoOmie = useMemo(() => {
    const m = new Map();
    pedidos.forEach(p => {
      if (p.omie_codigo_pedido) m.set(String(p.omie_codigo_pedido), p);
    });
    return m;
  }, [pedidos]);

  // Enriquece cada log com dados do cliente + FALLBACK do Pedido (Nº NF, nome e Nº Carga instantâneos).
  // Casa o Pedido por código Omie (mais confiável) e, como reforço, por número de pedido normalizado.
  const logsEnriquecidos = useMemo(() => {
    return logs.map(l => {
      const c = l.cliente_id ? clientePorId.get(l.cliente_id) : null;
      const chavePed = formatNumeroPedido(l.numero_pedido || l.codigo_pedido || '');
      const ped = pedidoPorCodigoOmie.get(String(l.codigo_pedido || ''))
        || (chavePed ? pedidoPorNumero.get(chavePed) : null);
      return {
        ...l,
        numero_nf: l.numero_nf || ped?.numero_nota_fiscal || '',
        numero_carga: l.numero_carga || ped?.numero_carga || '',
        cliente_nome: l.cliente_nome || ped?.cliente_nome || ped?.cliente_nome_fantasia || '',
        codigo_interno: c?.codigo_interno || '',
        nome_fantasia: c?.nome_fantasia || ''
      };
    });
  }, [logs, clientePorId, pedidoPorNumero, pedidoPorCodigoOmie]);

  useEffect(() => {
    if (cargaFiltro?.numero_carga) {
      setFiltroCarga(cargaFiltro.numero_carga);
    }
  }, [cargaFiltro]);

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
      if (pedT) {
        // Normaliza ambos os lados (sem zeros à esquerda) para que "1411" case com "0001411".
        const pedNorm = formatNumeroPedido(l.numero_pedido || l.codigo_pedido || '').toLowerCase();
        const buscaNorm = formatNumeroPedido(pedT).toLowerCase();
        if (!pedNorm.includes(buscaNorm) && !String(l.numero_pedido || l.codigo_pedido || '').toLowerCase().includes(pedT)) return false;
      }
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

  // ── Núcleo: reconsulta SOB DEMANDA via Omie em lotes pequenos, atualizando a UI a cada lote. ──
  const reconsultarCodigos = async (codigos, { silencioso = false } = {}) => {
    const lista = [...new Set(codigos.map(String).filter(Boolean))].slice(0, TETO_RECONSULTA);
    if (lista.length === 0) {
      if (!silencioso) toast.info('Nada para reconsultar.');
      return;
    }

    setResolvendo(true);
    setProgresso({ feito: 0, total: lista.length });

    let totAut = 0, totRej = 0, totPend = 0, abortado = false;
    try {
      for (let i = 0; i < lista.length; i += LOTE_RECONSULTA) {
        const lote = lista.slice(i, i + LOTE_RECONSULTA);
        let r = {};
        try {
          const resp = await base44.functions.invoke('reconsultarStatusNFsPendentes', { codigos_pedido: lote });
          r = resp?.data || {};
        } catch (e) {
          // Falha de rede no lote não trava os demais — segue.
          console.warn('Falha no lote de reconsulta:', e.message);
        }
        if (r?.abortado) {
          abortado = true;
          break;
        }
        totAut += r.autorizados || 0;
        totRej += r.rejeitados || 0;
        totPend += r.ainda_pendentes || 0;
        setProgresso({ feito: Math.min(i + lote.length, lista.length), total: lista.length });
        // Atualiza a tela conforme cada lote chega
        await refetch();
      }

      if (!silencioso) {
        if (abortado) {
          toast.info('Omie pediu para aguardar antes de consultar de novo. Atualize em ~1 min — quem já foi autorizado aparece como autorizado.');
        } else {
          const partes = [];
          if (totAut > 0) partes.push(`${totAut} autorizada(s)`);
          if (totRej > 0) partes.push(`${totRej} rejeitada(s)`);
          if (totPend > 0) partes.push(`${totPend} ainda em processamento`);
          toast.success(partes.length ? partes.join(', ') : 'Status já estava atualizado.');
        }
      }
    } finally {
      setResolvendo(false);
      setProgresso({ feito: 0, total: 0 });
    }
  };

  // Códigos pendentes/erro dentro do que está VISÍVEL na tela (respeita filtros).
  const codigosPendentesVisiveis = useMemo(() => {
    return [...new Set(
      logsFiltrados
        .filter(l => l.status === 'pendente' || l.status === 'erro')
        .map(l => String(l.codigo_pedido))
        .filter(Boolean)
    )];
  }, [logsFiltrados]);

  // Ao abrir a aba (ou quando os logs carregam): resolve os pendentes visíveis em background.
  useEffect(() => {
    if (!ativa || isLoading) return;
    if (codigosPendentesVisiveis.length === 0) return;
    const key = codigosPendentesVisiveis.slice().sort().join('|');
    if (autoResolveKeyRef.current === key) return; // já resolvido para este conjunto
    autoResolveKeyRef.current = key;
    const timer = setTimeout(() => {
      reconsultarCodigos(codigosPendentesVisiveis, { silencioso: true });
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativa, isLoading, codigosPendentesVisiveis]);

  // Códigos vindos de outra tela (ex: logo após emitir) — resolve também.
  useEffect(() => {
    if (!ativa || autoConsultarCodigos.length === 0) return;
    const codigos = [...new Set(autoConsultarCodigos.map(String).filter(Boolean))];
    const key = codigos.slice().sort().join('|');
    if (!key || autoResolveKeyRef.current === key) return;
    autoResolveKeyRef.current = key;
    const timer = setTimeout(() => {
      reconsultarCodigos(codigos, { silencioso: false });
    }, 1200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativa, autoConsultarCodigos]);

  // Botão "Resolver N pendente(s)" / "Atualizar" — reconsulta o que está visível, com progresso.
  const resolverPendentes = () => reconsultarCodigos(codigosPendentesVisiveis, { silencioso: false });

  // Reconsulta UM pedido específico (botão na linha).
  const reconsultarPedido = async (codigoPedido) => {
    if (!codigoPedido) return;
    setReconsultandoCod(String(codigoPedido));
    try {
      const resp = await base44.functions.invoke('reconsultarStatusNFsPendentes', { codigos_pedido: [String(codigoPedido)] });
      const r = resp?.data || {};
      const resultado = r?.resultados?.[0] || {};
      if (resultado.abortado || r?.abortado) toast.info('Omie pediu para aguardar — atualize novamente em ~1 min.');
      else if (r.autorizados > 0) toast.success('NF autorizada — pedido destravado.');
      else if (r.rejeitados > 0) toast.warning('NF rejeitada/cancelada no Omie.');
      else if (r.ainda_pendentes > 0) toast.info('Ainda aguardando a SEFAZ. Tente novamente em ~1 min.');
      else toast.info('Nada a atualizar para este pedido.');
      await refetch();
    } catch (e) {
      toast.error('Falha ao reconsultar: ' + e.message);
    }
    setReconsultandoCod(null);
  };

  // "Buscar no Omie": para NFs emitidas DIRETO no Omie (fora da tela do app), que nunca
  // geraram log local. Busca as NFs reais da carga filtrada no Omie e cria os logs faltantes.
  const buscarLogsNoOmie = async () => {
    const numCarga = filtroCarga.trim();
    if (!numCarga) {
      toast.warning('Informe o Nº da Carga para buscar as NFs emitidas no Omie.');
      return;
    }
    setBuscandoNoOmie(true);
    try {
      toast.info(`Buscando NFs da carga ${numCarga} no Omie...`);
      const resp = await base44.functions.invoke('sincronizarLogEmissaoCarga', { numero_carga: numCarga });
      const r = resp?.data || {};
      if (r?.sucesso) {
        if (r.criados > 0) {
          toast.success(`✅ ${r.criados} NF(s) da carga ${numCarga} adicionada(s) ao log.`);
        } else if (r.nfs_encontradas_omie > 0) {
          toast.info(`As ${r.nfs_encontradas_omie} NF(s) desta carga já estavam no log.`);
        } else {
          toast.warning(`Nenhuma NF encontrada no Omie para a carga ${numCarga}.`);
        }
        await refetch();
      } else {
        toast.error('Erro: ' + (r?.error || 'falha desconhecida'));
      }
    } catch (e) {
      toast.error('Falha ao buscar no Omie: ' + e.message);
    }
    setBuscandoNoOmie(false);
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
            <b>Log persistente de emissão.</b> Cada linha registra uma tentativa de emissão de NF-e. Ao abrir esta aba, os pendentes são reconsultados <b>ao vivo no Omie</b> — quem já foi autorizado aparece como autorizado; quem ainda está na SEFAZ (etapa 50) segue como pendente e resolve no próximo refresh.
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
              {filtroCarga.trim() && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-cyan-300 text-cyan-700 hover:bg-cyan-50"
                  onClick={buscarLogsNoOmie}
                  disabled={buscandoNoOmie}
                  title="Busca no Omie as NFs desta carga emitidas fora do app e adiciona ao log"
                >
                  {buscandoNoOmie ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                  Buscar no Omie
                </Button>
              )}
              {codigosPendentesVisiveis.length > 0 && (
                <Button
                  size="sm"
                  className="bg-amber-500 hover:bg-amber-600 text-white"
                  onClick={resolverPendentes}
                  disabled={resolvendo}
                  title="Consulta o Omie ao vivo para resolver os pendentes/erros visíveis"
                >
                  {resolvendo
                    ? <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    : <Wand2 className="w-4 h-4 mr-2" />}
                  {resolvendo && progresso.total > 0
                    ? `Resolvendo ${progresso.feito}/${progresso.total}...`
                    : `Resolver ${codigosPendentesVisiveis.length} pendente(s)`}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => (codigosPendentesVisiveis.length > 0 ? resolverPendentes() : refetch())}
                disabled={resolvendo || isFetching}
                title="Recarrega e reconsulta pendentes no Omie"
              >
                {resolvendo || isFetching ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
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
                  <th className="p-2 text-center font-semibold">Ação</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan="10" className="text-center py-12 text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Carregando histórico...
                  </td></tr>
                ) : logsFiltrados.length === 0 ? (
                  <tr><td colSpan="10" className="text-center py-12 text-slate-500">
                    Nenhum registro encontrado
                  </td></tr>
                ) : logsFiltrados.map((l) => (
                  <tr key={l.id} className="border-t hover:bg-slate-50/50 transition-colors">
                    <td className="p-2 text-xs whitespace-nowrap">
                      {l.created_date ? format(new Date(l.created_date), 'dd/MM/yyyy HH:mm') : '-'}
                    </td>
                    <td className="p-2 font-medium">{formatNumeroPedido(l.numero_pedido) || l.codigo_pedido}</td>
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
                      <div
                        className={l.status === 'rejeitada' || l.status === 'erro' ? 'text-red-700' : 'text-slate-600'}
                        title={l.faultstring || l.mensagem || ''}
                      >
                        {l.status === 'autorizada'
                          ? `Autorizada${l.numero_nf ? ` — NF ${l.numero_nf}` : ''}`
                          : (l.faultstring || l.mensagem || '-')}
                      </div>
                      {(l.faultstring || l.payload_resposta || l.payload_enviado) && (
                        <Button size="sm" variant="link" className="h-auto p-0 text-xs text-blue-700" onClick={() => setErroDetalhe(l)}>
                          Ver erro completo
                        </Button>
                      )}
                    </td>
                    <td className="p-2 text-xs text-slate-600">{l.usuario_nome || l.usuario_email || '-'}</td>
                    <td className="p-2 text-center">
                      {(l.status === 'pendente' || l.status === 'erro') && l.codigo_pedido ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => reconsultarPedido(l.codigo_pedido)}
                          disabled={reconsultandoCod === String(l.codigo_pedido)}
                          title="Reconsultar status deste pedido no Omie"
                        >
                          {reconsultandoCod === String(l.codigo_pedido)
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <RefreshCw className="w-4 h-4" />}
                        </Button>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!erroDetalhe} onOpenChange={(open) => !open && setErroDetalhe(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Erro completo da emissão</DialogTitle>
          </DialogHeader>
          {erroDetalhe && (
            <div className="space-y-3 text-sm">
              <div><b>Data/hora:</b> {erroDetalhe.created_date ? format(new Date(erroDetalhe.created_date), 'dd/MM/yyyy HH:mm') : '-'}</div>
              <div><b>Pedido:</b> {formatNumeroPedido(erroDetalhe.numero_pedido) || erroDetalhe.codigo_pedido}</div>
              <div><b>faultcode:</b> <code>{erroDetalhe.faultcode || erroDetalhe.codigo_sefaz || '-'}</code></div>
              <div>
                <b>faultstring:</b>
                <div className="mt-1 rounded border bg-red-50 p-3 text-red-800 whitespace-pre-wrap">
                  {erroDetalhe.faultstring || erroDetalhe.mensagem || '-'}
                </div>
              </div>
              <div>
                <b>Payload enviado:</b>
                <pre className="mt-1 max-h-56 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{erroDetalhe.payload_enviado || '-'}</pre>
              </div>
              <div>
                <b>Resposta Omie:</b>
                <pre className="mt-1 max-h-56 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{erroDetalhe.payload_resposta || '-'}</pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}