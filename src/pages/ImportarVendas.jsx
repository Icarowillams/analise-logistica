import React, { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2, Clipboard, Save, Plus, Calendar, Filter, Search, ChevronDown, ChevronRight, Package } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';

export default function ImportarVendas() {
  const [activeTab, setActiveTab] = useState("importacao");

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Gestão de Vendas" 
        subtitle="Importação de vendas e relatórios de faturamento" 
        icon={FileSpreadsheet} 
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-4xl grid-cols-4 mb-6">
          <TabsTrigger value="importacao">Importar Vendas</TabsTrigger>
          <TabsTrigger value="faturamento_produto">Faturamento Produto</TabsTrigger>
          <TabsTrigger value="faturamento_cliente">Faturamento Cliente</TabsTrigger>
          <TabsTrigger value="pedidos">Pedidos Importados</TabsTrigger>
        </TabsList>

        <TabsContent value="importacao" className="space-y-6">
          <ImportacaoTab />
        </TabsContent>

        <TabsContent value="faturamento_produto" className="space-y-6">
          <RelatorioFaturamento tipo="produto" />
        </TabsContent>

        <TabsContent value="faturamento_cliente" className="space-y-6">
          <RelatorioFaturamento tipo="cliente" />
        </TabsContent>

        <TabsContent value="pedidos" className="space-y-6">
          <PedidosTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ImportacaoTab() {
  const [mode, setMode] = useState('manual'); // 'manual' | 'text'
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            {mode === 'manual' ? 'Nova Venda Manual' : 'Importação em Massa'}
          </h3>
          <p className="text-sm text-slate-500">
            {mode === 'manual' ? 'Registre uma venda individualmente' : 'Copie e cole dados de uma planilha'}
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => setMode(mode === 'manual' ? 'text' : 'manual')}
          className="gap-2"
        >
          {mode === 'manual' ? (
            <><Clipboard className="w-4 h-4" /> Importar por Texto</>
          ) : (
            <><Plus className="w-4 h-4" /> Inserir Manualmente</>
          )}
        </Button>
      </div>

      {mode === 'manual' ? <ManualEntryForm /> : <TextImportForm />}
    </div>
  );
}

