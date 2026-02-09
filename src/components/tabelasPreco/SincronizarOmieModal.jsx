import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Upload, Download, CheckCircle, XCircle, Loader2, AlertTriangle, 
  Trash2, RefreshCw, Link2, Link2Off, ArrowUpDown, Wrench
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import ResolverErrosOmieModal from './ResolverErrosOmieModal';

export default function SincronizarOmieModal({ open, onOpenChange, tabelas = [], precoCounts = {} }) {
  const [activeTab, setActiveTab] = useState('exportar');
  const [selectedIds, setSelectedIds] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [resultados, setResultados] = useState([]);
  const [etapa, setEtapa] = useState('selecao');
  const [progresso, setProgresso] = useState('');
  const [resolverErrosOpen, setResolverErrosOpen] = useState(false);
  const queryClient = useQueryClient();

  const sortAuxiliarFirst = (list) => {
    return [...list].sort((a, b) => {
      const aIsAux = a.nome?.toUpperCase().includes('TABELA AUXILIAR') ? 0 : 1;
      const bIsAux = b.nome?.toUpperCase().includes('TABELA AUXILIAR') ? 0 : 1;
      return aIsAux - bIsAux;
    });
  };

  const tabelasAtivas = useMemo(() => sortAuxiliarFirst(tabelas.filter(t => t.status === 'ativo')), [tabelas]);
  const tabelasVinculadas = useMemo(() => sortAuxiliarFirst(tabelas.filter(t => t.omie_id)), [tabelas]);

  const toggleTabela = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleAll = (lista) => {
    const ids = lista.map(t => t.id);
    if (ids.every(id => selectedIds.includes(id))) {
      setSelectedIds(prev => prev.filter(id => !ids.includes(id)));
    } else {
      setSelectedIds(prev => [...new Set([...prev, ...ids])]);
    }
  };

  const [limpandoVinculos, setLimpandoVinculos] = useState(false);

  const resetState = () => {
    setEtapa('selecao');
    setResultados([]);
    setSelectedIds([]);
    setProgresso('');
  };

  const handleClose = () => {
    if (!processing) {
      resetState();
      onOpenChange(false);
    }
  };

  // ==========================================
  // IMPORTAR TABELAS DO OMIE
  // ==========================================
  const handleImportarTabelas = async () => {
    setProcessing(true);
    setEtapa('processando');
    setProgresso('Buscando tabelas do Omie...');

    const response = await base44.functions.invoke('sincronizarTabelasOmie', {
      acao: 'importar_tabelas'
    });

    const data = response.data;
    setProcessing(false);
    setEtapa('resultado');

    if (data.sucesso) {
      setResultados(data.resultados.map(r => ({
        nome: r.nome,
        sucesso: true,
        mensagem: r.status === 'criada' ? 'Tabela criada no sistema' : 'Tabela atualizada no sistema',
        omie_id: r.omie_id
      })));
      toast.success(data.mensagem);
    } else {
      setResultados([{ nome: 'Erro', sucesso: false, mensagem: data.error || data.erro }]);
      toast.error('Erro ao importar tabelas');
    }

    queryClient.invalidateQueries(['tabelasPreco']);
  };

  // ==========================================
  // EXPORTAR TABELAS PARA O OMIE
  // ==========================================
  const handleExportarTabelas = async () => {
    if (selectedIds.length === 0) { toast.error('Selecione pelo menos uma tabela'); return; }

    setProcessing(true);
    setEtapa('processando');
    const todosResultados = [];

    for (let i = 0; i < selectedIds.length; i++) {
      const tabelaId = selectedIds[i];
      const tabela = tabelas.find(t => t.id === tabelaId);
      setProgresso(`Exportando tabela ${i + 1}/${selectedIds.length}: ${tabela?.nome || ''}`);

      // 1. Exportar a tabela (criar/atualizar no Omie)
      const resTbl = await base44.functions.invoke('sincronizarTabelasOmie', {
        acao: 'exportar_tabela',
        tabela_id: tabelaId
      });

      if (!resTbl.data.sucesso) {
        todosResultados.push({
          nome: tabela?.nome,
          sucesso: false,
          mensagem: resTbl.data.erro || 'Erro ao exportar tabela'
        });
        continue;
      }

      // 2. Exportar preços em lotes
      let lote = 0;
      let concluido = false;
      let itensOk = 0;
      let itensErro = 0;
      const errosItens = [];

      while (!concluido) {
        setProgresso(`${tabela?.nome}: exportando preços (lote ${lote / 5 + 1})...`);

        const resPrecos = await base44.functions.invoke('sincronizarTabelasOmie', {
          acao: 'exportar_precos',
          tabela_id: tabelaId,
          lote_inicio: lote,
          lote_tamanho: 5
        });

        const dp = resPrecos.data;
        if (dp.itens) {
          itensOk += dp.itens.filter(i => i.sucesso).length;
          itensErro += dp.itens.filter(i => !i.sucesso).length;
          errosItens.push(...dp.itens.filter(i => !i.sucesso));
        }

        concluido = dp.concluido;
        if (!concluido) lote = dp.proximo_lote;
      }

      todosResultados.push({
        nome: tabela?.nome,
        sucesso: true,
        mensagem: `Tabela exportada. ${itensOk} preços OK, ${itensErro} erros.`,
        omie_id: resTbl.data.omie_id,
        erros_itens: errosItens
      });
    }

    setResultados(todosResultados);
    setEtapa('resultado');
    setProcessing(false);
    queryClient.invalidateQueries(['tabelasPreco']);
    queryClient.invalidateQueries(['todosPrecos']);

    const ok = todosResultados.filter(r => r.sucesso).length;
    toast.success(`${ok} tabela(s) exportada(s) para o Omie`);
  };

  // ==========================================
  // IMPORTAR PREÇOS DO OMIE
  // ==========================================
  const handleImportarPrecos = async () => {
    if (selectedIds.length === 0) { toast.error('Selecione pelo menos uma tabela'); return; }

    setProcessing(true);
    setEtapa('processando');
    const todosResultados = [];

    for (let i = 0; i < selectedIds.length; i++) {
      const tabelaId = selectedIds[i];
      const tabela = tabelas.find(t => t.id === tabelaId);
      setProgresso(`Importando preços ${i + 1}/${selectedIds.length}: ${tabela?.nome || ''}`);

      const res = await base44.functions.invoke('sincronizarTabelasOmie', {
        acao: 'importar_precos',
        tabela_id: tabelaId
      });

      const d = res.data;
      todosResultados.push({
        nome: tabela?.nome,
        sucesso: d.sucesso,
        mensagem: d.mensagem || d.error || d.erro,
        detalhes: d.sucesso ? `${d.criados} criados, ${d.atualizados} atualizados` : null
      });
    }

    setResultados(todosResultados);
    setEtapa('resultado');
    setProcessing(false);
    queryClient.invalidateQueries(['todosPrecos']);
    queryClient.invalidateQueries(['precosProduto']);
  };

  // ==========================================
  // EXCLUIR TABELA DO OMIE
  // ==========================================
  const handleExcluirOmie = async () => {
    if (selectedIds.length === 0) { toast.error('Selecione pelo menos uma tabela'); return; }
    if (!confirm(`Tem certeza que deseja excluir ${selectedIds.length} tabela(s) do Omie? Essa ação NÃO exclui do sistema local.`)) return;

    setProcessing(true);
    setEtapa('processando');
    const todosResultados = [];

    for (let i = 0; i < selectedIds.length; i++) {
      const tabelaId = selectedIds[i];
      const tabela = tabelas.find(t => t.id === tabelaId);
      setProgresso(`Excluindo ${i + 1}/${selectedIds.length}: ${tabela?.nome || ''}`);

      const res = await base44.functions.invoke('sincronizarTabelasOmie', {
        acao: 'excluir_tabela',
        tabela_id: tabelaId
      });

      todosResultados.push({
        nome: tabela?.nome,
        sucesso: res.data.sucesso,
        mensagem: res.data.mensagem || res.data.erro || res.data.error
      });
    }

    setResultados(todosResultados);
    setEtapa('resultado');
    setProcessing(false);
    queryClient.invalidateQueries(['tabelasPreco']);
  };

  // ==========================================
  // RENDER
  // ==========================================
  const renderTabelaList = (lista, showOmieStatus = false) => (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b">
        <Checkbox 
          checked={lista.length > 0 && lista.every(t => selectedIds.includes(t.id))}
          onCheckedChange={() => toggleAll(lista)}
        />
        <span className="text-sm font-medium">Selecionar todas ({lista.length})</span>
      </div>
      <ScrollArea className="h-[280px]">
        <div className="space-y-2 pr-4">
          {lista.map(tabela => (
            <div 
              key={tabela.id}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                selectedIds.includes(tabela.id) ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'
              }`}
              onClick={() => toggleTabela(tabela.id)}
            >
              <Checkbox checked={selectedIds.includes(tabela.id)} />
              <div className="flex-1 min-w-0">
                <span className="font-medium text-slate-800 text-sm">{tabela.nome}</span>
                {showOmieStatus && (
                  <div className="flex items-center gap-1 mt-0.5">
                    {tabela.omie_id ? (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <Link2 className="w-3 h-3" /> Omie #{tabela.omie_id}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Link2Off className="w-3 h-3" /> Não vinculada
                      </span>
                    )}
                  </div>
                )}
              </div>
              <Badge className="bg-slate-100 text-slate-600 text-xs shrink-0">
                {precoCounts[tabela.id] || 0} prod.
              </Badge>
            </div>
          ))}
          {lista.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-8">Nenhuma tabela encontrada</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );

  const renderResultados = () => (
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

      <ScrollArea className="h-[300px]">
        <div className="space-y-2 pr-4">
          {resultados.map((res, idx) => (
            <div key={idx} className={`p-3 rounded-lg border ${res.sucesso ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
              <div className="flex items-center gap-2">
                {res.sucesso ? <CheckCircle className="w-4 h-4 text-green-600 shrink-0" /> : <XCircle className="w-4 h-4 text-red-600 shrink-0" />}
                <span className="font-semibold text-sm">{res.nome}</span>
              </div>
              <p className="text-xs text-slate-600 ml-6 mt-1">{res.mensagem}</p>
              {res.detalhes && <p className="text-xs text-slate-500 ml-6">{res.detalhes}</p>}
              {res.erros_itens && res.erros_itens.length > 0 && (
                <div className="ml-6 mt-1 space-y-0.5">
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {res.erros_itens.length} produto(s) com erro:
                  </p>
                  {res.erros_itens.slice(0, 5).map((it, i) => (
                    <p key={i} className="text-xs text-red-500 ml-4">• {it.produto_codigo} - {it.produto_nome}: {it.mensagem}</p>
                  ))}
                  {res.erros_itens.length > 5 && (
                    <p className="text-xs text-slate-400 ml-4">...e mais {res.erros_itens.length - 5}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Botão Resolver Erros se houver erros de produto não encontrado */}
      {resultados.some(r => r.erros_itens && r.erros_itens.some(i => i.mensagem?.includes('não encontrado no Omie'))) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm text-amber-700 mb-2">
            Alguns produtos não existem no Omie. Use o botão abaixo para exportá-los automaticamente e re-enviar os preços.
          </p>
          <Button
            onClick={() => setResolverErrosOpen(true)}
            className="w-full bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold"
          >
            <Wrench className="w-4 h-4 mr-2" />
            Resolver Erros Automaticamente
          </Button>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button onClick={() => { resetState(); }}>Voltar</Button>
        <Button className="ml-2" variant="outline" onClick={handleClose}>Fechar</Button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpDown className="w-5 h-5 text-amber-600" />
            Sincronizar Tabelas de Preço com Omie
          </DialogTitle>
        </DialogHeader>

        {etapa === 'processando' && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <Loader2 className="w-12 h-12 text-amber-500 animate-spin" />
            <p className="text-lg font-semibold text-slate-700">Processando...</p>
            <p className="text-sm text-slate-500 text-center">{progresso}</p>
            <p className="text-xs text-slate-400">Não feche esta janela.</p>
          </div>
        )}

        {etapa === 'resultado' && renderResultados()}

        {etapa === 'selecao' && (
          <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setSelectedIds([]); }}>
            <TabsList className="grid w-full grid-cols-4 mb-4">
              <TabsTrigger value="exportar" className="text-xs">
                <Upload className="w-3 h-3 mr-1" /> Exportar
              </TabsTrigger>
              <TabsTrigger value="importar" className="text-xs">
                <Download className="w-3 h-3 mr-1" /> Importar
              </TabsTrigger>
              <TabsTrigger value="importar_precos" className="text-xs">
                <RefreshCw className="w-3 h-3 mr-1" /> Preços
              </TabsTrigger>
              <TabsTrigger value="excluir" className="text-xs">
                <Trash2 className="w-3 h-3 mr-1" /> Excluir
              </TabsTrigger>
            </TabsList>

            {/* EXPORTAR */}
            <TabsContent value="exportar">
              <p className="text-sm text-slate-600 mb-3">
                Exportar tabelas e preços do sistema → Omie. Tabelas existentes serão atualizadas, novas serão criadas.
              </p>
              {renderTabelaList(tabelasAtivas, true)}
              <div className="flex justify-between items-center pt-4 border-t mt-4">
                <span className="text-sm text-slate-500">{selectedIds.length} selecionada(s)</span>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                  <Button 
                    onClick={handleExportarTabelas}
                    disabled={selectedIds.length === 0}
                    className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold"
                  >
                    <Upload className="w-4 h-4 mr-2" /> Exportar para Omie
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* IMPORTAR TABELAS */}
            <TabsContent value="importar">
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Importar todas as tabelas de preço do Omie → sistema. Tabelas com mesmo nome serão vinculadas automaticamente.
                </p>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-700 font-medium flex items-center gap-2">
                    <Download className="w-4 h-4" />
                    Esta ação busca TODAS as tabelas no Omie e cria/atualiza no sistema.
                  </p>
                  <p className="text-xs text-blue-600 mt-1">
                    Tabelas com mesmo nome serão vinculadas, novas serão criadas.
                  </p>
                </div>
                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                  <Button 
                    onClick={handleImportarTabelas}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Download className="w-4 h-4 mr-2" /> Importar Tabelas do Omie
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* IMPORTAR PREÇOS */}
            <TabsContent value="importar_precos">
              <p className="text-sm text-slate-600 mb-3">
                Importar preços do Omie → sistema. Selecione tabelas já vinculadas ao Omie.
              </p>
              {renderTabelaList(tabelasVinculadas, true)}
              <div className="flex justify-between items-center pt-4 border-t mt-4">
                <span className="text-sm text-slate-500">{selectedIds.length} selecionada(s)</span>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                  <Button 
                    onClick={handleImportarPrecos}
                    disabled={selectedIds.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Download className="w-4 h-4 mr-2" /> Importar Preços
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* EXCLUIR */}
            <TabsContent value="excluir">
              <p className="text-sm text-slate-600 mb-3">
                Excluir tabelas do Omie ou limpar vínculos locais.
              </p>

              {/* Botão Limpar Todos os Vínculos */}
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-orange-700 mb-2 font-medium">
                  Se as tabelas foram excluídas diretamente no Omie e o sistema ainda mostra vínculo, use o botão abaixo para limpar TODOS os vínculos locais.
                </p>
                <Button
                  onClick={async () => {
                    if (!confirm('Tem certeza? Isso vai remover o omie_id e omie_cod_int de TODAS as tabelas no sistema local. As tabelas continuam existindo, só perdem o vínculo com o Omie.')) return;
                    setLimpandoVinculos(true);
                    let count = 0;
                    for (const t of tabelas) {
                      if (t.omie_id || t.omie_cod_int) {
                        await base44.entities.TabelaPreco.update(t.id, { omie_id: null, omie_cod_int: null });
                        count++;
                      }
                    }
                    setLimpandoVinculos(false);
                    queryClient.invalidateQueries(['tabelasPreco']);
                    toast.success(`Vínculos removidos de ${count} tabela(s)`);
                  }}
                  disabled={limpandoVinculos}
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white"
                >
                  {limpandoVinculos ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Limpando...</>
                  ) : (
                    <><Link2Off className="w-4 h-4 mr-2" /> Limpar TODOS os Vínculos Omie (local)</>
                  )}
                </Button>
              </div>

              {renderTabelaList(tabelasVinculadas, true)}
              <div className="flex justify-between items-center pt-4 border-t mt-4">
                <span className="text-sm text-slate-500">{selectedIds.length} selecionada(s)</span>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleClose}>Cancelar</Button>
                  <Button 
                    onClick={handleExcluirOmie}
                    disabled={selectedIds.length === 0}
                    variant="destructive"
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Excluir do Omie
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>

      <ResolverErrosOmieModal
        open={resolverErrosOpen}
        onOpenChange={setResolverErrosOpen}
        resultados={resultados}
        tabelas={tabelas}
        produtos={[]}
      />
    </Dialog>
  );
}