import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FileText, FileJson, Download, Loader2, Layers, Files } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { PDFDocument } from 'pdf-lib';

/**
 * Modal de "tipo de impressão" para 1 ou N NF-es selecionadas.
 *
 * Modos:
 *  - "individual": gera 1 arquivo POR NF (PDFs separados, XMLs separados, JSONs separados).
 *  - "agrupado":   gera 1 ÚNICO arquivo final.
 *      • PDF        → mescla todos os DANFEs num único PDF (via pdf-lib).
 *      • XML/JSON   → faz download de cada um (não há como mesclar XML/JSON validamente).
 *
 * Não redireciona para portal do Omie — o backend baixa o PDF e devolve em base64.
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export default function NfsImpressaoDialog({ open, onOpenChange, nfs = [], modo = 'individual' }) {
  const [tipoLoading, setTipoLoading] = useState(null);
  const [progresso, setProgresso] = useState({ atual: 0, total: 0 });

  const fechar = () => { setTipoLoading(null); setProgresso({ atual: 0, total: 0 }); onOpenChange(false); };

  const baixarBlob = (nome, blob) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = nome;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  };

  const baixarTexto = (nome, conteudo, mime = 'application/json') => {
    baixarBlob(nome, new Blob([conteudo], { type: `${mime};charset=utf-8` }));
  };

  const base64ToUint8Array = (b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  };

  const fetchDetalhe = async (nf) => {
    const { data } = await base44.functions.invoke('consultarDetalheNotaOmie', {
      nIdNF: nf.nIdNF || nf.nCodNF,
      nCodNF: nf.nCodNF || nf.nIdNF,
      nNF: nf.cNumero,
      nIdPedido: nf.nIdPedido
    });
    if (!data?.sucesso) throw new Error(data?.error || `Falha ao obter NF ${nf.cNumero}`);
    return data;
  };

  const fetchPdfBytes = async (nf) => {
    const { data, status } = await base44.functions.invoke('baixarPdfDanfeOmie', {
      nIdNF: nf.nIdNF || nf.nCodNF,
      nCodNF: nf.nCodNF || nf.nIdNF,
      nNF: nf.cNumero,
      nIdPedido: nf.nIdPedido
    });
    if (!data?.sucesso) {
      const motivo = data?.motivo || 'erro';
      const msg = motivo === 'aguardando_sefaz' 
        ? `NF ${nf.cNumero}: aguardando SEFAZ` 
        : (data?.error || `Falha ao obter PDF da NF ${nf.cNumero}`);
      const err = new Error(msg);
      err.motivo = motivo;
      throw err;
    }
    return base64ToUint8Array(data.pdf_base64);
  };

  const handlePdf = async () => {
    setTipoLoading('pdf');
    const total = nfs.length;
    setProgresso({ atual: 0, total });
    const falhas = [];
    const falhasSefaz = [];

    try {
      if (modo === 'individual') {
        for (let i = 0; i < nfs.length; i++) {
          const nf = nfs[i];
          setProgresso({ atual: i + 1, total });
          try {
            const bytes = await fetchPdfBytes(nf);
            if (!bytes || bytes.length === 0) { falhas.push(nf.cNumero || '?'); continue; }
            baixarBlob(`nfe-${nf.cNumero || 'omie'}.pdf`, new Blob([bytes], { type: 'application/pdf' }));
          } catch (err) { 
            if (err.motivo === 'aguardando_sefaz') falhasSefaz.push(nf.cNumero || '?');
            else falhas.push(nf.cNumero || '?'); 
          }
          if (i < nfs.length - 1) await sleep(500);
        }
        const totalFalhas = falhas.length + falhasSefaz.length;
        const ok = total - totalFalhas;
        if (ok > 0) toast.success(`${ok} PDF(s) gerado(s)`);
        if (falhasSefaz.length > 0) toast.warning(`${falhasSefaz.length} NF(s) aguardando SEFAZ (tente novamente em alguns minutos): ${falhasSefaz.join(', ')}`, { duration: 8000 });
        if (falhas.length > 0) toast.warning(`${falhas.length} NF(s) não baixadas: ${falhas.join(', ')}`);
        if (ok === 0) toast.error('Nenhuma NF pôde ser baixada.');
      } else {
        const merged = await PDFDocument.create();
        for (let i = 0; i < nfs.length; i++) {
          const nf = nfs[i];
          setProgresso({ atual: i + 1, total });
          try {
            const bytes = await fetchPdfBytes(nf);
            if (!bytes || bytes.length === 0) { falhas.push(nf.cNumero || '?'); continue; }
            const src = await PDFDocument.load(bytes);
            const pages = await merged.copyPages(src, src.getPageIndices());
            pages.forEach(p => merged.addPage(p));
          } catch (err) { 
            if (err.motivo === 'aguardando_sefaz') falhasSefaz.push(nf.cNumero || '?');
            else falhas.push(nf.cNumero || '?'); 
          }
          if (i < nfs.length - 1) await sleep(500);
        }
        const totalFalhas = falhas.length + falhasSefaz.length;
        const ok = total - totalFalhas;
        if (ok === 0) { 
          if (falhasSefaz.length > 0) toast.error(`Todas as ${falhasSefaz.length} NF(s) estão aguardando processamento SEFAZ. Tente novamente em alguns minutos.`, { duration: 8000 });
          else toast.error('Nenhuma NF pôde ser baixada.'); 
          setTipoLoading(null); return; 
        }
        const out = await merged.save();
        baixarBlob(`nfes-agrupadas-${ok}.pdf`, new Blob([out], { type: 'application/pdf' }));
        toast.success(`PDF agrupado com ${ok} de ${total} NF(s) gerado`);
        if (falhasSefaz.length > 0) toast.warning(`${falhasSefaz.length} NF(s) aguardando SEFAZ (tente novamente em minutos): ${falhasSefaz.join(', ')}`, { duration: 8000 });
        if (falhas.length > 0) toast.warning(`${falhas.length} NF(s) ignoradas: ${falhas.join(', ')}`);
      }
      fechar();
    } catch (e) {
      toast.error(e.message);
    }
    setTipoLoading(null);
  };

  const handleXml = async () => {
    setTipoLoading('xml');
    try {
      for (const nf of nfs) {
        const det = await fetchDetalhe(nf);
        const xml = det.dfe?.xml;
        if (!xml) { toast.warning(`NF ${nf.cNumero}: XML não disponível`); continue; }
        baixarTexto(`nfe-${nf.cNumero || 'omie'}.xml`, xml, 'application/xml');
      }
      toast.success(`XML(s) baixado(s)`);
      fechar();
    } catch (e) {
      toast.error(e.message);
    }
    setTipoLoading(null);
  };

  const handleJson = async () => {
    setTipoLoading('json');
    try {
      for (const nf of nfs) {
        const det = await fetchDetalhe(nf);
        baixarTexto(`nfe-${nf.cNumero || 'omie'}.json`, JSON.stringify(det, null, 2));
      }
      toast.success(`JSON(s) baixado(s)`);
      fechar();
    } catch (e) {
      toast.error(e.message);
    }
    setTipoLoading(null);
  };

  const titulo = modo === 'agrupado' ? 'Imprimir Agrupado' : 'Imprimir';
  const descricao = modo === 'agrupado'
    ? `${nfs.length} NF(s) selecionada(s) — PDF será mesclado em um único arquivo`
    : `${nfs.length} NF(s) selecionada(s) — um arquivo separado por NF`;
  const Icone = modo === 'agrupado' ? Layers : Files;

  return (
    <Dialog open={open} onOpenChange={(v) => !tipoLoading && onOpenChange(v)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icone className="w-5 h-5 text-cyan-600" />
            {titulo}
          </DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>

        {tipoLoading && progresso.total > 0 && (
          <div className="pt-2 space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>Baixando NF {progresso.atual} de {progresso.total}...</span>
              <span>{Math.round((progresso.atual / progresso.total) * 100)}%</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-2">
              <div
                className="bg-cyan-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(progresso.atual / progresso.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        <div className="space-y-2 pt-2">
          <Button
            className="w-full justify-start bg-cyan-600 hover:bg-cyan-700 text-white"
            onClick={handlePdf}
            disabled={!!tipoLoading || nfs.length === 0}
          >
            {tipoLoading === 'pdf'
              ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              : <FileText className="w-4 h-4 mr-2" />}
            {modo === 'agrupado' ? 'Gerar PDF único (todas mescladas)' : 'Gerar PDF (uma por NF)'}
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={handleXml}
            disabled={!!tipoLoading || nfs.length === 0}
          >
            {tipoLoading === 'xml'
              ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              : <Download className="w-4 h-4 mr-2" />}
            Baixar XML
          </Button>

          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={handleJson}
            disabled={!!tipoLoading || nfs.length === 0}
          >
            {tipoLoading === 'json'
              ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              : <FileJson className="w-4 h-4 mr-2" />}
            Baixar JSON
          </Button>
        </div>

        <p className="text-xs text-slate-500 pt-2 border-t">
          {modo === 'agrupado'
            ? 'O PDF será baixado diretamente, sem redirecionar para o Omie.'
            : 'Cada arquivo será baixado separadamente, sem redirecionar para o Omie.'}
        </p>
      </DialogContent>
    </Dialog>
  );
}