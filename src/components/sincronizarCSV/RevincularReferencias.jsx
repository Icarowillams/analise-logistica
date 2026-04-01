import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Upload, Loader2, CheckCircle, AlertTriangle, Link2,
  Play, XCircle, Table2, CreditCard, Wallet
} from 'lucide-react';

const BATCH_SIZE = 30;
const DELAY_ENTRE_LOTES = 2000;
const esperarMs = (ms) => new Promise(r => setTimeout(r, ms));

const invocarComRetry = async (fnName, params, maxRetries = 4) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await base44.functions.invoke(fnName, params);
    } catch (e) {
      const status = e?.response?.status;
      const msg = e?.response?.data?.error || e.message || '';
      const isRetryable = status === 500 || status === 429 || msg.includes('Rate limit');
      if (isRetryable && attempt < maxRetries - 1) {
        await esperarMs(6000 * Math.pow(2, attempt));
        continue;
      }
      throw e;
    }
  }
};

export default function RevincularReferencias() {
  const [etapa, setEtapa] = useState('idle'); // idle | verificando | resultado | executando | concluido
  const [arquivo, setArquivo] = useState(null);
  const [csvUrl, setCsvUrl] = useState('');
  const [analise, setAnalise] = useState(null);
  const [erroMsg, setErroMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progresso, setProgresso] = useState({ total: 0, atual: 0, ok: 0, erros: 0 });
  const [errosExec, setErrosExec] = useState([]);
  const [executando, setExecutando] = useState(false);
  const cancelRef = useRef(false);

  const handleUploadEAnalisar = async () => {
    if (!arquivo) return;
    setErroMsg('');
    setUploading(true);
    setEtapa('verificando');
    try {
      let fileUrl = csvUrl;
      if (arquivo) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file: arquivo });
        fileUrl = file_url;
        setCsvUrl(file_url);
      }
      const res = await base44.functions.invoke('revincularReferenciasCSV', {
        csv_url: fileUrl, etapa: 'analise'
      });
      setAnalise(res.data);
      setEtapa('resultado');
    } catch (err) {
      setErroMsg(err?.response?.data?.error || err.message);
      setEtapa('idle');
    } finally {
      setUploading(false);
    }
  };

  const executarAtualizacao = async () => {
    if (!csvUrl || !analise) return;
    cancelRef.current = false;
    setExecutando(true);
    setEtapa('executando');
    setErrosExec([]);
    setProgresso({ total: analise.total_atualizar, atual: 0, ok: 0, erros: 0 });

    let ok = 0, erros = 0;
    const allErros = [];
    let offset = 0;
    let concluido = false;

    while (!concluido && !cancelRef.current) {
      try {
        const res = await invocarComRetry('revincularReferenciasCSV', {
          csv_url: csvUrl, etapa: 'executar', offset, batch_size: BATCH_SIZE
        });
        const d = res.data;
        ok += d.processados || 0;
        erros += d.erros || 0;
        if (d.erros_detalhes) allErros.push(...d.erros_detalhes);
        offset = d.nextOffset || 0;
        concluido = d.concluido;
        setProgresso({ total: d.total, atual: Math.min(offset, d.total), ok, erros });
        if (!concluido) await esperarMs(DELAY_ENTRE_LOTES);
      } catch (e) {
        allErros.push(`Erro: ${e.message}`);
        concluido = true;
      }
    }

    setErrosExec(allErros);
    setExecutando(false);
    setEtapa('concluido');
  };

  const handleReset = () => {
    setEtapa('idle');
    setArquivo(null);
    setCsvUrl('');
    setAnalise(null);
    setErroMsg('');
    setProgresso({ total: 0, atual: 0, ok: 0, erros: 0 });
    setErrosExec([]);
  };

  const pct = progresso.total > 0 ? Math.round((progresso.atual / progresso.total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* IDLE */}
      {etapa === 'idle' && (
        <Card>
          <CardContent className="py-8 space-y-4">
            <div className="text-center">
              <Link2 className="w-12 h-12 mx-auto text-purple-500 mb-2" />
              <h3 className="text-lg font-semibold">Revincular Referências via CSV</h3>
              <p className="text-sm text-slate-500 max-w-lg mx-auto mt-1">
                Atualiza <strong>Tabela de Preço</strong>, <strong>Plano de Pagamento</strong> e <strong>Cobrança (Modalidade)</strong> de todos os clientes 
                com base nos nomes que estão no CSV. Use quando as tabelas foram recriadas e os clientes ficaram sem vínculo.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-3 max-w-lg mx-auto">
              <Input
                type="file"
                accept=".csv"
                onChange={(e) => setArquivo(e.target.files?.[0] || null)}
                className="flex-1"
              />
              <Button
                onClick={handleUploadEAnalisar}
                disabled={!arquivo || uploading}
                className="bg-purple-600 hover:bg-purple-700 text-white whitespace-nowrap"
              >
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                Analisar CSV
              </Button>
            </div>
            {erroMsg && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 text-center max-w-lg mx-auto">
                {erroMsg}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* VERIFICANDO */}
      {etapa === 'verificando' && (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <Loader2 className="w-10 h-10 mx-auto text-purple-500 animate-spin" />
            <p className="text-sm text-slate-600">Analisando referências do CSV...</p>
          </CardContent>
        </Card>
      )}

      {/* RESULTADO */}
      {etapa === 'resultado' && analise && (
        <>
          {/* Resumo geral */}
          <Card>
            <CardContent className="py-6">
              <h3 className="font-semibold text-slate-800 mb-4">Diagnóstico de Referências</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-slate-800">{analise.total_csv}</p>
                  <p className="text-xs text-slate-500">Clientes no CSV</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-slate-800">{analise.total_sistema}</p>
                  <p className="text-xs text-slate-500">Clientes no Base44</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-purple-700">{analise.total_atualizar}</p>
                  <p className="text-xs text-purple-600">A revincular</p>
                </div>
              </div>

              {/* Campos sem referência atual */}
              <h4 className="text-sm font-medium text-slate-700 mb-2">Clientes sem referência no Base44:</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                  <Table2 className="w-5 h-5 text-red-500 shrink-0" />
                  <div>
                    <p className="text-lg font-bold text-red-700">{analise.sem_tabela}</p>
                    <p className="text-xs text-red-600">Sem Tabela Preço</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <CreditCard className="w-5 h-5 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-lg font-bold text-amber-700">{analise.sem_plano}</p>
                    <p className="text-xs text-amber-600">Sem Plano Pgto</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <Wallet className="w-5 h-5 text-blue-500 shrink-0" />
                  <div>
                    <p className="text-lg font-bold text-blue-700">{analise.sem_modalidade}</p>
                    <p className="text-xs text-blue-600">Sem Cobrança</p>
                  </div>
                </div>
              </div>

              {/* Alertas de não resolvidos */}
              {(analise.tabela_nao_resolvida > 0 || analise.plano_nao_resolvido > 0 || analise.modalidade_nao_resolvida > 0) && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <div className="text-sm text-amber-800">
                      <p className="font-medium">Nomes do CSV não encontrados no Base44:</p>
                      <ul className="list-disc ml-4 mt-1 text-xs">
                        {analise.tabela_nao_resolvida > 0 && <li>{analise.tabela_nao_resolvida} tabela(s) de preço</li>}
                        {analise.plano_nao_resolvido > 0 && <li>{analise.plano_nao_resolvido} plano(s) de pagamento</li>}
                        {analise.modalidade_nao_resolvida > 0 && <li>{analise.modalidade_nao_resolvida} modalidade(s) de cobrança</li>}
                      </ul>
                      <p className="mt-1 text-xs">Verifique se os cadastros existem antes de executar.</p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Preview */}
          {analise.preview && analise.preview.length > 0 && (
            <Card>
              <CardContent className="py-4">
                <h4 className="text-sm font-semibold text-slate-700 mb-3">
                  Preview ({Math.min(analise.preview.length, 50)} de {analise.total_atualizar})
                </h4>
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="text-left p-2">Código</th>
                        <th className="text-left p-2">Cliente</th>
                        <th className="text-left p-2">Tabela (CSV → Base44)</th>
                        <th className="text-left p-2">Plano (CSV → Base44)</th>
                        <th className="text-left p-2">Cobrança (CSV → Base44)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analise.preview.map((item, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="p-2 font-mono">{item.codigo}</td>
                          <td className="p-2 max-w-[150px] truncate">{item.nome}</td>
                          <td className="p-2">
                            {item.mudou_tabela ? (
                              <span>
                                <span className="text-slate-400">{item.csv_tabela}</span>
                                <span className="mx-1">→</span>
                                <span className={item.resolvido_tabela.includes('NÃO') ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                                  {item.resolvido_tabela}
                                </span>
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="p-2">
                            {item.mudou_plano ? (
                              <span>
                                <span className="text-slate-400">{item.csv_plano}</span>
                                <span className="mx-1">→</span>
                                <span className={item.resolvido_plano.includes('NÃO') ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                                  {item.resolvido_plano}
                                </span>
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="p-2">
                            {item.mudou_modalidade ? (
                              <span>
                                <span className="text-slate-400">{item.csv_cobranca}</span>
                                <span className="mx-1">→</span>
                                <span className={item.resolvido_modalidade.includes('NÃO') ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                                  {item.resolvido_modalidade}
                                </span>
                              </span>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Ações */}
          <div className="flex flex-wrap gap-3 justify-center pt-4">
            <Button variant="outline" onClick={handleReset}>Voltar</Button>
            {analise.total_atualizar > 0 ? (
              <Button onClick={executarAtualizacao} className="bg-purple-600 hover:bg-purple-700 text-white">
                <Play className="w-4 h-4 mr-2" /> Revincular {analise.total_atualizar} clientes
              </Button>
            ) : (
              <Badge className="bg-green-100 text-green-700 text-sm py-2 px-4">
                <CheckCircle className="w-4 h-4 mr-1" /> Todas as referências já estão corretas!
              </Badge>
            )}
          </div>
        </>
      )}

      {/* EXECUTANDO / CONCLUIDO */}
      {(etapa === 'executando' || etapa === 'concluido') && (
        <>
          <Card>
            <CardContent className="py-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-800">Revinculando Referências</h3>
                {etapa === 'concluido' ? (
                  <Badge className="bg-green-100 text-green-700"><CheckCircle className="w-3 h-3 mr-1" /> Concluído</Badge>
                ) : (
                  <Badge className="bg-purple-100 text-purple-700"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Executando...</Badge>
                )}
              </div>
              <Progress value={pct} className="h-3" />
              <div className="flex justify-between text-sm text-slate-600">
                <span>{progresso.atual} / {progresso.total}</span>
                <span className="text-green-600">{progresso.ok} ok</span>
                {progresso.erros > 0 && <span className="text-red-600">{progresso.erros} erros</span>}
              </div>
              {errosExec.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 max-h-40 overflow-y-auto">
                  <p className="text-xs font-medium text-red-700 mb-1">Erros:</p>
                  {errosExec.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-center pt-4">
            {etapa === 'executando' && (
              <Button variant="destructive" onClick={() => { cancelRef.current = true; }}>
                <XCircle className="w-4 h-4 mr-2" /> Cancelar
              </Button>
            )}
            {etapa === 'concluido' && (
              <Button variant="outline" onClick={handleReset}>Voltar</Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}