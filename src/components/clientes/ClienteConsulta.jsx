import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useClientesPermissao } from '@/components/hooks/useClientesPermissao';
import { Search, Filter, MapPin, List, MapPinOff, Download } from 'lucide-react';
import DataTable from '@/components/ui/DataTable';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import MultiSelectFilter from '@/components/ui/MultiSelectFilter';

export default function ClienteConsulta({ onEdit, onDelete, onExport }) {
  const [filters, setFilters] = useState({
    vendedor_ids: [],
    supervisor_ids: [],
    rede_ids: [],
    segmento_ids: [],
    status: 'all',
    cidade: '',
    bairro: '',
    search: '',
    semLocalizacao: false,
    inscricaoEstadual: null // null = sem filtro, true = com IE, false = sem IE
  });

  const { data: clientesAll = [], isLoading } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: vendedoresAll = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  // Permissões de visibilidade de clientes
  const { filtrarClientes, vendedoresPermitidosIds } = useClientesPermissao();

  // Dados filtrados por permissão
  const clientes = useMemo(() => filtrarClientes(clientesAll), [clientesAll, filtrarClientes]);
  const vendedores = useMemo(() => {
    if (vendedoresPermitidosIds === null) return vendedoresAll;
    return vendedoresAll.filter(v => vendedoresPermitidosIds.has(v.id));
  }, [vendedoresAll, vendedoresPermitidosIds]);

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
      // Filter by Vendedor (multi-select)
      if (filters.vendedor_ids.length > 0) {
        const hasEmpty = filters.vendedor_ids.includes('__empty__');
        const selectedIds = filters.vendedor_ids.filter(id => id !== '__empty__');
        
        if (hasEmpty && !cliente.vendedor_id) {
          // Passa se está vazio e "vazio" está selecionado
        } else if (selectedIds.includes(cliente.vendedor_id)) {
          // Passa se o vendedor está selecionado
        } else {
          return false;
        }
      }
      
      // Filter by Supervisor (multi-select)
      if (filters.supervisor_ids.length > 0) {
        const supId = getSupervisorId(cliente);
        const hasEmpty = filters.supervisor_ids.includes('__empty__');
        const selectedIds = filters.supervisor_ids.filter(id => id !== '__empty__');
        
        if (hasEmpty && !supId) {
          // Passa se está vazio
        } else if (selectedIds.includes(supId)) {
          // Passa se o supervisor está selecionado
        } else {
          return false;
        }
      }

      // Filter by Rede (multi-select)
      if (filters.rede_ids.length > 0) {
        const hasEmpty = filters.rede_ids.includes('__empty__');
        const selectedIds = filters.rede_ids.filter(id => id !== '__empty__');
        
        if (hasEmpty && !cliente.rede_id) {
          // Passa se está vazio
        } else if (selectedIds.includes(cliente.rede_id)) {
          // Passa se a rede está selecionada
        } else {
          return false;
        }
      }

      // Filter by Segmento (multi-select)
      if (filters.segmento_ids.length > 0) {
        const hasEmpty = filters.segmento_ids.includes('__empty__');
        const selectedIds = filters.segmento_ids.filter(id => id !== '__empty__');
        
        if (hasEmpty && !cliente.segmento_id) {
          // Passa se está vazio
        } else if (selectedIds.includes(cliente.segmento_id)) {
          // Passa se o segmento está selecionado
        } else {
          return false;
        }
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

      // Filter by Sem Localização
      if (filters.semLocalizacao) {
        if (cliente.latitude && cliente.longitude) return false;
      }

      // Filter by Inscrição Estadual
      if (filters.inscricaoEstadual === true) {
        if (!cliente.inscricao_estadual || cliente.inscricao_estadual.trim() === '') return false;
      } else if (filters.inscricaoEstadual === false) {
        if (cliente.inscricao_estadual && cliente.inscricao_estadual.trim() !== '') return false;
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
              <MultiSelectFilter
                options={vendedores}
                selectedIds={filters.vendedor_ids}
                onChange={(ids) => setFilters({...filters, vendedor_ids: ids})}
                placeholder="Todos"
                includeEmpty
                emptyLabel="Sem Vendedor"
              />
            </div>

            {/* Supervisor */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Supervisor</label>
              <MultiSelectFilter
                options={supervisors}
                selectedIds={filters.supervisor_ids}
                onChange={(ids) => setFilters({...filters, supervisor_ids: ids})}
                placeholder="Todos"
                includeEmpty
                emptyLabel="Sem Supervisor"
              />
            </div>

            {/* Rede */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Rede</label>
              <MultiSelectFilter
                options={redes}
                selectedIds={filters.rede_ids}
                onChange={(ids) => setFilters({...filters, rede_ids: ids})}
                placeholder="Todas"
                includeEmpty
                emptyLabel="Sem Rede"
              />
            </div>

            {/* Segmento */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Segmento</label>
              <MultiSelectFilter
                options={segmentos}
                selectedIds={filters.segmento_ids}
                onChange={(ids) => setFilters({...filters, segmento_ids: ids})}
                placeholder="Todos"
                includeEmpty
                emptyLabel="Sem Segmento"
              />
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
            <div className="space-y-1">
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

            {/* Sem Localização */}
            <div className="space-y-1 flex items-end">
              <div className="flex items-center gap-2 h-9 px-3 border rounded-md bg-white">
                <Checkbox
                  id="semLocalizacao"
                  checked={filters.semLocalizacao}
                  onCheckedChange={(checked) => setFilters({...filters, semLocalizacao: checked})}
                />
                <label htmlFor="semLocalizacao" className="text-sm cursor-pointer flex items-center gap-1">
                  <MapPinOff className="w-4 h-4 text-amber-500" />
                  Sem localização
                </label>
              </div>
            </div>

          </div>
          
          <div className="mt-4 flex justify-end">
            <Button 
              variant="outline" 
              onClick={() => setFilters({
                vendedor_ids: [],
                supervisor_ids: [],
                rede_ids: [],
                segmento_ids: [],
                status: 'all',
                cidade: '',
                bairro: '',
                search: '',
                semLocalizacao: false
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
          {onExport && (
            <Button
              onClick={() => onExport(filteredClientes)}
              variant="outline"
              size="sm"
              className="border-green-200 text-green-700 hover:bg-green-50"
            >
              <Download className="w-4 h-4 mr-2" />
              Exportar ({filteredClientes.length})
            </Button>
          )}
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