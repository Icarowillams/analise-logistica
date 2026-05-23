import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Lock, Unlock } from 'lucide-react';

const formatCurrency = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);

const getCodigoCliente = (pedido) => pedido.cliente_codigo_base || pedido.cliente_codigo || pedido.codigo_cliente_omie || pedido.cliente_id || '-';
const getNomeCliente = (pedido) => pedido.cliente_fantasia_base || pedido.cliente_nome_fantasia || pedido.cliente_nome_base || pedido.cliente_nome || '-';
const getPedidoNumero = (pedido) => pedido.numero_pedido || pedido.id;

function PedidoTable({ pedidos, showCheckbox, selectedIds, onToggle, disabled }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            {showCheckbox && <th className="w-10 p-2 text-center">Sel.</th>}
            <th className="p-2 text-left">Código Cliente</th>
            <th className="p-2 text-left">Nome Fantasia</th>
            <th className="p-2 text-left">Número Pedido</th>
            <th className="p-2 text-right">Valor Pedido</th>
          </tr>
        </thead>
        <tbody>
          {pedidos.map((pedido) => (
            <tr key={pedido.id} className="border-t">
              {showCheckbox && (
                <td className="p-2 text-center">
                  <Checkbox checked={selectedIds.includes(pedido.id)} disabled={disabled} onCheckedChange={() => onToggle(pedido.id)} />
                </td>
              )}
              <td className="p-2 font-mono">{getCodigoCliente(pedido)}</td>
              <td className="p-2 font-medium">{getNomeCliente(pedido)}</td>
              <td className="p-2">{getPedidoNumero(pedido)}</td>
              <td className="p-2 text-right font-medium">{formatCurrency(pedido.valor_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DebitosAccordion({ pedido, bloqueio, open, onToggle }) {
  const titulos = bloqueio?.titulos || [];
  return (
    <div className="rounded-lg border border-red-200 bg-white">
      <button type="button" className="flex w-full items-center justify-between gap-3 p-3 text-left" onClick={onToggle}>
        <div>
          <p className="font-semibold text-red-900">{getNomeCliente(pedido)} • Pedido {getPedidoNumero(pedido)}</p>
          <p className="text-xs text-red-700">Total de débitos: {formatCurrency(bloqueio?.total_debitos)} • {bloqueio?.titulos_atrasados || 0} título(s) atrasado(s)</p>
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-red-700" /> : <ChevronRight className="h-4 w-4 text-red-700" />}
      </button>
      {open && (
        <div className="border-t p-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-xs">
              <thead className="bg-red-50 text-red-800">
                <tr>
                  <th className="p-2 text-left">Nº Documento / NF</th>
                  <th className="p-2 text-left">Pedido Omie</th>
                  <th className="p-2 text-left">Vencimento</th>
                  <th className="p-2 text-right">Valor</th>
                  <th className="p-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {titulos.map((titulo, index) => (
                  <tr key={`${pedido.id}-${index}`} className="border-t">
                    <td className="p-2">{titulo.documento_fiscal || titulo.numero || '-'}</td>
                    <td className="p-2">{titulo.codigo_pedido_omie || titulo.codigo_pedido || '-'}</td>
                    <td className="p-2">{titulo.vencimento || '-'}</td>
                    <td className="p-2 text-right font-medium">{formatCurrency(titulo.valor)}</td>
                    <td className="p-2 text-center"><Badge className="bg-red-600 text-white">Atrasado</Badge></td>
                  </tr>
                ))}
                {titulos.length === 0 && <tr><td colSpan={5} className="p-3 text-center text-slate-500">Nenhum título detalhado retornado pelo Omie.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ title, pedidos, color, icon }) {
  const colorMap = {
    green: 'border-green-500 bg-green-50 text-green-800',
    red: 'border-red-500 bg-red-50 text-red-800',
    amber: 'border-amber-500 bg-amber-50 text-amber-800'
  };
  return (
    <div className={`rounded-xl border-l-4 p-4 ${colorMap[color]}`}>
      <div className="mb-2 flex items-center gap-2 font-bold">{icon}{title}: {pedidos.length}</div>
      <div className="space-y-1 text-sm">
        {pedidos.map((pedido) => <div key={pedido.id}>Pedido {getPedidoNumero(pedido)} — {getNomeCliente(pedido)} — {formatCurrency(pedido.valor_total)}</div>)}
        {pedidos.length === 0 && <div>Nenhum.</div>}
      </div>
    </div>
  );
}

export default function LiberarPedidosModal({ isOpen, onClose, pedidosSelecionados = [], usuarioLogado, usuarioNome }) {
  const [pedidosLiberados, setPedidosLiberados] = useState([]);
  const [pedidosBloqueados, setPedidosBloqueados] = useState([]);
  const [pedidosErros, setPedidosErros] = useState([]);
  const [selecionados, setSelecionados] = useState([]);
  const [motivoLiberacao, setMotivoLiberacao] = useState('');
  const [etapa, setEtapa] = useState('analise');
  const [expanded, setExpanded] = useState({});
  const [processando, setProcessando] = useState(false);
  const autoRunRef = useRef(false);

  const { data: permissaoInfo = { podeLiberarBloqueados: false }, isLoading: loadingPermissao } = useQuery({
    queryKey: ['permissao-liberar-pedidos-bloqueados', usuarioLogado?.email],
    enabled: isOpen,
    staleTime: 300000,
    queryFn: async () => {
      const user = usuarioLogado || await base44.auth.me();
      if (user?.role === 'admin') return { podeLiberarBloqueados: true };
      const vendedores = await base44.entities.Vendedor.list();
      const funcionario = vendedores.find(v => v.email?.toLowerCase() === user?.email?.toLowerCase());
      if (!funcionario) return { podeLiberarBloqueados: false };
      const permissoes = await base44.entities.Permissao.filter({ vendedor_id: funcionario.id });
      return { podeLiberarBloqueados: !!permissoes[0]?.permissoes_pedidos?.liberar_pedidos_bloqueados };
    }
  });

  const clienteIds = useMemo(() => [...new Set(pedidosSelecionados.map(p => p.cliente_id).filter(Boolean))], [pedidosSelecionados]);

  const { data: bloqueiosPorCliente = {}, isLoading: consultandoDebitos } = useQuery({
    queryKey: ['bloqueios-financeiros-omie-liberacao', clienteIds.join('|')],
    enabled: isOpen && clienteIds.length > 0,
    staleTime: 300000,
    queryFn: async () => {
      const pares = await Promise.all(clienteIds.map(async (clienteId) => {
        try {
          const res = await base44.functions.invoke('consultarBloqueioFinanceiroOmie', { cliente_id: clienteId });
          if (res.data?.error || res.data?.sucesso === false) throw new Error(res.data?.error || 'Falha na consulta');
          return [clienteId, { ok: true, data: res.data }];
        } catch (error) {
          return [clienteId, { ok: false, error: error.message || 'Erro ao consultar Omie' }];
        }
      }));
      return Object.fromEntries(pares);
    }
  });

  useEffect(() => {
    if (!isOpen) {
      setPedidosLiberados([]);
      setPedidosBloqueados([]);
      setPedidosErros([]);
      setSelecionados([]);
      setMotivoLiberacao('');
      setEtapa('analise');
      setExpanded({});
      setProcessando(false);
      autoRunRef.current = false;
    }
  }, [isOpen]);

  const liberarPedido = async (pedido, extra = {}) => {
    if (pedido.omie_enviado && pedido.omie_codigo_pedido && pedido.tipo !== 'troca') {
      const res = await base44.functions.invoke('liberarPedidoOmie', { pedido_id: pedido.id });
      if (res.data && !res.data.sucesso) throw new Error(res.data.erro || res.data.error || 'Erro ao liberar no Omie');
    }
    await base44.entities.Pedido.update(pedido.id, {
      status: 'liberado',
      liberado_por: usuarioLogado?.email,
      liberado_por_nome: usuarioNome || usuarioLogado?.full_name || usuarioLogado?.email,
      data_liberacao: new Date().toISOString(),
      ...extra
    });
  };

  useEffect(() => {
    if (!isOpen || consultandoDebitos || loadingPermissao || autoRunRef.current) return;
    autoRunRef.current = true;

    const executarAnalise = async () => {
      setProcessando(true);
      const liberados = [];
      const bloqueados = [];
      const erros = [];

      for (const pedido of pedidosSelecionados) {
        const bloqueio = bloqueiosPorCliente[pedido.cliente_id];
        if (!bloqueio?.ok) {
          erros.push({ ...pedido, erro_liberacao: bloqueio?.error || 'Erro ao consultar débitos no Omie' });
          continue;
        }
        if (bloqueio.data?.deve_bloquear === true) {
          bloqueados.push({ ...pedido, bloqueio_financeiro: bloqueio.data });
          continue;
        }
        try {
          await liberarPedido(pedido);
          liberados.push(pedido);
        } catch (error) {
          erros.push({ ...pedido, erro_liberacao: error.message || 'Erro ao liberar pedido' });
        }
      }

      setPedidosLiberados(liberados);
      setPedidosBloqueados(bloqueados);
      setPedidosErros(erros);
      if (bloqueados.length === 0) setEtapa('resumo');
      setProcessando(false);
    };

    executarAnalise();
  }, [isOpen, consultandoDebitos, loadingPermissao, bloqueiosPorCliente, clienteIds.length, pedidosSelecionados]);

  const toggleSelecionado = (pedidoId) => {
    setSelecionados(prev => prev.includes(pedidoId) ? prev.filter(id => id !== pedidoId) : [...prev, pedidoId]);
  };

  const registrarLogForcado = async (pedido, bloqueio, motivo) => {
    await base44.functions.invoke('registrarLogGerencial', {
      tipo_acao: 'LIBERACAO_FORCADA',
      entidade_tipo: 'Pedido',
      entidade_id: pedido.id,
      pedido_id: pedido.id,
      cliente_id: pedido.cliente_id,
      entidade_descricao: `Pedido ${getPedidoNumero(pedido)} - ${getNomeCliente(pedido)}`,
      descricao: `Liberação forçada do pedido ${getPedidoNumero(pedido)} para cliente com débitos no Omie. Motivo: ${motivo}`,
      dados_json: JSON.stringify({
        cliente: getNomeCliente(pedido),
        pedido: getPedidoNumero(pedido),
        valor: pedido.valor_total || 0,
        titulos_ignorados: bloqueio?.titulos || [],
        total_debitos: bloqueio?.total_debitos || 0,
        motivo,
        usuario: usuarioLogado?.email,
        data_hora: new Date().toISOString()
      }),
      observacao: (bloqueio?.titulos || []).map(t => `${t.documento_fiscal || t.numero || '-'} venc. ${t.vencimento || '-'} ${formatCurrency(t.valor)}`).join(' | ')
    });
  };

  const liberarForcados = async (idsParaLiberar) => {
    const ids = idsParaLiberar.length ? idsParaLiberar : [];
    if (!permissaoInfo.podeLiberarBloqueados) return;
    if (ids.length === 0) return;
    if (motivoLiberacao.trim().length < 10) return;

    setProcessando(true);
    const liberadosAgora = [];
    const errosAgora = [];

    for (const pedido of pedidosBloqueados.filter(p => ids.includes(p.id))) {
      try {
        await liberarPedido(pedido, {
          liberacao_forcada: true,
          motivo_liberacao_forcada: motivoLiberacao.trim()
        });
        await registrarLogForcado(pedido, pedido.bloqueio_financeiro, motivoLiberacao.trim());
        liberadosAgora.push(pedido);
      } catch (error) {
        errosAgora.push({ ...pedido, erro_liberacao: error.message || 'Erro na liberação forçada' });
      }
    }

    setPedidosLiberados(prev => [...prev, ...liberadosAgora]);
    setPedidosBloqueados(prev => prev.filter(p => !liberadosAgora.some(l => l.id === p.id)));
    setPedidosErros(prev => [...prev, ...errosAgora]);
    setSelecionados([]);
    setEtapa('resumo');
    setProcessando(false);
  };

  const podeLiberar = permissaoInfo.podeLiberarBloqueados;
  const carregando = consultandoDebitos || loadingPermissao || processando;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent role="dialog" aria-label="Liberação de pedidos com análise financeira" className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Unlock className="h-5 w-5 text-green-600" /> Liberação de Pedidos
          </DialogTitle>
        </DialogHeader>

        {carregando && etapa === 'analise' && (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-slate-600">
            <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
            <p className="font-medium">Consultando débitos no Omie...</p>
          </div>
        )}

        {!carregando && etapa === 'analise' && (
          <div className="space-y-5">
            {pedidosLiberados.length > 0 && (
              <section className="rounded-xl border border-green-500 bg-green-50 p-4 text-green-800">
                <h3 className="mb-3 flex items-center gap-2 font-bold"><CheckCircle2 className="h-5 w-5" /> Liberados automaticamente</h3>
                <PedidoTable pedidos={pedidosLiberados} />
              </section>
            )}

            <section className="rounded-xl border border-red-500 bg-red-50 p-4 text-red-800">
              <h3 className="mb-3 flex items-center gap-2 font-bold"><Lock className="h-5 w-5" /> Bloqueados por débitos no Omie</h3>
              {!podeLiberar && (
                <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                  Você não possui permissão para liberar pedidos bloqueados. Solicite ao gestor.
                </div>
              )}
              <PedidoTable pedidos={pedidosBloqueados} showCheckbox selectedIds={selecionados} onToggle={toggleSelecionado} disabled={!podeLiberar} />
              <div className="mt-4 space-y-2">
                {pedidosBloqueados.map((pedido) => (
                  <DebitosAccordion
                    key={pedido.id}
                    pedido={pedido}
                    bloqueio={pedido.bloqueio_financeiro}
                    open={!!expanded[pedido.id]}
                    onToggle={() => setExpanded(prev => ({ ...prev, [pedido.id]: !prev[pedido.id] }))}
                  />
                ))}
              </div>
              {podeLiberar && selecionados.length > 0 && (
                <div className="mt-4 space-y-2">
                  <label className="text-sm font-semibold">Motivo da liberação forçada <span className="text-red-600">*</span></label>
                  <Textarea value={motivoLiberacao} onChange={(e) => setMotivoLiberacao(e.target.value)} placeholder="Informe o motivo com no mínimo 10 caracteres" className="bg-white" />
                  {motivoLiberacao.trim().length > 0 && motivoLiberacao.trim().length < 10 && <p className="text-xs text-red-700">O motivo deve ter pelo menos 10 caracteres.</p>}
                </div>
              )}
              {podeLiberar && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button className="bg-amber-600 hover:bg-amber-700" disabled={selecionados.length === 0 || motivoLiberacao.trim().length < 10 || processando} onClick={() => liberarForcados(selecionados)}>
                    Liberar Selecionados
                  </Button>
                  <Button variant="outline" className="border-red-300 text-red-700 hover:bg-red-100" disabled={pedidosBloqueados.length === 0 || motivoLiberacao.trim().length < 10 || processando} onClick={() => liberarForcados(pedidosBloqueados.map(p => p.id))}>
                    Liberar Todos os Bloqueados
                  </Button>
                </div>
              )}
            </section>

            {pedidosErros.length > 0 && (
              <section className="rounded-xl border border-amber-500 bg-amber-50 p-4 text-amber-800">
                <h3 className="mb-2 flex items-center gap-2 font-bold"><AlertTriangle className="h-5 w-5" /> Erros na consulta ou liberação</h3>
                {pedidosErros.map(p => <p key={p.id} className="text-sm">Pedido {getPedidoNumero(p)} — {p.erro_liberacao}</p>)}
              </section>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEtapa('resumo')}>Ver Resumo</Button>
            </div>
          </div>
        )}

        {etapa === 'resumo' && !carregando && (
          <div className="space-y-4">
            <div className="rounded-xl border bg-slate-50 p-4 text-center text-lg font-bold text-slate-800">
              {pedidosLiberados.length} pedidos liberados | {pedidosBloqueados.length} pedidos bloqueados | {pedidosErros.length} erros
            </div>
            <SummaryCard title="Liberados com sucesso" pedidos={pedidosLiberados} color="green" icon={<CheckCircle2 className="h-5 w-5" />} />
            <SummaryCard title="Permanecem bloqueados" pedidos={pedidosBloqueados} color="red" icon={<Lock className="h-5 w-5" />} />
            {pedidosErros.length > 0 && <SummaryCard title="Erros" pedidos={pedidosErros} color="amber" icon={<AlertTriangle className="h-5 w-5" />} />}
            <div className="flex justify-end">
              <Button className="bg-green-600 hover:bg-green-700" onClick={onClose}>Concluir</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}