import React, { useState, useCallback } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2, X } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ImportarVendas() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [errors, setErrors] = useState([]);
  const [importing, setImporting] = useState(false);
  const [success, setSuccess] = useState(false);
  
  const queryClient = useQueryClient();

  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: () => base44.entities.Cliente.list() });
  const { data: produtos = [] } = useQuery({ queryKey: ['produtos'], queryFn: () => base44.entities.Produto.list() });

  const parseCSV = (text) => {
    const lines = text.split('\n').filter(line => line.trim());
    const headers = lines[0].split(/[,;]/).map(h => h.trim().toLowerCase());
    return lines.slice(1).map((line, idx) => {
      const values = line.split(/[,;]/);
      const row = {};
      headers.forEach((h, i) => { row[h] = values[i]?.trim() || ''; });
      row._rowNum = idx + 2;
      return row;
    });
  };

  const handleFileChange = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setErrors([]);
    setSuccess(false);

    const text = await f.text();
    const rows = parseCSV(text);
    
    const validationErrors = [];
    const processedRows = rows.map(row => {
      const vendedor = vendedores.find(v => v.nome?.toLowerCase() === row.vendedor?.toLowerCase());
      const cliente = clientes.find(c => c.razao_social?.toLowerCase() === row.cliente?.toLowerCase() || c.nome_fantasia?.toLowerCase() === row.cliente?.toLowerCase());
      const produto = produtos.find(p => p.nome?.toLowerCase() === row.produto?.toLowerCase() || p.sku?.toLowerCase() === row.produto?.toLowerCase());
      
      if (!row.data) validationErrors.push(`Linha ${row._rowNum}: Data obrigatória`);
      if (!vendedor && row.vendedor) validationErrors.push(`Linha ${row._rowNum}: Vendedor "${row.vendedor}" não encontrado`);
      if (!cliente && row.cliente) validationErrors.push(`Linha ${row._rowNum}: Cliente "${row.cliente}" não encontrado`);
      if (!produto && row.produto) validationErrors.push(`Linha ${row._rowNum}: Produto "${row.produto}" não encontrado`);
      
      return {
        ...row,
        vendedor_id: vendedor?.id,
        vendedor_nome: vendedor?.nome || row.vendedor,
        cliente_id: cliente?.id,
        cliente_nome: cliente?.razao_social || row.cliente,
        produto_id: produto?.id,
        produto_nome: produto?.nome || row.produto,
        quantidade: parseFloat(row.quantidade) || 0,
        valor_total: parseFloat(row.valor) || 0,
        margem: parseFloat(row.margem) || 0,
        valid: vendedor && cliente && produto && row.data
      };
    });

    setPreview(processedRows);
    setErrors(validationErrors);
  };

  const handleImport = async () => {
    setImporting(true);
    const validRows = preview.filter(r => r.valid);
    
    const vendasData = validRows.map(r => ({
      data: r.data,
      vendedor_id: r.vendedor_id,
      vendedor_nome: r.vendedor_nome,
      cliente_id: r.cliente_id,
      cliente_nome: r.cliente_nome,
      produto_id: r.produto_id,
      produto_nome: r.produto_nome,
      quantidade: r.quantidade,
      valor_total: r.valor_total,
      margem: r.margem
    }));

    for (const venda of vendasData) {
      await base44.entities.Venda.create(venda);
    }

    setImporting(false);
    setSuccess(true);
    setPreview([]);
    setFile(null);
    queryClient.invalidateQueries(['vendas']);
  };

  const clearFile = () => {
    setFile(null);
    setPreview([]);
    setErrors([]);
    setSuccess(false);
  };

  return (
    <div>
      <PageHeader title="Importar Vendas" subtitle="Importe vendas via arquivo CSV" icon={Upload} />

      <div className="grid gap-6">
        {/* Upload Area */}
        <Card className="border-2 border-dashed border-slate-200 hover:border-indigo-400 transition-colors">
          <CardContent className="p-8">
            {!file ? (
              <label className="flex flex-col items-center justify-center cursor-pointer">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center mb-4">
                  <FileSpreadsheet className="w-8 h-8 text-indigo-600" />
                </div>
                <p className="text-lg font-medium text-slate-700 mb-2">Arraste ou clique para selecionar</p>
                <p className="text-sm text-slate-500 mb-4">Arquivos CSV com colunas: Data, Vendedor, Cliente, Produto, Quantidade, Valor, Margem</p>
                <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
                <Button className="bg-gradient-to-r from-indigo-500 to-purple-600">
                  Selecionar Arquivo
                </Button>
              </label>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                    <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-700">{file.name}</p>
                    <p className="text-sm text-slate-500">{preview.length} registros encontrados</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={clearFile}>
                  <X className="w-5 h-5" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Success Message */}
        {success && (
          <Alert className="bg-emerald-50 border-emerald-200">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
            <AlertDescription className="text-emerald-700 font-medium">
              Importação concluída com sucesso!
            </AlertDescription>
          </Alert>
        )}

        {/* Errors */}
        {errors.length > 0 && (
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-amber-700 flex items-center gap-2 text-base">
                <AlertCircle className="w-5 h-5" />
                {errors.length} aviso(s) encontrado(s)
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="text-sm text-amber-700 space-y-1 max-h-40 overflow-y-auto">
                {errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
                {errors.length > 10 && <li>...e mais {errors.length - 10} avisos</li>}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Preview */}
        {preview.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Pré-visualização</CardTitle>
              <Button 
                onClick={handleImport} 
                disabled={importing || preview.filter(r => r.valid).length === 0}
                className="bg-gradient-to-r from-emerald-500 to-teal-600"
              >
                {importing ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importando...</>
                ) : (
                  <>Importar {preview.filter(r => r.valid).length} vendas</>
                )}
              </Button>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Vendedor</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead>Qtd</TableHead>
                      <TableHead>Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.slice(0, 20).map((row, idx) => (
                      <TableRow key={idx} className={!row.valid ? 'bg-red-50' : ''}>
                        <TableCell>
                          <Badge className={row.valid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}>
                            {row.valid ? 'OK' : 'Erro'}
                          </Badge>
                        </TableCell>
                        <TableCell>{row.data}</TableCell>
                        <TableCell>{row.vendedor_nome}</TableCell>
                        <TableCell>{row.cliente_nome}</TableCell>
                        <TableCell>{row.produto_nome}</TableCell>
                        <TableCell>{row.quantidade}</TableCell>
                        <TableCell>R$ {row.valor_total?.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {preview.length > 20 && (
                  <p className="text-sm text-slate-500 mt-4 text-center">Mostrando 20 de {preview.length} registros</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}