import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, CheckCircle, XCircle, Search, Upload, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function ExportarFaltantesOmieModal({ open, onOpenChange }) {
  const [etapa, setEtapa] = useState('inicio'); // inicio, verificando, lista, exportando, resultado
  const [faltantes, setFaltantes] = useState([]);
  const [existentes, setExistentes] = useState([]);
  const [resultados, setResultados] = useState([]);
  const [totais, setTotais] = useState({ base44: 0, omie: 0 });

  const handleVerificar = async () => {
    setEtapa('verificando');
    const res = await base44.functions.invoke('exportarProdutosFaltantes', { acao: 'verificar' });
    const d = res.data;
    if (d.sucesso) {
      setFaltantes(d.faltantes);
      setExistentes(d.existentes);
      setTotais({ base44: d.total_base44, omie: d.total_omie });
      setEtapa('lista');
    } else {
      toast.error(d.error || 'Erro ao verificar');
      setEtapa('inicio');
    }
  };

  const handleExportar = async () => {
    if (faltantes.length === 0) { toast.info('Nenhum produto para exportar'); return; }
    setEtapa('exportando');
    const res = await base44.functions.invoke('exportarProdutosFaltantes', { acao: 'exportar' });
    const d = res.data;
    if (d.sucesso) {
      setResultados(d.resultados);
      setEtapa('resultado');
      toast.success(`${d.exportados} produto(s) exportado(s) para o Omie`);
    } else {
      toast.error(d.error || 'Erro ao exportar');
      setEtapa('lista');
    }
  };

  const handleClose = () => {
    if (etapa !== 'verificando' && etapa !== 'exportando') {
      setEtapa('inicio');
      setFaltantes([]);
      setExistentes([]);
      setResultados([]);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="w-5 h-5 text-amber-600" />
            Produtos Faltantes no Omie
          </DialogTitle>
        </DialogHeader>

        {/* INICIO */}
        {etapa === 'inicio' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Esta ferramenta verifica quais produtos do Base44 <strong>não existem</strong> no Omie e permite exportá-los automaticamente.
            </p>
            <Button onClick={handleVerificar} className="w-full bg-amber-500 hover:bg-amber-600 text-neutral-900 font-semibold">
              <Search className="w-4 h-4 mr-2" /> Verificar Produtos Faltantes
            </Button>
          </div>
        )}

        {/* VERIFICANDO */}
        {etapa === 'verificando' && (
          <div className="flex flex-col items-center py-10 space-y-3">
            <Loader2 className="w-10 h-10 text-amber-500 animate-spin" />
            <p className="text-sm text-slate-600">Consultando cada produto no Omie... (pode levar ~1 min)</p>
          </div>
        )}

        {/* LISTA DE FALTANTES */}
        {etapa === 'lista' && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="flex-1 bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{totais.omie}</p>
                <p className="text-xs text-green-600">No Omie</p>
              </div>
              <div className="flex-1 bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-red-700">{faltantes.length}</p>
                <p className="text-xs text-red-600">Faltantes</p>
              </div>
              <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-slate-700">{totais.base44}</p>
                <p className="text-xs text-slate-600">Total Base44</p>
              </div>
            </div>

            {faltantes.length === 0 ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
                <p className="text-sm font-medium text-green-700">Todos os produtos já estão no Omie!</p>
              </div>
            ) : (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-sm text-amber-700 font-medium flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    {faltantes.length} produto(s) não encontrado(s) no Omie:
                  </p>
                </div>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2 pr-4">
                    {faltantes.map(p => (
                      <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border border-red-200 bg-red-50">
                        <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{p.nome}</p>
                          <div className="flex gap-2 mt-0.5">
                            <Badge className="bg-slate-100 text-slate-600 text-[10px]">Cód: {p.codigo}</Badge>
                            {p.ncm && <Badge className="bg-blue-100 text-blue-600 text-[10px]">NCM: {p.ncm}</Badge>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                  <Button onClick={handleExportar} className="bg-green-600 hover:bg-green-700 text-white">
                    <Upload className="w-4 h-4 mr-2" /> Exportar {faltantes.length} Produto(s) para Omie
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* EXPORTANDO */}
        {etapa === 'exportando' && (
          <div className="flex flex-col items-center py-10 space-y-3">
            <Loader2 className="w-10 h-10 text-green-500 animate-spin" />
            <p className="text-sm text-slate-600">Exportando {faltantes.length} produto(s) para o Omie...</p>
            <p className="text-xs text-slate-400">Não feche esta janela.</p>
          </div>
        )}

        {/* RESULTADO */}
        {etapa === 'resultado' && (
          <div className="space-y-4">
            <div className="flex gap-3 p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-1">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium">{resultados.filter(r => r.sucesso).length} exportado(s)</span>
              </div>
              <div className="flex items-center gap-1">
                <XCircle className="w-4 h-4 text-red-600" />
                <span className="text-sm font-medium">{resultados.filter(r => !r.sucesso).length} erro(s)</span>
              </div>
            </div>
            <ScrollArea className="h-[250px]">
              <div className="space-y-2 pr-4">
                {resultados.map((r, idx) => (
                  <div key={idx} className={`p-3 rounded-lg border ${r.sucesso ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                    <div className="flex items-center gap-2">
                      {r.sucesso ? <CheckCircle className="w-4 h-4 text-green-600" /> : <XCircle className="w-4 h-4 text-red-600" />}
                      <span className="text-sm font-medium">{r.codigo} - {r.nome}</span>
                    </div>
                    <p className="text-xs text-slate-500 ml-6 mt-0.5">{r.mensagem}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="flex justify-end pt-2 border-t">
              <Button onClick={handleClose}>Fechar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}