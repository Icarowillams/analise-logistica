import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Loader2, CheckCircle, XCircle, AlertTriangle, Search, 
  Trash2, FolderPlus, Sparkles 
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

export default function TratarTabelasModal({ open, onOpenChange }) {
  const [etapa, setEtapa] = useState('menu'); // menu | processando | resultado
  const [processing, setProcessing] = useState(false);
  const [progresso, setProgresso] = useState('');
  const [resultado, setResultado] = useState(null);
  const queryClient = useQueryClient();

  const handleClose = () => {
    if (!processing) {
      setEtapa('menu');
      setResultado(null);
      onOpenChange(false);
    }
  };

  // DIAGNOSTICAR
  const handleDiagnosticar = async () => {
    setProcessing(true);
    setEtapa('processando');
    setProgresso('Analisando todas as tabelas de preço...');

    const res = await base44.functions.invoke('tratarTabelasPreco', { acao: 'diagnosticar' });
    setResultado({ tipo: 'diagnostico', data: res.data });
    setEtapa('resultado');
    setProcessing(false);
  };

  // LIMPAR DUPLICADOS
  const handleLimparDuplicados = async () => {
    if (!confirm('Confirma a remoção de TODOS os registros duplicados? O sistema manterá o registro com maior valor para cada produto em cada tabela.')) return;
    
    setProcessing(true);
    setEtapa('processando');
    setProgresso('Removendo duplicados de todas as tabelas...');

    const res = await base44.functions.invoke('tratarTabelasPreco', { acao: 'limpar_duplicados' });
    setResultado({ tipo: 'limpeza', data: res.data });
    setEtapa('resultado');
    setProcessing(false);
    queryClient.invalidateQueries(['todosPrecos']);
    queryClient.invalidateQueries(['precosProduto']);
    toast.success(`${res.data.removidos} duplicados removidos!`);
  };

  // CRIAR TABELA AUXILIAR
  const handleCriarAuxiliar = async () => {
    setProcessing(true);
    setEtapa('processando');
    setProgresso('Criando TABELA AUXILIAR com todos os produtos únicos...');

    const res = await base44.functions.invoke('tratarTabelasPreco', { acao: 'criar_tabela_auxiliar' });
    setResultado({ tipo: 'auxiliar', data: res.data });
    setEtapa('resultado');
    setProcessing(false);
    queryClient.invalidateQueries(['tabelasPreco']);
    queryClient.invalidateQueries(['todosPrecos']);
    toast.success(res.data.mensagem);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            Tratar Tabelas de Preço
          </DialogTitle>
        </DialogHeader>

        {/* MENU */}
        {etapa === 'menu' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Ferramentas para garantir que suas tabelas estejam perfeitas antes de exportar para o Omie.
            </p>

            {/* 1. Diagnosticar */}
            <div className="border border-blue-200 bg-blue-50 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Search className="w-6 h-6 text-blue-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-bold text-blue-800">1. Diagnosticar Problemas</h3>
                  <p className="text-sm text-blue-600 mt-1">
                    Analisa todas as tabelas e identifica produtos duplicados, contagem de registros e produtos únicos.
                  </p>
                  <Button 
                    onClick={handleDiagnosticar}
                    className="mt-3 bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Search className="w-4 h-4 mr-2" /> Diagnosticar
                  </Button>
                </div>
              </div>
            </div>

            {/* 2. Limpar Duplicados */}
            <div className="border border-red-200 bg-red-50 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <Trash2 className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-bold text-red-800">2. Limpar Duplicados</h3>
                  <p className="text-sm text-red-600 mt-1">
                    Remove registros duplicados de cada tabela. Mantém o registro com o maior valor para cada produto.
                  </p>
                  <Button 
                    onClick={handleLimparDuplicados}
                    className="mt-3 bg-red-600 hover:bg-red-700 text-white"
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Limpar Duplicados
                  </Button>
                </div>
              </div>
            </div>

            {/* 3. Criar Tabela Auxiliar */}
            <div className="border border-purple-200 bg-purple-50 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <FolderPlus className="w-6 h-6 text-purple-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-bold text-purple-800">3. Criar TABELA AUXILIAR</h3>
                  <p className="text-sm text-purple-600 mt-1">
                    Cria uma tabela com TODOS os produtos únicos de todas as tabelas. Essa tabela deve ser exportada primeiro para que o Omie cadastre todos os produtos.
                    Depois, exporte as demais tabelas normalmente.
                  </p>
                  <div className="bg-white/60 rounded-lg p-2 mt-2 text-xs text-purple-700">
                    <strong>Ordem de exportação para o Omie:</strong><br/>
                    1° TABELA AUXILIAR (registra todos os produtos) → 2° Demais tabelas (só definem os preços)
                  </div>
                  <Button 
                    onClick={handleCriarAuxiliar}
                    className="mt-3 bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    <FolderPlus className="w-4 h-4 mr-2" /> Criar Tabela Auxiliar
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PROCESSANDO */}
        {etapa === 'processando' && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="w-12 h-12 text-purple-500 animate-spin" />
            <p className="text-lg font-semibold text-slate-700">Processando...</p>
            <p className="text-sm text-slate-500 text-center">{progresso}</p>
          </div>
        )}

        {/* RESULTADO */}
        {etapa === 'resultado' && resultado && (
          <div className="space-y-4">
            {/* Diagnóstico */}
            {resultado.tipo === 'diagnostico' && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-blue-700">{resultado.data.total_precos}</p>
                    <p className="text-xs text-blue-600">Total Registros</p>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-green-700">{resultado.data.total_produtos_unicos}</p>
                    <p className="text-xs text-green-600">Produtos Únicos</p>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-amber-700">{resultado.data.total_tabelas}</p>
                    <p className="text-xs text-amber-600">Tabelas</p>
                  </div>
                  <div className={`border rounded-lg p-3 text-center ${resultado.data.total_duplicados > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                    <p className={`text-2xl font-bold ${resultado.data.total_duplicados > 0 ? 'text-red-700' : 'text-green-700'}`}>
                      {resultado.data.total_duplicados}
                    </p>
                    <p className={`text-xs ${resultado.data.total_duplicados > 0 ? 'text-red-600' : 'text-green-600'}`}>Duplicados</p>
                  </div>
                </div>

                {/* Resumo por tabela */}
                <h4 className="font-semibold text-slate-700 text-sm mt-4">Resumo por Tabela:</h4>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-1 pr-4">
                    {resultado.data.resumo_por_tabela?.map((t, i) => (
                      <div key={i} className="flex items-center justify-between p-2 rounded border border-slate-100 bg-slate-50 text-sm">
                        <span className="font-medium truncate flex-1">{t.tabela_nome}</span>
                        <div className="flex gap-2 shrink-0">
                          <Badge className="bg-slate-100 text-slate-600">{t.produtos_unicos} prod.</Badge>
                          {t.duplicados > 0 && (
                            <Badge className="bg-red-100 text-red-700">{t.duplicados} dup.</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>

                {/* Detalhes dos duplicados */}
                {resultado.data.duplicados?.length > 0 && (
                  <>
                    <h4 className="font-semibold text-red-700 text-sm flex items-center gap-1">
                      <AlertTriangle className="w-4 h-4" /> Duplicados Encontrados:
                    </h4>
                    <ScrollArea className="h-[150px]">
                      <div className="space-y-1 pr-4">
                        {resultado.data.duplicados.map((d, i) => (
                          <div key={i} className="p-2 rounded border border-red-100 bg-red-50 text-xs">
                            <span className="font-bold">{d.tabela_nome}</span>: {d.produto_codigo} - {d.produto_nome} 
                            <Badge className="ml-2 bg-red-200 text-red-800">{d.quantidade}x</Badge>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </>
                )}
              </>
            )}

            {/* Limpeza */}
            {resultado.tipo === 'limpeza' && (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                  <CheckCircle className="w-10 h-10 text-green-600 mx-auto mb-2" />
                  <p className="text-lg font-bold text-green-700">{resultado.data.removidos} duplicados removidos</p>
                </div>
                {resultado.data.detalhes?.length > 0 && (
                  <ScrollArea className="h-[250px]">
                    <div className="space-y-1 pr-4">
                      {resultado.data.detalhes.map((d, i) => (
                        <div key={i} className="p-2 rounded border border-slate-100 bg-slate-50 text-xs flex justify-between">
                          <span><strong>{d.tabela}</strong>: {d.codigo} - {d.produto}</span>
                          <span className="text-red-600">-{d.duplicados_removidos} | mantido R$ {d.valor_mantido?.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            )}

            {/* Tabela Auxiliar */}
            {resultado.tipo === 'auxiliar' && (
              <div className="space-y-4">
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-center">
                  <CheckCircle className="w-10 h-10 text-purple-600 mx-auto mb-2" />
                  <p className="text-lg font-bold text-purple-700">TABELA AUXILIAR criada!</p>
                  <p className="text-sm text-purple-600 mt-1">{resultado.data.total_produtos} produtos únicos</p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-green-700">{resultado.data.criados}</p>
                    <p className="text-xs text-green-600">Criados</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-blue-700">{resultado.data.atualizados}</p>
                    <p className="text-xs text-blue-600">Atualizados</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-slate-700">{resultado.data.ignorados}</p>
                    <p className="text-xs text-slate-600">Sem alteração</p>
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                  <strong>Próximo passo:</strong> Vá em "Sincronizar Omie" → Exportar → Selecione a TABELA AUXILIAR primeiro, depois exporte as demais tabelas.
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => { setEtapa('menu'); setResultado(null); }}>Voltar</Button>
              <Button onClick={handleClose}>Fechar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}