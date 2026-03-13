import React, { useState, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, ChevronLeft, ChevronRight, ArrowUpDown, Pencil, Trash2, CheckCircle, XCircle, Filter, X } from 'lucide-react';

export default function FuncionariosConsulta({
  funcionarios = [],
  funcoes = [],
  departamentos = [],
  isLoading,
  onEdit,
  onDelete,
  filters,
  setFilters
}) {
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  const potentialSupervisors = useMemo(() => {
    return funcionarios.filter(f =>
      f.funcao?.toLowerCase().includes('supervisor') || f.funcao?.toLowerCase().includes('gerente')
    );
  }, [funcionarios]);

  const getDepartmentName = (id) => {
    if (!id) return '-';
    return departamentos.find(d => d.id === id)?.nome || '-';
  };

  const getSupervisorNames = (item) => {
    const ids = item.supervisor_ids?.length > 0 ? item.supervisor_ids : (item.supervisor_id ? [item.supervisor_id] : []);
    if (ids.length === 0) return '-';
    return ids.map(id => funcionarios.find(f => f.id === id)?.nome || '-').join(', ');
  };

  const filteredData = useMemo(() => {
    let result = funcionarios;

    if (filters.search) {
      const s = filters.search.toLowerCase();
      result = result.filter(item =>
        ['nome', 'email', 'cpf', 'funcao'].some(field =>
          item[field] && String(item[field]).toLowerCase().includes(s)
        )
      );
    }

    if (filters.funcao) {
      result = result.filter(item => item.funcao === filters.funcao);
    }

    if (filters.departamento_id) {
      result = result.filter(item => item.departamento_id === filters.departamento_id);
    }

    if (filters.supervisor_id) {
      result = result.filter(item => {
        const ids = item.supervisor_ids?.length > 0 ? item.supervisor_ids : (item.supervisor_id ? [item.supervisor_id] : []);
        return ids.includes(filters.supervisor_id);
      });
    }

    if (filters.status) {
      result = result.filter(item => item.status === filters.status);
    }

    return result;
  }, [funcionarios, filters]);

  const sortedData = useMemo(() => {
    if (!sortConfig.key) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aVal = a[sortConfig.key] || '';
      const bVal = b[sortConfig.key] || '';
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredData, sortConfig]);

  const totalPages = Math.ceil(sortedData.length / pageSize);
  const paginatedData = sortedData.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const uniqueFuncoes = useMemo(() => {
    const set = new Set(funcionarios.map(f => f.funcao).filter(Boolean));
    return [...set].sort();
  }, [funcionarios]);

  const hasActiveFilters = filters.funcao || filters.departamento_id || filters.supervisor_id || filters.status;

  const clearFilters = () => {
    setFilters({ search: filters.search, funcao: '', departamento_id: '', supervisor_id: '', status: '' });
  };

  return (
    <div className="space-y-4">
      {/* Search + Filters */}
      <div className="flex flex-col gap-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Buscar nome, email, CPF..."
            value={filters.search}
            onChange={(e) => { setFilters({ ...filters, search: e.target.value }); setCurrentPage(1); }}
            className="pl-9 bg-white border-slate-200"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />

          <Select value={filters.funcao || "all"} onValueChange={(v) => { setFilters({ ...filters, funcao: v === 'all' ? '' : v }); setCurrentPage(1); }}>
            <SelectTrigger className="w-[160px] h-8 text-xs bg-white">
              <SelectValue placeholder="Função" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas Funções</SelectItem>
              {uniqueFuncoes.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filters.departamento_id || "all"} onValueChange={(v) => { setFilters({ ...filters, departamento_id: v === 'all' ? '' : v }); setCurrentPage(1); }}>
            <SelectTrigger className="w-[170px] h-8 text-xs bg-white">
              <SelectValue placeholder="Departamento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Departamentos</SelectItem>
              {departamentos.map(d => <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filters.supervisor_id || "all"} onValueChange={(v) => { setFilters({ ...filters, supervisor_id: v === 'all' ? '' : v }); setCurrentPage(1); }}>
            <SelectTrigger className="w-[180px] h-8 text-xs bg-white">
              <SelectValue placeholder="Supervisor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Supervisores</SelectItem>
              {potentialSupervisors.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filters.status || "all"} onValueChange={(v) => { setFilters({ ...filters, status: v === 'all' ? '' : v }); setCurrentPage(1); }}>
            <SelectTrigger className="w-[130px] h-8 text-xs bg-white">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Status</SelectItem>
              <SelectItem value="ativo">Ativo</SelectItem>
              <SelectItem value="inativo">Inativo</SelectItem>
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 px-2 text-xs text-slate-500 hover:text-red-600">
              <X className="w-3.5 h-3.5 mr-1" /> Limpar filtros
            </Button>
          )}

          <span className="text-xs text-slate-400 ml-auto">{sortedData.length} resultado(s)</span>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="font-semibold text-neutral-700">
                  <button onClick={() => handleSort('nome')} className="flex items-center gap-1 hover:text-slate-900">
                    Nome <ArrowUpDown className="w-3.5 h-3.5" />
                  </button>
                </TableHead>
                <TableHead className="font-semibold text-neutral-700">CPF</TableHead>
                <TableHead className="font-semibold text-neutral-700">Email</TableHead>
                <TableHead className="font-semibold text-neutral-700">Função</TableHead>
                <TableHead className="font-semibold text-neutral-700">Departamento</TableHead>
                <TableHead className="font-semibold text-neutral-700">Supervisor(es)</TableHead>
                <TableHead className="font-semibold text-neutral-700">Status</TableHead>
                <TableHead className="w-24 text-right font-semibold text-neutral-700">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-slate-500">Carregando...</TableCell>
                </TableRow>
              ) : paginatedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-slate-500">Nenhum registro encontrado</TableCell>
                </TableRow>
              ) : paginatedData.map((item) => (
                <TableRow key={item.id} className="hover:bg-slate-50/50 transition-colors">
                  <TableCell className="text-neutral-600 font-medium">{item.nome}</TableCell>
                  <TableCell className="text-neutral-600">{item.cpf || '-'}</TableCell>
                  <TableCell className="text-neutral-600">{item.email}</TableCell>
                  <TableCell className="text-neutral-600">{item.funcao || '-'}</TableCell>
                  <TableCell className="text-neutral-600">{getDepartmentName(item.departamento_id)}</TableCell>
                  <TableCell className="text-neutral-600">{getSupervisorNames(item)}</TableCell>
                  <TableCell>
                    <Badge className={item.status === 'ativo'
                      ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                    }>
                      {item.status === 'ativo' ? <CheckCircle className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
                      {item.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {onEdit && (
                        <Button variant="ghost" size="icon" onClick={() => onEdit(item)} className="h-8 w-8 text-neutral-500 hover:text-amber-600 hover:bg-amber-50">
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      {onDelete && (
                        <Button variant="ghost" size="icon" onClick={() => onDelete(item)} className="h-8 w-8 text-slate-500 hover:text-red-600 hover:bg-red-50">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            Mostrando {((currentPage - 1) * pageSize) + 1} a {Math.min(currentPage * pageSize, sortedData.length)} de {sortedData.length}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="h-8 w-8">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-slate-600 min-w-[100px] text-center">Página {currentPage} de {totalPages}</span>
            <Button variant="outline" size="icon" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="h-8 w-8">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}