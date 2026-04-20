import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Link2, Play, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

/**
 * Modal que executa a importação/vinculação dos clientes Omie → Base44 (por CNPJ/CPF).
 * Processa uma página por vez via backend `importarClientesOmie`, atualizando o progresso ao vivo.
 */
export default function VincularOmieModal({ open, onOpenChange }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [stats, setStats] = useState({
    novos_vinculos: 0,
    ja_vinculados: 0,
    nao_encontrados: 0,
    erros: 0
  });
  const [mensagemAtual, setMensagemAtual] = useState('');

  const reset = () => {
    setRunning(false);
    setDone(false);
    setCurrentPage(0);
    setTotalPages(0);
    setStats({ novos_vinculos: 0, ja_vinculados: 0, nao_encontrados: 0, erros: 0 });
    setMensagemAtual('');
  };

  const iniciar = async () => {
    reset();
    setRunning(true);
    setMensagemAtual('Conectando ao Omie…');

    try {
      let pagina = 1;
      let totalPaginas = 1;
      let acumulado = { novos_vinculos: 0, ja_vinculados: 0, nao_encontrados: 0, erros: 0 };

      while (pagina <= totalPaginas) {
        setCurrentPage(pagina);
        setMensagemAtual(`Processando página ${pagina}${totalPaginas > 1 ? `/${totalPaginas}` : ''}…`);

        const res = await base44.functions.invoke('importarClientesOmie', { pagina });
        const d = res.data;
        if (d.error) throw new Error(d.error);

        totalPaginas = d.total_paginas;
        setTotalPages(totalPaginas);

        acumulado = {
          novos_vinculos: acumulado.novos_vinculos + (d.nesta_pagina?.novos_vinculos || 0),
          ja_vinculados: acumulado.ja_vinculados + (d.nesta_pagina?.ja_vinculados || 0),
          nao_encontrados: acumulado.nao_encontrados + (d.nesta_pagina?.nao_encontrados || 0),
          erros: acumulado.erros + (d.nesta_pagina?.erros || 0)
        };
        setStats({ ...acumulado });

        if (d.concluido) break;
        pagina = d.proxima_pagina;
      }

      setDone(true);
      setMensagemAtual('Concluído!');
      toast.success(`✅ ${acumulado.novos_vinculos} novos vínculos criados, ${acumulado.ja_vinculados} já estavam vinculados`);
    } catch (err) {
      toast.error('❌ ' + err.message);
      setMensagemAtual('Erro: ' + err.message);
    } finally {
      setRunning(false);
    }
  };

  const progresso = totalPages > 0 ? (currentPage / totalPages) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!running) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-blue-500" />
            Vincular Clientes do Omie
          </DialogTitle>
          <DialogDescription>
            Busca todos os clientes no Omie e vincula o <code className="px-1 bg-slate-100 rounded">codigo_omie</code> aos registros do Base44 via CNPJ/CPF.
            Não cria clientes novos — apenas atualiza o vínculo dos existentes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {!running && !done && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
              <p className="font-medium mb-1">O que acontece:</p>
              <ul className="list-disc list-inside space-y-0.5 text-blue-800">
                <li>Busca todos os clientes do Omie (~30 páginas)</li>
                <li>Compara por CNPJ/CPF com os clientes locais</li>
                <li>Atualiza <code className="px-1 bg-blue-100 rounded">codigo_omie</code> quando houver match</li>
                <li>Pode levar alguns minutos</li>
              </ul>
            </div>
          )}

          {(running || done) && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-slate-600">
                  <span>{mensagemAtual}</span>
                  <span>{currentPage} / {totalPages || '?'}</span>
                </div>
                <Progress value={progresso} className="h-2" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="text-xs text-green-700 font-medium">Novos vínculos</div>
                  <div className="text-2xl font-bold text-green-900">{stats.novos_vinculos}</div>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <div className="text-xs text-slate-600 font-medium">Já vinculados</div>
                  <div className="text-2xl font-bold text-slate-900">{stats.ja_vinculados}</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="text-xs text-amber-700 font-medium">Não encontrados</div>
                  <div className="text-2xl font-bold text-amber-900">{stats.nao_encontrados}</div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <div className="text-xs text-red-700 font-medium">Erros</div>
                  <div className="text-2xl font-bold text-red-900">{stats.erros}</div>
                </div>
              </div>
            </>
          )}

          {done && stats.erros > 0 && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{stats.erros} atualizações falharam. Você pode executar novamente para tentar reprocessá-las.</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            {!running && !done && (
              <Button onClick={iniciar} className="bg-blue-600 hover:bg-blue-700">
                <Play className="w-4 h-4 mr-2" /> Iniciar Importação
              </Button>
            )}
            {running && (
              <Button disabled className="bg-blue-600">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processando…
              </Button>
            )}
            {done && (
              <>
                <Button variant="outline" onClick={iniciar}>
                  <Play className="w-4 h-4 mr-2" /> Executar Novamente
                </Button>
                <Button onClick={() => { onOpenChange(false); reset(); }}>
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Fechar
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}