import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Loader2, FileText, Layers } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { PDFDocument } from 'pdf-lib';

const CONCORRENCIA = 1; // 1 por vez — evita "consumo redundante" (código 6) do Omie
const DELAY_ENTRE_BOLETOS_MS = 900; // espaçamento entre chamadas consecutivas
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

export default function BoletosImpressaoDialog({ open, onOpenChange, titulos = [], modo = 'individual', numeroCarga }) {
  const [carregando, setCarregando] = useState(false);
  const [progresso, setProgresso] = useState({ feito: 0, total: 0, erros: 0 });
  const [mesclando, setMesclando] = useState(false);

  const reportarErro = (titulo, msg) => {
    const docRef = titulo.numero_documento || titulo.codigo_lancamento;
    const naoGerado = /404|n[ãa]o (foi )?gerado|n[ãa]o dispon[íi]vel|sem boleto|cLinkBoleto|status code 404/i.test(msg);
    if (naoGerado) {
      toast.error(`Boleto do documento ${docRef}: ainda não foi gerado no Omie. Emita primeiro na aba "Emissão de Boletos".`);
    } else {
      toast.error(`Boleto ${docRef}: ${msg}`);
    }
  };

  const baixarPdf = async (titulo) => {
    const { data } = await base44.functions.invoke('baixarPdfBoletoOmie', {
      codigo_lancamento: titulo.codigo_lancamento,
      url_boleto: titulo.url_boleto || undefined
    });
    if (!data?.sucesso) throw new Error(data?.error || 'Falha ao baixar PDF');
    return base64ToUint8Array(data.pdf_base64);
  };

  // Baixa 1 boleto com até 4 tentativas em erros temporários do Omie.
  // Código 6 (consumo redundante): espera o tempo informado na mensagem.
  const baixarComRetry = async (titulo) => {
    const ESPERAS = [3000, 6000, 12000, 20000];
    let ultimoErro;
    for (let t = 0; t <= ESPERAS.length; t++) {
      try {
        return await baixarPdf(titulo);
      } catch (e) {
        ultimoErro = e;
        const msg = (e.message || '');
        const docRef = titulo.numero_documento || titulo.codigo_lancamento;
        // Código 6: extrai o tempo da mensagem "Aguarde X segundos"
        const matchCod6 = msg.match(/(\d+)\s*segundo/i);
        const redundante = /redundante|aguarde|consumo/i.test(msg);
        const temporario = redundante || /j[áa] existe uma requisi|1880|cota|limite|bloqueada|timeout/i.test(msg);
        if (!temporario || t === ESPERAS.length) throw e;
        const waitMs = matchCod6 && redundante
          ? Math.min((parseInt(matchCod6[1]) + 2) * 1000, 60000)
          : ESPERAS[t];
        console.log(`[BoletosImpressao] Retry ${t + 1}/${ESPERAS.length} para ${docRef} → aguardando ${waitMs}ms (${msg.slice(0, 80)})`);
        await sleep(waitMs);
      }
    }
    throw ultimoErro;
  };

  // Baixa TODOS os boletos sequencialmente, com delay entre chamadas para
  // evitar o anti-flood "consumo redundante" (código 6) da Omie.
  const baixarTodos = async () => {
    let feito = 0;
    let erros = 0;
    const resultados = [];
    for (let idx = 0; idx < titulos.length; idx++) {
      const titulo = titulos[idx];
      // Espaçar chamadas — evita que o Omie detecte "consumo redundante"
      if (idx > 0) await sleep(DELAY_ENTRE_BOLETOS_MS);
      try {
        const pdf = await baixarComRetry(titulo);
        feito++;
        setProgresso(p => ({ ...p, feito, erros }));
        resultados.push({ ok: true, item: titulo, value: pdf });
      } catch (e) {
        erros++;
        feito++;
        reportarErro(titulo, e.message || 'Erro');
        setProgresso(p => ({ ...p, feito, erros }));
        resultados.push({ ok: false, item: titulo, error: e });
      }
    }
    return resultados;
  };

  // Individual: 1 PDF por boleto. Download paralelo, depois salva cada um.
  const gerarIndividual = async () => {
    const resultados = await baixarTodos();
    let erros = 0;
    for (const r of resultados) {
      if (!r.ok) { erros++; continue; }
      const docRef = r.item.numero_documento || r.item.codigo_lancamento;
      downloadBlob(new Blob([r.value], { type: 'application/pdf' }), `boleto_${docRef}.pdf`);
    }
    toast.success(`${titulos.length - erros} boleto(s) baixado(s)${erros > 0 ? ` — ${erros} falha(s)` : ''}`);
    if (erros === 0) onOpenChange(false);
  };

  // Agrupado: download paralelo, depois mescla na ordem original num único PDF.
  const gerarAgrupado = async () => {
    const resultados = await baixarTodos();
    let erros = 0;
    let incluidos = 0;
    const merged = await PDFDocument.create();

    for (const r of resultados) {
      if (!r.ok) { erros++; continue; }
      try {
        const src = await PDFDocument.load(r.value);
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach(p => merged.addPage(p));
        incluidos++;
      } catch {
        erros++;
      }
    }

    if (incluidos === 0) {
      toast.error('Nenhum boleto pôde ser mesclado.');
      return;
    }
    setMesclando(true);
    const mergedBytes = await merged.save();
    const nome = `boletos_carga_${numeroCarga || titulos.length}.pdf`;
    downloadBlob(new Blob([mergedBytes], { type: 'application/pdf' }), nome);
    toast.success(`${incluidos} boleto(s) mesclado(s) em um único PDF${erros > 0 ? ` — ${erros} falha(s)` : ''}`);
    if (erros === 0) onOpenChange(false);
  };

  const gerarPdf = async () => {
    if (titulos.length === 0) return;
    setCarregando(true);
    setMesclando(false);
    setProgresso({ feito: 0, total: titulos.length, erros: 0 });
    try {
      if (modo === 'agrupado') await gerarAgrupado();
      else await gerarIndividual();
    } catch (e) {
      toast.error(e.message);
    }
    setCarregando(false);
    setMesclando(false);
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
          {modo === 'agrupado' && ' — Todos os boletos serão mesclados em um único PDF para impressão'}
        </div>

        {carregando && (
          <div className="space-y-2">
            <Progress value={mesclando ? 100 : percentual} className="h-2" />
            <p className="text-xs text-slate-500 text-center">
              {mesclando
                ? 'Mesclando PDFs…'
                : `Baixando boleto ${Math.min(progresso.feito + 1, progresso.total)} de ${progresso.total} (${percentual}%)`}
              {progresso.erros > 0 && <span className="text-red-600"> — {progresso.erros} falha(s)</span>}
            </p>
          </div>
        )}

        <Button onClick={gerarPdf} disabled={carregando || titulos.length === 0} className="w-full bg-cyan-600 hover:bg-cyan-700 text-white">
          {carregando ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {mesclando ? 'Mesclando PDFs…' : `Baixando ${progresso.feito}/${progresso.total}…`}</>
          ) : (
            <>{modo === 'agrupado' ? <Layers className="w-4 h-4 mr-2" /> : <FileText className="w-4 h-4 mr-2" />} Gerar PDF</>
          )}
        </Button>

        <p className="text-xs text-slate-500">
          {modo === 'agrupado'
            ? 'Os boletos são baixados sequencialmente e mesclados em um único PDF para impressão.'
            : 'Os PDFs são baixados sequencialmente, sem redirecionar para o Omie.'}
        </p>
      </DialogContent>
    </Dialog>
  );
}