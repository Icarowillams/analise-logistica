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
  }, [pasteData, clientes, produtos, vendedores]);

  const processData = (text) => {
    // Split lines and remove empty ones
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) return;

    let startIdx = 0;
    const firstLine = lines[0].toLowerCase();
    // Adjusted for new column: DATA
    if (firstLine.includes('data') && firstLine.includes('cod')) {
      startIdx = 1;
    }

    const validationErrors = [];
    const processedRows = lines.slice(startIdx).map((line, idx) => {
      const values = line.split(/\t/); // Assuming tab separated from Excel copy
      
      const splitValues = values.length > 1 ? values : line.split(/[,;]/);
      
      // New Order: DATA | COD | COD PRODUTO | VALOR LIQ | QTD LIQ | BONIF | TROCA
      const dataRaw = splitValues[0]?.trim();
      const codCliente = splitValues[1]?.trim();
      const codProduto = splitValues[2]?.trim();
      const valorLiq = parseFloat(splitValues[3]?.replace('R$', '').replace('.', '').replace(',', '.') || '0');
      const qtdLiq = parseFloat(splitValues[4]?.replace(',', '.') || '0');
      const bonificacao = parseFloat(splitValues[5]?.replace(',', '.') || '0');
      const troca = parseFloat(splitValues[6]?.replace(',', '.') || '0');

      // Format Date (assuming input DD/MM/YYYY or similar, need YYYY-MM-DD for entity)
      let dataVenda = null;
      if (dataRaw) {
        if (dataRaw.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
          const [day, month, year] = dataRaw.split('/');
          dataVenda = `${year}-${month}-${day}`;
        } else if (dataRaw.match(/^\d{4}-\d{2}-\d{2}$/)) {
          dataVenda = dataRaw;
        }
      }

      const cliente = clientes.find(c => 
        c.codigo === codCliente || 
        c.cpf_cnpj?.replace(/\D/g, '') === codCliente?.replace(/\D/g, '')
      );
      
      const produto = produtos.find(p => 
        p.sku === codProduto || 
        p.cod_barras === codProduto
      );

      const rowNum = idx + 1 + startIdx;

      if (!dataRaw) validationErrors.push(`Linha ${rowNum}: Data vazia`);
      if (dataRaw && !dataVenda) validationErrors.push(`Linha ${rowNum}: Formato de data inválido (use DD/MM/AAAA)`);
      if (!codCliente) validationErrors.push(`Linha ${rowNum}: Código do cliente vazio`);
      if (codCliente && !cliente) validationErrors.push(`Linha ${rowNum}: Cliente não encontrado (Código: ${codCliente})`);
      if (!codProduto) validationErrors.push(`Linha ${rowNum}: Código do produto vazio`);
      if (codProduto && !produto) validationErrors.push(`Linha ${rowNum}: Produto não encontrado (Código: ${codProduto})`);
      
      // Validation for Vendedor linked to Cliente
      if (cliente && !cliente.vendedor_id) validationErrors.push(`Linha ${rowNum}: Cliente ${cliente.razao_social} não tem vendedor vinculado`);

      return {
        _rowNum: rowNum,
        data: dataVenda,
        cod_cliente: codCliente,
        cliente: cliente, // Pass full objects to use in handleImport
        produto: produto,
        valor_liq: valorLiq,
        qtd_liq: qtdLiq,
        bonificacao: bonificacao,
        troca: troca,
        valid: !!(cliente && produto && dataVenda && cliente.vendedor_id)
      };
    });

    setPreview(processedRows);
    setErrors([...new Set(validationErrors)]); 
  };

  const handleImport = async () => {
    setImporting(true);
    const validRows = preview.filter(r => r.valid);

    try {
      const vendasData = validRows.map(r => {
        const cli = r.cliente;
        const prod = r.produto;
        const vend = vendedores.find(v => v.id === cli.vendedor_id);
        const supervisorId = vend?.supervisor_id; // Assuming Vendor entity has supervisor_id

        return {
          data: r.data,
          vendedor_id: cli.vendedor_id,
          vendedor_nome: vend?.nome || 'Vendedor Desconhecido',
          supervisor_id: supervisorId,
          cliente_id: cli.id,
          cliente_nome: cli.razao_social || cli.nome_fantasia,
          produto_id: prod.id,
          produto_nome: prod.nome,
          categoria_id: prod.categoria_id,
          sub_categoria_id: prod.sub_categoria_id,
          segmento_id: cli.segmento_id,
          rede_id: cli.rede_id,
          rota_id: cli.rota_id,
          tabela_id: cli.tabela_id,
          plano_pagamento_id: cli.plano_pagamento_id,
          quantidade: r.qtd_liq,
          valor_total: r.valor_liq,
          valor_unitario: r.qtd_liq > 0 ? r.valor_liq / r.qtd_liq : 0,
          margem: 0,
          bonificacao: r.bonificacao,
          troca: r.troca
        };
      });

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
        {/* Left Column: Input */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clipboard className="w-4 h-4" />
                Área de Transferência
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label className="text-xs text-slate-500 font-semibold block mb-2">
                  Ordem das Colunas:
                  <br/>
                  DATA | COD CLI | COD PROD | VALOR LIQ | QTD LIQ | BONIF | TROCA
                </Label>
                <Textarea 
                  placeholder={`Cole aqui os dados do Excel...
Exemplo:
01/01/2024\tC001\tP123\t150,00\t10\t0\t0`}
                  className="min-h-[400px] font-mono text-xs"
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