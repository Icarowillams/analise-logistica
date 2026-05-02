import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Loader2, Search, AlertCircle, CheckCircle2, Send, Download, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Audita Base44 vs Omie e permite exportar em massa os clientes que faltam no Omie.
 * Resolve o erro "Cliente não cadastrado no Omie. Exporte o cliente primeiro."
 */
export default function AuditoriaOmieModal({ open, onOpenChange }) {
  const [comparando, setComparando] = useState(false);
  const [resumo, setResumo] = useState(null);
  const [faltantes, setFaltantes] = useState([]);
  const [busca, setBusca] = useState('');
  const [selecionados, setSelecionados] = useState(new Set());
  const [exportando, setExportando] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const [resultadoExport, setResultadoExport] = useState(null);
  const queryClient = useQueryClient();

  const comparar = async () => {
    setComparando(true);
    setResumo(null);
    setFaltantes([]);
    setSelecionados(new Set());
    setResultadoExport(null);
    try {
      const res = await base44.functions.invoke('consultarClientesOmie', { acao: 'comparar' });
      if (res.data?.error) {
        toast.error('❌ ' + res.data.error);
        return;
      }
      const lista = (res.data?.lista_so_base44 || []).filter(c => c.status !== 'inativo');
      setResumo({
        total_base44: res.data.total_base44,
        total_omie: res.data.total_omie,
        iguais: res.data.iguais,
        so_no_base44: lista.length,
      });
      setFaltantes(lista);
      // Pré-seleciona todos
      setSelecionados(new Set(lista.map(c => c.id)));
      toast.success(`Comparação concluída: ${lista.length} cliente(s) faltam no Omie`);
    } catch (e) {
      toast.error('❌ Erro: ' + e.message);
    } finally {
      setComparando(false);
    }
  };

  const filtrados = faltantes.filter(c => {
    if (!busca.trim()) return true;
    const s = busca.toLowerCase();
    return (
      (c.razao_social || '').toLowerCase().includes(s) ||
      (c.nome_fantasia || '').toLowerCase().includes(s) ||
      (c.cpf_cnpj || '').includes(s) ||
      (c.codigo || '').toLowerCase().includes(s)
    );
  });

  const toggleAll = () => {
    if (selecionados.size === filtrados.length) {
      setSelecionados(new Set());
    } else {
      setSelecionados(new Set(filtrados.map(c => c.id)));
    }
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

    // Buscar dados completos dos clientes selecionados
    const ids = Array.from(selecionados);
    const completos = [];
    for (const id of ids) {
      try {
        const c = await base44.entities.Cliente.get(id);
        if (c) completos.push(c);
      } catch (_) {}
    }

    if (completos.length === 0) {
      setExportando(false);
      toast.error('Não foi possível carregar dados dos clientes');
      return;
    }

    // Enviar em lotes de 30 para evitar timeout
    const LOTE = 30;
    let totalOk = 0;
    let totalErro = 0;
    const erros = [];

    for (let i = 0; i < completos.length; i += LOTE) {
      const batch = completos.slice(i, i + LOTE);
      const loteNum = Math.floor(i / LOTE) + 1;
      const totalLotes = Math.ceil(completos.length / LOTE);
      setProgresso({ atual: i, total: completos.length, lote: loteNum, totalLotes });

      try {
        const res = await base44.functions.invoke('exportarClientesOmie', {
          clientes_data: batch,
          modo: 'upsert'
        });
        const resumoLote = res.data?.resumo;
        if (resumoLote) {
          totalOk += resumoLote.sucessos || 0;
          totalErro += resumoLote.erros || 0;
        }
        const resultadosLote = res.data?.resultados || [];
        resultadosLote.filter(r => !r.sucesso).forEach(r => {
          erros.push({ razao_social: r.razao_social, mensagem: r.mensagem });
        });
      } catch (e) {
        totalErro += batch.length;
        batch.forEach(c => erros.push({ razao_social: c.razao_social, mensagem: e.message }));
      }
    }

    setProgresso(null);
    setExportando(false);
    setResultadoExport({ totalOk, totalErro, erros: erros.slice(0, 50) });
    queryClient.invalidateQueries(['clientes']);
    if (totalErro === 0) {
      toast.success(`✅ ${totalOk} cliente(s) exportado(s) ao Omie!`);
    } else {
      toast.warning(`${totalOk} ok | ${totalErro} com erro`);
    }
  };

  const baixarCSV = () => {
    if (faltantes.length === 0) return;
    const headers = ['codigo', 'razao_social', 'nome_fantasia', 'cpf_cnpj', 'status'];
    const linhas = faltantes.map(c => [
      c.codigo || '', c.razao_social || '', c.nome_fantasia || '', c.cpf_cnpj || '', c.status || ''
    ]);
    const csv = [headers.join(';'), ...linhas.map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `clientes_faltantes_omie_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const fechar = () => {
    setResumo(null); setFaltantes([]); setSelecionados(new Set());
    setBusca(''); setResultadoExport(null); setProgresso(null);
    onOpenChange(false);
  };

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
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-blue-900">
              Compara <b>todos</b> os clientes ativos da sua base com o Omie. Lista os que <b>existem aqui mas NÃO no Omie</b> —
              que é o que causa o erro <i>"Cliente não cadastrado no Omie. Exporte o cliente primeiro"</i> ao faturar.
            </p>
            <p className="text-blue-800 mt-1 text-xs">
              Comparação por: <b>código de integração</b>, <b>ID</b> e <b>CPF/CNPJ</b>.
            </p>
          </div>

          {!resumo && (
            <Button onClick={comparar} disabled={comparando} className="w-full bg-emerald-600 hover:bg-emerald-700">
              {comparando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              {comparando ? 'Comparando bases (pode levar 1-2 min)...' : 'Iniciar Auditoria'}
            </Button>
          )}

          {resumo && (
            <>
              <div className="grid grid-cols-4 gap-2">
                <div className="border rounded-lg p-2 bg-slate-50 text-center">
                  <p className="text-xs text-slate-500">Base44</p>
                  <p className="text-xl font-bold">{resumo.total_base44}</p>
                </div>
                <div className="border rounded-lg p-2 bg-slate-50 text-center">
                  <p className="text-xs text-slate-500">Omie</p>
                  <p className="text-xl font-bold">{resumo.total_omie}</p>
                </div>
                <div className="border rounded-lg p-2 bg-emerald-50 border-emerald-200 text-center">
                  <p className="text-xs text-emerald-600">Sincronizados</p>
                  <p className="text-xl font-bold text-emerald-700">{resumo.iguais}</p>
                </div>
                <div className="border rounded-lg p-2 bg-red-50 border-red-200 text-center">
                  <p className="text-xs text-red-600">Faltam no Omie</p>
                  <p className="text-xl font-bold text-red-700">{resumo.so_no_base44}</p>
                </div>
              </div>

              {faltantes.length === 0 ? (
                <div className="text-center py-8 text-emerald-600">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-2" />
                  <p className="font-semibold">100% sincronizado!</p>
                  <p className="text-xs text-slate-500">Todos os clientes ativos estão no Omie.</p>
                </div>
              ) : (
                <>
                  <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input
                        value={busca}
                        onChange={e => setBusca(e.target.value)}
                        placeholder="Buscar por razão social, CNPJ, código..."
                        className="pl-8"
                      />
                    </div>
                    <Button variant="outline" size="sm" onClick={baixarCSV}>
                      <Download className="w-4 h-4 mr-1" /> CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setResumo(null); comparar(); }}>
                      Recomparar
                    </Button>
                  </div>

                  <div className="text-xs text-slate-600">
                    {selecionados.size} selecionado(s) de {filtrados.length} listado(s)
                  </div>

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
                            <td className="p-2 font-mono text-slate-500">{c.cpf_cnpj || '-'}</td>
                            <td className="p-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] ${c.status === 'ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                {c.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {progresso && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Loader2 className="w-4 h-4 animate-spin text-amber-600" />
                        <p className="font-medium text-amber-900">
                          Lote {progresso.lote}/{progresso.totalLotes} — {progresso.atual} de {progresso.total} processados
                        </p>
                      </div>
                      <div className="w-full bg-amber-200 rounded-full h-2">
                        <div
                          className="bg-amber-600 h-2 rounded-full transition-all"
                          style={{ width: `${(progresso.atual / progresso.total) * 100}%` }}
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
          {faltantes.length > 0 && (
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