function ManualEntryForm() {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    data: format(new Date(), 'yyyy-MM-dd'),
    cliente_id: '',
    produto_id: '',
    quantidade: '',
    valor_total: '',
    bonificacao: '0',
    troca: '0'
  });
  const [successMsg, setSuccessMsg] = useState('');

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: () => base44.entities.Cliente.list() });
  const { data: produtos = [] } = useQuery({ queryKey: ['produtos'], queryFn: () => base44.entities.Produto.list() });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const cliente = clientes.find(c => c.id === data.cliente_id);
      const produto = produtos.find(p => p.id === data.produto_id);
      const vendedor = vendedores.find(v => v.id === cliente?.vendedor_id);
      
      if (!cliente || !produto) throw new Error("Cliente ou Produto inválido");

      const qtd = parseFloat(data.quantidade);
      const valor = parseFloat(data.valor_total);

      const vendaPayload = {
        data: data.data,
        vendedor_id: cliente.vendedor_id,
        vendedor_nome: vendedor?.nome || 'Vendedor Desconhecido',
        supervisor_id: vendedor?.supervisor_id,
        cliente_id: cliente.id,
        cliente_nome: cliente.razao_social || cliente.nome_fantasia,
        produto_id: produto.id,
        produto_nome: produto.nome,
        categoria_id: produto.categoria_id,
        sub_categoria_id: produto.sub_categoria_id,
        segmento_id: cliente.segmento_id,
        rede_id: cliente.rede_id,
        rota_id: cliente.rota_id,
        tabela_id: cliente.tabela_id,
        plano_pagamento_id: cliente.plano_pagamento_id,
        quantidade: qtd,
        valor_total: valor,
        valor_unitario: qtd > 0 ? valor / qtd : 0,
        margem: 0,
        bonificacao: parseFloat(data.bonificacao) || 0,
        troca: parseFloat(data.troca) || 0,
        numero_pedido: `MANUAL-${Date.now()}`
      };

      return base44.entities.Venda.create(vendaPayload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['vendas']);
      setSuccessMsg('Venda registrada com sucesso!');
      setFormData(prev => ({ ...prev, quantidade: '', valor_total: '', bonificacao: '0', troca: '0' }));
      setTimeout(() => setSuccessMsg(''), 3000);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        {successMsg && (
          <Alert className="mb-6 bg-emerald-50 border-emerald-200 text-emerald-800">
            <CheckCircle className="w-4 h-4 mr-2" />
            <AlertDescription>{successMsg}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="grid gap-6 md:grid-cols-2">
          <div>
            <Label>Data</Label>
            <Input 
              type="date" 
              required
              value={formData.data}
              onChange={e => setFormData({...formData, data: e.target.value})}
            />
          </div>
          
          <div>
            <Label>Cliente</Label>
            <Select 
              value={formData.cliente_id} 
              onValueChange={v => setFormData({...formData, cliente_id: v})}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o cliente" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {clientes.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.codigo} - {c.nome_fantasia || c.razao_social}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Produto</Label>
            <Select 
              value={formData.produto_id} 
              onValueChange={v => setFormData({...formData, produto_id: v})}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o produto" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {produtos.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.sku} - {p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Quantidade Líquida</Label>
              <Input 
                type="number" 
                step="0.01"
                required
                value={formData.quantidade}
                onChange={e => setFormData({...formData, quantidade: e.target.value})}
              />
            </div>
            <div>
              <Label>Valor Líquido (R$)</Label>
              <Input 
                type="number" 
                step="0.01"
                required
                value={formData.valor_total}
                onChange={e => setFormData({...formData, valor_total: e.target.value})}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Bonificação (Qtd)</Label>
              <Input 
                type="number" 
                step="0.01"
                value={formData.bonificacao}
                onChange={e => setFormData({...formData, bonificacao: e.target.value})}
              />
            </div>
            <div>
              <Label>Troca (Qtd)</Label>
              <Input 
                type="number" 
                step="0.01"
                value={formData.troca}
                onChange={e => setFormData({...formData, troca: e.target.value})}
              />
            </div>
          </div>

          <div className="md:col-span-2 flex justify-end">
            <Button 
              type="submit" 
              disabled={createMutation.isPending}
              className="w-full md:w-auto bg-gradient-to-r from-emerald-500 to-teal-600"
            >
              {createMutation.isPending ? 'Salvando...' : 'Registrar Venda'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function TextImportForm() {
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
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) return;

    let startIdx = 0;
    const firstLine = lines[0].toLowerCase();
    if (firstLine.includes('data') && firstLine.includes('cod')) {
      startIdx = 1;
    }

    const validationErrors = [];
    const processedRows = lines.slice(startIdx).map((line, idx) => {
      const values = line.split(/\t/); 
      const splitValues = values.length > 1 ? values : line.split(/[,;]/);
      
      // Order: DATA | COD CLI | COD PROD | VALOR LIQ | QTD LIQ | BONIF | TROCA
      const dataRaw = splitValues[0]?.trim();
      const codCliente = splitValues[1]?.trim();
      const codProduto = splitValues[2]?.trim();
      const valorLiq = parseFloat(splitValues[3]?.replace('R$', '').replace('.', '').replace(',', '.') || '0');
      const qtdLiq = parseFloat(splitValues[4]?.replace(',', '.') || '0');
      const bonificacao = parseFloat(splitValues[5]?.replace(',', '.') || '0');
      const troca = parseFloat(splitValues[6]?.replace(',', '.') || '0');

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
      if (dataRaw && !dataVenda) validationErrors.push(`Linha ${rowNum}: Formato de data inválido`);
      if (!codCliente) validationErrors.push(`Linha ${rowNum}: Código do cliente vazio`);
      if (codCliente && !cliente) validationErrors.push(`Linha ${rowNum}: Cliente não encontrado (${codCliente})`);
      if (!codProduto) validationErrors.push(`Linha ${rowNum}: Código do produto vazio`);
      if (codProduto && !produto) validationErrors.push(`Linha ${rowNum}: Produto não encontrado (${codProduto})`);
      if (cliente && !cliente.vendedor_id) validationErrors.push(`Linha ${rowNum}: Cliente sem vendedor vinculado`);

      return {
        _rowNum: rowNum,
        data: dataVenda,
        cod_cliente: codCliente,
        cliente: cliente,
        produto: produto,
        valor_liq: valorLiq,
        qtd_liq: qtdLiq,
        bonificacao: bonificacao,
        troca: troca,
        valid: !!(cliente && produto && dataVenda && cliente?.vendedor_id)
      };
    });

    setPreview(processedRows);
    setErrors([...new Set(validationErrors)]); 
  };

  const handleImport = async () => {
    setImporting(true);
    const validRows = preview.filter(r => r.valid);

    try {
      // Group rows by (data + cliente_id) to generate order numbers
      const groupedOrders = {};
      validRows.forEach(r => {
        const key = `${r.data}-${r.cliente.id}`;
        if (!groupedOrders[key]) {
          groupedOrders[key] = `PED-${format(new Date(), 'yyyyMMdd')}-${Math.floor(Math.random() * 10000)}`;
        }
      });

      const vendasData = validRows.map(r => {
        const cli = r.cliente;
        const prod = r.produto;
        const vend = vendedores.find(v => v.id === cli.vendedor_id);
        const orderNum = groupedOrders[`${r.data}-${cli.id}`];
        
        return {
          numero_pedido: orderNum,
          data: r.data,
          vendedor_id: cli.vendedor_id,
          vendedor_nome: vend?.nome || 'Vendedor Desconhecido',
          supervisor_id: vend?.supervisor_id,
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
      setErrors(['Erro ao salvar vendas.']);
      setImporting(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clipboard className="w-4 h-4" /> Área de Transferência
            </CardTitle>
            <CardDescription className="text-xs">
              Colunas: DATA | COD CLI | COD PROD | VALOR LIQ | QTD LIQ | BONIF | TROCA
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea 
              placeholder={`Exemplo:\n01/01/2024\tC001\tP123\t150,00\t10\t0\t0`}
              className="min-h-[400px] font-mono text-xs"
              value={pasteData}
              onChange={(e) => { setPasteData(e.target.value); setSuccess(false); }}
            />
          </CardContent>
        </Card>
      </div>

      <div className="lg:col-span-2 space-y-6">
        {success && (
          <Alert className="bg-emerald-50 border-emerald-200">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
            <AlertDescription className="text-emerald-700 font-medium">
              Vendas importadas com sucesso!
            </AlertDescription>
          </Alert>
        )}

        {errors.length > 0 && (
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader className="pb-3">
              <CardTitle className="text-amber-700 flex items-center gap-2 text-base">
                <AlertCircle className="w-5 h-5" /> {errors.length} pendências
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

        <Card>
          <CardHeader className="flex flex-row items-center justify-between py-4">
            <CardTitle className="text-base">Pré-visualização ({preview.length})</CardTitle>
            <Button 
              onClick={handleImport} 
              disabled={importing || preview.length === 0 || preview.some(r => !r.valid)}
              className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
            >
              {importing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Processando...</> : <><Save className="w-4 h-4 mr-2" /> Confirmar Importação</>}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 sticky top-0">
                    <TableHead className="w-12">St</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-slate-500">Cole os dados para visualizar</TableCell></TableRow>
                  ) : (
                    preview.map((row, idx) => (
                      <TableRow key={idx} className={!row.valid ? 'bg-red-50' : ''}>
                        <TableCell>{row.valid ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <AlertCircle className="w-4 h-4 text-red-500" />}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{row.data ? format(parseISO(row.data), 'dd/MM/yy') : '-'}</TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate" title={row.cliente?.razao_social}>{row.cliente?.razao_social || row.cod_cliente}</TableCell>
                        <TableCell className="text-xs max-w-[150px] truncate" title={row.produto?.nome}>{row.produto?.nome || row.cod_produto}</TableCell>
                        <TableCell className="text-right text-xs">{row.valor_liq?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</TableCell>
                        <TableCell className="text-right text-xs">{row.qtd_liq}</TableCell>
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
  );
}

function RelatorioFaturamento({ tipo }) { 
  const [dates, setDates] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });

  const { data: vendas = [], isLoading } = useQuery({
    queryKey: ['vendas_relatorio', dates.start, dates.end],
    queryFn: () => base44.entities.Venda.filter({
      data: { '$gte': dates.start, '$lte': dates.end }
    }, { limit: 2000 }) 
  });

  const relatorio = useMemo(() => {
    const agrupado = {};
    
    vendas.forEach(venda => {
      const key = tipo === 'produto' ? venda.produto_nome : venda.cliente_nome;
      if (!key) return;

      if (!agrupado[key]) {
        agrupado[key] = {
          nome: key,
          quantidade: 0,
          valor: 0
        };
      }
      agrupado[key].quantidade += (venda.quantidade || 0);
      agrupado[key].valor += (venda.valor_total || 0);
    });

    return Object.values(agrupado).sort((a, b) => b.valor - a.valor);
  }, [vendas, tipo]);

  const totalGeral = relatorio.reduce((acc, curr) => ({
    quantidade: acc.quantidade + curr.quantidade,
    valor: acc.valor + curr.valor
  }), { quantidade: 0, valor: 0 });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Filtros do Relatório</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-end">
            <div>
              <Label>Data Inicial</Label>
              <Input 
                type="date" 
                value={dates.start} 
                onChange={e => setDates(d => ({ ...d, start: e.target.value }))} 
              />
            </div>
            <div>
              <Label>Data Final</Label>
              <Input 
                type="date" 
                value={dates.end} 
                onChange={e => setDates(d => ({ ...d, end: e.target.value }))} 
              />
            </div>
            <Button variant="outline" className="mb-[2px]">
              <Filter className="w-4 h-4 mr-2" /> Filtrar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            Faturamento por {tipo === 'produto' ? 'Produto' : 'Cliente'}
          </CardTitle>
          <div className="flex gap-4 text-sm">
            <div className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full font-medium">
              Total Qtd: {totalGeral.quantidade.toLocaleString('pt-BR')}
            </div>
            <div className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full font-medium">
              Total Valor: {totalGeral.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="w-[50%]">{tipo === 'produto' ? 'Produto' : 'Cliente'}</TableHead>
                    <TableHead className="text-right">Quantidade</TableHead>
                    <TableHead className="text-right">Valor Líquido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relatorio.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center py-8 text-slate-500">Nenhum registro no período</TableCell></TableRow>
                  ) : (
                    relatorio.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{item.nome}</TableCell>
                        <TableCell className="text-right">{item.quantidade.toLocaleString('pt-BR')}</TableCell>
                        <TableCell className="text-right font-semibold text-emerald-700">
                          {item.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PedidosTab() {
  const [dates, setDates] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });
  const [expandedOrders, setExpandedOrders] = useState([]);

  const { data: vendas = [], isLoading } = useQuery({
    queryKey: ['vendas_pedidos', dates.start, dates.end],
    queryFn: () => base44.entities.Venda.filter({
      data: { '$gte': dates.start, '$lte': dates.end }
    }, { limit: 2000, sort: { data: -1 } }) 
  });

  const pedidos = useMemo(() => {
    const agrupado = {};
    
    vendas.forEach(venda => {
      const numPedido = venda.numero_pedido || `S/N-${venda.data}-${venda.cliente_id}`;
      
      if (!agrupado[numPedido]) {
        agrupado[numPedido] = {
          numero_pedido: numPedido,
          data: venda.data,
          cod_cliente: '', 
          cliente_id: venda.cliente_id,
          cliente_nome: venda.cliente_nome,
          itens: [],
          total_qtd: 0,
          total_valor: 0
        };
      }
      
      agrupado[numPedido].itens.push(venda);
      agrupado[numPedido].total_qtd += (venda.quantidade || 0);
      agrupado[numPedido].total_valor += (venda.valor_total || 0);
    });

    return Object.values(agrupado);
  }, [vendas]);

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes_lookup'], queryFn: () => base44.entities.Cliente.list() });
  
  const getClienteCode = (id) => {
    const c = clientes.find(cli => cli.id === id);
    return c ? c.codigo : 'N/A';
  };

  const toggleOrder = (orderId) => {
    setExpandedOrders(prev => 
      prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-end">
            <div>
              <Label>Data Inicial</Label>
              <Input 
                type="date" 
                value={dates.start} 
                onChange={e => setDates(d => ({ ...d, start: e.target.value }))} 
              />
            </div>
            <div>
              <Label>Data Final</Label>
              <Input 
                type="date" 
                value={dates.end} 
                onChange={e => setDates(d => ({ ...d, end: e.target.value }))} 
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" /> Pedidos Importados
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Num Pedido</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Cod</TableHead>
                    <TableHead>Nome Fantasia</TableHead>
                    <TableHead className="text-right">Qtd Liq</TableHead>
                    <TableHead className="text-right">Valor Liq</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pedidos.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-slate-500">Nenhum pedido encontrado no período</TableCell></TableRow>
                  ) : (
                    pedidos.map((pedido) => (
                      <React.Fragment key={pedido.numero_pedido}>
                        <TableRow className="hover:bg-slate-50 cursor-pointer" onClick={() => toggleOrder(pedido.numero_pedido)}>
                          <TableCell>
                            {expandedOrders.includes(pedido.numero_pedido) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </TableCell>
                          <TableCell className="font-medium">{pedido.numero_pedido}</TableCell>
                          <TableCell>{format(parseISO(pedido.data), 'dd/MM/yyyy')}</TableCell>
                          <TableCell className="font-mono text-xs">{getClienteCode(pedido.cliente_id)}</TableCell>
                          <TableCell>{pedido.cliente_nome}</TableCell>
                          <TableCell className="text-right">{pedido.total_qtd}</TableCell>
                          <TableCell className="text-right font-semibold text-emerald-700">
                            {pedido.total_valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </TableCell>
                        </TableRow>
                        {expandedOrders.includes(pedido.numero_pedido) && (
                          <TableRow className="bg-slate-50/50">
                            <TableCell colSpan={7} className="p-0">
                              <div className="p-4 pl-12 border-b">
                                <Table>
                                  <TableHeader>
                                    <TableRow className="bg-slate-100/50">
                                      <TableHead>Produto</TableHead>
                                      <TableHead className="text-right">Qtd Liq</TableHead>
                                      <TableHead className="text-right">Valor Liq</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {pedido.itens.map((item, idx) => (
                                      <TableRow key={idx} className="border-0">
                                        <TableCell className="py-2">{item.produto_nome}</TableCell>
                                        <TableCell className="text-right py-2">{item.quantidade}</TableCell>
                                        <TableCell className="text-right py-2">
                                          {item.valor_total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}