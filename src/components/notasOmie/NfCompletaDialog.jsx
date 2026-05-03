import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Download, ExternalLink, FileJson, FileText } from 'lucide-react';

function baixarTexto(nome, conteudo, tipo = 'application/json') {
  const blob = new Blob([conteudo], { type: `${tipo};charset=utf-8` });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = nome;
  link.click();
  URL.revokeObjectURL(link.href);
}

function abrirUrl(url) {
  if (url) window.open(url, '_blank');
}

function Linha({ label, value }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-slate-800">{value || '-'}</p>
    </div>
  );
}

export default function NfCompletaDialog({ open, onOpenChange, detalhe }) {
  if (!detalhe) return null;

  const resumo = detalhe.resumo || {};
  const dfe = detalhe.dfe || {};
  const itens = detalhe.detalhe_nf?.det || [];
  const total = detalhe.detalhe_nf?.total?.ICMSTot || {};
  const jsonCompleto = JSON.stringify(detalhe, null, 2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-amber-500" />
            Extração completa da NF-e {resumo.numero || ''}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <Linha label="Número" value={resumo.numero} />
              <Linha label="Emissão" value={resumo.emissao} />
              <Linha label="Cliente" value={resumo.cliente} />
              <Linha label="Valor" value={resumo.valor ? `R$ ${Number(resumo.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-'} />
            </div>

            <Linha label="Chave NF-e" value={resumo.chave} />

            <div className="rounded-xl border bg-amber-50 p-4">
              <h3 className="font-semibold text-slate-900 mb-3">Arquivos e documentos extraídos do Omie</h3>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => abrirUrl(dfe.pdf_danfe)} disabled={!dfe.pdf_danfe}>
                  <ExternalLink className="w-4 h-4 mr-2" /> DANFE/PDF
                </Button>
                <Button size="sm" variant="outline" onClick={() => abrirUrl(dfe.danfe_simplificado)} disabled={!dfe.danfe_simplificado}>
                  <ExternalLink className="w-4 h-4 mr-2" /> DANFE Simplificado
                </Button>
                <Button size="sm" variant="outline" onClick={() => abrirUrl(dfe.pedido_pdf)} disabled={!dfe.pedido_pdf}>
                  <ExternalLink className="w-4 h-4 mr-2" /> PDF Pedido
                </Button>
                <Button size="sm" variant="outline" onClick={() => abrirUrl(dfe.portal)} disabled={!dfe.portal}>
                  <ExternalLink className="w-4 h-4 mr-2" /> Portal Omie
                </Button>
                <Button size="sm" variant="outline" onClick={() => baixarTexto(`nfe-${resumo.numero || 'omie'}.xml`, dfe.xml || '', 'application/xml')} disabled={!dfe.xml}>
                  <Download className="w-4 h-4 mr-2" /> Baixar XML
                </Button>
                <Button size="sm" variant="outline" onClick={() => baixarTexto(`nfe-${resumo.numero || 'omie'}-completa.json`, jsonCompleto)}>
                  <FileJson className="w-4 h-4 mr-2" /> Baixar JSON completo
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Linha label="Base ICMS" value={total.vBC} />
              <Linha label="ICMS" value={total.vICMS} />
              <Linha label="Produtos" value={total.vProd} />
              <Linha label="Total NF" value={total.vNF} />
              <Linha label="Frete" value={total.vFrete} />
              <Linha label="Desconto" value={total.vDesc} />
              <Linha label="PIS" value={total.vPIS} />
              <Linha label="COFINS" value={total.vCOFINS} />
            </div>

            <div className="rounded-xl border bg-white overflow-hidden">
              <div className="p-3 border-b bg-slate-50 flex items-center justify-between">
                <h3 className="font-semibold">Itens da NF-e</h3>
                <Badge variant="outline">{itens.length} item(ns)</Badge>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-600">
                    <tr>
                      <th className="p-2 text-left">Código</th>
                      <th className="p-2 text-left">Descrição</th>
                      <th className="p-2 text-right">Qtd</th>
                      <th className="p-2 text-right">Unitário</th>
                      <th className="p-2 text-right">Total</th>
                      <th className="p-2 text-left">NCM/CFOP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itens.map((item, index) => {
                      const prod = item.prod || {};
                      return (
                        <tr key={index} className="border-t">
                          <td className="p-2 font-mono">{prod.cProd || prod.codigo_produto || '-'}</td>
                          <td className="p-2">{prod.xProd || prod.descricao || '-'}</td>
                          <td className="p-2 text-right">{prod.qCom || prod.quantidade || '-'}</td>
                          <td className="p-2 text-right">{prod.vUnCom || prod.valor_unitario || '-'}</td>
                          <td className="p-2 text-right">{prod.vProd || prod.valor_total || '-'}</td>
                          <td className="p-2">{prod.NCM || prod.ncm || '-'} / {prod.CFOP || prod.cfop || '-'}</td>
                        </tr>
                      );
                    })}
                    {itens.length === 0 && (
                      <tr><td colSpan="6" className="p-6 text-center text-slate-500">Nenhum item retornado no detalhe.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-xl border bg-slate-950 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-white">JSON bruto completo</h3>
                <Button size="sm" variant="secondary" onClick={() => baixarTexto(`nfe-${resumo.numero || 'omie'}-completa.json`, jsonCompleto)}>
                  Baixar
                </Button>
              </div>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs text-slate-100">{jsonCompleto}</pre>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}