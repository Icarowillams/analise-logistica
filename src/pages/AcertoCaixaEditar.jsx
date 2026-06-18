import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Wallet, RefreshCw, CheckCircle2, FileText, Loader2, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import CardNotaAcerto from '@/components/acertoCaixa/CardNotaAcerto';
import MotivoNaoEntregueModal from '@/components/acertoCaixa/MotivoNaoEntregueModal';

const fmt = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

export default function AcertoCaixaEditar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const acertoId = new URLSearchParams(window.location.search).get('id');

  const [notas, setNotas] = useState([]);
  const [obs, setObs] = useState('');
  const [sincronizando, setSincronizando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const [sincInicialFeita, setSincInicialFeita] = useState(false);

  const [modalNaoEntregue, setModalNaoEntregue] = useState({ open: false, index: null, loading: false });
  const saveTimer = useRef(null);
  const saveInProgress = useRef(false);
  const pendingSave = useRef(null);

  const { data: acerto, isLoading } = useQuery({
    queryKey: ['acerto', acertoId],
    queryFn: () => base44.entities.AcertoCaixa.get(acertoId),
    enabled: !!acertoId
  });

  useEffect(() => {
    if (acerto) {
      setNotas(acerto.notas || []);
      setObs(acerto.observacao_geral || '');
    }
  }, [acerto]);

  // Sincronização inicial bloqueante
  useEffect(() => {
    const run = async () => {
      if (!acerto || sincInicialFeita || acerto.status_acerto === 'finalizado') return;
      setSincronizando(true);
      try {
        const { data } = await base44.functions.invoke('sincronizarAcertoOmie', { acerto_id: acertoId });
        if (data?.sucesso && data.alteradas > 0) {
          const atualizado = await base44.entities.AcertoCaixa.get(acertoId);
          setNotas(atualizado.notas || []);
          toast.info(`${data.alteradas} nota(s) atualizada(s) pelo Omie`);
        }
      } catch (_) {}
      setSincronizando(false);
      setSincInicialFeita(true);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acerto]);

  const totais = useMemo(() => {
    const ent = notas.filter(n => n.status_entrega === 'entregue').length;
    const ne = notas.filter(n => n.status_entrega === 'nao_entregue').length;
    const pe = notas.filter(n => n.status_entrega === 'pendente').length;
    const dif = notas.reduce((s, n) => s + Number(n.diferenca || 0), 0);
    const rec = notas.reduce((s, n) => s + Number(n.valor_recebido || 0), 0);
    return { total: notas.length, ent, ne, pe, dif, rec };
  }, [notas]);

  // Auto-save com debounce + mutex para evitar race condition
  const agendarSalvar = (novasNotas, novaObs) => {
    pendingSave.current = { notas: novasNotas, obs: novaObs ?? obs };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (saveInProgress.current) {
        agendarSalvar(pendingSave.current.notas, pendingSave.current.obs);
        return;
      }
      const { notas: notasParaSalvar, obs: obsParaSalvar } = pendingSave.current;
      pendingSave.current = null;
      saveInProgress.current = true;
      setSalvando(true);
      const valor_total_recebido = notasParaSalvar.reduce((s, n) => s + Number(n.valor_recebido || 0), 0);
      const valor_total_diferenca = notasParaSalvar.reduce((s, n) => s + Number(n.diferenca || 0), 0);
      try {
        await base44.entities.AcertoCaixa.update(acertoId, {
          notas: notasParaSalvar,
          observacao_geral: obsParaSalvar,
          valor_total_recebido,
          valor_total_diferenca
        });
      } catch (e) {
        toast.error('Erro ao salvar: ' + e.message);
      }
      saveInProgress.current = false;
      setSalvando(false);
      if (pendingSave.current) {
        agendarSalvar(pendingSave.current.notas, pendingSave.current.obs);
      }
    }, 1000);
  };

  const atualizarNota = (idx, nova) => {
    const novas = [...notas];
    novas[idx] = nova;
    setNotas(novas);
    agendarSalvar(novas, obs);
  };

  const marcarEntregue = (idx) => {
    const nota = notas[idx];
    // Marca entregue LOCALMENTE primeiro — ação humana na volta da rua. Nunca trava por causa do Omie.
    const nova = { ...nota, status_entrega: 'entregue', data_recebimento: new Date().toISOString().slice(0, 10) };
    atualizarNota(idx, nova);

    // Best-effort: avisa o Omie que o pedido foi ENTREGUE (etapa 50). Desacoplado da marcação local —
    // se o Omie falhar/rate limit, marca omie_etapa_pendente para reconciliar depois, sem bloquear.
    if (nota.codigo_pedido) {
      base44.functions.invoke('trocarEtapaPedidoOmie', { codigo_pedido: nota.codigo_pedido, etapa: '50' })
        .then(({ data }) => {
          if (!data?.sucesso) {
            setNotas(prev => prev.map((n, i) => i === idx ? { ...n, omie_etapa_pendente: true } : n));
          }
        })
        .catch(() => {
          setNotas(prev => prev.map((n, i) => i === idx ? { ...n, omie_etapa_pendente: true } : n));
        });
    }
  };

  const restaurar = (idx) => {
    const nota = notas[idx];
    const nova = {
      ...nota, status_entrega: 'pendente',
      valor_recebido: nota.valor_original,
      diferenca: 0,
      motivo_cancelamento: '',
      data_recebimento: ''
    };
    atualizarNota(idx, nova);
  };

  const abrirNaoEntregue = (idx) => setModalNaoEntregue({ open: true, index: idx, loading: false });

  const confirmarNaoEntregue = async ({ motivo }) => {
    const idx = modalNaoEntregue.index;
    if (idx == null) return;
    setModalNaoEntregue(s => ({ ...s, loading: true }));
    const nota = notas[idx];
    try {
      const { data } = await base44.functions.invoke('cancelarNfAcerto', {
        codigo_pedido: nota.codigo_pedido, motivo
      });
      if (!data?.sucesso) {
        toast.error(data?.error || 'Erro ao cancelar no Omie');
        setModalNaoEntregue(s => ({ ...s, loading: false }));
        return;
      }
      const nova = {
        ...nota,
        status_entrega: 'nao_entregue',
        valor_recebido: 0,
        diferenca: -Number(nota.valor_original || 0),
        motivo_cancelamento: motivo,
        numero_nfe: data.numero_nf || nota.numero_nfe
      };
      atualizarNota(idx, nova);
      toast.success(data.ja_cancelada ? 'NF já estava cancelada no Omie' : 'Pedido/NF cancelado(a) no Omie');
    } catch (e) {
      toast.error(e.message);
    }
    setModalNaoEntregue({ open: false, index: null, loading: false });
  };

  const sincronizarManual = async () => {
    setSincronizando(true);
    try {
      const { data } = await base44.functions.invoke('sincronizarAcertoOmie', { acerto_id: acertoId });
      if (data?.sucesso) {
        const atualizado = await base44.entities.AcertoCaixa.get(acertoId);
        setNotas(atualizado.notas || []);
        toast.success(`${data.alteradas} nota(s) atualizada(s)`);
      } else toast.error(data?.error || 'Erro');
    } catch (e) { toast.error(e.message); }
    setSincronizando(false);
  };

  const recarregarNotasDaCarga = async () => {
    if (!acerto?.carga_id) return;
    if (notas.length > 0 && !confirm('Isto vai SOBRESCREVER as notas atuais com os pedidos da carga. Continuar?')) return;
    setSincronizando(true);
    try {
      const carga = await base44.entities.Carga.get(acerto.carga_id);
      const notasOmie = (carga.pedidos_omie || []).map(p => ({
        codigo_pedido: String(p.codigo_pedido || ''),
        numero_pedido: String(p.numero_pedido || ''),
        numero_nfe: String(p.numero_nf || ''),
        nome_cliente: p.nome_fantasia || p.nome_cliente || '',
        razao_social: p.nome_cliente || '',
        codigo_cliente: String(p.codigo_cliente || ''),
        codigo_cliente_cod: String(p.codigo_cliente_cod || ''),
        valor_original: Number(p.valor_total_pedido || 0),
        valor_recebido: Number(p.valor_total_pedido || 0),
        diferenca: 0, status_entrega: 'pendente', forma_pagamento: 'boleto',
        data_recebimento: '', motivo_cancelamento: '', observacao: ''
      }));
      const notasInternas = (carga.pedidos_internos || []).map(p => ({
        codigo_pedido: '', numero_pedido: String(p.numero_pedido || ''), numero_nfe: '',
        nome_cliente: p.nome_fantasia || p.nome_cliente || '', razao_social: p.nome_cliente || '',
        codigo_cliente: String(p.cliente_id || ''), codigo_cliente_cod: '',
        valor_original: Number(p.valor_total_pedido || 0),
        valor_recebido: Number(p.valor_total_pedido || 0),
        diferenca: 0, status_entrega: 'pendente', forma_pagamento: 'dinheiro',
        data_recebimento: '', motivo_cancelamento: '', observacao: 'D1 (interno)'
      }));
      const notasTroca = (carga.pedidos_troca || []).map(p => ({
        codigo_pedido: '', numero_pedido: String(p.numero_pedido || ''), numero_nfe: '',
        nome_cliente: p.nome_fantasia || p.nome_cliente || '', razao_social: p.nome_cliente || '',
        codigo_cliente: String(p.cliente_id || ''), codigo_cliente_cod: '',
        valor_original: Number(p.valor_total_pedido || 0), valor_recebido: 0,
        diferenca: 0, status_entrega: 'pendente', forma_pagamento: 'boleto',
        data_recebimento: '', motivo_cancelamento: '', observacao: 'Troca'
      }));
      const novas = [...notasOmie, ...notasInternas, ...notasTroca];
      const valor_total_original = novas.reduce((s, n) => s + n.valor_original, 0);
      await base44.entities.AcertoCaixa.update(acertoId, {
        notas: novas, valor_total_original,
        valor_total_recebido: valor_total_original, valor_total_diferenca: 0
      });
      setNotas(novas);
      toast.success(`${novas.length} nota(s) carregada(s) da carga`);
    } catch (e) { toast.error(e.message); }
    setSincronizando(false);
  };

  const finalizar = async () => {
    if (!confirm('Finalizar acerto? Notas pendentes serão marcadas como ENTREGUES.')) return;
    setFinalizando(true);
    const finais = notas.map(n => n.status_entrega === 'pendente' ? {
      ...n, status_entrega: 'entregue', data_recebimento: n.data_recebimento || new Date().toISOString().slice(0, 10)
    } : n);
    const valor_total_recebido = finais.reduce((s, n) => s + Number(n.valor_recebido || 0), 0);
    const valor_total_diferenca = finais.reduce((s, n) => s + Number(n.diferenca || 0), 0);
    try {
      await base44.entities.AcertoCaixa.update(acertoId, {
        notas: finais,
        observacao_geral: obs,
        valor_total_recebido, valor_total_diferenca,
        status_acerto: 'finalizado',
        finalizado_em: new Date().toISOString()
      });
      // Atualiza carga para "entregue"
      if (acerto?.carga_id) {
        try { await base44.entities.Carga.update(acerto.carga_id, { status_carga: 'entregue' }); } catch (_) {}
      }
      toast.success('Acerto finalizado');
      queryClient.invalidateQueries({ queryKey: ['acertos'] });
      queryClient.invalidateQueries({ queryKey: ['cargas-acerto'] });
      navigate('/AcertoCaixa');
    } catch (e) { toast.error(e.message); }
    setFinalizando(false);
  };

  if (isLoading || !acerto) return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div>;

  const finalizado = acerto.status_acerto === 'finalizado';

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {sincronizando && !sincInicialFeita && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 flex items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            <span className="font-medium">Sincronizando com Omie...</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/AcertoCaixa')}><ArrowLeft className="w-5 h-5" /></Button>
          <Wallet className="w-7 h-7 text-emerald-500" />
          <div>
            <h1 className="text-xl font-bold">Acerto — Carga {acerto.numero_carga}</h1>
            <p className="text-xs text-slate-500">{acerto.motorista_nome} • Saída {acerto.data_saida_carga} {salvando && <span className="ml-2 text-amber-600">salvando...</span>}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {!finalizado && notas.length === 0 && (
            <Button variant="outline" onClick={recarregarNotasDaCarga} disabled={sincronizando} className="border-amber-300 text-amber-700">
              {sincronizando ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Carregar notas da carga
            </Button>
          )}
          <Button variant="outline" onClick={sincronizarManual} disabled={sincronizando || finalizado}>
            {sincronizando ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Sincronizar Omie
          </Button>
          <Button variant="outline" onClick={() => window.open(`/AcertoResumoPDF?id=${acertoId}`, '_blank')}>
            <FileText className="w-4 h-4 mr-2" /> PDF
          </Button>
          {!finalizado && (
            <Button onClick={finalizar} disabled={finalizando} className="bg-emerald-600 hover:bg-emerald-700">
              {finalizando ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              Finalizar Acerto
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="p-3"><div className="text-xs text-slate-500">Notas</div><div className="text-2xl font-bold">{totais.total}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-slate-500">Entregues</div><div className="text-2xl font-bold text-emerald-600">{totais.ent}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-slate-500">Não Entregues</div><div className="text-2xl font-bold text-red-600">{totais.ne}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-slate-500">Pendentes</div><div className="text-2xl font-bold text-amber-600">{totais.pe}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-slate-500">Diferença</div><div className={`text-2xl font-bold ${totais.dif < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmt(totais.dif)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Notas ({notas.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {notas.map((n, i) => (
            <CardNotaAcerto
              key={i}
              nota={n}
              onChange={(nova) => !finalizado && atualizarNota(i, nova)}
              onMarcarEntregue={() => !finalizado && marcarEntregue(i)}
              onMarcarNaoEntregue={() => !finalizado && abrirNaoEntregue(i)}
              onRestaurar={() => !finalizado && restaurar(i)}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Resumo Financeiro</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="p-3 bg-slate-50 rounded"><div className="text-xs text-slate-500">Valor Original</div><div className="font-bold">{fmt(acerto.valor_total_original)}</div></div>
            <div className="p-3 bg-emerald-50 rounded"><div className="text-xs text-emerald-700">Recebido</div><div className="font-bold text-emerald-700">{fmt(totais.rec)}</div></div>
            <div className={`p-3 rounded ${totais.dif < 0 ? 'bg-red-50' : 'bg-slate-50'}`}><div className="text-xs text-slate-500">Diferença</div><div className={`font-bold ${totais.dif < 0 ? 'text-red-600' : ''}`}>{fmt(totais.dif)}</div></div>
          </div>
          <Textarea
            placeholder="Observação geral do acerto"
            value={obs}
            onChange={(e) => { setObs(e.target.value); agendarSalvar(notas, e.target.value); }}
            disabled={finalizado}
            rows={3}
          />
        </CardContent>
      </Card>

      <MotivoNaoEntregueModal
        open={modalNaoEntregue.open}
        onOpenChange={(v) => setModalNaoEntregue(s => ({ ...s, open: v }))}
        onConfirm={confirmarNaoEntregue}
        loading={modalNaoEntregue.loading}
      />
    </div>
  );
}