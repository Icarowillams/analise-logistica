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
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [prices, setPrices] = useState({});
  const [importModalOpen, setImportModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });

  const { data: tabelas = [] } = useQuery({
    queryKey: ['tabelasPreco'],
    queryFn: () => base44.entities.TabelaPreco.list()
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

  // Filtrar produtos por código ou nome
  const filteredProducts = useMemo(() => {
    if (!search.trim()) return [];
    const searchLower = search.toLowerCase();
    return produtos.filter(p => 
      p.codigo?.toLowerCase().includes(searchLower) ||
      p.nome?.toLowerCase().includes(searchLower)
    ).slice(0, 20); // Limitar a 20 resultados
  }, [produtos, search]);

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

  const handleSelectProduct = (produto) => {
    setSelectedProduct(produto);
    setSearch('');
    setShowDropdown(false);
  };

  return (
    <div className="space-y-6">
      {/* Header com botão de importação */}
      <div className="flex justify-end">
        <Button 
          onClick={() => setImportModalOpen(true)}
          className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold shadow-lg shadow-amber-500/30"
        >
          <Upload className="w-4 h-4 mr-2" />
          Importar Preços em Massa
        </Button>
      </div>

      {/* Search Section - Pesquisa por COD ou TEXTO */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <h3 className="font-semibold text-slate-700">Pesquisar Produto</h3>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input 
            placeholder="Digite o código ou nome do produto..." 
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            className="pl-9"
          />
          
          {/* Dropdown de resultados */}
          {showDropdown && search.trim() && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {filteredProducts.length === 0 ? (
                <div className="p-3 text-sm text-slate-500 text-center">Nenhum produto encontrado</div>
              ) : (
                filteredProducts.map(p => (
                  <div 
                    key={p.id}
                    onClick={() => handleSelectProduct(p)}
                    className="p-3 hover:bg-amber-50 cursor-pointer flex justify-between items-center border-b last:border-b-0"
                  >
                    <div>
                      <span className="font-medium text-slate-700">{p.nome}</span>
                    </div>
                    <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded">COD: {p.codigo}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Produto Selecionado - Lista de Tabelas */}
      {selectedProduct ? (
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
      ) : (
        <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-500">
          <Search className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p>Pesquise um produto pelo código ou nome para gerenciar os preços em todas as tabelas.</p>
        </div>
      )}

      {/* Modal de Importação em Massa */}
      <ImportarPrecosMassa 
        open={importModalOpen}
        onOpenChange={setImportModalOpen}
        tabelas={tabelas}
        produtos={produtos}
        onSuccess={() => {
          queryClient.invalidateQueries(['precosProduto']);
          if (selectedProduct) {
            refetchPrices();
          }
        }}
      />
    </div>
  );
}