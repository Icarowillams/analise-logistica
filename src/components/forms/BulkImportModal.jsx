import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FileSpreadsheet, Upload, AlertCircle, CheckCircle, Download, Loader2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function BulkImportModal({
  open,
  onOpenChange,
  title,
  description,
  columns,
  exampleData,
  onImport,
  isImporting,
  tipoImportacao = 'venda',
  onTipoChange,
  modoCliente,
  onModoClienteChange
}) {
  const [mode, setMode] = useState('upload'); // 'upload' | 'paste'
  const [file, setFile] = useState(null);
  const [pasteData, setPasteData] = useState('');
  const [preview, setPreview] = useState([]);
  const [allRows, setAllRows] = useState([]);
  const [errors, setErrors] = useState([]);

  const parseCSV = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(/[,;\t]/).map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
    return lines.slice(1).map((line, idx) => {
      const values = line.split(/[,;\t]/);
      const row = { _rowNum: idx + 2 };
      headers.forEach((h, i) => { row[h] = values[i]?.trim() || ''; });
      return row;
    });
  };

  const handleFileChange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    const text = await f.text();
    processData(text);
  };

  const handlePasteChange = (text) => {
    setPasteData(text);
    if (text.trim()) {
      processData(text);
    } else {
      setPreview([]);
      setErrors([]);
    }
  };

  const processData = (text) => {
    const rows = parseCSV(text);
    setAllRows(rows);
    setPreview(rows.slice(0, 10));

    // Validação básica
    const errs = [];
    const requiredCols = columns.filter(c => c.required).map(c => c.key);

    rows.forEach((row, idx) => {
      requiredCols.forEach(col => {
        if (!row[col]) {
          errs.push(`Linha ${row._rowNum}: Campo "${col}" é obrigatório`);
        }
      });
    });

    setErrors(errs.slice(0, 5));
  };

  const handleImport = async () => {
    // Mapear para o formato correto
    const data = allRows.map(row => {
      const item = {};
      columns.forEach(col => {
        if (row[col.key] !== undefined && row[col.key] !== '') {
          if (col.type === 'number') {
            item[col.key] = parseFloat(row[col.key]) || 0;
          } else {
            item[col.key] = row[col.key];
          }
        }
      });
      return item;
    });

    await onImport(data);
    resetForm();
  };

  const resetForm = () => {
    setFile(null);
    setPasteData('');
    setPreview([]);
    setAllRows([]);
    setErrors([]);
    setMode('upload');
  };

  const downloadTemplate = () => {
    const headers = columns.map(c => c.key).join(';');
    const example = exampleData.map(row => columns.map(c => row[c.key] || '').join(';')).join('\n');
    const content = headers + '\n' + example;
    
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'modelo_importacao.csv';
    link.click();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-amber-600" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Modo de importação de clientes - só mostra se as props forem passadas */}
          {onModoClienteChange && (
            <div className="p-4 bg-slate-50 rounded-xl border-2 border-slate-200">
              <p className="font-medium text-slate-700 mb-3">Modo de Importação:</p>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer p-3 rounded-lg border-2 transition-all flex-1" style={{
                  borderColor: modoCliente === 'cadastro' ? '#10b981' : '#e5e7eb',
                  backgroundColor: modoCliente === 'cadastro' ? '#ecfdf5' : 'white'
                }}>
                  <input
                    type="radio"
                    checked={modoCliente === 'cadastro'}
                    onChange={() => onModoClienteChange('cadastro')}
                    className="w-4 h-4 text-emerald-600"
                    name="modoImportacaoCliente"
                  />
                  <div>
                    <span className="text-sm font-semibold block" style={{
                      color: modoCliente === 'cadastro' ? '#059669' : '#64748b'
                    }}>
                      ➕ Cadastro
                    </span>
                    <span className="text-xs text-slate-500">Cria novos e atualiza existentes</span>
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer p-3 rounded-lg border-2 transition-all flex-1" style={{
                  borderColor: modoCliente === 'atualizacao' ? '#3b82f6' : '#e5e7eb',
                  backgroundColor: modoCliente === 'atualizacao' ? '#eff6ff' : 'white'
                }}>
                  <input
                    type="radio"
                    checked={modoCliente === 'atualizacao'}
                    onChange={() => onModoClienteChange('atualizacao')}
                    className="w-4 h-4 text-blue-600"
                    name="modoImportacaoCliente"
                  />
                  <div>
                    <span className="text-sm font-semibold block" style={{
                      color: modoCliente === 'atualizacao' ? '#1e40af' : '#64748b'
                    }}>
                      ✏️ Atualização Cadastral
                    </span>
                    <span className="text-xs text-slate-500">Apenas atualiza clientes existentes</span>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Tipo de importação (vendas/trocas) - só mostra se as props forem passadas */}
          {onTipoChange && (
            <div className="p-4 bg-slate-50 rounded-xl border-2 border-slate-200">
              <p className="font-medium text-slate-700 mb-3">Tipo de Importação:</p>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer p-3 rounded-lg border-2 transition-all" style={{
                  borderColor: tipoImportacao === 'venda' ? '#3b82f6' : '#e5e7eb',
                  backgroundColor: tipoImportacao === 'venda' ? '#eff6ff' : 'white'
                }}>
                  <input
                    type="radio"
                    checked={tipoImportacao === 'venda'}
                    onChange={() => onTipoChange(false)}
                    className="w-4 h-4 text-blue-600"
                    name="tipoImportacaoModal"
                  />
                  <span className="text-sm font-semibold" style={{
                    color: tipoImportacao === 'venda' ? '#1e40af' : '#64748b'
                  }}>
                    📦 Vendas
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer p-3 rounded-lg border-2 transition-all" style={{
                  borderColor: tipoImportacao === 'troca' ? '#f97316' : '#e5e7eb',
                  backgroundColor: tipoImportacao === 'troca' ? '#fff7ed' : 'white'
                }}>
                  <input
                    type="radio"
                    checked={tipoImportacao === 'troca'}
                    onChange={() => onTipoChange(true)}
                    className="w-4 h-4 text-orange-600"
                    name="tipoImportacaoModal"
                  />
                  <span className="text-sm font-semibold" style={{
                    color: tipoImportacao === 'troca' ? '#ea580c' : '#64748b'
                  }}>
                    🔄 Trocas
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Baixar modelo */}
          <div className="flex items-center justify-between p-4 bg-amber-50 rounded-xl">
            <div>
              <p className="font-medium text-amber-900">Baixe o modelo de importação</p>
              <p className="text-sm text-amber-700">Arquivo CSV com as colunas corretas e exemplos</p>
            </div>
            <Button variant="outline" onClick={downloadTemplate} className="border-amber-300 text-amber-700 hover:bg-amber-100">
              <Download className="w-4 h-4 mr-2" />
              Baixar Modelo
            </Button>
          </div>

          {/* Tabs de modo */}
          <div className="flex gap-2">
            <Button
              variant={mode === 'upload' ? 'default' : 'outline'}
              onClick={() => setMode('upload')}
              className={mode === 'upload' ? 'bg-amber-500 hover:bg-amber-600 text-neutral-900' : ''}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload de Arquivo
            </Button>
            <Button
              variant={mode === 'paste' ? 'default' : 'outline'}
              onClick={() => setMode('paste')}
              className={mode === 'paste' ? 'bg-amber-500 hover:bg-amber-600 text-neutral-900' : ''}
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Colar Dados
            </Button>
          </div>

          {/* Área de input */}
          {mode === 'upload' ? (
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center hover:border-indigo-400 transition-colors">
              <input
                type="file"
                accept=".csv,.txt"
                onChange={handleFileChange}
                className="hidden"
                id="bulk-file-input"
              />
              <label htmlFor="bulk-file-input" className="cursor-pointer">
                <Upload className="w-12 h-12 mx-auto text-slate-400 mb-4" />
                {file ? (
                  <p className="text-lg font-medium text-slate-700">{file.name}</p>
                ) : (
                  <>
                    <p className="text-lg font-medium text-slate-700">Clique para selecionar arquivo</p>
                    <p className="text-sm text-slate-500 mt-1">CSV ou TXT separado por vírgula, ponto-e-vírgula ou tab</p>
                  </>
                )}
              </label>
            </div>
          ) : (
            <div>
              <p className="text-sm text-slate-600 mb-2">Cole os dados do Excel ou planilha (com cabeçalho na primeira linha):</p>
              <Textarea
                value={pasteData}
                onChange={(e) => handlePasteChange(e.target.value)}
                placeholder={`${columns.map(c => c.key).join('\t')}\nValor1\tValor2\t...`}
                rows={8}
                className="font-mono text-sm"
              />
            </div>
          )}

          {/* Colunas esperadas */}
          <div className="p-4 bg-slate-50 rounded-xl">
            <p className="font-medium text-slate-700 mb-2">Colunas esperadas:</p>
            <div className="flex flex-wrap gap-2">
              {columns.map(col => (
                <span
                  key={col.key}
                  className={`px-3 py-1 rounded-full text-sm ${col.required ? 'bg-red-100 text-red-700' : 'bg-slate-200 text-slate-600'}`}
                >
                  {col.key} {col.required && '*'}
                </span>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-2">* Campos obrigatórios</p>
          </div>

          {/* Erros */}
          {errors.length > 0 && (
            <Alert className="bg-amber-50 border-amber-200">
              <AlertCircle className="w-5 h-5 text-amber-600" />
              <AlertDescription className="text-amber-700">
                <ul className="list-disc list-inside">
                  {errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Preview */}
          {preview.length > 0 && (
            <div>
              <p className="font-medium text-slate-700 mb-2">Pré-visualização (10 primeiros de {allRows.length} registros):</p>
              <div className="overflow-x-auto border rounded-xl">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      {columns.slice(0, 5).map(col => (
                        <TableHead key={col.key}>{col.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((row, idx) => (
                      <TableRow key={idx}>
                        {columns.slice(0, 5).map(col => (
                          <TableCell key={col.key}>{row[col.key] || '-'}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Botões */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isImporting}>
              Cancelar
            </Button>
            <Button
              onClick={handleImport}
              disabled={isImporting || allRows.length === 0}
              className={
                modoCliente === 'atualizacao' 
                  ? 'bg-gradient-to-r from-blue-500 to-indigo-600' 
                  : tipoImportacao === 'troca' 
                    ? 'bg-gradient-to-r from-orange-500 to-red-600' 
                    : 'bg-gradient-to-r from-emerald-500 to-teal-600'
              }
            >
              {isImporting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importando...</>
              ) : (
                <><CheckCircle className="w-4 h-4 mr-2" />
                  {modoCliente === 'atualizacao' 
                    ? `Atualizar ${allRows.length} cliente(s)` 
                    : `Importar ${allRows.length} ${tipoImportacao === 'troca' ? 'trocas' : onModoClienteChange ? 'cliente(s)' : 'vendas'}`
                  }
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}