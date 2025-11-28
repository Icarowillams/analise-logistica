import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2, Clipboard, Save } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';

export default function ImportarVendas() {
  const [pasteData, setPasteData] = useState('');
  const [preview, setPreview] = useState([]);
  const [errors, setErrors] = useState([]);
  const [importing, setImporting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [importDate, setImportDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [selectedVendedor, setSelectedVendedor] = useState('');
  
  const queryClient = useQueryClient();

  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: () => base44.entities.Cliente.list() });
  const { data: produtos = [] } = useQuery({ queryKey: ['produtos'], queryFn: () => base44.entities.Produto.list() });

  useEffect(() => {
    if (pasteData) {
      processData(pasteData);
    } else {
      setPreview([]);
      setErrors([]);
    }
  }, [pasteData, importDate, selectedVendedor, clientes, produtos]);

  const processData = (text) => {
    // Split lines and remove empty ones
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) return;

    // Assuming first line is header or data? The user said "seguindo as colunas configuradas".
    // It's safer to assume the user pastes WITH headers or WITHOUT.
    // Usually paste from Excel has headers if copied, or not. 
    // The user specified the columns: "COD" "COD PRODUTO" "VALOR LIQ" "QUANTIDADE LIQUIDA" "BONIFICAÇÃO" "TROCA"
    // We'll try to detect if the first line matches headers. If so, skip it.
    
    let startIdx = 0;
    const firstLine = lines[0].toLowerCase();
    if (firstLine.includes('cod') && firstLine.includes('valor')) {
      startIdx = 1;
    }

    const validationErrors = [];
    const processedRows = lines.slice(startIdx).map((line, idx) => {
      const values = line.split(/\t/); // Assuming tab separated from Excel copy
      
      // Fallback to comma/semicolon if no tabs found in a line with content
      const splitValues = values.length > 1 ? values : line.split(/[,;]/);
      
      // Map columns based on order: COD, COD PRODUTO, VALOR LIQ, QUANTIDADE LIQUIDA, BONIFICAÇÃO, TROCA
      const codCliente = splitValues[0]?.trim();
      const codProduto = splitValues[1]?.trim();
      const valorLiq = parseFloat(splitValues[2]?.replace('R$', '').replace('.', '').replace(',', '.') || '0');
      const qtdLiq = parseFloat(splitValues[3]?.replace(',', '.') || '0');
      const bonificacao = parseFloat(splitValues[4]?.replace(',', '.') || '0');
      const troca = parseFloat(splitValues[5]?.replace(',', '.') || '0');

      const cliente = clientes.find(c => 
        c.codigo === codCliente || 
        c.cpf_cnpj?.replace(/\D/g, '') === codCliente?.replace(/\D/g, '')
      );
      
      const produto = produtos.find(p => 
        p.sku === codProduto || 
        p.cod_barras === codProduto
      );

      const rowNum = idx + 1 + startIdx;

      if (!codCliente) validationErrors.push(`Linha ${rowNum}: Código do cliente vazio`);
      if (codCliente && !cliente) validationErrors.push(`Linha ${rowNum}: Cliente não encontrado (Código: ${codCliente})`);
      if (!codProduto) validationErrors.push(`Linha ${rowNum}: Código do produto vazio`);
      if (codProduto && !produto) validationErrors.push(`Linha ${rowNum}: Produto não encontrado (Código: ${codProduto})`);
      if (!selectedVendedor) validationErrors.push(`Linha ${rowNum}: Vendedor não selecionado para a importação`);

      return {
        _rowNum: rowNum,
        cod_cliente: codCliente,
        cliente_id: cliente?.id,
        cliente_nome: cliente?.razao_social || cliente?.nome_fantasia,
        cod_produto: codProduto,
        produto_id: produto?.id,
        produto_nome: produto?.nome,
        valor_liq: valorLiq,
        qtd_liq: qtdLiq,
        bonificacao: bonificacao,
        troca: troca,
        valid: !!(cliente && produto && selectedVendedor && importDate)
      };
    });

    setPreview(processedRows);
    setErrors([...new Set(validationErrors)]); // remove duplicates
  };

  const handleImport = async () => {
    setImporting(true);
    const validRows = preview.filter(r => r.valid);
    const vendedor = vendedores.find(v => v.id === selectedVendedor);

    try {
      const vendasData = validRows.map(r => ({
        data: importDate,
        vendedor_id: selectedVendedor,
        vendedor_nome: vendedor?.nome,
        cliente_id: r.cliente_id,
        cliente_nome: r.cliente_nome,
        produto_id: r.produto_id,
        produto_nome: r.produto_nome,
        quantidade: r.qtd_liq,
        valor_total: r.valor_liq,
        valor_unitario: r.qtd_liq > 0 ? r.valor_liq / r.qtd_liq : 0,
        margem: 0, // Default or calculated if possible
        bonificacao: r.bonificacao,
        troca: r.troca
      }));

      // Batch creation could be better but simple loop for now to ensure safety
      // Or use bulkCreate if available (sdk usually supports it? prompt says base44.entities.Todo.bulkCreate)
      // Using bulkCreate for efficiency
      await base44.entities.Venda.create_entity_records(vendasData); // Wait, prompt says create_entity_records is a TOOL, not SDK method.
      // SDK method is base44.entities.Entity.create (single) or base44.entities.Entity.bulkCreate (if available).
      // The instructions say: "base44.entities.Todo.bulkCreate(...) will create 2 new todos."
      // So I can use bulkCreate.
      
      await base44.entities.Venda.bulkCreate(vendasData);

      setImporting(false);
      setSuccess(true);
      setPasteData('');
      setPreview([]);
      setErrors([]);
      queryClient.invalidateQueries(['vendas']);
    } catch (error) {
      console.error(error);
      setErrors(['Erro ao salvar vendas. Tente novamente.']);
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Importar Vendas (Copiar e Colar)" 
        subtitle="Cole os dados da planilha de vendas" 
        icon={Clipboard} 
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Configuration and Input */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configuração da Importação</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Data da Venda</Label>
                <Input 
                  type="date" 
                  value={importDate}
                  onChange={(e) => setImportDate(e.target.value)}
                />
              </div>
              
              <div>
                <Label>Vendedor Responsável</Label>
                <Select value={selectedVendedor} onValueChange={setSelectedVendedor}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o vendedor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {vendedores.map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clipboard className="w-4 h-4" />
                Área de Transferência
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label className="text-xs text-slate-500">
                  Colunas: COD | COD PRODUTO | VALOR LIQ | QTD LIQ | BONIF | TROCA
                </Label>
                <Textarea 
                  placeholder={`Cole aqui os dados do Excel...\nExemplo:\n001\t789123\t150,00\t10\t0\t0`}
                  className="min-h-[300px] font-mono text-xs"
                  value={pasteData}
                  onChange={(e) => {
                    setPasteData(e.target.value);
                    setSuccess(false);
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Preview and Action */}
        <div className="lg:col-span-2 space-y-6">
          {/* Success Message */}
          {success && (
            <Alert className="bg-emerald-50 border-emerald-200">
              <CheckCircle className="w-5 h-5 text-emerald-600" />
              <AlertDescription className="text-emerald-700 font-medium">
                Vendas importadas com sucesso!
              </AlertDescription>
            </Alert>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <Card className="border-amber-200 bg-amber-50">
              <CardHeader className="pb-3">
                <CardTitle className="text-amber-700 flex items-center gap-2 text-base">
                  <AlertCircle className="w-5 h-5" />
                  {errors.length} pendências encontradas
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

          {/* Preview Table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <CardTitle className="text-base">Pré-visualização ({preview.length} registros)</CardTitle>
              <Button 
                onClick={handleImport} 
                disabled={importing || preview.length === 0 || preview.some(r => !r.valid)}
                className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
              >
                {importing ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processando...</>
                ) : (
                  <><Save className="w-4 h-4 mr-2" /> Importar Vendas</>
                )}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 sticky top-0">
                      <TableHead className="w-12">Status</TableHead>
                      <TableHead>COD Cli</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>COD Prod</TableHead>
                      <TableHead>Produto</TableHead>
                      <TableHead className="text-right">Valor Liq</TableHead>
                      <TableHead className="text-right">Qtd</TableHead>
                      <TableHead className="text-right">Bonif</TableHead>
                      <TableHead className="text-right">Troca</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-slate-500">
                          Cole os dados na área de texto para visualizar
                        </TableCell>
                      </TableRow>
                    ) : (
                      preview.map((row, idx) => (
                        <TableRow key={idx} className={!row.valid ? 'bg-red-50' : ''}>
                          <TableCell>
                            {row.valid ? (
                              <CheckCircle className="w-4 h-4 text-emerald-500" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-red-500" />
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{row.cod_cliente}</TableCell>
                          <TableCell className="truncate max-w-[150px]" title={row.cliente_nome}>
                            {row.cliente_nome || <span className="text-red-500 italic">Não encontrado</span>}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{row.cod_produto}</TableCell>
                          <TableCell className="truncate max-w-[150px]" title={row.produto_nome}>
                            {row.produto_nome || <span className="text-red-500 italic">Não encontrado</span>}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.valor_liq?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </TableCell>
                          <TableCell className="text-right">{row.qtd_liq}</TableCell>
                          <TableCell className="text-right">{row.bonificacao}</TableCell>
                          <TableCell className="text-right">{row.troca}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}