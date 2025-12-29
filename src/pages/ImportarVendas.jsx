import React, { useState, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2, Clipboard, Save, Plus, Calendar, Filter, Search, ChevronDown, ChevronRight, Package, ArrowLeftRight } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import BulkImportModal from '@/components/forms/BulkImportModal';
import TrocasNaoCadastradasTab from '@/components/ImportarVendas/TrocasNaoCadastradasTab';
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
        <TabsList className="grid w-full max-w-6xl grid-cols-6 mb-6">
          <TabsTrigger value="importacao">Importar Vendas</TabsTrigger>
          <TabsTrigger value="faturamento_produto">Faturamento Produto</TabsTrigger>
          <TabsTrigger value="faturamento_cliente">Faturamento Cliente</TabsTrigger>
          <TabsTrigger value="pedidos">Pedidos Importados</TabsTrigger>
          <TabsTrigger value="trocas_importadas">Trocas Importadas</TabsTrigger>
          <TabsTrigger value="trocas_nao_cadastradas">Trocas S/ Cadastro</TabsTrigger>
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

        <TabsContent value="trocas_importadas" className="space-y-6">
          <TrocasImportadasTab />
        </TabsContent>

        <TabsContent value="trocas_nao_cadastradas" className="space-y-6">
          <TrocasNaoCadastradasTab />
        </TabsContent>
        </Tabs>
    </div>
  );
}

