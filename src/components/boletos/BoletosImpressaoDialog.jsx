import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, FileText, Layers } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

const BATCH_SIZE = 4; // PDFs baixados em paralelo

const base64ToUint8Array = (b64) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
};

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};

export default function BoletosImpressaoDialog({ open, onOpenChange, titulos = [], modo = 'individual' }) {
  const [carregando, setCarregando] = useState(false);
  const [progresso, setProgresso] = useState({ feito: 0, total: 0, erros: 0 });

  const baixarPdf = async (titulo) => {
    const { data } = await base44.functions.invoke('baixarPdfBoletoOmie', {
      codigo_lancamento: titulo.codigo_lancamento,
      url_boleto: titulo.url_boleto || undefined
    });
    if (!data?.sucesso) throw new Error(data?.error || 'Falha ao baixar PDF');
    return base64ToUint8Array(data.pdf_base64);
  };

  // Processa lote em paralelo
  const processarLote = async (lote, onProgress) => {
    const resultados = await Promise.allSettled(lote.map(t => baixarPdf(t)));
    const saida = [];
    resultados.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        saida.push({ titulo: lote[idx], bytes: r.value, ok: true });
      } else {
        const msg = r.reason?.message || 'Erro';
        saida.push({ titulo: lote[idx], ok: false, erro: msg });
        const docRef = lote[idx].numero_documento || lote[idx].codigo_lancamento;
        const naoGerado = /404|não disponível|nao disponivel|status code 404/i.test(msg);
        if (naoGerado) {
          toast.error(`Boleto do documento ${docRef}: ainda não foi gerado no Omie. Emita primeiro na aba "Emissão de Boletos".`);
        } else {
          toast.error(`Boleto ${docRef}: ${msg}`);
        }
      }
      onProgress();
    });
    return saida;
  };

  const gerarPdf = async () => {
    if (titulos.length === 0) return;
    setCarregando(true);
    let feito = 0;
    let erros = 0;
    setProgresso({ feito: 0, total: titulos.length, erros: 0 });
    const onProgress = () => { feito++; setProgresso(p => ({ ...p, feito })); };

    try {
      // Tanto 'agrupado' quanto 'individual': 1 PDF por boleto.
      for (let i = 0; i < titulos.length; i += BATCH_SIZE) {
        const lote = titulos.slice(i, i + BATCH_SIZE);
        const resultados = await processarLote(lote, onProgress);
        for (const r of resultados) {
          if (!r.ok) { erros++; continue; }
          const nome = `boleto_${r.titulo.numero_documento || r.titulo.codigo_lancamento}.pdf`;
          downloadBlob(new Blob([r.bytes], { type: 'application/pdf' }), nome);
        }
      }
      toast.success(`${titulos.length - erros} boleto(s) baixado(s)${erros > 0 ? ` — ${erros} falha(s)` : ''}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(e.message);
    }
    setCarregando(false);
    setProgresso({ feito: 0, total: 0, erros: 0 });
  };

  const percentual = progresso.total > 0 ? Math.round((progresso.feito / progresso.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {modo === 'agrupado' ? <Layers className="w-5 h-5 text-cyan-600" /> : <FileText className="w-5 h-5 text-cyan-600" />}
            {modo === 'agrupado' ? 'Imprimir Agrupado' : 'Imprimir Boletos'}
          </DialogTitle>
        </DialogHeader>

        <div className="text-sm text-slate-600">
          <b>{titulos.length}</b> boleto(s) selecionado(s)
          {modo === 'agrupado' && ' — Será baixado um PDF para cada boleto selecionado'}
        </div>

        {carregando && (
          <div className="space-y-2">
            <Progress value={percentual} className="h-2" />
            <p className="text-xs text-slate-500 text-center">
              {progresso.feito}/{progresso.total} processados ({percentual}%)
            </p>
          </div>
        )}

        <Button onClick={gerarPdf} disabled={carregando || titulos.length === 0} className="w-full bg-cyan-600 hover:bg-cyan-700 text-white">
          {carregando ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Baixando {progresso.feito}/{progresso.total}…</>
          ) : (
            <>{modo === 'agrupado' ? <Layers className="w-4 h-4 mr-2" /> : <FileText className="w-4 h-4 mr-2" />} Gerar PDF</>
          )}
        </Button>

        <p className="text-xs text-slate-500">
          {titulos.length > 1
            ? `Downloads em lotes de ${BATCH_SIZE} — mais rápido que individual.`
            : 'O PDF será baixado diretamente, sem redirecionar para o Omie.'}
        </p>
      </DialogContent>
    </Dialog>
  );
}