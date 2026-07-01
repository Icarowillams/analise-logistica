import React, { useState, useMemo, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  ArrowRight, Search, Loader2, AlertTriangle, CheckCircle2, RefreshCw, Users, FileSpreadsheet,
} from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import { ArrowLeftRight } from 'lucide-react';

function ultimasCompetencias(n = 6) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) out.push(new Date(d.getFullYear(), d.getMonth() - i, 1).toISOString().slice(0, 7));
  return out;
}

function competenciaLabel(c) {
  if (!c) return '';
  const [ano, mes] = c.split('-').map(Number);
  const nomes = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${nomes[mes - 1]}/${ano}`;
}

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function TransferirCarteira() {
  const qc = useQueryClient();
  const [origemId, setOrigemId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [reativarVendas, setReativarVendas] = useState(false);
  const [competencia, setCompetencia] = useState(ultimasCompetencias()[0]);
  const [previewResult, setPreviewResult] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [omieState, setOmieState] = useState(null); // { total, done, pendentes:[] }

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores-transferir-carteira'],
    queryFn: () => base44.entities.Vendedor.list('-status,-nome', 5000),
  });

  // Ordenar: ativos primeiro, depois inativos/afastados, tudo alfabético dentro de cada grupo
  const vendedoresOrdenados = useMemo(() => {
    return [...vendedores].sort((a, b) => {
      const sa = a.status === 'ativo' ? 0 : 1;
      const sb = b.status === 'ativo' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return (a.nome || '').localeCompare(b.nome || '');
    });
  }, [vendedores]);

  const nomeVendedor = useCallback(
    (id) => vendedores.find((v) => v.id === id)?.nome || '(desconhecido)',
    [vendedores],
  );

  const podePreview = origemId && destinoId && origemId !== destinoId && !previewLoading && !executing;

  const fazerPreview = async () => {
    setPreviewLoading(true);
    setPreviewResult(null);
    setOmieState(null);
    try {
      const r = await base44.functions.invoke('transferirCarteiraVendedor', {
        vendedor_origem_id: origemId,
        vendedor_destino_id: destinoId,
        reativar_vendas: reativarVendas,
        competencia: reativarVendas ? competencia : null,
        preview: true,
      });
      if (r.data?.error) throw new Error(r.data.error);
      setPreviewResult(r.data);
    } catch (e) {
      toast.error('Erro no preview: ' + e.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Sync Omie resiliente: chunks de 5, throttle 600ms, 1 retry, isolamento de falha
  const syncOmie = useCallback(async (clienteIds) => {
    const CHUNK = 5;
    const THROTTLE = 600;
    const pendentes = [];
    let done = 0;

    setOmieState({ total: clienteIds.length, done: 0, pendentes: [] });

    for (let i = 0; i < clienteIds.length; i += CHUNK) {
      const batch = clienteIds.slice(i, i + CHUNK);
      const results = await Promise.allSettled(
        batch.map(async (cid) => {
          const call = () => base44.functions.invoke('enviarClienteOmie', { cliente_id: cid });
          try {
            const r = await call();
            if (r.data?.sucesso === false) throw new Error(r.data.erro || 'Falha Omie');
            return { id: cid, ok: true };
          } catch (e) {
            // 1 retry
            await new Promise((r) => setTimeout(r, 1200));
            try {
              const r2 = await call();
              if (r2.data?.sucesso === false) throw new Error(r2.data.erro || 'Falha Omie');
              return { id: cid, ok: true };
            } catch (e2) {
              return { id: cid, ok: false, erro: e2.message };
            }
          }
        }),
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value?.ok) {
          done++;
        } else {
          const val = r.status === 'fulfilled' ? r.value : { id: '?', ok: false, erro: r.reason?.message };
          pendentes.push(val);
        }
      }
      setOmieState({ total: clienteIds.length, done, pendentes: [...pendentes] });
      if (i + CHUNK < clienteIds.length) await new Promise((r) => setTimeout(r, THROTTLE));
    }
    return pendentes;
  }, []);

  const executar = async () => {
    if (!podePreview) return;
    const origemNome = nomeVendedor(origemId);
    const destinoNome = nomeVendedor(destinoId);
    const msg =
      `CONFIRMAR TRANSFERÊNCIA DE CARTEIRA\n\n` +
      `Origem: ${origemNome}\nDestino: ${destinoNome}\n` +
      `${reativarVendas ? `Reatribuir vendas: ${competenciaLabel(competencia)}\n` : ''}` +
      `\nEsta operação atualiza ${previewResult?.total_clientes || '?'} cliente(s) no banco e dispara sync Omie. Continuar?`;
    if (!window.confirm(msg)) return;

    setExecuting(true);
    setOmieState(null);
    try {
      const r = await base44.functions.invoke('transferirCarteiraVendedor', {
        vendedor_origem_id: origemId,
        vendedor_destino_id: destinoId,
        reativar_vendas: reativarVendas,
        competencia: reativarVendas ? competencia : null,
        preview: false,
      });
      if (r.data?.error) throw new Error(r.data.error);

      const res = r.data;
      toast.success(`${res.clientes_atualizados} clientes transferidos para ${res.vendedor_destino_nome}`);

      // Iniciar sync Omie se houver clientes
      if (res.cliente_ids?.length > 0) {
        const pendentes = await syncOmie(res.cliente_ids);
        if (pendentes.length > 0) {
          toast.warning(`Sync Omie: ${pendentes.length} pendente(s) — clique em "Reenviar Pendentes"`);
        } else {
          toast.success(`Sync Omie concluído: ${res.cliente_ids.length} cliente(s) sincronizados`);
        }
      }

      qc.invalidateQueries({ queryKey: ['vendedores-transferir-carteira'] });
    } catch (e) {
      toast.error('Erro na transferência: ' + e.message);
    } finally {
      setExecuting(false);
    }
  };

  const reenviarPendentes = async () => {
    if (!omieState?.pendentes?.length) return;
    const ids = omieState.pendentes.map((p) => p.id).filter(Boolean);
    if (ids.length === 0) return;
    setExecuting(true);
    try {
      const pendentes = await syncOmie(ids);
      if (pendentes.length === 0) {
        toast.success(`Pendentes reenviados com sucesso: ${ids.length} cliente(s)`);
      } else {
        toast.warning(`${ids.length - pendentes.length} sincronizados, ${pendentes.length} ainda pendente(s)`);
      }
    } catch (e) {
      toast.error('Erro no reenvio: ' + e.message);
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <PageHeader icon={ArrowLeftRight} title="Transferir Carteira de Vendedor" subtitle="Move clientes entre vendedores + sync Omie" />

      {/* Seleção origem → destino */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase text-slate-500">Vendedor de Origem</Label>
              <Select value={origemId} onValueChange={(v) => { setOrigemId(v); setPreviewResult(null); setOmieState(null); }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Selecionar origem..." /></SelectTrigger>
                <SelectContent>
                  {vendedoresOrdenados.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      <span className="flex items-center gap-2">
                        {v.nome}
                        {v.status !== 'ativo' && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 text-red-600 border-red-300">
                            {v.status}
                          </Badge>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-center pb-2">
              <ArrowRight className="w-5 h-5 text-slate-400" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase text-slate-500">Vendedor de Destino</Label>
              <Select value={destinoId} onValueChange={(v) => { setDestinoId(v); setPreviewResult(null); setOmieState(null); }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Selecionar destino..." /></SelectTrigger>
                <SelectContent>
                  {vendedoresOrdenados.filter((v) => v.status === 'ativo').map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Opções */}
          <div className="flex flex-col sm:flex-row gap-4 pt-2 border-t">
            <div className="flex items-center gap-2">
              <Checkbox
                id="reativar"
                checked={reativarVendas}
                onCheckedChange={(v) => { setReativarVendas(v === true); setPreviewResult(null); setOmieState(null); }}
              />
              <Label htmlFor="reativar" className="text-sm cursor-pointer">
                Reatribuir vendas no espelho (NFs por competência)
              </Label>
            </div>
            {reativarVendas && (
              <div className="flex items-center gap-2">
                <Label className="text-xs text-slate-500">Competência:</Label>
                <Select value={competencia} onValueChange={(v) => { setCompetencia(v); setPreviewResult(null); }}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ultimasCompetencias().map((c) => <SelectItem key={c} value={c}>{competenciaLabel(c)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Botões */}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={fazerPreview} disabled={!podePreview}>
              {previewLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Search className="w-4 h-4 mr-1" />}
              Preview
            </Button>
            {previewResult && (
              <Button onClick={executar} disabled={executing} className="bg-amber-500 hover:bg-amber-600 text-white">
                {executing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-1" />}
                Executar Transferência
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Resultado do preview */}
      {previewResult && (
        <Card className="border-blue-200 bg-blue-50/40">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-800">
              <Search className="w-4 h-4" />
              Preview: {previewResult.vendedor_origem_nome} → {previewResult.vendedor_destino_nome}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-lg p-3 border">
                <div className="flex items-center gap-1 text-xs text-slate-500"><Users className="w-3 h-3" /> Clientes</div>
                <p className="text-xl font-bold text-slate-800">{previewResult.total_clientes}</p>
              </div>
              {previewResult.reativar_vendas && (
                <>
                  <div className="bg-white rounded-lg p-3 border">
                    <div className="flex items-center gap-1 text-xs text-slate-500"><FileSpreadsheet className="w-3 h-3" /> NFs no período</div>
                    <p className="text-xl font-bold text-slate-800">{previewResult.total_nfs_periodo}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 border">
                    <div className="flex items-center gap-1 text-xs text-slate-500"><CheckCircle2 className="w-3 h-3" /> Comissionáveis</div>
                    <p className="text-xl font-bold text-slate-800">{previewResult.nfs_comissionavel}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 border">
                    <div className="text-xs text-slate-500">Valor vendas</div>
                    <p className="text-xl font-bold text-emerald-600">{brl(previewResult.valor_venda_periodo)}</p>
                  </div>
                </>
              )}
            </div>
            {previewResult.amostra_clientes?.length > 0 && (
              <div className="text-xs text-slate-500">
                <span className="font-medium">Amostra: </span>
                {previewResult.amostra_clientes.map((c) => c.nome).join(', ')}
                {previewResult.total_clientes > 10 && ` ... (+${previewResult.total_clientes - 10})`}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Progresso sync Omie */}
      {omieState && (
        <Card className={omieState.pendentes.length > 0 ? 'border-amber-300' : 'border-emerald-300'}>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <RefreshCw className={`w-4 h-4 ${executing ? 'animate-spin' : ''}`} />
                Sync Omie: {omieState.done}/{omieState.total} sincronizados
              </div>
              {omieState.pendentes.length > 0 && !executing && (
                <Button size="sm" variant="outline" onClick={reenviarPendentes}>
                  <RefreshCw className="w-3 h-3 mr-1" /> Reenviar Pendentes ({omieState.pendentes.length})
                </Button>
              )}
            </div>
            {/* Barra de progresso */}
            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${omieState.total > 0 ? (omieState.done / omieState.total) * 100 : 0}%` }}
              />
            </div>
            {omieState.pendentes.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-xs font-medium text-amber-700">
                  <AlertTriangle className="w-3 h-3" /> Pendentes:
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {omieState.pendentes.map((p, idx) => (
                    <div key={idx} className="text-xs text-slate-600 bg-amber-50 rounded px-2 py-1 border border-amber-100">
                      <span className="font-mono">{p.id?.slice(-8) || '?'}</span> — {p.erro}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Aviso */}
      <div className="text-xs text-slate-400 space-y-1">
        <p>• A transferência atualiza <strong>Cliente.vendedor_id</strong> (carteira) e, se marcado, <strong>EspelhoFaturamentoNF</strong> (vendas do período).</p>
        <p>• O sync Omie envia cada cliente ao UpsertCliente em chunks de 5 com throttle 600ms. Falhas ficam como pendentes para reenvio.</p>
        <p>• <strong>Não recalcula comissão</strong> — rode o Scorecard manualmente após a transferência.</p>
        <p>• Vendedores inativos aparecem na origem (para transferir carteira de demitidos). Destino só mostra ativos.</p>
      </div>
    </div>
  );
}