function TrocasImportadasTab() {
  const queryClient = useQueryClient();
  const [dates, setDates] = useState({
    start: '',
    end: ''
  });
  const [busca, setBusca] = useState('');
  const [appliedDates, setAppliedDates] = useState({
    start: '',
    end: ''
  });
  const [appliedBusca, setAppliedBusca] = useState('');
  const [selectedTrocas, setSelectedTrocas] = useState([]);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: trocas = [], isLoading } = useQuery({
    queryKey: ['trocas_todas', appliedDates.start, appliedDates.end],
    queryFn: async () => {
      let query = {};
      if (appliedDates.start && appliedDates.end) {
        query.data = { '$gte': appliedDates.start, '$lte': appliedDates.end };
      } else if (appliedDates.start) {
        query.data = { '$gte': appliedDates.start };
      } else if (appliedDates.end) {
        query.data = { '$lte': appliedDates.end };
      }
      
      const allTrocas = await base44.entities.Troca.list('-data', 50000);
      
      // Aplicar filtro de data se necessário
      if (Object.keys(query).length > 0 && query.data) {
        return allTrocas.filter(t => {
          if (query.data.$gte && t.data < query.data.$gte) return false;
          if (query.data.$lte && t.data > query.data.$lte) return false;
          return true;
        });
      }
      
      return allTrocas;
    }
  });

  const trocasFiltradas = useMemo(() => {
    if (!appliedBusca.trim()) return trocas;
    const termo = appliedBusca.toLowerCase();
    return trocas.filter(t => 
      t.cliente_nome?.toLowerCase().includes(termo) ||
      t.produto_original_nome?.toLowerCase().includes(termo) ||
      t.vendedor_nome?.toLowerCase().includes(termo) ||
      t.motivo_descricao?.toLowerCase().includes(termo) ||
      t.observacoes?.toLowerCase().includes(termo)
    );
  }, [trocas, appliedBusca]);

  const handleAtualizar = () => {
    setAppliedDates(dates);
    setAppliedBusca(busca);
  };

  const handleLimpar = () => {
    setDates({ start: '', end: '' });
    setBusca('');
    setAppliedDates({ start: '', end: '' });
    setAppliedBusca('');
  };

  const totalQuantidade = trocasFiltradas.reduce((acc, t) => acc + (t.quantidade || 0), 0);

  const toggleSelectTroca = (id) => {
    setSelectedTrocas(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedTrocas.length === trocasFiltradas.length) {
      setSelectedTrocas([]);
    } else {
      setSelectedTrocas(trocasFiltradas.map(t => t.id));
    }
  };

  const handleDelete = async () => {
    if (selectedTrocas.length === 0) {
      alert('Selecione pelo menos uma troca para excluir');
      return;
    }

    if (!confirm(`Deseja realmente excluir ${selectedTrocas.length} troca(s) selecionada(s)?`)) {
      return;
    }

    setIsDeleting(true);
    try {
      // Deletar em lotes menores para evitar rate limit
      const BATCH_SIZE = 10;
      const DELAY_MS = 3000;
      
      let deletados = 0;
      for (let i = 0; i < selectedTrocas.length; i += BATCH_SIZE) {
        const batch = selectedTrocas.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(id => base44.entities.Troca.delete(id)));
        deletados += batch.length;
        
        // Delay entre todos os lotes
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
      
      queryClient.invalidateQueries(['trocas_todas']);
      setSelectedTrocas([]);
      alert(`✅ ${deletados} troca(s) excluída(s) com sucesso!`);
    } catch (error) {
      alert('Erro ao excluir trocas: ' + error.message);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteAll = async () => {
    if (trocasFiltradas.length === 0) {
      alert('Não há trocas para excluir');
      return;
    }

    if (!confirm(`⚠️ ATENÇÃO: Deseja realmente excluir TODAS as ${trocasFiltradas.length} trocas exibidas?\n\nEsta ação não pode ser desfeita!`)) {
      return;
    }

    if (!confirm(`Confirme novamente: Excluir ${trocasFiltradas.length} trocas?`)) {
      return;
    }

    setIsDeleting(true);
    try {
      const idsParaExcluir = trocasFiltradas.map(t => t.id);
      const BATCH_SIZE = 10;
      const DELAY_MS = 3000;
      
      let deletados = 0;
      for (let i = 0; i < idsParaExcluir.length; i += BATCH_SIZE) {
        const batch = idsParaExcluir.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(id => base44.entities.Troca.delete(id)));
        deletados += batch.length;
        
        // Delay entre todos os lotes
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
      
      queryClient.invalidateQueries(['trocas_todas']);
      setSelectedTrocas([]);
      alert(`✅ ${deletados} troca(s) excluída(s) com sucesso!`);
    } catch (error) {
      alert('Erro ao excluir trocas: ' + error.message);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            <div>
              <Label>Buscar</Label>
              <Input 
                type="text"
                placeholder="Cliente, produto, vendedor..."
                value={busca}
                onChange={e => setBusca(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <Button onClick={handleAtualizar} className="bg-blue-600 hover:bg-blue-700">
              <Search className="w-4 h-4 mr-2" />
              Atualizar
            </Button>
            <Button onClick={handleLimpar} variant="outline">
              Limpar Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="w-5 h-5 text-orange-500" />
              Todas as Trocas Importadas
            </CardTitle>
            <CardDescription className="mt-1">
              Total de {trocasFiltradas.length} registros encontrados
              {selectedTrocas.length > 0 && ` • ${selectedTrocas.length} selecionada(s)`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <div className="px-4 py-2 bg-orange-50 text-orange-700 rounded-full font-medium">
              Qtd Total: {totalQuantidade.toLocaleString('pt-BR')}
            </div>
            <Button 
              variant="outline" 
              onClick={toggleSelectAll}
              className="gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              {selectedTrocas.length === trocasFiltradas.length && trocasFiltradas.length > 0 
                ? 'Desmarcar Tudo' 
                : 'Selecionar Tudo'}
            </Button>
            {selectedTrocas.length > 0 && (
              <Button 
                variant="destructive" 
                onClick={handleDelete}
                disabled={isDeleting}
                className="gap-2"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertCircle className="w-4 h-4" />}
                Excluir Selecionadas ({selectedTrocas.length})
              </Button>
            )}
            <Button 
              variant="destructive" 
              onClick={handleDeleteAll}
              disabled={isDeleting || trocasFiltradas.length === 0}
              className="gap-2 bg-red-700 hover:bg-red-800"
            >
              {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertCircle className="w-4 h-4" />}
              Excluir Todas ({trocasFiltradas.length})
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-slate-50 z-10">
                    <TableRow>
                      <TableHead className="w-10">
                        <input 
                          type="checkbox"
                          checked={trocasFiltradas.length > 0 && selectedTrocas.length === trocasFiltradas.length}
                          onChange={toggleSelectAll}
                          className="cursor-pointer w-4 h-4"
                        />
                      </TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Produto Original</TableHead>
                      <TableHead>Produto Novo</TableHead>
                      <TableHead>Vendedor</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead className="text-right">Quantidade</TableHead>
                      <TableHead>Observações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trocasFiltradas.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-slate-500">
                          Nenhuma troca encontrada no período
                        </TableCell>
                      </TableRow>
                    ) : (
                      trocasFiltradas.map((troca, idx) => (
                        <TableRow key={idx} className="hover:bg-slate-50">
                          <TableCell>
                            <input 
                              type="checkbox"
                              checked={selectedTrocas.includes(troca.id)}
                              onChange={() => toggleSelectTroca(troca.id)}
                              className="cursor-pointer w-4 h-4"
                            />
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {format(parseISO(troca.data), 'dd/MM/yyyy')}
                          </TableCell>
                          <TableCell>
                            <div className="max-w-[200px]">
                              <p className="font-medium text-slate-900 truncate">{troca.cliente_nome || 'N/A'}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-[200px]">
                              <p className="text-sm truncate">{troca.produto_original_nome || 'N/A'}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-[200px]">
                              <p className="text-sm text-slate-600 truncate">
                                {troca.produto_novo_nome || '-'}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-[150px]">
                              <p className="text-sm truncate">{troca.vendedor_nome || 'N/A'}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-[150px]">
                              <p className="text-xs text-slate-600 truncate">
                                {troca.motivo_descricao || 'N/A'}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge className="bg-orange-100 text-orange-700">
                              {troca.quantidade || 0}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-[200px]">
                              <p className="text-xs text-slate-500 truncate">
                                {troca.observacoes || '-'}
                              </p>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ImportacaoTab() {
  const [bulkOpen, setBulkOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const queryClient = useQueryClient();

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: () => base44.entities.Cliente.list() });
  const { data: produtos = [] } = useQuery({ queryKey: ['produtos'], queryFn: () => base44.entities.Produto.list() });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: motivosTroca = [] } = useQuery({ queryKey: ['motivosTroca'], queryFn: () => base44.entities.MotivoTroca.list() });

  const recalcularValores = async () => {
    if (!confirm('Deseja recalcular os valores totais para vendas entre 01/01/2025 e 31/05/2025?\n\nIsso irá atualizar todos os registros que possuem quantidade e valor unitário mas não possuem valor total calculado.')) {
      return;
    }

    setIsRecalculating(true);
    try {
      // Buscar todas as vendas no período
      const vendasParaAtualizar = await base44.entities.Venda.filter({
        data: { '$gte': '2025-01-01', '$lte': '2025-05-31' }
      });

      let atualizados = 0;
      let erros = 0;

      // Atualizar cada venda que precisa de recálculo
      for (const venda of vendasParaAtualizar) {
        try {
          const qtd = parseFloat(venda.quantidade) || 0;
          const vlUnit = parseFloat(venda.valor_unitario) || 0;
          const vlTotal = parseFloat(venda.valor_total) || 0;

          // Só atualiza se tem quantidade e valor unitário, mas não tem valor total
          if (qtd > 0 && vlUnit > 0 && vlTotal === 0) {
            const novoValorTotal = qtd * vlUnit;
            await base44.entities.Venda.update(venda.id, {
              valor_total: novoValorTotal
            });
            atualizados++;
          }
        } catch (error) {
          console.error(`Erro ao atualizar venda ${venda.id}:`, error);
          erros++;
        }
      }

      queryClient.invalidateQueries(['vendas']);
      alert(`✅ Recálculo concluído!\n\n${atualizados} vendas atualizadas\n${erros} erros encontrados`);
    } catch (error) {
      alert('Erro ao recalcular valores: ' + error.message);
    } finally {
      setIsRecalculating(false);
    }
  };

  const removerDuplicatas = async () => {
    if (!confirm('Deseja identificar e remover vendas duplicadas?\n\nSerá mantida apenas a primeira ocorrência de cada venda.\n\nCritério: mesmo pedido + produto + cliente + data')) {
      return;
    }

    setIsRecalculating(true);
    try {
      // Buscar todas as vendas
      const todasVendas = await base44.entities.Venda.list('-created_date', 10000);

      const duplicatasMap = new Map();
      const idsParaRemover = [];

      // Identificar duplicatas
      todasVendas.forEach(venda => {
        const chave = `${venda.numero_pedido}|${venda.produto_id}|${venda.cliente_id}|${venda.data}`;
        
        if (duplicatasMap.has(chave)) {
          // É duplicata, marcar para remoção
          idsParaRemover.push(venda.id);
        } else {
          // Primeira ocorrência, manter
          duplicatasMap.set(chave, venda.id);
        }
      });

      if (idsParaRemover.length === 0) {
        alert('✅ Nenhuma duplicata encontrada!');
        setIsRecalculating(false);
        return;
      }

      if (!confirm(`Encontradas ${idsParaRemover.length} duplicatas.\n\nDeseja realmente excluir?`)) {
        setIsRecalculating(false);
        return;
      }

      // Remover em lotes
      const BATCH_SIZE = 50;
      let removidos = 0;

      for (let i = 0; i < idsParaRemover.length; i += BATCH_SIZE) {
        const batch = idsParaRemover.slice(i, i + BATCH_SIZE);
        try {
          await Promise.all(batch.map(id => base44.entities.Venda.delete(id)));
          removidos += batch.length;
        } catch (error) {
          console.error('Erro ao remover lote:', error);
        }
        
        // Delay entre lotes
        if (i + BATCH_SIZE < idsParaRemover.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      queryClient.invalidateQueries(['vendas']);
      alert(`✅ Limpeza concluída!\n\n${removidos} vendas duplicadas removidas`);
    } catch (error) {
      alert('Erro ao remover duplicatas: ' + error.message);
    } finally {
      setIsRecalculating(false);
    }
  };

  const bulkColumns = [
    { key: 'numpedido', label: 'NUMPEDIDO', required: true },
    { key: 'codproduto', label: 'CODPRODUTO', required: true },
    { key: 'qtd', label: 'QTD', required: true },
    { key: 'codcliente', label: 'CODCLIENTE', required: true },
    { key: 'data', label: 'DATA', required: true },
    { key: 'vl_unitario', label: 'VL_UNITARIO', required: true },
    { key: 'troca', label: 'TROCA (SIM/NÃO)' }
  ];

  const bulkExampleData = [
    { numpedido: '267862', codproduto: '1', qtd: '100', codcliente: '3362', data: '01/10/2025', vl_unitario: '4,00', troca: 'NÃO' },
    { numpedido: '268040', codproduto: '1', qtd: '8', codcliente: '3362', data: '02/10/2025', vl_unitario: '4,00', troca: 'SIM' }
  ];

  const handleBulkImport = async (data) => {
    setIsImporting(true);
    
    try {
      // Buscar ou criar motivo padrão para trocas importadas
      let motivoTrocaId = motivosTroca.find(m => m.descricao?.toLowerCase().includes('import'))?.id;
      
      if (!motivoTrocaId) {
        const novoMotivo = await base44.entities.MotivoTroca.create({
          descricao: 'Troca importada via sistema'
        });
        motivoTrocaId = novoMotivo.id;
      }
    
      // PRÉ-PROCESSAMENTO: Criar Maps para busca O(1) ao invés de find O(n)
      const clientesPorCodigo = new Map();
      const clientesPorCNPJ = new Map();
      clientes.forEach(c => {
        if (c.codigo) clientesPorCodigo.set(String(c.codigo), c);
        if (c.cpf_cnpj) clientesPorCNPJ.set(c.cpf_cnpj.replace(/\D/g, ''), c);
      });

      const produtosPorCodigo = new Map();
      const produtosPorBarras = new Map();
      produtos.forEach(p => {
        if (p.codigo) produtosPorCodigo.set(String(p.codigo), p);
        if (p.cod_barras) produtosPorBarras.set(String(p.cod_barras), p);
      });

      const vendedoresPorId = new Map();
      vendedores.forEach(v => vendedoresPorId.set(v.id, v));
    
    // Helper para converter valores monetários brasileiros (ex: "4,00" -> 4.00)
    const parseBRLValues = (val) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        return parseFloat(String(val).replace(/\./g, '').replace(',', '.')) || 0;
    };

    // PROCESSAMENTO RÁPIDO
    const vendasData = [];
    const trocasNaoCadastradas = [];
    
    for (const row of data) {
        // Parse date
        let dataVenda = null;
        const dataRaw = row.data;
        
        if (dataRaw) {
            if (String(dataRaw).match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                const [day, month, year] = dataRaw.split('/');
                dataVenda = `${year}-${month}-${day}`;
            } else if (String(dataRaw).match(/^\d{4}-\d{2}-\d{2}$/)) {
                dataVenda = dataRaw;
            } else {
                 try {
                     const parsed = new Date(dataRaw);
                     if (!isNaN(parsed)) dataVenda = format(parsed, 'yyyy-MM-dd');
                 } catch (e) {}
            }
        }
        
        if (!dataVenda) continue;
        
        // Busca otimizada O(1) ao invés de O(n)
        const cliente = clientesPorCodigo.get(String(row.codcliente)) || 
                       clientesPorCNPJ.get(String(row.codcliente)?.replace(/\D/g, ''));
        
        const produto = produtosPorCodigo.get(String(row.codproduto)) || 
                       produtosPorBarras.get(String(row.codproduto));

        // Lógica de valores
        const qtdRaw = parseBRLValues(row.qtd);
        const vlUnit = parseBRLValues(row.vl_unitario);
        const trocaValue = String(row.troca || '').toUpperCase().trim();
        // É troca apenas se a coluna estiver preenchida com 'SIM'
        const isTroca = trocaValue === 'SIM';

        // Debug log
        console.log(`Pedido: ${row.numpedido}, Coluna 'troca': '${row.troca}', isTroca: ${isTroca}, qtdRaw: ${qtdRaw}`);

        // Se é troca e cliente não cadastrado, armazenar separadamente
        if (isTroca && !cliente && produto) {
          const d = new Date(dataVenda);
          d.setDate(d.getDate() - 1);
          const dataTroca = format(d, 'yyyy-MM-dd');
          
          trocasNaoCadastradas.push({
            data: dataTroca,
            codigo_cliente: String(row.codcliente),
            produto_original_id: produto.id,
            produto_original_nome: produto.nome,
            quantidade: qtdRaw,
            observacoes: `Pedido: ${row.numpedido || 'S/N'} - Cliente não cadastrado: ${row.codcliente}`
          });
          continue;
        }

        if (!cliente || !produto) continue;
        
        const vend = vendedoresPorId.get(cliente.vendedor_id);
        
        const qtdVenda = isTroca ? 0 : qtdRaw;
        const qtdTroca = isTroca ? qtdRaw : 0;
        const valorTotal = qtdRaw * vlUnit;

        // Calcular data_troca: se for troca, data_troca = data - 1 dia (exceto segunda que é -2 dias)
        let dataTroca = null;
        if (isTroca) {
          const d = new Date(dataVenda + 'T00:00:00');
          const dayOfWeek = d.getDay(); // 0 = Domingo, 1 = Segunda, ..., 6 = Sábado

          if (dayOfWeek === 1) { // Se for segunda-feira
            d.setDate(d.getDate() - 2); // Subtrai 2 dias (cai no sábado)
          } else { // Para os outros dias
            d.setDate(d.getDate() - 1); // Subtrai 1 dia
          }
          dataTroca = format(d, 'yyyy-MM-dd');
        }

        vendasData.push({
          numero_pedido: row.numpedido || `S/N-${dataVenda}-${cliente.id}`,
          data: dataVenda,
          data_troca: dataTroca,
          vendedor_id: cliente.vendedor_id,
          vendedor_nome: vend?.nome || 'Vendedor Desconhecido',
          supervisor_id: vend?.supervisor_id,
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
          quantidade: qtdVenda,
          valor_total: valorTotal,
          valor_unitario: vlUnit,
          margem: 0,
          bonificacao: 0,
          troca: qtdTroca
        });
    }

      // Separar vendas e trocas cadastradas
      const trocasData = [];
      
      for (const venda of vendasData) {
        if (venda.troca > 0) {
          // Criar registro de troca para clientes cadastrados
          trocasData.push({
            data: venda.data_troca || venda.data,
            cliente_id: venda.cliente_id,
            cliente_nome: venda.cliente_nome,
            produto_original_id: venda.produto_id,
            produto_original_nome: venda.produto_nome,
            produto_novo_id: null,
            produto_novo_nome: null,
            motivo_id: motivoTrocaId,
            motivo_descricao: 'Troca importada via sistema',
            vendedor_id: venda.vendedor_id,
            vendedor_nome: venda.vendedor_nome,
            quantidade: venda.troca,
            observacoes: `Pedido: ${venda.numero_pedido}`
          });
        }
      }

      // Adicionar trocas de clientes não cadastrados (sem vendedor_id, apenas código)
      for (const troca of trocasNaoCadastradas) {
        trocasData.push({
          data: troca.data,
          cliente_id: '',
          cliente_nome: `Cliente Não Cadastrado: ${troca.codigo_cliente}`,
          produto_original_id: troca.produto_original_id,
          produto_original_nome: troca.produto_original_nome,
          produto_novo_id: '',
          produto_novo_nome: '',
          motivo_id: motivoTrocaId || '',
          motivo_descricao: 'Troca importada - Cliente não cadastrado',
          vendedor_id: '',
          vendedor_nome: 'N/A',
          quantidade: troca.quantidade,
          observacoes: troca.observacoes
        });
      }

      if (vendasData.length > 0) {
          await base44.entities.Venda.bulkCreate(vendasData);
      }
      
      if (trocasData.length > 0) {
          await base44.entities.Troca.bulkCreate(trocasData);
      }
      
      queryClient.invalidateQueries(['vendas']);
      queryClient.invalidateQueries(['trocas']);
      
      // Mostrar resumo da importação
      const msgResumo = [];
      if (vendasData.length > 0) msgResumo.push(`${vendasData.length} vendas`);
      if (trocasData.length > 0) msgResumo.push(`${trocasData.length} trocas`);
      if (trocasNaoCadastradas.length > 0) msgResumo.push(`${trocasNaoCadastradas.length} trocas sem cliente cadastrado`);
      
      if (msgResumo.length > 0) {
        alert(`✅ Importação concluída:\n${msgResumo.join('\n')}`);
      }
      
      setIsImporting(false);
      setBulkOpen(false);
    } catch (error) {
      console.error('Erro na importação:', error);
      alert('Erro ao importar vendas: ' + error.message);
      setIsImporting(false);
    }
  };
  
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Alert className="bg-orange-50 border-orange-200">
          <AlertCircle className="h-4 w-4 text-orange-600" />
          <AlertDescription className="flex items-center justify-between">
            <span className="text-orange-800">
              <strong>Valores zerados?</strong> Recalcular vendas 01/01 a 31/05/2025
            </span>
            <Button 
              onClick={recalcularValores}
              disabled={isRecalculating}
              size="sm"
              className="bg-orange-600 hover:bg-orange-700"
            >
              {isRecalculating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processando...
                </>
              ) : (
                'Recalcular'
              )}
            </Button>
          </AlertDescription>
        </Alert>

        <Alert className="bg-red-50 border-red-200">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="flex items-center justify-between">
            <span className="text-red-800">
              <strong>Duplicatas?</strong> Remover vendas duplicadas automaticamente
            </span>
            <Button 
              onClick={removerDuplicatas}
              disabled={isRecalculating}
              size="sm"
              className="bg-red-600 hover:bg-red-700"
            >
              {isRecalculating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processando...
                </>
              ) : (
                'Remover Duplicatas'
              )}
            </Button>
          </AlertDescription>
        </Alert>
      </div>

      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            Nova Venda
          </h3>
          <p className="text-sm text-slate-500">
            Registre uma venda individualmente ou importe em massa
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={() => setBulkOpen(true)}
          className="gap-2 border-amber-200 text-amber-700 hover:bg-amber-50"
        >
          <Clipboard className="w-4 h-4" /> Importar em Massa
        </Button>
      </div>

      <ManualEntryForm />
      
      <BulkImportModal
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title="Importar Vendas em Massa"
        description="Copie e cole os dados das vendas (Excel/CSV). As colunas devem seguir a ordem ou cabeçalho."
        columns={bulkColumns}
        exampleData={bulkExampleData}
        onImport={handleBulkImport}
        isImporting={isImporting}
      />
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
    valor_unitario: '',
    valor_total: '',
    bonificacao: '0',
    troca: '0'
  });
  const [successMsg, setSuccessMsg] = useState('');

  // Calcular valor total automaticamente
  useEffect(() => {
    const qtd = parseFloat(formData.quantidade) || 0;
    const vlUnit = parseFloat(formData.valor_unitario) || 0;
    const total = qtd * vlUnit;
    setFormData(prev => ({ ...prev, valor_total: total.toFixed(2) }));
  }, [formData.quantidade, formData.valor_unitario]);

  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: () => base44.entities.Cliente.list() });
  const { data: produtos = [] } = useQuery({ queryKey: ['produtos'], queryFn: () => base44.entities.Produto.list() });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: motivosTroca = [] } = useQuery({ queryKey: ['motivosTroca'], queryFn: () => base44.entities.MotivoTroca.list() });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const cliente = clientes.find(c => c.id === data.cliente_id);
      const produto = produtos.find(p => p.id === data.produto_id);
      const vendedor = vendedores.find(v => v.id === cliente?.vendedor_id);
      
      if (!cliente || !produto) throw new Error("Cliente ou Produto inválido");

      const qtd = parseFloat(data.quantidade);
      const valor = parseFloat(data.valor_total);

      const isTrocaManual = parseFloat(data.troca) > 0;
      let dataTroca = null;
      if (isTrocaManual) {
        const d = new Date(data.data);
        d.setDate(d.getDate() - 1);
        dataTroca = format(d, 'yyyy-MM-dd');
      }
      
      // Buscar ou criar motivo padrão para trocas manuais
      let motivoTrocaId = motivosTroca.find(m => m.descricao?.toLowerCase().includes('manual'))?.id;
      
      if (!motivoTrocaId && isTrocaManual) {
        const novoMotivo = await base44.entities.MotivoTroca.create({
          descricao: 'Troca registrada manualmente'
        });
        motivoTrocaId = novoMotivo.id;
      }

      const vendaPayload = {
        data: data.data,
        data_troca: dataTroca,
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

      const venda = await base44.entities.Venda.create(vendaPayload);
      
      // Se tem troca, criar registro na entidade Troca
      if (parseFloat(data.troca) > 0 && motivoTrocaId) {
        await base44.entities.Troca.create({
          data: dataTroca || data.data,
          cliente_id: cliente.id,
          cliente_nome: cliente.razao_social || cliente.nome_fantasia,
          produto_original_id: produto.id,
          produto_original_nome: produto.nome,
          produto_novo_id: '',
          produto_novo_nome: '',
          motivo_id: motivoTrocaId || '',
          motivo_descricao: 'Troca registrada manualmente via sistema',
          vendedor_id: cliente.vendedor_id || '',
          vendedor_nome: vendedor?.nome || 'Vendedor Desconhecido',
          quantidade: parseFloat(data.troca),
          observacoes: `Venda manual: ${vendaPayload.numero_pedido}`,
          venda_original_id: venda.id
        });
      }
      
      return venda;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['vendas']);
      queryClient.invalidateQueries(['trocas']);
      setSuccessMsg('Venda registrada com sucesso!');
      setFormData(prev => ({ ...prev, quantidade: '', valor_unitario: '', valor_total: '', bonificacao: '0', troca: '0' }));
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

          <div className="grid grid-cols-3 gap-4">
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
              <Label>Valor Unitário (R$)</Label>
              <Input 
                type="number" 
                step="0.01"
                required
                value={formData.valor_unitario}
                onChange={e => setFormData({...formData, valor_unitario: e.target.value})}
              />
            </div>
            <div>
              <Label>Valor Total (R$)</Label>
              <Input 
                type="number" 
                step="0.01"
                required
                value={formData.valor_total}
                readOnly
                className="bg-slate-100"
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

function RelatorioFaturamento({ tipo }) { 
  const [dates, setDates] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });
  const [appliedDates, setAppliedDates] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });

  const handleAtualizar = () => {
    setAppliedDates(dates);
  };

  const { data: vendas = [], isLoading } = useQuery({
    queryKey: ['vendas_relatorio', appliedDates.start, appliedDates.end],
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
            <Button onClick={handleAtualizar} className="mb-[2px] bg-blue-600 hover:bg-blue-700">
              <Search className="w-4 h-4 mr-2" /> Atualizar
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
  const [appliedDates, setAppliedDates] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });
  const [expandedOrders, setExpandedOrders] = useState([]);

  const handleAtualizar = () => {
    setAppliedDates(dates);
  };

  const { data: vendas = [], isLoading } = useQuery({
    queryKey: ['vendas_pedidos', appliedDates.start, appliedDates.end],
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
            <Button onClick={handleAtualizar} className="bg-blue-600 hover:bg-blue-700">
              <Search className="w-4 h-4 mr-2" /> Atualizar
            </Button>
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