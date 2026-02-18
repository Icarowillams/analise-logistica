import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, RefreshCw, AlertTriangle, Loader2, Search } from 'lucide-react';

export default function SincronizarOmieClientesModal({ open, onOpenChange }) {
  const [etapa, setEtapa] = useState('idle'); // idle | verificando | resultado | sincronizando | concluido
  const [verificacao, setVerificacao] = useState(null);
  const [progresso, setProgresso] = useState(0);
  const [processado, setProcessado] = useState(0);
  const [sucessos, setSucessos] = useState(0);
  const [erros, setErros] = useState(0);
  const [todosResultados, setTodosResultados] = useState([]);

  const handleVerificar = async () => {
    setEtapa('verificando');
    setVerificacao(null);
    try {
      const res = await base44.functions.invoke('sincronizarClientesOmie', { modo: 'verificar' });
      setVerificacao(res.data);
      setEtapa('resultado');
    } catch (err) {
      toast.error('Erro ao verificar: ' + err.message);
      setEtapa('idle');
    }
  };

  const handleSincronizar = async () => {
    if (!verificacao || verificacao.clientes_faltando.length === 0) return;

    const ids = verificacao.clientes_faltando.map(c => c.id);
    setEtapa('sincronizando');
    setProgresso(0);
    setProcessado(0);
    setSucessos(0);
    setErros(0);
    setTodosResultados([]);

    let loteAtual = 0;
    let accResultados = [];
    let accSucessos = 0;
    let accErros = 0;

    while (true) {
      try {
        const res = await base44.functions.invoke('sincronizarClientesOmie', {
          modo: 'sincronizar',
          ids_para_enviar: ids,
          lote_inicio: loteAtual
        });
        const data = res.data;

        accResultados = [...accResultados, ...data.resultados];
        accSucessos += data.resumo.sucessos;
        accErros += data.resumo.erros;

        setTodosResultados([...accResultados]);
        setSucessos(accSucessos);
        setErros(accErros);
        setProcessado(accResultados.length);
        setProgresso((accResultados.length / ids.length) * 100);

        if (data.concluido) {
          setEtapa('concluido');
          if (accErros === 0) {
            toast.success(`✅ ${accSucessos} cliente(s) sincronizados com sucesso!`);
          } else {
            toast.warning(`⚠️ ${accSucessos} sincronizados, ${accErros} com erro`);
          }
          break;
        }
        loteAtual = data.proximo_lote;
      } catch (err) {
        toast.error('Erro durante sincronização: ' + err.message);
        setEtapa('resultado');
        break;
      }
    }
  };

  const handleClose = () => {
    setEtapa('idle');
    setVerificacao(null);
    setTodosResultados([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img
              src="https://www.omie.com.br/wp-content/themes/flavor-flavor-flavor/lib/assets/img/logo-omie.svg"
              alt="Omie"
              className="h-6"
            />
            Sincronizar Clientes → Omie
          </DialogTitle>
          <DialogDescription>
            Verifica quais clientes do Base44 ainda não existem no Omie e os envia automaticamente.
          </DialogDescription>
        </DialogHeader>

        {/* IDLE */}
        {etapa === 'idle' && (
          <div className="space-y-6 py-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
              <p className="font-semibold mb-1">Como funciona?</p>
              <ol className="list-decimal list-inside space-y-1 text-blue-700">
                <li>Busca todos os clientes cadastrados no Base44</li>
                <li>Busca todos os clientes existentes no Omie</li>
                <li>Compara pelos campos: código de integração e CPF/CNPJ</li>
                <li>Exibe quais estão faltando no Omie</li>
                <li>Envia os clientes faltantes via UpsertCliente</li>
              </ol>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleVerificar} className="btn-pao-mel">
                <Search className="w-4 h-4 mr-2" />
                Verificar agora
              </Button>
            </div>
          </div>
        )}

        {/* VERIFICANDO */}
        {etapa === 'verificando' && (
          <div className="flex flex-col items-center gap-4 py-10">
            <Loader2 className="w-10 h-10 animate-spin text-amber-500" />
            <p className="text-slate-600 text-sm">Comparando Base44 com Omie...</p>
            <p className="text-xs text-slate-400">Isso pode levar alguns segundos dependendo do volume de clientes.</p>
          </div>
        )}

        {/* RESULTADO DA VERIFICAÇÃO */}
        {etapa === 'resultado' && verificacao && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-slate-800">{verificacao.total_base44}</p>
                <p className="text-xs text-slate-500">No Base44</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-green-600">{verificacao.ja_existem_no_omie}</p>
                <p className="text-xs text-green-600">Já no Omie</p>
              </div>
              <div className={`rounded-lg p-3 text-center ${verificacao.faltando_no_omie > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                <p className={`text-xl font-bold ${verificacao.faltando_no_omie > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {verificacao.faltando_no_omie}
                </p>
                <p className={`text-xs ${verificacao.faltando_no_omie > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  Faltando no Omie
                </p>
              </div>
            </div>

            {verificacao.faltando_no_omie === 0 ? (
              <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
                <CheckCircle className="w-6 h-6 text-green-600 shrink-0" />
                <p className="text-green-800 font-medium">Todos os clientes já estão sincronizados com o Omie!</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                  <p className="text-amber-800 text-sm">
                    <strong>{verificacao.faltando_no_omie} cliente(s)</strong> do Base44 não foram encontrados no Omie. Clique em "Sincronizar" para enviá-los.
                  </p>
                </div>

                <ScrollArea className="h-[200px] border rounded-lg">
                  <div className="p-2 space-y-1">
                    {verificacao.clientes_faltando.map((c) => (
                      <div key={c.id} className="flex items-center gap-3 p-2 rounded hover:bg-slate-50">
                        <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{c.razao_social}</p>
                          {c.nome_fantasia && c.nome_fantasia !== c.razao_social && (
                            <p className="text-xs text-slate-400 truncate">{c.nome_fantasia}</p>
                          )}
                        </div>
                        <span className="text-xs text-slate-400 shrink-0">{c.cpf_cnpj || 'Sem CPF/CNPJ'}</span>
                        <Badge variant={c.status === 'ativo' ? 'default' : 'secondary'} className="shrink-0 text-xs">
                          {c.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}

            <div className="flex justify-between pt-2 border-t">
              <Button variant="outline" onClick={handleVerificar}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Reverificar
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose}>Fechar</Button>
                {verificacao.faltando_no_omie > 0 && (
                  <Button onClick={handleSincronizar} className="btn-pao-mel">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Sincronizar {verificacao.faltando_no_omie} cliente(s)
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SINCRONIZANDO */}
        {etapa === 'sincronizando' && (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-slate-600">
                <span>Enviando clientes para o Omie...</span>
                <span>{processado} / {verificacao?.faltando_no_omie}</span>
              </div>
              <Progress value={progresso} className="h-3" />
              <div className="flex justify-center gap-6 text-sm">
                <span className="text-green-600">✅ {sucessos} sucesso(s)</span>
                <span className="text-red-600">❌ {erros} erro(s)</span>
              </div>
            </div>
            <p className="text-xs text-center text-slate-400">Não feche esta janela durante a sincronização.</p>
          </div>
        )}

        {/* CONCLUÍDO */}
        {etapa === 'concluido' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-slate-800">{processado}</p>
                <p className="text-xs text-slate-500">Total enviado</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-green-600">{sucessos}</p>
                <p className="text-xs text-green-600">Sucesso</p>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-red-600">{erros}</p>
                <p className="text-xs text-red-600">Erros</p>
              </div>
            </div>

            <ScrollArea className="h-[220px] border rounded-lg">
              <div className="p-2 space-y-1">
                {todosResultados.map((r, i) => (
                  <div key={i} className={`flex items-center gap-3 p-2 rounded ${r.sucesso ? 'bg-green-50' : 'bg-red-50'}`}>
                    {r.sucesso
                      ? <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
                      : <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.razao_social}</p>
                      <p className={`text-xs truncate ${r.sucesso ? 'text-green-600' : 'text-red-600'}`}>{r.mensagem}</p>
                    </div>
                    {r.codigo_omie && <span className="text-xs text-slate-400 shrink-0">#{r.codigo_omie}</span>}
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={handleVerificar}>
                <Search className="w-4 h-4 mr-2" />
                Verificar novamente
              </Button>
              <Button onClick={handleClose} className="btn-pao-mel">Fechar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}