import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Download, RefreshCw, XCircle, Edit2, Trash2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function ImportarPrecosMassa({ open, onOpenChange, tabelas, produtos, onSuccess }) {
  const [mode, setMode] = useState('upload'); // 'upload' ou 'paste'
  const [importMode, setImportMode] = useState('cadastrar'); // 'cadastrar' ou 'atualizar'
  const [file, setFile] = useState(null);
  const [pastedData, setPastedData] = useState('');
  const [preview, setPreview] = useState([]);
  const [errors, setErrors] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);
  const [failedImports, setFailedImports] = useState([]); // Log de erros de importação
  const [showErrorLog, setShowErrorLog] = useState(false);
  const [editingError, setEditingError] = useState(null);

  const resetState = () => {
    setFile(null);
    setPastedData('');
    setPreview([]);
    setErrors([]);
    setProgress(0);
    setResults(null);
    setFailedImports([]);
    setShowErrorLog(false);
    setEditingError(null);
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const parseCSV = (text) => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return { data: [], errors: ['Arquivo vazio ou sem dados'] };

    // Detectar separador: se a primeira linha tem ; usa ;, se tem \t usa \t, senão usa ,
    const firstLine = lines[0];
    let separator;
    if (firstLine.includes('\t')) {
      separator = '\t';
    } else if (firstLine.includes(';')) {
      separator = ';';
    } else {
      separator = ',';
    }

    const headers = firstLine.split(separator).map(h => h.trim().toUpperCase());
    
    // Verificar colunas obrigatórias
    const colMap = {
      'TABELA': headers.findIndex(h => h.includes('TABELA')),
      'COD_PRODUTO': headers.findIndex(h => h.includes('COD') && h.includes('PRODUTO')),
      'VALOR_UNITARIO': headers.findIndex(h => h.includes('VALOR') && h.includes('UNITARIO'))
    };

    const parseErrors = [];
    if (colMap.TABELA === -1) parseErrors.push('Coluna TABELA não encontrada');
    if (colMap.COD_PRODUTO === -1) parseErrors.push('Coluna COD PRODUTO não encontrada');
    if (colMap.VALOR_UNITARIO === -1) parseErrors.push('Coluna VALOR UNITARIO não encontrada');

    if (parseErrors.length > 0) {
      return { data: [], errors: parseErrors };
    }

    const data = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(separator).map(v => v.trim());
      if (values.length < 3 || !values[colMap.TABELA]) continue;

      const tabelaNome = values[colMap.TABELA]?.toUpperCase();
      const codProduto = values[colMap.COD_PRODUTO];
      // Tratar valor: substituir vírgula por ponto e remover espaços/caracteres extras
      let valorStr = (values[colMap.VALOR_UNITARIO] || '0').replace(/\s/g, '').replace(',', '.');
      // Se o separador for vírgula e o valor ficou partido (ex: "5" na coluna valor e "81" na próxima)
      // reunir com ponto decimal
      if (separator === ',' && colMap.VALOR_UNITARIO < values.length - 1) {
        const nextVal = values[colMap.VALOR_UNITARIO + 1]?.trim();
        if (nextVal && /^\d+$/.test(nextVal) && /^\d+$/.test(valorStr.replace('.', ''))) {
          valorStr = valorStr + '.' + nextVal;
        }
      }
      const valor = parseFloat(valorStr);

      // Encontrar tabela e produto
      const tabela = tabelas.find(t => t.nome?.toUpperCase() === tabelaNome);
      const produto = produtos.find(p => p.codigo === codProduto);

      const row = {
        linha: i + 1,
        tabela_nome: tabelaNome,
        tabela_id: tabela?.id || null,
        cod_produto: codProduto,
        produto_id: produto?.id || null,
        produto_nome: produto?.nome || null,
        valor_unitario: valor,
        erro: null
      };

      if (!tabela) row.erro = `Tabela "${tabelaNome}" não encontrada`;
      else if (!produto) row.erro = `Produto código "${codProduto}" não encontrado`;
      else if (isNaN(valor) || valor < 0) row.erro = `Valor inválido: ${valorStr}`;

      data.push(row);
    }

    return { data, errors: [] };
  };

  const handleFileUpload = (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const { data, errors } = parseCSV(text);
      setPreview(data);
      setErrors(errors);
    };
    reader.readAsText(uploadedFile);
  };

  const handlePasteData = () => {
    if (!pastedData.trim()) {
      setErrors(['Cole os dados no campo acima']);
      return;
    }
    const { data, errors } = parseCSV(pastedData);
    setPreview(data);
    setErrors(errors);
  };

  const handleImport = async () => {
    const validRows = preview.filter(r => !r.erro);
    if (validRows.length === 0) {
      toast.error('Nenhum registro válido para importar');
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setFailedImports([]);

    let created = 0;
    let updated = 0;
    let errorsCount = 0;
    const failedList = [];

    try {
      // Buscar todos os preços existentes
      const existingPrices = await base44.entities.PrecoProduto.list();
      setProgress(10);

      // Separar registros novos dos existentes
      const toCreate = [];
      const toUpdate = [];

      for (const row of validRows) {
        const existing = existingPrices.find(
          p => p.produto_id === row.produto_id && p.tabela_id === row.tabela_id
        );

        if (existing) {
          if (importMode === 'atualizar') {
            toUpdate.push({ id: existing.id, data: { valor_unitario: row.valor_unitario }, row });
          }
        } else {
          toCreate.push({
            produto_id: row.produto_id,
            tabela_id: row.tabela_id,
            valor_unitario: row.valor_unitario,
            valor_acao: 0,
            ativacao_acao: false
          });
        }
      }

      setProgress(20);

      // Criar novos em lote (batch de 50)
      const batchSize = 50;
      for (let i = 0; i < toCreate.length; i += batchSize) {
        const batch = toCreate.slice(i, i + batchSize);
        try {
          await base44.entities.PrecoProduto.bulkCreate(batch);
          created += batch.length;
        } catch (err) {
          // Se falhar em lote, tentar individualmente
          for (const item of batch) {
            try {
              await base44.entities.PrecoProduto.create(item);
              created++;
            } catch (e) {
              errorsCount++;
              const row = validRows.find(r => r.produto_id === item.produto_id && r.tabela_id === item.tabela_id);
              failedList.push({
                ...row,
                erro_importacao: e.message || 'Erro ao criar',
                id: `failed_create_${Date.now()}_${errorsCount}`
              });
            }
          }
        }
        setProgress(20 + Math.round((i / toCreate.length) * 40));
      }

      setProgress(60);

      // Atualizar existentes (batch de 20 para updates)
      const updateBatchSize = 20;
      for (let i = 0; i < toUpdate.length; i += updateBatchSize) {
        const batch = toUpdate.slice(i, i + updateBatchSize);
        await Promise.all(batch.map(async ({ id, data, row }) => {
          try {
            await base44.entities.PrecoProduto.update(id, data);
            updated++;
          } catch (e) {
            errorsCount++;
            failedList.push({
              ...row,
              erro_importacao: e.message || 'Erro ao atualizar',
              id: `failed_update_${Date.now()}_${errorsCount}`
            });
          }
        }));
        setProgress(60 + Math.round((i / toUpdate.length) * 35));
      }

      setProgress(95);
    } catch (err) {
      toast.error('Erro geral na importação: ' + err.message);
    }

    // Adicionar também os registros com erro de validação ao log
    const validationErrors = preview.filter(r => r.erro).map((row, idx) => ({
      ...row,
      erro_importacao: row.erro,
      id: `validation_${idx}_${Date.now()}`
    }));

    const allFailed = [...failedList, ...validationErrors];
    setFailedImports(allFailed);
    
    // Salvar erros no localStorage para a aba de Log de Erros
    if (allFailed.length > 0) {
      const existingErrors = JSON.parse(localStorage.getItem('importacao_precos_erros') || '[]');
      const newErrors = allFailed.map((err, idx) => ({
        ...err,
        id: `error_${Date.now()}_${idx}`
      }));
      localStorage.setItem('importacao_precos_erros', JSON.stringify([...existingErrors, ...newErrors]));
      setShowErrorLog(true);
    }

    setResults({ created, updated, errors: errorsCount + validationErrors.length, total: preview.length });
    setIsProcessing(false);
    
    if (errorsCount === 0 && validationErrors.length === 0) {
      toast.success(`✅ Importação concluída! ${created} criados, ${updated} atualizados`);
      onSuccess?.();
    } else {
      toast.warning(`⚠️ Importação com erros: ${allFailed.length} falhas`);
    }
  };

  // Função para editar item com erro
  const handleEditErrorItem = (item) => {
    setEditingError({
      ...item,
      new_tabela_id: item.tabela_id || '',
      new_produto_id: item.produto_id || '',
      new_valor: item.valor_unitario || 0
    });
  };

  // Função para salvar item editado
  const handleSaveEditedItem = async () => {
    if (!editingError) return;

    const { new_tabela_id, new_produto_id, new_valor } = editingError;

    if (!new_tabela_id || !new_produto_id || new_valor <= 0) {
      toast.error('Preencha todos os campos corretamente');
      return;
    }

    try {
      // Verificar se já existe
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

      // Remover do log de erros
      setFailedImports(prev => prev.filter(f => f.id !== editingError.id));
      setEditingError(null);
      onSuccess?.();
    } catch (err) {
      toast.error('Erro ao salvar: ' + err.message);
    }
  };

  // Função para remover item do log de erros
  const handleRemoveErrorItem = (itemId) => {
    setFailedImports(prev => prev.filter(f => f.id !== itemId));
  };

  // Função para tentar importar todos os erros corrigidos
  const handleRetryAllErrors = async () => {
    const itemsToRetry = failedImports.filter(item => item.tabela_id && item.produto_id && item.valor_unitario > 0);
    
    if (itemsToRetry.length === 0) {
      toast.error('Nenhum item válido para reimportar');
      return;
    }

    setIsProcessing(true);
    let successCount = 0;
    const stillFailed = [];

    const existingPrices = await base44.entities.PrecoProduto.list();

    for (const item of itemsToRetry) {
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

    // Manter os que não tinham dados válidos + os que ainda falharam
    const invalidItems = failedImports.filter(item => !item.tabela_id || !item.produto_id || item.valor_unitario <= 0);
    setFailedImports([...invalidItems, ...stillFailed]);
    setIsProcessing(false);

    if (successCount > 0) {
      toast.success(`${successCount} itens importados com sucesso!`);
      onSuccess?.();
    }
    if (stillFailed.length > 0) {
      toast.warning(`${stillFailed.length} itens ainda com erro`);
    }
  };

  const downloadTemplate = () => {
    const template = "TABELA;COD PRODUTO;VALOR UNITARIO\nNOME_TABELA;001;10,50\nNOME_TABELA;002;15,99";
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo_precos.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = preview.filter(r => !r.erro).length;
  const errorCount = preview.filter(r => r.erro).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-amber-500" />
            Importar Preços em Massa
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Modo de Importação */}
          <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg">
            <Label className="font-medium">Modo:</Label>
            <div className="flex gap-2">
              <Button 
                size="sm" 
                variant={importMode === 'cadastrar' ? 'default' : 'outline'}
                onClick={() => setImportMode('cadastrar')}
                className={importMode === 'cadastrar' ? 'bg-emerald-600' : ''}
              >
                Cadastrar Novos
              </Button>
              <Button 
                size="sm" 
                variant={importMode === 'atualizar' ? 'default' : 'outline'}
                onClick={() => setImportMode('atualizar')}
                className={importMode === 'atualizar' ? 'bg-blue-600' : ''}
              >
                Atualizar Existentes
              </Button>
            </div>
          </div>

          <Tabs value={mode} onValueChange={setMode}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload">Upload de Arquivo</TabsTrigger>
              <TabsTrigger value="paste">Colar Dados</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="flex-1"
                />
                <Button variant="outline" size="sm" onClick={downloadTemplate}>
                  <Download className="w-4 h-4 mr-1" /> Modelo
                </Button>
              </div>
              {file && <p className="text-sm text-slate-500">Arquivo: {file.name}</p>}
            </TabsContent>

            <TabsContent value="paste" className="space-y-3">
              <Textarea
                placeholder="Cole os dados aqui (TABELA;COD PRODUTO;VALOR UNITARIO)..."
                value={pastedData}
                onChange={(e) => setPastedData(e.target.value)}
                rows={6}
              />
              <Button variant="outline" onClick={handlePasteData}>
                <RefreshCw className="w-4 h-4 mr-1" /> Processar Dados
              </Button>
            </TabsContent>
          </Tabs>

          {/* Erros de Parsing */}
          {errors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center gap-2 text-red-700 font-medium mb-2">
                <AlertCircle className="w-4 h-4" /> Erros encontrados:
              </div>
              <ul className="text-sm text-red-600 list-disc list-inside">
                {errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          )}

          {/* Preview */}
          {preview.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="p-3 bg-slate-50 border-b flex justify-between items-center">
                <span className="font-medium">Preview ({preview.length} registros)</span>
                <div className="flex gap-2 text-sm">
                  <span className="text-emerald-600">{validCount} válidos</span>
                  {errorCount > 0 && <span className="text-red-600">{errorCount} com erro</span>}
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Linha</th>
                      <th className="p-2 text-left">Tabela</th>
                      <th className="p-2 text-left">Cód. Produto</th>
                      <th className="p-2 text-left">Produto</th>
                      <th className="p-2 text-right">Valor</th>
                      <th className="p-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 50).map((row, idx) => (
                      <tr key={idx} className={row.erro ? 'bg-red-50' : ''}>
                        <td className="p-2 text-slate-500">{row.linha}</td>
                        <td className="p-2">{row.tabela_nome}</td>
                        <td className="p-2 font-mono">{row.cod_produto}</td>
                        <td className="p-2">{row.produto_nome || '-'}</td>
                        <td className="p-2 text-right">R$ {row.valor_unitario?.toFixed(2)}</td>
                        <td className="p-2">
                          {row.erro ? (
                            <span className="text-red-600 text-xs">{row.erro}</span>
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 50 && (
                  <p className="p-2 text-center text-sm text-slate-500">
                    ... e mais {preview.length - 50} registros
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Progress */}
          {isProcessing && (
            <div className="space-y-2">
              <Progress value={progress} />
              <p className="text-sm text-slate-500 text-center">Processando... {progress}%</p>
            </div>
          )}

          {/* Results */}
          {results && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
              <h4 className="font-medium text-emerald-800 mb-2">Importação Concluída!</h4>
              <ul className="text-sm text-emerald-700">
                <li>✅ {results.created} preços criados</li>
                <li>🔄 {results.updated} preços atualizados</li>
                {results.errors > 0 && (
                  <li className="text-red-600">
                    ❌ {results.errors} erros 
                    <Button 
                      variant="link" 
                      size="sm" 
                      className="text-red-600 p-0 ml-2 h-auto"
                      onClick={() => setShowErrorLog(true)}
                    >
                      (Ver detalhes)
                    </Button>
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Log de Erros */}
          {showErrorLog && failedImports.length > 0 && (
            <div className="border border-red-200 rounded-lg overflow-hidden">
              <div className="p-3 bg-red-50 border-b border-red-200 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <XCircle className="w-5 h-5 text-red-500" />
                  <span className="font-medium text-red-800">
                    Log de Erros ({failedImports.length} registros)
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={handleRetryAllErrors}
                    disabled={isProcessing}
                    className="text-xs"
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Reimportar Válidos
                  </Button>
                  <Button 
                    size="sm" 
                    variant="ghost"
                    onClick={() => setShowErrorLog(false)}
                    className="text-xs"
                  >
                    Ocultar
                  </Button>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-red-100 sticky top-0">
                    <tr>
                      <th className="p-2 text-left">Tabela</th>
                      <th className="p-2 text-left">Cód. Produto</th>
                      <th className="p-2 text-right">Valor Informado</th>
                      <th className="p-2 text-left">Erro</th>
                      <th className="p-2 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedImports.map((item) => (
                      <tr key={item.id} className="border-b border-red-100 hover:bg-red-50">
                        <td className="p-2 font-medium">{item.tabela_nome || '-'}</td>
                        <td className="p-2 font-mono">{item.cod_produto || '-'}</td>
                        <td className="p-2 text-right">
                          R$ {item.valor_unitario?.toFixed(2) || '0.00'}
                        </td>
                        <td className="p-2">
                          <span className="text-red-600 text-xs bg-red-100 px-2 py-1 rounded">
                            {item.erro_importacao || item.erro}
                          </span>
                        </td>
                        <td className="p-2 text-center">
                          <div className="flex justify-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleEditErrorItem(item)}
                              className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRemoveErrorItem(item.id)}
                              className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Modal de Edição de Erro */}
          {editingError && (
            <div className="p-4 border border-blue-200 bg-blue-50 rounded-lg space-y-3">
              <h4 className="font-medium text-blue-800 flex items-center gap-2">
                <Edit2 className="w-4 h-4" />
                Corrigir Item com Erro
              </h4>
              <p className="text-xs text-blue-600">
                Erro original: {editingError.erro_importacao || editingError.erro}
              </p>
              <div className="grid grid-cols-3 gap-3">
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

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={handleClose}>
              {results ? 'Fechar' : 'Cancelar'}
            </Button>
            {!results && (
              <Button 
                onClick={handleImport}
                disabled={isProcessing || validCount === 0}
                className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold"
              >
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                Importar {validCount} Registros
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}