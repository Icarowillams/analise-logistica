import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  DollarSign, CheckCircle, XCircle, Loader2, AlertTriangle, Zap
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function AjustarPrecosOriginaisModal({ open, onOpenChange, tabelas, produtos, precos }) {
  const [etapa, setEtapa] = useState('selecao'); // selecao | processando | resultado
  const [tabelasSelecionadas, setTabelasSelecionadas] = useState([]);
  const [progresso, setProgresso] = useState('');
  const [progressoPct, setProgressoPct] = useState(0);
  const [resultados, setResultados] = useState({ preco_original: [], tabelas: [] });

  useEffect(() => {
    if (open) {
      setEtapa('selecao');
      setTabelasSelecionadas([]);
      setResultados({ preco_original: [], tabelas: [] });
      setProgresso('');
      setProgressoPct(0);
    }
  }, [open]);

  const tabelasAtivas = tabelas.filter(t => t.status === 'ativo' && t.omie_id);

  const toggleTabela = (id) => {
    setTabelasSelecionadas(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleTodas = () => {
    if (tabelasSelecionadas.length === tabelasAtivas.length) {
      setTabelasSelecionadas([]);
    } else {
      setTabelasSelecionadas(tabelasAtivas.map(t => t.id));
    }
  };

  // Pegar todos os produto_ids que estão nas tabelas selecionadas
  const getProdutoIdsDasTabelas = () => {
    const ids = new Set();
    precos.filter(p => tabelasSelecionadas.includes(p.tabela_id)).forEach(p => {
      ids.add(p.produto_id);
    });
    return [...ids];
  };

  const executar = async () => {
    setEtapa('processando');
    const produtoIds = getProdutoIdsDasTabelas();
    const allResultsOriginal = [];
    const allResultsTabelas = [];

    // ETAPA 1: Definir preço original = R$ 1,00 para todos os produtos
    setProgresso(`Etapa 1/2: Definindo preço original = R$ 1,00 para ${produtoIds.length} produtos...`);
    setProgressoPct(0);

    let lote = 0;
    let concluido = false;
    while (!concluido) {
      const res = await base44.functions.invoke('ajustarPrecosOriginaisOmie', {
        acao: 'definir_preco_original',
        produto_ids: produtoIds,
        lote_inicio: lote,
        lote_tamanho: 5
      });

      allResultsOriginal.push(...(res.data.resultados || []));
      concluido = res.data.concluido;
      lote = res.data.proximo_lote || 0;

      const pct = Math.min(50, Math.round((res.data.processados / res.data.total) * 50));
      setProgressoPct(pct);
      setProgresso(`Etapa 1/2: ${res.data.processados}/${res.data.total} produtos processados...`);
    }

    // ETAPA 2: Exportar preços das tabelas usando % acréscimo
    setProgresso(`Etapa 2/2: Exportando preços das tabelas com % acréscimo...`);
    setProgressoPct(50);

    lote = 0;
    concluido = false;
    while (!concluido) {
      const res = await base44.functions.invoke('ajustarPrecosOriginaisOmie', {
        acao: 'exportar_precos_percentual',
        tabela_ids: tabelasSelecionadas,
        lote_inicio: lote
      });

      allResultsTabelas.push(...(res.data.resultados || []));
      concluido = res.data.concluido;
      lote = res.data.proximo_lote || 0;

      const pct = 50 + Math.min(50, Math.round(((lote || res.data.total_tabelas) / res.data.total_tabelas) * 50));
      setProgressoPct(pct);
      setProgresso(`Etapa 2/2: ${lote || res.data.total_tabelas}/${res.data.total_tabelas} tabelas processadas...`);
    }

    setResultados({ preco_original: allResultsOriginal, tabelas: allResultsTabelas });
    setEtapa('resultado');
    toast.success('Processo concluído!');
  };

  const sucessosOriginal = resultados.preco_original.filter(r => r.sucesso).length;
  const errosOriginal = resultados.preco_original.filter(r => !r.sucesso).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-500" />
            Ajustar Preços para Omie (Original = R$ 1,00)
          </DialogTitle>
        </DialogHeader>

        {etapa === 'selecao' && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-800 font-medium mb-1">Como funciona:</p>
              <ol className="text-sm text-amber-700 list-decimal list-inside space-y-1">
                <li>Define o <strong>Preço Original</strong> de todos os produtos no Omie como <strong>R$ 1,00</strong></li>
                <li>Para cada tabela selecionada, calcula o <strong>% de acréscimo</strong> necessário para chegar no preço desejado</li>
                <li>Ex: Preço desejado R$ 5,00 → Acréscimo de 400% sobre R$ 1,00</li>
              </ol>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Selecione as tabelas (vinculadas ao Omie):</span>
              <Button variant="ghost" size="sm" onClick={toggleTodas}>
                {tabelasSelecionadas.length === tabelasAtivas.length ? 'Desmarcar todas' : 'Selecionar todas'}
              </Button>
            </div>

            <ScrollArea className="h-[300px] border rounded-lg p-2">
              {tabelasAtivas.length === 0 ? (
                <p className="text-sm text-gray-500 p-4 text-center">
                  Nenhuma tabela ativa vinculada ao Omie encontrada.
                </p>
              ) : (
                <div className="space-y-2">
                  {tabelasAtivas.map(t => {
                    const qtdPrecos = precos.filter(p => p.tabela_id === t.id).length;
                    return (
                      <div
                        key={t.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          tabelasSelecionadas.includes(t.id) ? 'bg-yellow-50 border-yellow-300' : 'bg-white hover:bg-gray-50'
                        }`}
                        onClick={() => toggleTabela(t.id)}
                      >
                        <Checkbox checked={tabelasSelecionadas.includes(t.id)} />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{t.nome}</p>
                          <p className="text-xs text-gray-500">
                            {qtdPrecos} preços · Omie ID: {t.omie_id}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>

            {tabelasSelecionadas.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-700">
                  <strong>{tabelasSelecionadas.length}</strong> tabela(s) selecionada(s) · 
                  <strong> {getProdutoIdsDasTabelas().length}</strong> produtos únicos terão preço original = R$ 1,00
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button
                onClick={executar}
                disabled={tabelasSelecionadas.length === 0}
                className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold"
              >
                <Zap className="w-4 h-4 mr-2" />
                Executar Ajuste
              </Button>
            </div>
          </div>
        )}

        {etapa === 'processando' && (
          <div className="flex flex-col items-center justify-center py-12 space-y-6">
            <Loader2 className="w-12 h-12 text-yellow-500 animate-spin" />
            <p className="text-sm text-gray-600 text-center">{progresso}</p>
            <Progress value={progressoPct} className="w-full max-w-md" />
            <p className="text-xs text-gray-400">Não feche esta janela...</p>
          </div>
        )}

        {etapa === 'resultado' && (
          <ScrollArea className="flex-1 max-h-[60vh]">
            <div className="space-y-4 p-1">
              {/* Resultados Etapa 1 */}
              <div className="border rounded-lg p-3">
                <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-green-600" />
                  Etapa 1: Preço Original → R$ 1,00
                </h3>
                <div className="flex gap-3 mb-2">
                  <Badge className="bg-green-100 text-green-800">{sucessosOriginal} sucesso(s)</Badge>
                  {errosOriginal > 0 && <Badge className="bg-red-100 text-red-800">{errosOriginal} erro(s)</Badge>}
                </div>
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {resultados.preco_original.map((r, i) => (
                    <div key={i} className={`flex items-center gap-2 text-xs p-1.5 rounded ${
                      r.sucesso ? 'bg-green-50' : 'bg-red-50'
                    }`}>
                      {r.sucesso ? <CheckCircle className="w-3 h-3 text-green-500 shrink-0" /> : <XCircle className="w-3 h-3 text-red-500 shrink-0" />}
                      <span className="font-medium">{r.produto_nome || r.produto_id}</span>
                      <span className="text-gray-500 ml-auto">{r.mensagem}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Resultados Etapa 2 */}
              {resultados.tabelas.map((tab, idx) => (
                <div key={idx} className="border rounded-lg p-3">
                  <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    Etapa 2: {tab.tabela_nome}
                  </h3>
                  <p className="text-xs text-gray-500 mb-2">{tab.mensagem}</p>
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {(tab.itens || []).map((item, j) => (
                      <div key={j} className={`flex items-center gap-2 text-xs p-1.5 rounded ${
                        item.sucesso ? 'bg-green-50' : 'bg-red-50'
                      }`}>
                        {item.sucesso ? <CheckCircle className="w-3 h-3 text-green-500 shrink-0" /> : <XCircle className="w-3 h-3 text-red-500 shrink-0" />}
                        <span className="font-medium">{item.produto_nome}</span>
                        {item.sucesso && (
                          <span className="text-green-600 ml-auto">
                            R$ {item.valor_desejado?.toFixed(2)} ({item.perc_acrescimo?.toFixed(2)}%)
                          </span>
                        )}
                        {!item.sucesso && (
                          <span className="text-red-500 ml-auto">{item.mensagem}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div className="flex justify-end pt-2">
                <Button onClick={() => onOpenChange(false)}>Fechar</Button>
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}