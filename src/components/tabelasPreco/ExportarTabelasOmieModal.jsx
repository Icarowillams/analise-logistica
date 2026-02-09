import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Upload, CheckCircle, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function ExportarTabelasOmieModal({ open, onOpenChange, tabelas = [], precoCounts = {} }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [resultados, setResultados] = useState([]);
  const [etapa, setEtapa] = useState('selecao'); // selecao | processando | resultado
  const [progresso, setProgresso] = useState({ atual: 0, total: 0 });

  const tabelasAtivas = useMemo(() => {
    return tabelas.filter(t => t.status === 'ativo').sort((a, b) => {
      const aIsAux = a.nome?.toUpperCase().includes('TABELA AUXILIAR') ? 0 : 1;
      const bIsAux = b.nome?.toUpperCase().includes('TABELA AUXILIAR') ? 0 : 1;
      return aIsAux - bIsAux;
    });
  }, [tabelas]);

  const toggleTabela = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleAll = () => {
    if (selectedIds.length === tabelasAtivas.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(tabelasAtivas.map(t => t.id));
    }
  };

  const handleExportar = async () => {
    if (selectedIds.length === 0) {
      toast.error('Selecione pelo menos uma tabela');
      return;
    }

    setExporting(true);
    setEtapa('processando');
    setProgresso({ atual: 0, total: selectedIds.length });

    const todosResultados = [];
    let lote = 0;
    let concluido = false;

    while (!concluido) {
      const response = await base44.functions.invoke('exportarTabelasPrecoOmie', {
        tabela_ids: selectedIds,
        lote_inicio: lote
      });

      const data = response.data;
      
      if (data.resultados) {
        todosResultados.push(...data.resultados);
      }

      setProgresso({ atual: todosResultados.length, total: selectedIds.length });

      if (data.concluido) {
        concluido = true;
      } else {
        lote = data.proximo_lote;
      }
    }

    setResultados(todosResultados);
    setEtapa('resultado');
    setExporting(false);

    const sucessos = todosResultados.filter(r => r.sucesso).length;
    const erros = todosResultados.filter(r => !r.sucesso).length;
    
    if (erros === 0) {
      toast.success(`✅ ${sucessos} tabela(s) exportada(s) com sucesso!`);
    } else {
      toast.warning(`⚠️ ${sucessos} exportada(s), ${erros} com erro(s)`);
    }
  };

  const handleClose = () => {
    if (!exporting) {
      setEtapa('selecao');
      setResultados([]);
      setSelectedIds([]);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-amber-600" />
            Exportar Tabelas de Preço para Omie
          </DialogTitle>
        </DialogHeader>

        {etapa === 'selecao' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Selecione as tabelas que deseja exportar. Cada tabela será criada/atualizada no Omie com seus respectivos preços.
            </p>

            <div className="flex items-center gap-2 pb-2 border-b">
              <Checkbox 
                checked={selectedIds.length === tabelasAtivas.length && tabelasAtivas.length > 0}
                onCheckedChange={toggleAll}
              />
              <span className="text-sm font-medium">Selecionar todas ({tabelasAtivas.length})</span>
            </div>

            <ScrollArea className="h-[300px]">
              <div className="space-y-2 pr-4">
                {tabelasAtivas.map(tabela => (
                  <div 
                    key={tabela.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedIds.includes(tabela.id) 
                        ? 'border-amber-400 bg-amber-50' 
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                    onClick={() => toggleTabela(tabela.id)}
                  >
                    <Checkbox checked={selectedIds.includes(tabela.id)} />
                    <div className="flex-1">
                      <span className="font-medium text-slate-800">{tabela.nome}</span>
                    </div>
                    <Badge className="bg-slate-100 text-slate-600 text-xs">
                      {precoCounts[tabela.id] || 0} produtos
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex justify-between items-center pt-4 border-t">
              <span className="text-sm text-slate-500">{selectedIds.length} tabela(s) selecionada(s)</span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                <Button 
                  onClick={handleExportar}
                  disabled={selectedIds.length === 0}
                  className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Exportar para Omie
                </Button>
              </div>
            </div>
          </div>
        )}

        {etapa === 'processando' && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="w-12 h-12 text-amber-500 animate-spin" />
            <p className="text-lg font-semibold text-slate-700">Exportando tabelas...</p>
            <p className="text-sm text-slate-500">
              Processando {progresso.atual} de {progresso.total} tabelas
            </p>
            <p className="text-xs text-slate-400">
              Isso pode levar alguns minutos. Não feche esta janela.
            </p>
          </div>
        )}

        {etapa === 'resultado' && (
          <div className="space-y-4">
            <div className="flex gap-4 p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-1">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium">{resultados.filter(r => r.sucesso).length} sucesso(s)</span>
              </div>
              <div className="flex items-center gap-1">
                <XCircle className="w-4 h-4 text-red-600" />
                <span className="text-sm font-medium">{resultados.filter(r => !r.sucesso).length} erro(s)</span>
              </div>
            </div>

            <ScrollArea className="h-[350px]">
              <div className="space-y-3 pr-4">
                {resultados.map((res, idx) => (
                  <div key={idx} className={`p-3 rounded-lg border ${res.sucesso ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {res.sucesso ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-600" />
                      )}
                      <span className="font-semibold text-sm">{res.tabela_nome}</span>
                    </div>
                    <p className="text-xs text-slate-600 ml-6">{res.mensagem}</p>

                    {/* Detalhes dos itens */}
                    {res.itens_resultados && res.itens_resultados.length > 0 && (
                      <div className="mt-2 ml-6 space-y-1">
                        {res.itens_resultados.filter(i => !i.sucesso).length > 0 && (
                          <div className="text-xs text-red-600 flex items-center gap-1 mt-1">
                            <AlertTriangle className="w-3 h-3" />
                            {res.itens_resultados.filter(i => !i.sucesso).length} produto(s) com erro:
                          </div>
                        )}
                        {res.itens_resultados.filter(i => !i.sucesso).slice(0, 5).map((item, iIdx) => (
                          <div key={iIdx} className="text-xs text-red-500 ml-4">
                            • {item.produto_codigo} - {item.produto_nome}: {item.mensagem}
                          </div>
                        ))}
                        {res.itens_resultados.filter(i => !i.sucesso).length > 5 && (
                          <div className="text-xs text-slate-400 ml-4">
                            ...e mais {res.itens_resultados.filter(i => !i.sucesso).length - 5} erros
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>

            <div className="flex justify-end pt-2">
              <Button onClick={handleClose}>Fechar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}