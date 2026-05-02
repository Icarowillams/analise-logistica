import React, { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Loader2, Search, AlertCircle, CheckCircle2, Send, Download, ShieldCheck, Database, Cloud, GitCompare } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Audita Base44 vs Omie em job assíncrono com polling de progresso.
 * Otimizado conforme docs Omie: 100 reg/página, 4 simultâneas, 240 req/min.
 */
export default function AuditoriaOmieModal({ open, onOpenChange }) {
  const [jobId, setJobId] = useState(null);
  const [progresso, setProgresso] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [busca, setBusca] = useState('');
  const [selecionados, setSelecionados] = useState(new Set());
  const [exportando, setExportando] = useState(false);
  const [progressoExport, setProgressoExport] = useState(null);
  const [resultadoExport, setResultadoExport] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState('ativo'); // 'ativo' | 'todos' | 'inativo' | 'prospecto' | 'bloqueado'
  const queryClient = useQueryClient();
  const pollRef = useRef(null);

  // Polling do job
  useEffect(() => {
    if (!jobId || resultado) return;

    const poll = async () => {
      try {
        const res = await base44.functions.invoke('auditoriaClientesOmieJob', {
          acao: 'progresso',
          job_id: jobId,
        });
        const data = res.data;
        if (!data) return;
        setProgresso(data);

        if (data.status === 'concluido') {
          // Backend pode enviar a lista direto OU um placeholder apontando pra entidade/URL.
          const carregarTodosDaEntidade = async (lado) => {
            const todos = [];
            const PAGE = 500;
            let skip = 0;
            while (true) {
              const lote = await base44.entities.AuditoriaClienteFaltante.filter(
                { job_id: data.job_id || jobId, lado },
                '-created_date',
                PAGE,
                skip
              );
              const arr = Array.isArray(lote) ? lote : [];
              todos.push(...arr);
              if (arr.length < PAGE) break;
              skip += PAGE;
            }
            // Mapear pro formato curto que o expandir* espera
            if (lado === 'base44') {
              return todos.map(t => ({
                id: t.cliente_id, c: t.codigo, r: t.razao_social, f: t.nome_fantasia,
                d: t.cnpj_cpf, ci: t.cidade, uf: t.estado, s: t.status, tn: t.tipo_nota,
              }));
            }
            return todos.map(t => ({
              co: t.codigo_omie, ci: t.codigo_integracao, r: t.razao_social,
              f: t.nome_fantasia, d: t.cnpj_cpf, in: t.inativo,
            }));
          };

          const resolverLista = async (raw, lado) => {
            if (!raw) return [];
            if (Array.isArray(raw)) return raw;
            if (raw && typeof raw === 'object') {
              if (raw.__entity === 'AuditoriaClienteFaltante') {
                return await carregarTodosDaEntidade(lado);
              }
              if (raw.__url) {
                try { const r = await fetch(raw.__url); return await r.json(); }
                catch (e) { console.error('Erro ao baixar lista:', e.message); return []; }
              }
            }
            return [];
          };
          const rawB44 = await resolverLista(data.lista_so_base44, 'base44');
          const rawOmie = await resolverLista(data.lista_so_omie, 'omie');

          // Backend envia campos curtos pra caber no limite do campo. Re-expandir aqui.
          const expandirB44 = (c) => ({
            id: c.id,
            codigo: c.c ?? c.codigo,
            razao_social: c.r ?? c.razao_social,
            nome_fantasia: c.f ?? c.nome_fantasia,
            cnpj_cpf: c.d ?? c.cnpj_cpf,
            cidade: c.ci ?? c.cidade,
            estado: c.uf ?? c.estado,
            status: c.s ?? c.status,
            tipo_nota: c.tn ?? c.tipo_nota,
          });
          const expandirOmie = (c) => ({
            codigo_omie: c.co ?? c.codigo_omie,
            codigo_integracao: c.ci ?? c.codigo_integracao,
            razao_social: c.r ?? c.razao_social,
            nome_fantasia: c.f ?? c.nome_fantasia,
            cnpj_cpf: c.d ?? c.cnpj_cpf,
            inativo: c.in ?? c.inativo,
          });
          const listaB44 = (rawB44 || []).map(expandirB44);
          const listaOmie = (rawOmie || []).map(expandirOmie);
          setResultado({
            total_base44: data.total_base44,
            total_omie: data.total_omie_obtidos,
            iguais: data.iguais,
            diferentes: data.diferentes,
            so_no_base44: data.so_no_base44,
            so_no_omie: data.so_no_omie,
            lista_so_base44: listaB44,
            lista_so_omie: listaOmie,
          });
          // Pré-seleciona apenas ativos (filtro padrão)
          const ativos = listaB44.filter(c => c.status === 'ativo');
          setSelecionados(new Set(ativos.map(c => c.id)));
          toast.success(`Auditoria concluída: ${data.so_no_base44} faltam no Omie`);
        } else if (data.status === 'erro') {
          toast.error('❌ ' + (data.erro_mensagem || 'Erro na auditoria'));
        }
      } catch (e) {
        console.error('Polling erro:', e.message);
      }
    };

    poll(); // imediato
    pollRef.current = setInterval(poll, 1500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId, resultado]);

  const iniciar = async () => {
    setProgresso(null);
    setResultado(null);
    setSelecionados(new Set());
    setResultadoExport(null);
    try {
      const res = await base44.functions.invoke('auditoriaClientesOmieJob', { acao: 'iniciar' });
      if (res.data?.job_id) {
        setJobId(res.data.job_id);
      } else {
        toast.error('❌ ' + (res.data?.error || 'Falha ao iniciar'));
      }
    } catch (e) {
      toast.error('❌ ' + e.message);
    }
  };

  const todosFaltantes = resultado?.lista_so_base44 || [];
  // Contagem por status (pra mostrar no UI)
  const contagemStatus = todosFaltantes.reduce((acc, c) => {
    const s = c.status || 'sem_status';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
  const faltantes = todosFaltantes.filter(c => {
    if (filtroStatus === 'todos') return true;
    return (c.status || 'sem_status') === filtroStatus;
  });

  const filtrados = faltantes.filter(c => {
    if (!busca.trim()) return true;
    const s = busca.toLowerCase();
    return (
      (c.razao_social || '').toLowerCase().includes(s) ||
      (c.nome_fantasia || '').toLowerCase().includes(s) ||
      (c.cnpj_cpf || '').includes(s) ||
      (c.codigo || '').toLowerCase().includes(s) ||
      (c.cidade || '').toLowerCase().includes(s)
    );
  });

  const toggleAll = () => {
    if (selecionados.size === filtrados.length) setSelecionados(new Set());
    else setSelecionados(new Set(filtrados.map(c => c.id)));
  };

  const toggleOne = (id) => {
    const novo = new Set(selecionados);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    setSelecionados(novo);
  };

  const exportarSelecionados = async () => {
    if (selecionados.size === 0) {
      toast.warning('Selecione ao menos um cliente');
      return;
    }
    setExportando(true);
    setResultadoExport(null);

    const ids = Array.from(selecionados);
    setProgressoExport({ atual: 0, total: ids.length, lote: 0, totalLotes: 0, fase: 'carregando' });

    // Carrega clientes em paralelo (10 simultâneos) — bem mais rápido que sequencial
    const completos = [];
    let cursorLoad = 0;
    let loaded = 0;
    const loadWorker = async () => {
      while (true) {
        const i = cursorLoad++;
        if (i >= ids.length) break;
        try {
          const c = await base44.entities.Cliente.get(ids[i]);
          if (c) completos.push(c);
        } catch (_) {}
        loaded++;
        if (loaded % 25 === 0 || loaded === ids.length) {
          setProgressoExport({ atual: loaded, total: ids.length, lote: 0, totalLotes: 0, fase: 'carregando' });
        }
      }
    };
    await Promise.all(Array.from({ length: 10 }, () => loadWorker()));

    if (completos.length === 0) {
      setExportando(false);
      setProgressoExport(null);
      toast.error('Não foi possível carregar dados dos clientes');
      return;
    }

    const LOTE = 50;
    const LOTES_PARALELOS = 2; // 2 lotes × 4 paralelismo backend = 8 simultâneas (limite Omie)
    let totalOk = 0, totalErro = 0;
    let processados = 0;
    const erros = [];

    // Monta todos os lotes
    const lotes = [];
    for (let i = 0; i < completos.length; i += LOTE) {
      lotes.push(completos.slice(i, i + LOTE));
    }
    const totalLotes = lotes.length;

    setProgressoExport({ atual: 0, total: completos.length, lote: 0, totalLotes });

    // Worker que processa lotes da fila
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= lotes.length) break;
        const batch = lotes[idx];
        try {
          const res = await base44.functions.invoke('exportarClientesOmie', {
            clientes_data: batch,
          });
          const r = res.data?.resumo;
          if (r) { totalOk += r.sucessos || 0; totalErro += r.erros || 0; }
          (res.data?.resultados || []).filter(x => !x.sucesso).forEach(x => {
            erros.push({ razao_social: x.razao_social, mensagem: x.mensagem });
          });
        } catch (e) {
          totalErro += batch.length;
          batch.forEach(c => erros.push({ razao_social: c.razao_social, mensagem: e.message }));
        }
        processados += batch.length;
        setProgressoExport({ atual: processados, total: completos.length, lote: idx + 1, totalLotes });
      }
    };

    await Promise.all(Array.from({ length: LOTES_PARALELOS }, () => worker()));

    setProgressoExport(null);
    setExportando(false);
    setResultadoExport({ totalOk, totalErro, erros: erros.slice(0, 50) });
    queryClient.invalidateQueries(['clientes']);
    if (totalErro === 0) toast.success(`✅ ${totalOk} cliente(s) exportado(s) ao Omie!`);
    else toast.warning(`${totalOk} ok | ${totalErro} com erro`);
  };

  const baixarCSV = () => {
    if (faltantes.length === 0) return;
    const headers = ['codigo', 'razao_social', 'nome_fantasia', 'cnpj_cpf', 'cidade', 'estado', 'status'];
    const linhas = faltantes.map(c => [
      c.codigo || '', c.razao_social || '', c.nome_fantasia || '', c.cnpj_cpf || '',
      c.cidade || '', c.estado || '', c.status || ''
    ]);
    const csv = [headers.join(';'), ...linhas.map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `clientes_faltantes_omie_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const fechar = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    setJobId(null); setProgresso(null); setResultado(null); setSelecionados(new Set());
    setBusca(''); setResultadoExport(null); setProgressoExport(null);
    onOpenChange(false);
  };

  const emProgresso = jobId && !resultado;
  const pctOmie = progresso?.total_omie_estimado
    ? Math.min(100, (progresso.total_omie_obtidos / progresso.total_omie_estimado) * 100)
    : 0;

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            Auditoria Omie — Clientes Faltantes
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4 text-sm">
          {!jobId && !resultado && (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-blue-900">
                  Lista os clientes que <b>existem aqui mas NÃO no Omie</b> — causa do erro
                  <i> "Cliente não cadastrado no Omie. Exporte o cliente primeiro"</i>.
                </p>
                <p className="text-blue-800 mt-1 text-xs">
                  Otimizado: 100 reg/página • 3 páginas em paralelo • respeita rate limit Omie (240 req/min).
                </p>
              </div>
              <Button onClick={iniciar} className="w-full bg-emerald-600 hover:bg-emerald-700">
                <Search className="w-4 h-4 mr-2" />
                Iniciar Auditoria
              </Button>
            </>
          )}

          {emProgresso && progresso && (
            <div className="space-y-3">
              {/* Status etapa */}
              <div className="bg-gradient-to-r from-blue-50 to-emerald-50 border border-blue-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  <p className="font-semibold text-blue-900">{progresso.etapa_descricao}</p>
                </div>

                {/* Etapa: buscando Omie */}
                {progresso.status === 'buscando_omie' && progresso.total_omie_estimado > 0 && (
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-blue-700 flex items-center gap-1">
                        <Cloud className="w-3 h-3" /> Buscando Omie
                      </span>
                      <span className="font-mono text-blue-900">
                        {progresso.total_omie_obtidos}/{progresso.total_omie_estimado}
                        {' '}({progresso.pagina_atual}/{progresso.total_paginas} pág)
                      </span>
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${pctOmie}%` }}
                      />
                    </div>
                    <p className="text-xs text-blue-600 mt-1 text-right">{pctOmie.toFixed(1)}%</p>
                  </div>
                )}

                {/* Etapa: buscando Base44 */}
                {progresso.status === 'buscando_base44' && (
                  <div className="flex items-center gap-2 text-emerald-700">
                    <Database className="w-4 h-4" />
                    <span className="text-xs">Lendo {progresso.total_omie_obtidos} clientes Omie + base local...</span>
                  </div>
                )}

                {/* Etapa: comparando */}
                {progresso.status === 'comparando' && (
                  <div className="flex items-center gap-2 text-purple-700">
                    <GitCompare className="w-4 h-4" />
                    <span className="text-xs">
                      Cruzando {progresso.total_base44} clientes locais com {progresso.total_omie_obtidos} do Omie...
                    </span>
                  </div>
                )}
              </div>

              {/* Mini cards parciais */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="border rounded p-2 bg-slate-50">
                  <p className="text-slate-500">Omie</p>
                  <p className="font-bold text-base">{progresso.total_omie_obtidos}</p>
                </div>
                <div className="border rounded p-2 bg-slate-50">
                  <p className="text-slate-500">Base44</p>
                  <p className="font-bold text-base">{progresso.total_base44 || '...'}</p>
                </div>
                <div className="border rounded p-2 bg-slate-50">
                  <p className="text-slate-500">Status</p>
                  <p className="font-bold text-xs uppercase">{progresso.status.replace('_', ' ')}</p>
                </div>
              </div>
            </div>
          )}

          {resultado && (
            <>
              <div className="grid grid-cols-4 gap-2">
                <div className="border rounded-lg p-2 bg-slate-50 text-center">
                  <p className="text-xs text-slate-500">Base44</p>
                  <p className="text-xl font-bold">{resultado.total_base44}</p>
                </div>
                <div className="border rounded-lg p-2 bg-slate-50 text-center">
                  <p className="text-xs text-slate-500">Omie</p>
                  <p className="text-xl font-bold">{resultado.total_omie}</p>
                </div>
                <div className="border rounded-lg p-2 bg-emerald-50 border-emerald-200 text-center">
                  <p className="text-xs text-emerald-600">Sincronizados</p>
                  <p className="text-xl font-bold text-emerald-700">{resultado.iguais}</p>
                </div>
                <div className="border rounded-lg p-2 bg-red-50 border-red-200 text-center">
                  <p className="text-xs text-red-600">Faltam no Omie</p>
                  <p className="text-xl font-bold text-red-700">{resultado.so_no_base44}</p>
                </div>
              </div>

              {todosFaltantes.length === 0 ? (
                <div className="text-center py-8 text-emerald-600">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-2" />
                  <p className="font-semibold">100% sincronizado!</p>
                  <p className="text-xs text-slate-500">Todos os clientes estão no Omie.</p>
                </div>
              ) : (
                <>
                  <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input
                        value={busca}
                        onChange={e => setBusca(e.target.value)}
                        placeholder="Buscar por razão social, CNPJ, código, cidade..."
                        className="pl-8"
                      />
                    </div>
                    <Button variant="outline" size="sm" onClick={baixarCSV}>
                      <Download className="w-4 h-4 mr-1" /> CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setJobId(null); setResultado(null); iniciar(); }}>
                      Recomparar
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-1.5 items-center text-xs">
                    <span className="text-slate-600 mr-1">Status:</span>
                    {[
                      { v: 'ativo', label: 'Ativos', cor: 'emerald' },
                      { v: 'inativo', label: 'Inativos', cor: 'slate' },
                      { v: 'prospecto', label: 'Prospectos', cor: 'blue' },
                      { v: 'bloqueado', label: 'Bloqueados', cor: 'red' },
                      { v: 'todos', label: 'Todos', cor: 'amber' },
                    ].map(opt => {
                      const count = opt.v === 'todos' ? todosFaltantes.length : (contagemStatus[opt.v] || 0);
                      const ativo = filtroStatus === opt.v;
                      return (
                        <button
                          key={opt.v}
                          onClick={() => { setFiltroStatus(opt.v); setSelecionados(new Set()); }}
                          className={`px-2 py-1 rounded border transition ${
                            ativo
                              ? 'bg-amber-500 border-amber-600 text-neutral-900 font-semibold'
                              : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {opt.label} ({count})
                        </button>
                      );
                    })}
                  </div>
                  {(() => {
                    const semDocSelecionados = filtrados.filter(c => selecionados.has(c.id) && !(c.cnpj_cpf || '').replace(/\D/g, '')).length;
                    const semDocTotal = todosFaltantes.filter(c => !(c.cnpj_cpf || '').replace(/\D/g, '')).length;
                    return (
                      <div className="space-y-1">
                        <div className="text-xs text-slate-600">
                          {selecionados.size} selecionado(s) de {filtrados.length} listado(s) — Total faltantes: <b>{todosFaltantes.length}</b>
                        </div>
                        {semDocTotal > 0 && (
                          <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                            ⚠️ <b>{semDocTotal}</b> faltantes estão SEM CPF/CNPJ e serão ignorados (Omie exige documento).
                            {semDocSelecionados > 0 && ` Dos selecionados: ${semDocSelecionados} serão pulados.`}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="border rounded-lg overflow-auto max-h-[40vh]">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100 sticky top-0">
                        <tr>
                          <th className="p-2 text-left w-10">
                            <Checkbox
                              checked={filtrados.length > 0 && selecionados.size === filtrados.length}
                              onCheckedChange={toggleAll}
                            />
                          </th>
                          <th className="p-2 text-left">Código</th>
                          <th className="p-2 text-left">Razão Social</th>
                          <th className="p-2 text-left">Fantasia</th>
                          <th className="p-2 text-left">CNPJ/CPF</th>
                          <th className="p-2 text-left">Cidade/UF</th>
                          <th className="p-2 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtrados.map(c => (
                          <tr key={c.id} className="border-t hover:bg-amber-50">
                            <td className="p-2">
                              <Checkbox
                                checked={selecionados.has(c.id)}
                                onCheckedChange={() => toggleOne(c.id)}
                              />
                            </td>
                            <td className="p-2 font-mono">{c.codigo || '-'}</td>
                            <td className="p-2">{c.razao_social}</td>
                            <td className="p-2 text-slate-500">{c.nome_fantasia || '-'}</td>
                            <td className="p-2 font-mono text-slate-700">{c.cnpj_cpf || '-'}</td>
                            <td className="p-2 text-slate-500">
                              {c.cidade ? `${c.cidade}/${c.estado || '?'}` : '-'}
                            </td>
                            <td className="p-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] ${
                                c.tipo_nota === 'D1' ? 'bg-orange-100 text-orange-700' :
                                c.status === 'ativo' ? 'bg-emerald-100 text-emerald-700' :
                                'bg-slate-100 text-slate-600'
                              }`}>
                                {c.tipo_nota === 'D1' ? 'D1' : c.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {progressoExport && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                        <p className="font-medium text-amber-900">
                          {progressoExport.fase === 'carregando'
                            ? `Carregando dados: ${progressoExport.atual}/${progressoExport.total}`
                            : `Lote ${progressoExport.lote}/${progressoExport.totalLotes} — ${progressoExport.atual} de ${progressoExport.total} enviados ao Omie`}
                        </p>
                      </div>
                      <div className="w-full bg-amber-200 rounded-full h-2">
                        <div
                          className="bg-amber-600 h-2 rounded-full transition-all"
                          style={{ width: `${(progressoExport.atual / progressoExport.total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {resultadoExport && (
                    <div className="border rounded-lg p-3 bg-slate-50 space-y-2">
                      <div className="flex gap-4 items-center">
                        <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                        <div className="flex-1">
                          <p className="font-semibold">
                            {resultadoExport.totalOk} exportado(s) com sucesso
                            {resultadoExport.totalErro > 0 && ` | ${resultadoExport.totalErro} com erro`}
                          </p>
                        </div>
                      </div>
                      {resultadoExport.erros.length > 0 && (
                        <div className="max-h-40 overflow-auto border rounded bg-white p-2">
                          <p className="text-xs font-medium text-red-700 mb-1 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> Erros:
                          </p>
                          {resultadoExport.erros.map((e, i) => (
                            <div key={i} className="text-xs border-b py-1 last:border-0">
                              <span className="font-medium">{e.razao_social}</span>:
                              <span className="text-red-600 ml-1">{e.mensagem}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <DialogFooter className="border-t pt-3">
          <Button variant="outline" onClick={fechar} disabled={exportando}>
            Fechar
          </Button>
          {todosFaltantes.length > 0 && (
            <Button
              onClick={exportarSelecionados}
              disabled={exportando || selecionados.size === 0}
              className="bg-amber-500 hover:bg-amber-600 text-neutral-900 font-semibold"
            >
              {exportando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              {exportando ? 'Exportando...' : `Exportar ${selecionados.size} ao Omie`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}