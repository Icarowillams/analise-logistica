import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, Layers } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { PDFDocument } from 'pdf-lib';

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
  const [progresso, setProgresso] = useState({ feito: 0, total: 0 });

  const baixarPdf = async (titulo) => {
    const { data } = await base44.functions.invoke('baixarPdfBoletoOmie', {
      codigo_lancamento: titulo.codigo_lancamento,
      url_boleto: titulo.url_boleto || undefined
    });
    if (!data?.sucesso) throw new Error(data?.error || 'Falha ao baixar PDF');
    return base64ToUint8Array(data.pdf_base64);
  };

  const gerarPdf = async () => {
    if (titulos.length === 0) return;
    setCarregando(true);
    setProgresso({ feito: 0, total: titulos.length });
    try {
      if (modo === 'agrupado' && titulos.length > 1) {
        const merged = await PDFDocument.create();
        for (let i = 0; i < titulos.length; i++) {
          try {
            const bytes = await baixarPdf(titulos[i]);
            const src = await PDFDocument.load(bytes);
            const pages = await merged.copyPages(src, src.getPageIndices());
            pages.forEach(p => merged.addPage(p));
          } catch (e) {
            toast.error(`Boleto ${titulos[i].numero_documento || titulos[i].codigo_lancamento}: ${e.message}`);
          }
          setProgresso({ feito: i + 1, total: titulos.length });
        }
        const bytes = await merged.save();
        downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `boletos_${titulos.length}.pdf`);
        toast.success('PDF agrupado gerado');
      } else {
        for (let i = 0; i < titulos.length; i++) {
          try {
            const bytes = await baixarPdf(titulos[i]);
            const nome = `boleto_${titulos[i].numero_documento || titulos[i].codigo_lancamento}.pdf`;
            downloadBlob(new Blob([bytes], { type: 'application/pdf' }), nome);
          } catch (e) {
            toast.error(`Boleto ${titulos[i].numero_documento || titulos[i].codigo_lancamento}: ${e.message}`);
          }
          setProgresso({ feito: i + 1, total: titulos.length });
        }
        toast.success(`${titulos.length} boleto(s) baixado(s)`);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e.message);
    }
    setCarregando(false);
  };

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
          {modo === 'agrupado' && titulos.length > 1 && ' — PDF será mesclado em um único arquivo'}
        </div>

        <Button onClick={gerarPdf} disabled={carregando || titulos.length === 0} className="w-full bg-cyan-600 hover:bg-cyan-700 text-white">
          {carregando ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {progresso.feito}/{progresso.total}</>
          ) : (
            <>{modo === 'agrupado' ? <Layers className="w-4 h-4 mr-2" /> : <FileText className="w-4 h-4 mr-2" />} Gerar PDF</>
          )}
        </Button>

        <p className="text-xs text-slate-500">O PDF será baixado diretamente, sem redirecionar para o Omie.</p>
      </DialogContent>
    </Dialog>
  );
}