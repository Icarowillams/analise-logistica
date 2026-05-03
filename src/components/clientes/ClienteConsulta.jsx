import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useClientesPermissao } from '@/components/hooks/useClientesPermissao';
import { Search, Filter, MapPin, List, MapPinOff, Download, Eye, Pencil, Trash2 } from 'lucide-react';
import DataTable from '@/components/ui/DataTable';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import MultiSelectFilter from '@/components/ui/MultiSelectFilter';

export default function ClienteConsulta({ onEdit, onDelete, onExport }) {
  const [selectedClienteId, setSelectedClienteId] = useState(null);
  const [filters, setFilters] = useState({
    vendedor_ids: [],
    supervisor_ids: [],
    rede_ids: [],
    segmento_ids: [],
    plano_pagamento_ids: [],
    modalidade_pagamento_ids: [],
    tabela_preco_ids: [],
    status: 'all',
    rota: 'all',
    cidade: '',
    bairro: '',
    search: '',
    semLocalizacao: false,
    semNomeFantasia: false,
    inscricaoEstadual: null,
    tipoNota: 'all',
  });

  const { data: clientesAll = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: async () => {
      const lista = await base44.entities.Cliente.list();
      return lista.map((cliente) => ({
        ...cliente,
        ...(cliente.data || {}),
        id: cliente.id,
        codigo_interno: cliente.codigo_interno || cliente.data?.codigo_interno || cliente.codigo || cliente.data?.codigo || '',
        codigo_integracao: cliente.codigo_integracao || cliente.data?.codigo_integracao || cliente.codigo || cliente.data?.codigo || '',
      }));
    },
    refetchOnMount: 'always',
  });

  const { data: vendedoresAll = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list(),
  });

  const { data: redes = [] } = useQuery({
    queryKey: ['redes'],
    queryFn: () => base44.entities.Rede.list(),
  });

  const { data: segmentos = [] } = useQuery({
    queryKey: ['segmentos'],
    queryFn: () => base44.entities.Segmento.list(),
  });

  const { data: planosPagamento = [] } = useQuery({
    queryKey: ['planosPagamento'],
    queryFn: () => base44.entities.PlanoPagamento.list(),
  });

  const { data: modalidadesPagamento = [] } = useQuery({
    queryKey: ['modalidadesPagamento'],
    queryFn: () => base44.entities.ModalidadePagamento.list(),
  });

  const { data: tabelasPreco = [] } = useQuery({
    queryKey: ['tabelasPreco'],
    queryFn: () => base44.entities.TabelaPreco.list(),
  });

  const { data: rotas = [] } = useQuery({
    queryKey: ['rotas'],
    queryFn: () => base44.entities.Rota.list(),
  });

  const { filtrarClientes, vendedoresPermitidosIds } = useClientesPermissao();

  const clientes = useMemo(() => {
    const normalizados = clientesAll.map((cliente) => ({
      ...cliente,
      ...(cliente.data || {}),
      id: cliente.id,
      codigo_interno: cliente.codigo_interno || cliente.data?.codigo_interno || cliente.codigo || cliente.data?.codigo || '',
      codigo_integracao: cliente.codigo_integracao || cliente.data?.codigo_integracao || cliente.codigo || cliente.data?.codigo || '',
    }));
    return filtrarClientes(normalizados);
  }, [clientesAll, filtrarClientes]);

  const vendedores = useMemo(() => {
    if (vendedoresPermitidosIds === null) return vendedoresAll;
    return vendedoresAll.filter((v) => vendedoresPermitidosIds.has(v.id));
  }, [vendedoresAll, vendedoresPermitidosIds]);

  const supervisors = useMemo(() => {
    const supervisorIds = [...new Set(vendedores.map((v) => v.supervisor_id).filter(Boolean))];
    return vendedores.filter((v) => supervisorIds.includes(v.id));
  }, [vendedores]);

  const getSupervisorId = (cliente) => {
    const vendedor = vendedores.find((v) => v.id === cliente.vendedor_id);
    return vendedor ? vendedor.supervisor_id : null;
  };

  const getName = (list, id) => {
    if (!id) return '-';
    const item = list.find((entry) => entry.id === id);
    return item ? item.nome : '-';
  };

  const getVendedorName = (id) => getName(vendedores, id);

  const getSupervisorNameForClient = (cliente) => {
    const supId = getSupervisorId(cliente);
    return getName(vendedores, supId);
  };

  // Set de IDs de tabelas existentes para detectar tabelas órfãs
  const tabelaIdsExistentes = useMemo(() => new Set(tabelasPreco.map(t => t.id)), [tabelasPreco]);

  const filteredClientes = useMemo(() => {
    return clientes.filter((cliente) => {
      if (filters.vendedor_ids.length > 0) {
        const hasEmpty = filters.vendedor_ids.includes('__empty__');
        const selectedIds = filters.vendedor_ids.filter((id) => id !== '__empty__');
        if (!(hasEmpty && !cliente.vendedor_id) && !selectedIds.includes(cliente.vendedor_id)) return false;
      }

      if (filters.supervisor_ids.length > 0) {
        const supId = getSupervisorId(cliente);
        const hasEmpty = filters.supervisor_ids.includes('__empty__');
        const selectedIds = filters.supervisor_ids.filter((id) => id !== '__empty__');
        if (!(hasEmpty && !supId) && !selectedIds.includes(supId)) return false;
      }

      if (filters.rede_ids.length > 0) {
        const hasEmpty = filters.rede_ids.includes('__empty__');
        const selectedIds = filters.rede_ids.filter((id) => id !== '__empty__');
        if (!(hasEmpty && !cliente.rede_id) && !selectedIds.includes(cliente.rede_id)) return false;
      }

      if (filters.segmento_ids.length > 0) {
        const hasEmpty = filters.segmento_ids.includes('__empty__');
        const selectedIds = filters.segmento_ids.filter((id) => id !== '__empty__');
        if (!(hasEmpty && !cliente.segmento_id) && !selectedIds.includes(cliente.segmento_id)) return false;
      }

      if (filters.plano_pagamento_ids.length > 0) {
        const hasEmpty = filters.plano_pagamento_ids.includes('__empty__');
        const selectedIds = filters.plano_pagamento_ids.filter((id) => id !== '__empty__');
        if (!(hasEmpty && !cliente.plano_pagamento_id) && !selectedIds.includes(cliente.plano_pagamento_id)) return false;
      }

      if (filters.modalidade_pagamento_ids.length > 0) {
        const hasEmpty = filters.modalidade_pagamento_ids.includes('__empty__');
        const selectedIds = filters.modalidade_pagamento_ids.filter((id) => id !== '__empty__');
        if (!(hasEmpty && !cliente.modalidade_pagamento_id) && !selectedIds.includes(cliente.modalidade_pagamento_id)) return false;
      }

      if (filters.tabela_preco_ids.length > 0) {
        const hasEmpty = filters.tabela_preco_ids.includes('__empty__');
        const selectedIds = filters.tabela_preco_ids.filter((id) => id !== '__empty__');
        const clienteSemTabela = !cliente.tabela_id || !tabelaIdsExistentes.has(cliente.tabela_id);
        if (!(hasEmpty && clienteSemTabela) && !selectedIds.includes(cliente.tabela_id)) return false;
      }

      if (filters.status !== 'all' && cliente.status !== filters.status) return false;
      if (filters.rota === 'com' && !cliente.rota_id) return false;
      if (filters.rota === 'sem' && cliente.rota_id) return false;
      if (filters.cidade && !cliente.cidade?.toLowerCase().includes(filters.cidade.toLowerCase())) return false;
      if (filters.bairro && !cliente.bairro?.toLowerCase().includes(filters.bairro.toLowerCase())) return false;

      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const match = [
          cliente.codigo_interno,
          cliente.codigo_integracao,
          cliente.razao_social,
          cliente.nome_fantasia,
          cliente.cnpj_cpf,
          cliente.endereco,
          cliente.numero,
        ].some((val) => val && String(val).toLowerCase().includes(searchLower));
        if (!match) return false;
      }

      if (filters.semLocalizacao && cliente.latitude && cliente.longitude) return false;
      if (filters.semNomeFantasia && cliente.nome_fantasia && cliente.nome_fantasia.trim() !== '') return false;

      if (filters.inscricaoEstadual === true) {
        if (!cliente.inscricao_estadual || cliente.inscricao_estadual.trim() === '') return false;
      } else if (filters.inscricaoEstadual === false) {
        if (cliente.inscricao_estadual && cliente.inscricao_estadual.trim() !== '') return false;
      }

      if (filters.tipoNota !== 'all') {
        const tipo = cliente.tipo_nota || '55';
        if (tipo !== filters.tipoNota) return false;
      }

      return true;
    });
  }, [clientes, filters, vendedores]);

  const selectedCliente = useMemo(() => {
    if (!filteredClientes.length) return null;
    return filteredClientes.find((cliente) => cliente.id === selectedClienteId) || filteredClientes[0];
  }, [filteredClientes, selectedClienteId]);

  const previewFields = [
    { label: 'Código', value: selectedCliente?.codigo_interno || selectedCliente?.codigo_integracao || '-' },
    { label: 'Razão social', value: selectedCliente?.razao_social || '-' },
    { label: 'Nome fantasia', value: selectedCliente?.nome_fantasia || '-' },
    { label: 'CPF/CNPJ', value: selectedCliente?.cnpj_cpf || '-' },
    { label: 'Inscrição estadual', value: selectedCliente?.inscricao_estadual || '-' },
    { label: 'Cidade', value: selectedCliente?.cidade || '-' },
    { label: 'Bairro', value: selectedCliente?.bairro || '-' },
    { label: 'Endereço', value: selectedCliente?.endereco || '-' },
    { label: 'Número', value: selectedCliente?.numero || '-' },
    { label: 'CEP', value: selectedCliente?.cep || '-' },
    { label: 'Vendedor', value: selectedCliente ? getVendedorName(selectedCliente.vendedor_id) : '-' },
    { label: 'Supervisor', value: selectedCliente ? getSupervisorNameForClient(selectedCliente) : '-' },
    { label: 'Rota', value: selectedCliente ? getName(rotas, selectedCliente.rota_id) : '-' },
    { label: 'Rede', value: selectedCliente ? getName(redes, selectedCliente.rede_id) : '-' },
    { label: 'Segmento', value: selectedCliente ? getName(segmentos, selectedCliente.segmento_id) : '-' },
    { label: 'Plano de pagamento', value: selectedCliente ? getName(planosPagamento, selectedCliente.plano_pagamento_id) : '-' },
    { label: 'Tabela de preço', value: selectedCliente ? (selectedCliente.tabela_id && !tabelaIdsExistentes.has(selectedCliente.tabela_id) ? '⚠️ Tabela excluída (vincular nova)' : getName(tabelasPreco, selectedCliente.tabela_id)) : '-' },
    { label: 'Status', value: selectedCliente?.status || '-' },
    { label: 'Tipo de Nota', value: selectedCliente ? ((selectedCliente.tipo_nota || '55') === 'D1' ? 'D1 — Sem NF (interno)' : '55 — NF-e') : '-' },
  ];

  const columns = [
    {
      key: 'codigo_interno',
      label: 'Código',
      sortable: true,
      width: '100px',
      render: (val, row) => val || row.codigo_integracao || '-'
    },
    {
      key: 'nome_fantasia',
      label: 'Nome Fantasia',
      sortable: true,
      render: (val, row) => val || row.razao_social,
    },
    { key: 'cidade', label: 'Cidade' },
    {
      key: 'vendedor_id',
      label: 'Vendedor',
      render: (val) => getVendedorName(val),
    },
    {
      key: 'rede_id',
      label: 'Rede',
      render: (val) => getName(redes, val),
    },
    {
      key: 'rota_id',
      label: 'Rota',
      render: (val) => getName(rotas, val),
    },
    {
      key: 'status',
      label: 'Status',
      width: '100px',
      render: (val) => (
        <Badge className={val === 'ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
          {val}
        </Badge>
      ),
    },
    {
      key: 'tipo_nota',
      label: 'Tipo Nota',
      width: '90px',
      sortable: true,
      render: (val) => {
        const tipo = val || '55';
        return (
          <Badge className={tipo === 'D1' ? 'bg-orange-100 text-orange-700 border border-orange-300' : 'bg-blue-100 text-blue-700 border border-blue-300'}>
            {tipo}
          </Badge>
        );
      },
    },
    {
      key: 'visualizar',
      label: 'Ver',
      width: '72px',
      render: (_, row) => (
        <Button
          type="button"
          variant={selectedCliente?.id === row.id ? 'default' : 'outline'}
          size="sm"
          className="h-8 px-2"
          onClick={() => setSelectedClienteId(row.id)}
        >
          <Eye className="w-4 h-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card className="bg-white shadow-sm border-slate-200 overflow-hidden">
        <CardHeader className="pb-2 sm:pb-3 px-4 sm:px-6 pt-4 sm:pt-6">
          <CardTitle className="text-base sm:text-lg font-medium flex items-center gap-2">
            <Filter className="w-5 h-5 text-amber-500" />
            Filtros Avançados
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 sm:px-6 pb-4 sm:pb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Vendedor</label>
              <MultiSelectFilter
                options={vendedores}
                selectedIds={filters.vendedor_ids}
                onChange={(ids) => setFilters({ ...filters, vendedor_ids: ids })}
                placeholder="Todos"
                includeEmpty
                emptyLabel="Sem Vendedor"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Supervisor</label>
              <MultiSelectFilter
                options={supervisors}
                selectedIds={filters.supervisor_ids}
                onChange={(ids) => setFilters({ ...filters, supervisor_ids: ids })}
                placeholder="Todos"
                includeEmpty
                emptyLabel="Sem Supervisor"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Rede</label>
              <MultiSelectFilter
                options={redes}
                selectedIds={filters.rede_ids}
                onChange={(ids) => setFilters({ ...filters, rede_ids: ids })}
                placeholder="Todas"
                includeEmpty
                emptyLabel="Sem Rede"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Segmento</label>
              <MultiSelectFilter
                options={segmentos}
                selectedIds={filters.segmento_ids}
                onChange={(ids) => setFilters({ ...filters, segmento_ids: ids })}
                placeholder="Todos"
                includeEmpty
                emptyLabel="Sem Segmento"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Plano de Pagamento</label>
              <MultiSelectFilter
                options={planosPagamento}
                selectedIds={filters.plano_pagamento_ids}
                onChange={(ids) => setFilters({ ...filters, plano_pagamento_ids: ids })}
                placeholder="Todos"
                includeEmpty
                emptyLabel="Sem Plano"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Modalidade de Cobrança</label>
              <MultiSelectFilter
                options={modalidadesPagamento}
                selectedIds={filters.modalidade_pagamento_ids}
                onChange={(ids) => setFilters({ ...filters, modalidade_pagamento_ids: ids })}
                placeholder="Todas"
                includeEmpty
                emptyLabel="Sem Modalidade"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Tabela de Preço</label>
              <MultiSelectFilter
                options={tabelasPreco}
                selectedIds={filters.tabela_preco_ids}
                onChange={(ids) => setFilters({ ...filters, tabela_preco_ids: ids })}
                placeholder="Todas"
                includeEmpty
                emptyLabel="Sem Tabela"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Status</label>
              <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="ativo">Ativos</SelectItem>
                <SelectItem value="inativo">Inativos</SelectItem>
                <SelectItem value="prospecto">Prospectos</SelectItem>
                </SelectContent>
                </Select>
                </div>

                <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">Rota</label>
                <Select value={filters.rota} onValueChange={(v) => setFilters({ ...filters, rota: v })}>
                <SelectTrigger>
                <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="com">Clientes com rota</SelectItem>
                <SelectItem value="sem">Clientes sem rota</SelectItem>
                </SelectContent>
                </Select>
                </div>

                <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">Cidade</label>
              <div className="relative">
                <MapPin className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Buscar cidade..."
                  value={filters.cidade}
                  onChange={(e) => setFilters({ ...filters, cidade: e.target.value })}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Bairro</label>
              <div className="relative">
                <MapPin className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Buscar bairro..."
                  value={filters.bairro}
                  onChange={(e) => setFilters({ ...filters, bairro: e.target.value })}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Busca Geral</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Código, nome, CNPJ, endereço..."
                  value={filters.search}
                  onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-1 flex items-end">
              <div className="flex items-center gap-2 h-9 px-3 border rounded-md bg-white">
                <Checkbox
                  id="semLocalizacao"
                  checked={filters.semLocalizacao}
                  onCheckedChange={(checked) => setFilters({ ...filters, semLocalizacao: checked })}
                />
                <label htmlFor="semLocalizacao" className="text-sm cursor-pointer flex items-center gap-1">
                  <MapPinOff className="w-4 h-4 text-amber-500" />
                  Sem localização
                </label>
              </div>
            </div>

            <div className="space-y-1 flex items-end">
              <div className="flex items-center gap-2 h-9 px-3 border rounded-md bg-white">
                <Checkbox
                  id="semNomeFantasia"
                  checked={filters.semNomeFantasia}
                  onCheckedChange={(checked) => setFilters({ ...filters, semNomeFantasia: checked })}
                />
                <label htmlFor="semNomeFantasia" className="text-sm cursor-pointer flex items-center gap-1">
                  <Filter className="w-4 h-4 text-red-500" />
                  Sem nome fantasia
                </label>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Inscrição Estadual</label>
              <Select
                value={filters.inscricaoEstadual === null ? 'all' : filters.inscricaoEstadual ? 'com' : 'sem'}
                onValueChange={(val) => setFilters({ ...filters, inscricaoEstadual: val === 'all' ? null : val === 'com' })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="com">Com IE informada</SelectItem>
                  <SelectItem value="sem">Sem IE informada</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Tipo de Nota</label>
              <Select
                value={filters.tipoNota}
                onValueChange={(val) => setFilters({ ...filters, tipoNota: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="55">55 — NF-e (Omie)</SelectItem>
                  <SelectItem value="D1">D1 — Sem NF (interno)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4 flex justify-stretch sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setFilters({
                vendedor_ids: [],
                supervisor_ids: [],
                rede_ids: [],
                segmento_ids: [],
                plano_pagamento_ids: [],
                modalidade_pagamento_ids: [],
                tabela_preco_ids: [],
                status: 'all',
                rota: 'all',
                cidade: '',
                bairro: '',
                search: '',
                semLocalizacao: false,
                semNomeFantasia: false,
                inscricaoEstadual: null,
                tipoNota: 'all',
              })}
              className="w-full sm:w-auto text-slate-600 hover:text-slate-900"
            >
              Limpar Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-w-0">
          <div className="p-3 sm:p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
            <h3 className="font-semibold text-slate-700 flex items-center gap-2 text-base sm:text-lg">
              <List className="w-4 h-4" />
              Resultados ({filteredClientes.length})
            </h3>
            {onExport && (
              <Button
                onClick={() => onExport(filteredClientes)}
                variant="outline"
                size="sm"
                className="w-full sm:w-auto border-green-200 text-green-700 hover:bg-green-50"
              >
                <Download className="w-4 h-4 mr-2" />
                Exportar ({filteredClientes.length})
              </Button>
            )}
          </div>
          <div className="p-0 min-w-0">
            <DataTable
              data={filteredClientes}
              columns={columns}
              searchable={false}
              pageSize={1000}
              emptyMessage="Nenhum cliente encontrado com os filtros selecionados."
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </div>
        </div>

        <div className="xl:sticky xl:top-4">
          <Card className="bg-white shadow-sm border-slate-200 overflow-hidden">
            <CardHeader className="pb-3 px-4 sm:px-5 pt-4 sm:pt-5 border-b border-slate-100">
              <CardTitle className="text-base font-semibold flex items-center justify-between gap-3">
                <span>Visualização do cliente</span>
                {selectedCliente && (
                  <Badge className={selectedCliente.status === 'ativo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
                    {selectedCliente.status}
                  </Badge>
                )}
              </CardTitle>
              {selectedCliente && (
                <div className="flex gap-2 pt-2">
                  {onEdit && (
                    <Button className="flex-1" variant="outline" size="sm" onClick={() => onEdit(selectedCliente)}>
                      <Pencil className="w-4 h-4 mr-1" />
                      Editar
                    </Button>
                  )}
                  {onDelete && (
                    <Button className="flex-1" variant="outline" size="sm" onClick={() => onDelete(selectedCliente)}>
                      <Trash2 className="w-4 h-4 mr-1" />
                      Excluir
                    </Button>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent className="p-4 sm:p-5 space-y-4">
              {selectedCliente ? (
                <>
                  <div className="space-y-1">
                    <h4 className="font-semibold text-slate-900 break-words">{selectedCliente.nome_fantasia || selectedCliente.razao_social}</h4>
                    <p className="text-sm text-slate-500 break-words">{selectedCliente.razao_social || '-'}</p>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    {previewFields.map((field) => (
                      <div key={field.label} className="rounded-lg border border-slate-200 p-3 bg-slate-50/60">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{field.label}</p>
                        <p className="text-sm text-slate-800 break-words">{field.value}</p>
                      </div>
                    ))}
                  </div>


                </>
              ) : (
                <p className="text-sm text-slate-500">Nenhum cliente disponível para visualização.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}