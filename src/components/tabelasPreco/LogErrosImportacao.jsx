import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { XCircle, Edit2, Trash2, RefreshCw, AlertTriangle, CheckCircle2, Download } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

export default function LogErrosImportacao({ tabelas, produtos }) {
  const [failedImports, setFailedImports] = useState([]);
  const [editingError, setEditingError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const queryClient = useQueryClient();

  // Função para adicionar erros ao log (chamada pelo componente de importação)
  const addErrorsToLog = (errors) => {
    const newErrors = errors.map((err, idx) => ({
      ...err,
      id: `error_${Date.now()}_${idx}`
    }));
    setFailedImports(prev => [...prev, ...newErrors]);
  };

  // Expor função para outros componentes
  React.useEffect(() => {
    window.addImportErrors = addErrorsToLog;
    return () => {
      delete window.addImportErrors;
    };
  }, []);

  // Carregar erros do localStorage
  React.useEffect(() => {
    const savedErrors = localStorage.getItem('importacao_precos_erros');
    if (savedErrors) {
      try {
        setFailedImports(JSON.parse(savedErrors));
      } catch (e) {
        console.error('Erro ao carregar log de erros:', e);
      }
    }
  }, []);

  // Salvar erros no localStorage quando mudar
  React.useEffect(() => {
    localStorage.setItem('importacao_precos_erros', JSON.stringify(failedImports));
  }, [failedImports]);

  const handleEditErrorItem = (item) => {
    setEditingError({
      ...item,
      new_tabela_id: item.tabela_id || '',
      new_produto_id: item.produto_id || '',
      new_valor: item.valor_unitario || 0
    });
  };

  const handleSaveEditedItem = async () => {
    if (!editingError) return;

    const { new_tabela_id, new_produto_id, new_valor } = editingError;

    if (!new_tabela_id || !new_produto_id || new_valor <= 0) {
      toast.error('Preencha todos os campos corretamente');
      return;
    }

    try {
      const existingPrices = await base44.entities.PrecoProduto.list();
      const existing = existingPrices.find(
        p => p.produto_id === new_produto_id && p.tabela_id === new_tabela_id
      );

      if (existing) {
        await base44.entities.PrecoProduto.update(existing.id, {
          valor_unitario: parseFloat(new_valor)
        });
        toast.success('Preço atualizado com sucesso!');
      } else {
        await base44.entities.PrecoProduto.create({
          produto_id: new_produto_id,
          tabela_id: new_tabela_id,
          valor_unitario: parseFloat(new_valor),
          valor_acao: 0,
          ativacao_acao: false
        });
        toast.success('Preço criado com sucesso!');
      }

      setFailedImports(prev => prev.filter(f => f.id !== editingError.id));
      setEditingError(null);
      queryClient.invalidateQueries(['precosProduto']);
    } catch (err) {
      toast.error('Erro ao salvar: ' + err.message);
    }
  };

  const handleRemoveErrorItem = (itemId) => {
    setFailedImports(prev => prev.filter(f => f.id !== itemId));
  };

  const handleClearAll = () => {
    if (confirm('Tem certeza que deseja limpar todos os erros do log?')) {
      setFailedImports([]);
      toast.success('Log de erros limpo!');
    }
  };

  const handleImportAllValid = async () => {
    const validItems = failedImports.filter(item => 
      item.tabela_id && item.produto_id && item.valor_unitario > 0
    );

    if (validItems.length === 0) {
      toast.error('Nenhum item válido para importar. Corrija os erros primeiro.');
      return;
    }

    setIsProcessing(true);
    let successCount = 0;
    const stillFailed = [];

    const existingPrices = await base44.entities.PrecoProduto.list();

    for (const item of validItems) {
      try {
        const existing = existingPrices.find(
          p => p.produto_id === item.produto_id && p.tabela_id === item.tabela_id
        );

        if (existing) {
          await base44.entities.PrecoProduto.update(existing.id, {
            valor_unitario: item.valor_unitario
          });
        } else {
          await base44.entities.PrecoProduto.create({
            produto_id: item.produto_id,
            tabela_id: item.tabela_id,
            valor_unitario: item.valor_unitario,
            valor_acao: 0,
            ativacao_acao: false
          });
        }
        successCount++;
      } catch (err) {
        stillFailed.push({ ...item, erro_importacao: err.message });
      }
    }

    const invalidItems = failedImports.filter(item => 
      !item.tabela_id || !item.produto_id || item.valor_unitario <= 0
    );
    setFailedImports([...invalidItems, ...stillFailed]);
    setIsProcessing(false);
    queryClient.invalidateQueries(['precosProduto']);

    if (successCount > 0) {
      toast.success(`${successCount} preços importados com sucesso!`);
    }
    if (stillFailed.length > 0) {
      toast.warning(`${stillFailed.length} itens ainda com erro`);
    }
  };

  const handleExportErrors = () => {
    if (failedImports.length === 0) {
      toast.error('Nenhum erro para exportar');
      return;
    }

    const csvContent = [
      'TABELA;COD PRODUTO;VALOR UNITARIO;ERRO',
      ...failedImports.map(item => 
        `${item.tabela_nome || ''};${item.cod_produto || ''};${item.valor_unitario || ''};${item.erro_importacao || item.erro || ''}`
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `erros_importacao_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = failedImports.filter(item => 
    item.tabela_id && item.produto_id && item.valor_unitario > 0
  ).length;
  const invalidCount = failedImports.length - validCount;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h3 className="font-semibold text-lg text-slate-800">Log de Erros de Importação</h3>
          <p className="text-sm text-slate-500">
            Gerencie e corrija os preços que não foram importados
          </p>
        </div>
        
        {failedImports.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportErrors}
            >
              <Download className="w-4 h-4 mr-1" />
              Exportar Erros
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearAll}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Limpar Tudo
            </Button>
            <Button
              size="sm"
              onClick={handleImportAllValid}
              disabled={isProcessing || validCount === 0}
              className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold"
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${isProcessing ? 'animate-spin' : ''}`} />
              Importar {validCount} Válidos
            </Button>
          </div>
        )}
      </div>

      {/* Estatísticas */}
      {failedImports.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <p className="text-2xl font-bold text-slate-800">{failedImports.length}</p>
            <p className="text-sm text-slate-500">Total de Erros</p>
          </div>
          <div className="bg-emerald-50 p-4 rounded-lg border border-emerald-200">
            <p className="text-2xl font-bold text-emerald-700">{validCount}</p>
            <p className="text-sm text-emerald-600">Prontos para Importar</p>
          </div>
          <div className="bg-red-50 p-4 rounded-lg border border-red-200">
            <p className="text-2xl font-bold text-red-700">{invalidCount}</p>
            <p className="text-sm text-red-600">Precisam Correção</p>
          </div>
        </div>
      )}

      {/* Modal de Edição */}
      {editingError && (
        <div className="p-4 border border-blue-200 bg-blue-50 rounded-lg space-y-3">
          <h4 className="font-medium text-blue-800 flex items-center gap-2">
            <Edit2 className="w-4 h-4" />
            Corrigir Item com Erro
          </h4>
          <p className="text-xs text-blue-600">
            Erro original: {editingError.erro_importacao || editingError.erro}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Tabela</Label>
              <Select
                value={editingError.new_tabela_id}
                onValueChange={(val) => setEditingError(prev => ({ ...prev, new_tabela_id: val }))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecionar tabela" />
                </SelectTrigger>
                <SelectContent>
                  {tabelas.map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Produto</Label>
              <Select
                value={editingError.new_produto_id}
                onValueChange={(val) => setEditingError(prev => ({ ...prev, new_produto_id: val }))}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecionar produto" />
                </SelectTrigger>
                <SelectContent>
                  {produtos.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.codigo} - {p.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Valor Unitário (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={editingError.new_valor}
                onChange={(e) => setEditingError(prev => ({ ...prev, new_valor: e.target.value }))}
                className="h-9"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditingError(null)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSaveEditedItem} className="bg-blue-600 hover:bg-blue-700">
              Salvar e Importar
            </Button>
          </div>
        </div>
      )}

      {/* Lista de Erros */}
      {failedImports.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-200">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-emerald-300" />
          <p className="text-slate-600 font-medium">Nenhum erro pendente!</p>
          <p className="text-sm text-slate-400 mt-1">
            Todos os preços foram importados com sucesso ou o log foi limpo.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-3 text-left font-medium text-slate-700">Tabela</th>
                  <th className="p-3 text-left font-medium text-slate-700">Cód. Produto</th>
                  <th className="p-3 text-right font-medium text-slate-700">Valor Informado</th>
                  <th className="p-3 text-left font-medium text-slate-700">Erro</th>
                  <th className="p-3 text-center font-medium text-slate-700">Status</th>
                  <th className="p-3 text-center font-medium text-slate-700">Ações</th>
                </tr>
              </thead>
              <tbody>
                {failedImports.map((item) => {
                  const isValid = item.tabela_id && item.produto_id && item.valor_unitario > 0;
                  return (
                    <tr key={item.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="p-3 font-medium">{item.tabela_nome || '-'}</td>
                      <td className="p-3 font-mono text-xs">{item.cod_produto || '-'}</td>
                      <td className="p-3 text-right">
                        R$ {item.valor_unitario?.toFixed(2) || '0.00'}
                      </td>
                      <td className="p-3">
                        <span className="text-red-600 text-xs bg-red-100 px-2 py-1 rounded">
                          {item.erro_importacao || item.erro}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        {isValid ? (
                          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded">
                            Pronto
                          </span>
                        ) : (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">
                            Pendente
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex justify-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleEditErrorItem(item)}
                            className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveErrorItem(item.id)}
                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}