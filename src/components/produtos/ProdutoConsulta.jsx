import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Search, Filter, Package, List, Pencil, Eye } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ProdutoConsulta({ onView, onEdit, onDelete }) {
  const [filters, setFilters] = useState({
    categoria_id: 'all',
    sub_categoria_id: 'all',
    status: 'all',
    search: ''
  });

  const { data: produtos = [], isLoading } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => base44.entities.Categoria.list()
  });

  const { data: subCategorias = [] } = useQuery({
    queryKey: ['subCategorias'],
    queryFn: () => base44.entities.SubCategoria.list()
  });

  const filteredProdutos = useMemo(() => {
    return produtos.filter(produto => {
      // Filter by Categoria
      if (filters.categoria_id !== 'all' && produto.categoria_id !== filters.categoria_id) return false;

      // Filter by SubCategoria
      if (filters.sub_categoria_id !== 'all' && produto.sub_categoria_id !== filters.sub_categoria_id) return false;
      
      // Filter by Status
      if (filters.status !== 'all' && produto.status !== filters.status) return false;

      // General Search
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const match = [
          produto.codigo,
          produto.nome,
          produto.cod_barras
        ].some(val => val && String(val).toLowerCase().includes(searchLower));
        if (!match) return false;
      }

      return true;
    });
  }, [produtos, filters]);

  const getCategoryName = (id) => {
    if (!id) return '-';
    const cat = categorias.find(c => c.id === id);
    return cat ? cat.nome : '-';
  };

  const getSubCategoryName = (id) => {
    if (!id) return '-';
    const sub = subCategorias.find(s => s.id === id);
    return sub ? sub.nome : '-';
  };

  const columns = [
    { 
      key: 'imagem_url', 
      label: 'Imagem',
      width: '80px',
      render: (val) => val ? (
        <div className="h-12 w-12 rounded-lg overflow-hidden border border-slate-200">
           <img src={val} alt="Produto" className="w-full h-full object-cover" />
        </div>
      ) : (
        <div className="h-12 w-12 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400">
          <Package className="w-6 h-6" />
        </div>
      )
    },
    { key: 'codigo', label: 'Código', sortable: true, width: '100px' },
    { key: 'nome', label: 'Nome', sortable: true },
    { key: 'categoria_id', label: 'Categoria', render: (val) => getCategoryName(val) },
    { key: 'ncm', label: 'NCM', width: '100px' },
    { key: 'estoque_atual', label: 'Estoque', width: '100px' },
    {
      key: 'status',
      label: 'Status',
      width: '100px',
      render: (val) => (
        <Badge className={val === 'ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
          {val}
        </Badge>
      )
    },
    {
      key: 'actions',
      label: 'Ações',
      width: '120px',
      render: (_, row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onView && onView(row)}
            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
          >
            <Eye className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit && onEdit(row)}
            className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
          >
            <Pencil className="w-4 h-4" />
          </Button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card className="bg-white shadow-sm border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-medium flex items-center gap-2">
            <Filter className="w-5 h-5 text-amber-500" />
            Filtros Avançados
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            {/* Categoria */}
            <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Categoria</label>
            <Select 
              value={filters.categoria_id} 
              onValueChange={(v) => setFilters({...filters, categoria_id: v, sub_categoria_id: 'all'})}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {categorias.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            </div>

            {/* SubCategoria */}
            <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">Subcategoria</label>
            <Select 
              value={filters.sub_categoria_id} 
              onValueChange={(v) => setFilters({...filters, sub_categoria_id: v})}
            >
              <SelectTrigger>
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {subCategorias
                  .filter(s => filters.categoria_id === 'all' || s.categoria_id === filters.categoria_id)
                  .map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            </div>

            {/* Status */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Status</label>
              <Select 
                value={filters.status} 
                onValueChange={(v) => setFilters({...filters, status: v})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="ativo">Ativo</SelectItem>
                  <SelectItem value="inativo">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* General Search */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Busca Geral</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                <Input 
                  placeholder="Nome, Cód. Barras..." 
                  value={filters.search}
                  onChange={(e) => setFilters({...filters, search: e.target.value})}
                  className="pl-8"
                />
              </div>
            </div>

          </div>
          
          <div className="mt-4 flex justify-end">
            <Button 
              variant="outline" 
              onClick={() => setFilters({
                categoria_id: 'all',
                sub_categoria_id: 'all',
                status: 'all',
                search: ''
              })}
              className="text-slate-600 hover:text-slate-900"
            >
              Limpar Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
          <h3 className="font-semibold text-slate-700 flex items-center gap-2">
            <List className="w-4 h-4" />
            Resultados ({filteredProdutos.length})
          </h3>
        </div>
        <div className="p-0">
          <DataTable 
            data={filteredProdutos} 
            columns={columns}
            searchable={false}
            pageSize={1000}
            emptyMessage="Nenhum produto encontrado."
          />
        </div>
      </div>
    </div>
  );
}