import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Table as TableIcon, CheckCircle, XCircle, Search, Save, Calendar, Upload } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import FormModal from '@/components/forms/FormModal';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import ImportarPrecosMassa from '@/components/tabelasPreco/ImportarPrecosMassa';
import LogErrosImportacao from '@/components/tabelasPreco/LogErrosImportacao';

export default function TabelasPreco() {
  const [activeTab, setActiveTab] = useState("tabelas");

  const { data: tabelas = [] } = useQuery({
    queryKey: ['tabelasPreco'],
    queryFn: () => base44.entities.TabelaPreco.list()
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });
  
  return (
    <div className="space-y-6">
      <PageHeader 
        title="Tabelas de Preço" 
        subtitle="Gerencie tabelas e preços por produto"
        icon={TableIcon}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-[500px] grid-cols-3 mb-6">
          <TabsTrigger value="tabelas">Tabelas</TabsTrigger>
          <TabsTrigger value="precos">Preços</TabsTrigger>
          <TabsTrigger value="erros">Log de Erros</TabsTrigger>
        </TabsList>
        
        <TabsContent value="tabelas" className="animate-in fade-in-50 duration-300">
          <GerenciarTabelas />
        </TabsContent>
        
        <TabsContent value="precos" className="animate-in fade-in-50 duration-300">
          <GerenciarPrecos />
        </TabsContent>

        <TabsContent value="erros" className="animate-in fade-in-50 duration-300">
          <LogErrosImportacao tabelas={tabelas} produtos={produtos} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function GerenciarTabelas() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [formData, setFormData] = useState({ nome: '', status: 'ativo' });

  const queryClient = useQueryClient();

  const { data: tabelas = [], isLoading } = useQuery({
    queryKey: ['tabelasPreco'],
    queryFn: () => base44.entities.TabelaPreco.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TabelaPreco.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['tabelasPreco']);
      setFormOpen(false);
      resetForm();
      toast.success('✅ Tabela criada com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao criar tabela: ' + error.message);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TabelaPreco.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['tabelasPreco']);
      setFormOpen(false);
      resetForm();
      toast.success('✅ Tabela atualizada com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao atualizar tabela: ' + error.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TabelaPreco.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['tabelasPreco']);
      setDeleteOpen(false);
      setSelected(null);
    }
  });

  const resetForm = () => {
    setFormData({ nome: '', status: 'ativo' });
    setSelected(null);
  };

  const handleNew = () => {
    resetForm();
    setFormOpen(true);
  };

  const handleEdit = (item) => {
    setSelected(item);
    setFormData({
      nome: item.nome || '',
      status: item.status || 'ativo'
    });
    setFormOpen(true);
  };

  const handleDelete = (item) => {
    setSelected(item);
    setDeleteOpen(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (selected) {
      updateMutation.mutate({ id: selected.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const columns = [
    { key: 'nome', label: 'Nome da Tabela', sortable: true },
    {
      key: 'status',
      label: 'Status',
      render: (val) => (
        <Badge className={val === 'ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
          {val === 'ativo' ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
          {val}
        </Badge>
      )
    }
  ];

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button 
          onClick={handleNew}
          className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold shadow-lg shadow-amber-500/30"
        >
          Nova Tabela
        </Button>
      </div>

      <DataTable
        data={tabelas}
        columns={columns}
        searchFields={['nome']}
        onEdit={handleEdit}
        onDelete={handleDelete}
        pageSize={1000}
        isLoading={isLoading}
      />

      <FormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={selected ? 'Editar Tabela' : 'Nova Tabela'}
      >
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div>
            <Label>Nome da Tabela *</Label>
            <Input
              value={formData.nome}
              onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
              required
            />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="inativo">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Cancelar
            </Button>
            <Button 
              type="submit" 
              disabled={createMutation.isPending || updateMutation.isPending}
              className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold"
            >
              Salvar
            </Button>
          </div>
        </form>
      </FormModal>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate(selected?.id)}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}

function GerenciarPrecos() {
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [searchCod, setSearchCod] = useState('');
  const [searchNome, setSearchNome] = useState('');
  const [showDropdownCod, setShowDropdownCod] = useState(false);
  const [showDropdownNome, setShowDropdownNome] = useState(false);
  const [prices, setPrices] = useState({});
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [expandedTabelas, setExpandedTabelas] = useState([]);
  const [tabelaSelecionada, setTabelaSelecionada] = useState('all');
  const queryClient = useQueryClient();

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });

  const { data: tabelas = [] } = useQuery({
    queryKey: ['tabelasPreco'],
    queryFn: () => base44.entities.TabelaPreco.list()
  });

  const { data: allPrecos = [] } = useQuery({
    queryKey: ['todosPrecos'],
    queryFn: () => base44.entities.PrecoProduto.list()
  });

  // Fetch existing prices for the selected product
  const { data: existingPrices = [], refetch: refetchPrices } = useQuery({
    queryKey: ['precosProduto', selectedProduct?.id],
    queryFn: () => base44.entities.PrecoProduto.filter({ produto_id: selectedProduct?.id }),
    enabled: !!selectedProduct
  });

  // Initialize prices state when existingPrices changes
  useEffect(() => {
    if (selectedProduct && tabelas.length > 0) {
      const initialPrices = {};
      tabelas.forEach(tabela => {
        const existing = existingPrices.find(p => p.tabela_id === tabela.id);
        initialPrices[tabela.id] = existing || {
          tabela_id: tabela.id,
          produto_id: selectedProduct.id,
          valor_unitario: 0,
          valor_acao: 0,
          periodo_acao_fim: '',
          ativacao_acao: false
        };
      });
      setPrices(initialPrices);
    }
  }, [selectedProduct, existingPrices, tabelas]);

  // Filtrar produtos por código
  const filteredProductsCod = useMemo(() => {
    if (!searchCod.trim()) return [];
    const searchLower = searchCod.toLowerCase();
    return produtos.filter(p => 
      p.codigo?.toLowerCase().includes(searchLower)
    ).slice(0, 20);
  }, [produtos, searchCod]);

  // Filtrar produtos por nome
  const filteredProductsNome = useMemo(() => {
    if (!searchNome.trim()) return [];
    const searchLower = searchNome.toLowerCase();
    return produtos.filter(p => 
      p.nome?.toLowerCase().includes(searchLower)
    ).slice(0, 20);
  }, [produtos, searchNome]);

  // Agrupar preços por tabela
  const precosPorTabela = useMemo(() => {
    const grouped = {};
    tabelas.forEach(t => {
      grouped[t.id] = {
        tabela: t,
        precos: allPrecos.filter(p => p.tabela_id === t.id).map(preco => {
          const produto = produtos.find(prod => prod.id === preco.produto_id);
          return { ...preco, produto };
        }).filter(p => p.produto).sort((a, b) => (a.produto?.codigo || '').localeCompare(b.produto?.codigo || ''))
      };
    });
    return grouped;
  }, [tabelas, allPrecos, produtos]);

  const savePriceMutation = useMutation({
    mutationFn: async (priceData) => {
      if (priceData.id) {
        return base44.entities.PrecoProduto.update(priceData.id, priceData);
      } else {
        return base44.entities.PrecoProduto.create(priceData);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['precosProduto', selectedProduct?.id]);
      queryClient.invalidateQueries(['todosPrecos']);
      toast.success('✅ Preço salvo com sucesso!');
    },
    onError: (error) => {
      toast.error('❌ Erro ao salvar preço: ' + error.message);
    }
  });

  const handlePriceChange = (tabelaId, field, value) => {
    setPrices(prev => ({
      ...prev,
      [tabelaId]: { ...prev[tabelaId], [field]: value }
    }));
  };

  const handleSavePrice = (tabelaId) => {
    const priceData = prices[tabelaId];
    savePriceMutation.mutate({
      ...priceData,
      produto_id: selectedProduct.id,
      tabela_id: tabelaId
    });
  };

  const handleSelectProduct = (produto, source) => {
    setSelectedProduct(produto);
    setSearchCod('');
    setSearchNome('');
    setShowDropdownCod(false);
    setShowDropdownNome(false);
  };

  const toggleTabela = (tabelaId) => {
    setExpandedTabelas(prev => 
      prev.includes(tabelaId) 
        ? prev.filter(id => id !== tabelaId) 
        : [...prev, tabelaId]
    );
  };

  // Função para imprimir tabela
  const handlePrint = (tabelaId = null) => {
    const tabelasParaImprimir = tabelaId ? [tabelaId] : tabelas.map(t => t.id);
    
    let printContent = `
      <html>
      <head>
        <title>Relatório de Preços - Pão e Mel</title>
        <style>
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
          body { font-family: Arial, sans-serif; margin: 20px; }
          .tabela-container { margin-bottom: 40px; page-break-inside: avoid; }
          .tabela-header { 
            background: #dc2626; 
            color: white; 
            padding: 12px; 
            text-align: center; 
            font-weight: bold;
            font-size: 14px;
          }
          table { width: 100%; border-collapse: collapse; }
          th { 
            background: #fef08a; 
            color: #1a1a1a; 
            padding: 8px; 
            border: 1px solid #000;
            font-weight: bold;
            text-align: left;
          }
          th:last-child { text-align: right; }
          td { padding: 6px 8px; border: 1px solid #000; }
          td:first-child { width: 60px; text-align: right; }
          td:last-child { text-align: right; width: 100px; }
          tr:nth-child(even) { background: #fefce8; }
        </style>
      </head>
      <body>
    `;

    tabelasParaImprimir.forEach(tId => {
      const data = precosPorTabela[tId];
      if (!data || data.precos.length === 0) return;

      printContent += `
        <div class="tabela-container">
          <div class="tabela-header">${data.tabela.nome}</div>
          <table>
            <thead>
              <tr>
                <th>COD</th>
                <th>PRODUTOS</th>
                <th>VALOR ATUAL</th>
              </tr>
            </thead>
            <tbody>
      `;

      data.precos.forEach(p => {
        const valorAtual = p.ativacao_acao && p.valor_acao > 0 ? p.valor_acao : p.valor_unitario;
        printContent += `
          <tr>
            <td>${p.produto?.codigo || ''}</td>
            <td>${p.produto?.nome || ''}</td>
            <td>${valorAtual?.toFixed(2).replace('.', ',') || '0,00'}</td>
          </tr>
        `;
      });

      printContent += `
            </tbody>
          </table>
        </div>
      `;
    });

    printContent += '</body></html>';

    const printWindow = window.open('', '_blank');
    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <div className="space-y-6">
      {/* Header com botão de importação */}
      <div className="flex justify-end gap-2">
        <Button 
          onClick={() => handlePrint()}
          variant="outline"
          className="border-amber-400 text-amber-700 hover:bg-amber-50"
        >
          <Upload className="w-4 h-4 mr-2 rotate-180" />
          Imprimir Todas Tabelas
        </Button>
        <Button 
          onClick={() => setImportModalOpen(true)}
          className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold shadow-lg shadow-amber-500/30"
        >
          <Upload className="w-4 h-4 mr-2" />
          Importar Preços em Massa
        </Button>
      </div>

      {/* Search Section - Pesquisa por COD e NOME separados */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-700">Pesquisar Produto</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Pesquisa por Código */}
          <div className="relative">
            <Label className="text-xs text-slate-500 mb-1 block">Pesquisar por Código</Label>
            <Search className="absolute left-3 top-[calc(50%+8px)] -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Digite o código do produto..." 
              value={searchCod}
              onChange={(e) => {
                setSearchCod(e.target.value);
                setShowDropdownCod(true);
                setSearchNome('');
                setShowDropdownNome(false);
              }}
              onFocus={() => setShowDropdownCod(true)}
              className="pl-9"
            />
            
            {showDropdownCod && searchCod.trim() && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                {filteredProductsCod.length === 0 ? (
                  <div className="p-3 text-sm text-slate-500 text-center">Nenhum produto encontrado</div>
                ) : (
                  filteredProductsCod.map(p => (
                    <div 
                      key={p.id}
                      onClick={() => handleSelectProduct(p, 'cod')}
                      className="p-3 hover:bg-amber-50 cursor-pointer flex justify-between items-center border-b last:border-b-0"
                    >
                      <span className="text-xs font-mono bg-amber-100 px-2 py-1 rounded font-bold">{p.codigo}</span>
                      <span className="font-medium text-slate-700 text-sm truncate ml-2">{p.nome}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Pesquisa por Nome */}
          <div className="relative">
            <Label className="text-xs text-slate-500 mb-1 block">Pesquisar por Nome</Label>
            <Search className="absolute left-3 top-[calc(50%+8px)] -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Digite o nome do produto..." 
              value={searchNome}
              onChange={(e) => {
                setSearchNome(e.target.value);
                setShowDropdownNome(true);
                setSearchCod('');
                setShowDropdownCod(false);
              }}
              onFocus={() => setShowDropdownNome(true)}
              className="pl-9"
            />
            
            {showDropdownNome && searchNome.trim() && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                {filteredProductsNome.length === 0 ? (
                  <div className="p-3 text-sm text-slate-500 text-center">Nenhum produto encontrado</div>
                ) : (
                  filteredProductsNome.map(p => (
                    <div 
                      key={p.id}
                      onClick={() => handleSelectProduct(p, 'nome')}
                      className="p-3 hover:bg-amber-50 cursor-pointer flex justify-between items-center border-b last:border-b-0"
                    >
                      <span className="font-medium text-slate-700 text-sm">{p.nome}</span>
                      <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded">COD: {p.codigo}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Produto Selecionado - Lista de Tabelas */}
      {selectedProduct && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in-50 slide-in-from-bottom-4">
          <div className="p-4 bg-gradient-to-r from-amber-50 to-yellow-50 border-b border-slate-200">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="font-bold text-lg text-slate-800">{selectedProduct.nome}</h3>
                <p className="text-sm text-slate-500">Código: {selectedProduct.codigo}</p>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setSelectedProduct(null)}
                className="text-slate-500"
              >
                ✕ Limpar
              </Button>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tabela</TableHead>
                  <TableHead className="w-[150px]">Valor Unitário</TableHead>
                  <TableHead className="w-[150px]">Valor Ação</TableHead>
                  <TableHead className="w-[180px]">Período Ação (Fim)</TableHead>
                  <TableHead className="w-[120px]">Ativação Ação</TableHead>
                  <TableHead className="w-[80px]">Salvar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tabelas.map(tabela => {
                  const price = prices[tabela.id] || {};
                  return (
                    <TableRow key={tabela.id}>
                      <TableCell className="font-medium">{tabela.nome}</TableCell>
                      <TableCell>
                        <Input 
                          type="number" 
                          step="0.01"
                          value={price.valor_unitario || ''}
                          onChange={(e) => handlePriceChange(tabela.id, 'valor_unitario', parseFloat(e.target.value) || 0)}
                          disabled={price.ativacao_acao}
                          className={price.ativacao_acao ? 'bg-slate-100 text-slate-400' : ''}
                        />
                      </TableCell>
                      <TableCell>
                        <Input 
                          type="number" 
                          step="0.01"
                          value={price.valor_acao || ''}
                          onChange={(e) => handlePriceChange(tabela.id, 'valor_acao', parseFloat(e.target.value) || 0)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="relative">
                          <Input 
                            type="date"
                            value={price.periodo_acao_fim || ''}
                            onChange={(e) => handlePriceChange(tabela.id, 'periodo_acao_fim', e.target.value)}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center h-full">
                          <Switch 
                            checked={price.ativacao_acao || false}
                            onCheckedChange={(checked) => handlePriceChange(tabela.id, 'ativacao_acao', checked)}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button 
                          size="icon" 
                          variant="ghost"
                          onClick={() => handleSavePrice(tabela.id)}
                          className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                        >
                          <Save className="w-5 h-5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Seção de Visualização por Tabela (Lista Suspensa) */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-slate-700">Visualizar Produtos por Tabela</h3>
          <Select value={tabelaSelecionada} onValueChange={setTabelaSelecionada}>
            <SelectTrigger className="w-[250px]">
              <SelectValue placeholder="Selecione uma tabela" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as Tabelas</SelectItem>
              {tabelas.map(t => (
                <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tabelas expandíveis */}
        <div className="space-y-3">
          {tabelas
            .filter(t => tabelaSelecionada === 'all' || tabelaSelecionada === t.id)
            .map(tabela => {
              const data = precosPorTabela[tabela.id];
              const isExpanded = expandedTabelas.includes(tabela.id);
              
              return (
                <div key={tabela.id} className="border rounded-lg overflow-hidden">
                  <div 
                    className="flex justify-between items-center p-3 bg-red-600 text-white cursor-pointer hover:bg-red-700 transition-colors"
                    onClick={() => toggleTabela(tabela.id)}
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5" />
                      ) : (
                        <ChevronRight className="w-5 h-5" />
                      )}
                      <span className="font-bold">{tabela.nome}</span>
                      <Badge className="bg-white/20 text-white">
                        {data?.precos.length || 0} produtos
                      </Badge>
                    </div>
                    <Button 
                      size="sm"
                      variant="ghost"
                      className="text-white hover:bg-white/20"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePrint(tabela.id);
                      }}
                    >
                      <Upload className="w-4 h-4 mr-1 rotate-180" />
                      Imprimir
                    </Button>
                  </div>
                  
                  {isExpanded && data && (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-yellow-200">
                            <th className="p-2 text-left border-b border-slate-300 w-[80px] font-bold">COD</th>
                            <th className="p-2 text-left border-b border-slate-300 font-bold">PRODUTOS</th>
                            <th className="p-2 text-right border-b border-slate-300 w-[120px] font-bold">VALOR ATUAL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.precos.length === 0 ? (
                            <tr>
                              <td colSpan={3} className="p-4 text-center text-slate-500">
                                Nenhum produto cadastrado nesta tabela
                              </td>
                            </tr>
                          ) : (
                            data.precos.map((p, idx) => {
                              const valorAtual = p.ativacao_acao && p.valor_acao > 0 ? p.valor_acao : p.valor_unitario;
                              return (
                                <tr key={p.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-yellow-50'}>
                                  <td className="p-2 border-b border-slate-200 text-right font-mono">
                                    {p.produto?.codigo}
                                  </td>
                                  <td className="p-2 border-b border-slate-200">
                                    {p.produto?.nome}
                                  </td>
                                  <td className="p-2 border-b border-slate-200 text-right font-medium">
                                    {valorAtual?.toFixed(2).replace('.', ',')}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* Modal de Importação em Massa */}
      <ImportarPrecosMassa 
        open={importModalOpen}
        onOpenChange={setImportModalOpen}
        tabelas={tabelas}
        produtos={produtos}
        onSuccess={() => {
          queryClient.invalidateQueries(['precosProduto']);
          queryClient.invalidateQueries(['todosPrecos']);
          if (selectedProduct) {
            refetchPrices();
          }
        }}
      />
    </div>
  );
}