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

    const headers = lines[0].split(/[,;\t]/).map(h => h.trim().toUpperCase());
    
    // Verificar colunas obrigatórias
    const requiredCols = ['TABELA', 'COD PRODUTO', 'VALOR UNITARIO'];
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
      const values = lines[i].split(/[,;\t]/).map(v => v.trim());
      if (values.length < 3 || !values[colMap.TABELA]) continue;

      const tabelaNome = values[colMap.TABELA]?.toUpperCase();
      const codProduto = values[colMap.COD_PRODUTO];
      let valorStr = values[colMap.VALOR_UNITARIO]?.replace(',', '.') || '0';
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

    let created = 0;
    let updated = 0;
    let errorsCount = 0;

    // Buscar todos os preços existentes
    const existingPrices = await base44.entities.PrecoProduto.list();

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      
      try {
        // Verificar se já existe preço para este produto/tabela
        const existing = existingPrices.find(
          p => p.produto_id === row.produto_id && p.tabela_id === row.tabela_id
        );

        if (existing) {
          if (importMode === 'atualizar') {
            await base44.entities.PrecoProduto.update(existing.id, {
              valor_unitario: row.valor_unitario
            });
            updated++;
          }
          // Se modo cadastrar, pula registros existentes
        } else {
          await base44.entities.PrecoProduto.create({
            produto_id: row.produto_id,
            tabela_id: row.tabela_id,
            valor_unitario: row.valor_unitario,
            valor_acao: 0,
            ativacao_acao: false
          });
          created++;
        }
      } catch (err) {
        errorsCount++;
      }

      setProgress(Math.round(((i + 1) / validRows.length) * 100));
    }

    setResults({ created, updated, errors: errorsCount, total: validRows.length });
    setIsProcessing(false);
    
    if (errorsCount === 0) {
      toast.success(`✅ Importação concluída! ${created} criados, ${updated} atualizados`);
      onSuccess?.();
    } else {
      toast.warning(`⚠️ Importação com erros: ${errorsCount} falhas`);
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
                {results.errors > 0 && <li>❌ {results.errors} erros</li>}
              </ul>
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