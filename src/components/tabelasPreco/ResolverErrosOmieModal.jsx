import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Wrench, CheckCircle, XCircle, Loader2, AlertTriangle, Package, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

export default function ResolverErrosOmieModal({ open, onOpenChange, resultados = [], tabelas = [], produtos = [] }) {
  const [etapa, setEtapa] = useState('resumo'); // resumo | exportando_produtos | reexportando_precos | concluido
  const [progresso, setProgresso] = useState('');
  const [resultadoFinal, setResultadoFinal] = useState([]);
  const [processing, setProcessing] = useState(false);
  const queryClient = useQueryClient();

  // Extrair produtos não encontrados no Omie (únicos)
  const produtosComErro = useMemo(() => {
    const produtosMap = new Map();
    
    resultados.forEach(res => {
      if (res.erros_itens) {
        res.erros_itens.forEach(item => {
          if (item.mensagem?.includes('não encontrado no Omie') && item.produto_id) {
            if (!produtosMap.has(item.produto_id)) {
              produtosMap.set(item.produto_id, {
                produto_id: item.produto_id,
                produto_nome: item.produto_nome,
                produto_codigo: item.produto_codigo,
                tabelas_afetadas: []
              });
            }
            const tabela = tabelas.find(t => {
              // Encontrar a tabela que originou este erro
              return res.nome === t.nome;
            });
            if (tabela) {
              produtosMap.get(item.produto_id).tabelas_afetadas.push(tabela.nome);
            }
          }
        });
      }
    });

    return Array.from(produtosMap.values());
  }, [resultados, tabelas]);

  // Tabelas que tiveram erros de produtos
  const tabelasComErro = useMemo(() => {
    return resultados
      .filter(r => r.erros_itens && r.erros_itens.some(i => i.mensagem?.includes('não encontrado no Omie')))
      .map(r => {
        const tabela = tabelas.find(t => t.nome === r.nome);
        return tabela;
      })
      .filter(Boolean);
  }, [resultados, tabelas]);

  const handleResolver = async () => {
    setProcessing(true);
    const logs = [];

    // ETAPA 1: Exportar produtos faltantes para o Omie
    setEtapa('exportando_produtos');
    const produtoIds = produtosComErro.map(p => p.produto_id);
    
    let lote = 0;
    let concluido = false;
    let produtosExportados = 0;
    let produtosComFalha = 0;

    while (!concluido) {
      setProgresso(`Exportando produtos para Omie (lote ${Math.floor(lote / 10) + 1})...`);
      
      const res = await base44.functions.invoke('exportarProdutosOmie', {
        produto_ids: produtoIds,
        modo: 'upsert',
        lote_inicio: lote
      });

      const data = res.data;
      if (data.resultados) {
        produtosExportados += data.resultados.filter(r => r.sucesso).length;
        produtosComFalha += data.resultados.filter(r => !r.sucesso).length;
        data.resultados.forEach(r => {
          logs.push({
            tipo: 'produto',
            nome: `${r.codigo} - ${r.nome}`,
            sucesso: r.sucesso,
            mensagem: r.mensagem
          });
        });
      }

      concluido = data.concluido;
      if (!concluido) lote = data.proximo_lote;
    }

    // ETAPA 2: Re-exportar preços das tabelas afetadas
    setEtapa('reexportando_precos');
    let precosOk = 0;
    let precosErro = 0;

    for (let i = 0; i < tabelasComErro.length; i++) {
      const tabela = tabelasComErro[i];
      setProgresso(`Re-exportando preços: ${tabela.nome} (${i + 1}/${tabelasComErro.length})...`);

      let lotePrc = 0;
      let concluidoPrc = false;

      while (!concluidoPrc) {
        const resPrecos = await base44.functions.invoke('sincronizarTabelasOmie', {
          acao: 'exportar_precos',
          tabela_id: tabela.id,
          lote_inicio: lotePrc,
          lote_tamanho: 10
        });

        const dp = resPrecos.data;
        if (dp.itens) {
          precosOk += dp.itens.filter(i => i.sucesso).length;
          precosErro += dp.itens.filter(i => !i.sucesso).length;
          dp.itens.filter(i => !i.sucesso).forEach(item => {
            logs.push({
              tipo: 'preco',
              nome: `${item.produto_codigo} - ${item.produto_nome} (${tabela.nome})`,
              sucesso: false,
              mensagem: item.mensagem
            });
          });
        }

        concluidoPrc = dp.concluido;
        if (!concluidoPrc) lotePrc = dp.proximo_lote;
      }
    }

    setResultadoFinal({
      produtosExportados,
      produtosComFalha,
      precosOk,
      precosErro,
      logs
    });

    setEtapa('concluido');
    setProcessing(false);
    queryClient.invalidateQueries(['tabelasPreco']);
    queryClient.invalidateQueries(['todosPrecos']);

    if (produtosComFalha === 0 && precosErro === 0) {
      toast.success('Todos os erros foram resolvidos!');
    } else {
      toast.warning('Processo concluído com alguns erros restantes.');
    }
  };

  const handleClose = () => {
    if (!processing) {
      setEtapa('resumo');
      setResultadoFinal([]);
      setProgresso('');
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-amber-600" />
            Resolver Erros de Exportação
          </DialogTitle>
        </DialogHeader>

        {etapa === 'resumo' && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm font-medium text-amber-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {produtosComErro.length} produto(s) não encontrado(s) no Omie
              </p>
              <p className="text-xs text-amber-700 mt-1">
                Este assistente irá: 1) Exportar os produtos faltantes para o Omie, 2) Re-exportar os preços das tabelas afetadas.
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Package className="w-4 h-4" />
                Produtos para exportar:
              </h4>
              <ScrollArea className="h-[200px]">
                <div className="space-y-1 pr-4">
                  {produtosComErro.map((p, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-white rounded border border-slate-200">
                      <div className="flex items-center gap-2">
                        <Badge className="bg-slate-100 text-slate-700 text-xs font-mono">{p.produto_codigo}</Badge>
                        <span className="text-sm text-slate-800">{p.produto_nome}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <RefreshCw className="w-4 h-4" />
                Tabelas que terão preços re-exportados:
              </h4>
              <div className="flex flex-wrap gap-2">
                {tabelasComErro.map(t => (
                  <Badge key={t.id} className="bg-blue-100 text-blue-700">{t.nome}</Badge>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button
                onClick={handleResolver}
                disabled={produtosComErro.length === 0}
                className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold"
              >
                <Wrench className="w-4 h-4 mr-2" />
                Resolver Tudo ({produtosComErro.length} produtos + {tabelasComErro.length} tabelas)
              </Button>
            </div>
          </div>
        )}

        {(etapa === 'exportando_produtos' || etapa === 'reexportando_precos') && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="w-12 h-12 text-amber-500 animate-spin" />
            <p className="text-lg font-semibold text-slate-700">
              {etapa === 'exportando_produtos' ? 'Exportando Produtos...' : 'Re-exportando Preços...'}
            </p>
            <p className="text-sm text-slate-500 text-center">{progresso}</p>
            <div className="flex gap-2">
              <Badge className={etapa === 'exportando_produtos' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}>
                Etapa 1: Produtos {etapa !== 'exportando_produtos' ? '✓' : '...'}
              </Badge>
              <Badge className={etapa === 'reexportando_precos' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}>
                Etapa 2: Preços {etapa === 'reexportando_precos' ? '...' : ''}
              </Badge>
            </div>
            <p className="text-xs text-slate-400">Não feche esta janela.</p>
          </div>
        )}

        {etapa === 'concluido' && resultadoFinal && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{resultadoFinal.produtosExportados}</p>
                <p className="text-xs text-green-600">Produtos exportados</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-blue-700">{resultadoFinal.precosOk}</p>
                <p className="text-xs text-blue-600">Preços atualizados</p>
              </div>
              {resultadoFinal.produtosComFalha > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-700">{resultadoFinal.produtosComFalha}</p>
                  <p className="text-xs text-red-600">Produtos com falha</p>
                </div>
              )}
              {resultadoFinal.precosErro > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-orange-700">{resultadoFinal.precosErro}</p>
                  <p className="text-xs text-orange-600">Preços com erro</p>
                </div>
              )}
            </div>

            {resultadoFinal.logs && resultadoFinal.logs.filter(l => !l.sucesso).length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-2">Erros restantes:</h4>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-1 pr-4">
                    {resultadoFinal.logs.filter(l => !l.sucesso).map((log, idx) => (
                      <div key={idx} className="flex items-start gap-2 p-2 bg-red-50 rounded border border-red-200 text-xs">
                        <XCircle className="w-3 h-3 text-red-500 mt-0.5 shrink-0" />
                        <div>
                          <span className="font-medium text-red-700">{log.nome}</span>
                          <p className="text-red-600">{log.mensagem}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t">
              <Button onClick={handleClose}>Fechar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}