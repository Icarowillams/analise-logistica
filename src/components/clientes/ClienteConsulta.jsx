import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Search, Filter, MapPin, List } from 'lucide-react';
import DataTable from '@/components/ui/DataTable';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ClienteConsulta({ onEdit, onDelete }) {
  const [filters, setFilters] = useState({
    vendedor_id: 'all',
    supervisor_id: 'all',
    rede_id: 'all',
    segmento_id: 'all',
    status: 'all',
    cidade: '',
    bairro: '',
    search: ''
  });

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: redes = [] } = useQuery({
    queryKey: ['redes'],
    queryFn: () => base44.entities.Rede.list()
  });

  const { data: segmentos = [] } = useQuery({
    queryKey: ['segmentos'],
    queryFn: () => base44.entities.Segmento.list()
  });

  const { data: planosPagamento = [] } = useQuery({
    queryKey: ['planosPagamento'],
    queryFn: () => base44.entities.PlanoPagamento.list()
  });

  // Extract unique supervisors (vendedores who are supervisors of others)
  const supervisors = useMemo(() => {
    const supervisorIds = [...new Set(vendedores.map(v => v.supervisor_id).filter(Boolean))];
    return vendedores.filter(v => supervisorIds.includes(v.id));
  }, [vendedores]);

  // Helper to get supervisor for a client (via client.vendedor_id -> vendedor.supervisor_id)
  const getSupervisorId = (cliente) => {
    const vendedor = vendedores.find(v => v.id === cliente.vendedor_id);
    return vendedor ? vendedor.supervisor_id : null;
  };

  const filteredClientes = useMemo(() => {
    return clientes.filter(cliente => {
      // Filter by Vendedor
      if (filters.vendedor_id === 'empty') {
        if (cliente.vendedor_id) return false;
      } else if (filters.vendedor_id !== 'all' && cliente.vendedor_id !== filters.vendedor_id) {
        return false;
      }
      
      // Filter by Supervisor
      if (filters.supervisor_id !== 'all') {
        const supId = getSupervisorId(cliente);
        if (filters.supervisor_id === 'empty') {
          if (supId) return false;
        } else if (supId !== filters.supervisor_id) {
          return false;
        }
      }

      // Filter by Rede
      if (filters.rede_id === 'empty') {
        if (cliente.rede_id) return false;
      } else if (filters.rede_id !== 'all' && cliente.rede_id !== filters.rede_id) {
        return false;
      }

      // Filter by Segmento
      if (filters.segmento_id === 'empty') {
        if (cliente.segmento_id) return false;
      } else if (filters.segmento_id !== 'all' && cliente.segmento_id !== filters.segmento_id) {
        return false;
      }

      // Filter by Status
      if (filters.status !== 'all' && cliente.status !== filters.status) return false;

      // Filter by Cidade (partial match)
      if (filters.cidade && !cliente.cidade?.toLowerCase().includes(filters.cidade.toLowerCase())) return false;

      // Filter by Bairro (partial match)
      if (filters.bairro && !cliente.bairro?.toLowerCase().includes(filters.bairro.toLowerCase())) return false;

      // General Search (matches text/numbers in key columns)
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const match = [
          cliente.codigo,
          cliente.razao_social,
          cliente.nome_fantasia,
          cliente.cpf_cnpj,
          cliente.endereco,
          cliente.numero
        ].some(val => val && String(val).toLowerCase().includes(searchLower));
        if (!match) return false;
      }

      return true;
    });
  }, [clientes, filters, vendedores]);

  const getName = (list, id) => {
    if (!id) return '-';
    const item = list.find(i => i.id === id);
    return item ? item.nome : '-';
  };

  const getVendedorName = (id) => getName(vendedores, id);
  const getSupervisorNameForClient = (cliente) => {
    const supId = getSupervisorId(cliente);
    return getName(vendedores, supId);
  };

  const columns = [
    { key: 'codigo', label: 'Código', sortable: true, width: '100px' },
    { 
      key: 'nome_fantasia', 
      label: 'Nome Fantasia', 
      sortable: true,
      render: (val, row) => val || row.razao_social
    },
    { key: 'cidade', label: 'Cidade' },
    { 
      key: 'vendedor_id', 
      label: 'Vendedor',
      render: (val) => getVendedorName(val)
    },
    { 
      key: 'rede_id', 
      label: 'Rede',
      render: (val) => getName(redes, val)
    },
    {
      key: 'status',
      label: 'Status',
      width: '100px',
      render: (val) => (
        <Badge className={val === 'ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
          {val}
        </Badge>
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
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            
            {/* Vendedor */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Vendedor</label>
              <Select 
                value={filters.vendedor_id} 
                onValueChange={(v) => setFilters({...filters, vendedor_id: v})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="empty" className="text-amber-600">🔍 Vazio / Sem Vendedor</SelectItem>
                  {vendedores.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Supervisor */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Supervisor</label>
              <Select 
                value={filters.supervisor_id} 
                onValueChange={(v) => setFilters({...filters, supervisor_id: v})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="empty" className="text-amber-600">🔍 Vazio / Sem Supervisor</SelectItem>
                  {supervisors.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Rede */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Rede</label>
              <Select 
                value={filters.rede_id} 
                onValueChange={(v) => setFilters({...filters, rede_id: v})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="empty" className="text-amber-600">🔍 Vazio / Sem Rede</SelectItem>
                  {redes.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Segmento */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Segmento</label>
              <Select 
                value={filters.segmento_id} 
                onValueChange={(v) => setFilters({...filters, segmento_id: v})}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="empty" className="text-amber-600">🔍 Vazio / Sem Segmento</SelectItem>
                  {segmentos.map(s => (
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
                  <SelectItem value="prospecto">Prospecto</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Cidade */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Cidade</label>
              <div className="relative">
                <MapPin className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                <Input 
                  placeholder="Buscar cidade..." 
                  value={filters.cidade}
                  onChange={(e) => setFilters({...filters, cidade: e.target.value})}
                  className="pl-8"
                />
              </div>
            </div>

            {/* Bairro */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Bairro</label>
              <div className="relative">
                <MapPin className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                <Input 
                  placeholder="Buscar bairro..." 
                  value={filters.bairro}
                  onChange={(e) => setFilters({...filters, bairro: e.target.value})}
                  className="pl-8"
                />
              </div>
            </div>

            {/* General Search */}
            <div className="md:col-span-2 space-y-1">
              <label className="text-sm font-medium text-slate-700">Busca Geral</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                <Input 
                  placeholder="Nome, CNPJ, Email, Telefone..." 
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
                vendedor_id: 'all',
                supervisor_id: 'all',
                rede_id: 'all',
                segmento_id: 'all',
                status: 'all',
                cidade: '',
                bairro: '',
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
            Resultados ({filteredClientes.length})
          </h3>
        </div>
        <div className="p-0">
          <DataTable 
            data={filteredClientes} 
            columns={columns}
            searchable={false} // We have custom search
            pageSize={1000}
            emptyMessage="Nenhum cliente encontrado com os filtros selecionados."
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      </div>
    </div>
  );
}