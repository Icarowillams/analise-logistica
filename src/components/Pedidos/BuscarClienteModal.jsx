import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, MapPin } from 'lucide-react';

// Modal compacto de busca de cliente — usa as mesmas dimensões dos filtros do cadastro,
// mas em formato pop-up. Ao selecionar e clicar em "Buscar", retorna o código do cliente.
export default function BuscarClienteModal({ open, onOpenChange, onConfirm }) {
  const [filters, setFilters] = useState({
    vendedor_id: 'all',
    rede_id: 'all',
    segmento_id: 'all',
    rota_id: 'all',
    cidade: '',
    bairro: '',
    search: '',
    status: 'ativo',
  });
  const [selectedId, setSelectedId] = useState(null);

  const { data: clientes = [] } = useQuery({
    queryKey: ['buscar-cliente-modal-clientes'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 5000),
    enabled: open,
  });
  const { data: vendedores = [] } = useQuery({
    queryKey: ['buscar-cliente-modal-vendedores'],
    queryFn: () => base44.entities.Vendedor.list(),
    enabled: open,
  });
  const { data: redes = [] } = useQuery({
    queryKey: ['buscar-cliente-modal-redes'],
    queryFn: () => base44.entities.Rede.list(),
    enabled: open,
  });
  const { data: segmentos = [] } = useQuery({
    queryKey: ['buscar-cliente-modal-segmentos'],
    queryFn: () => base44.entities.Segmento.list(),
    enabled: open,
  });
  const { data: rotas = [] } = useQuery({
    queryKey: ['buscar-cliente-modal-rotas'],
    queryFn: () => base44.entities.Rota.list(),
    enabled: open,
  });

  const getNome = (lista, id) => lista.find(i => i.id === id)?.nome || '-';
  const getCodigo = (c) => c?.codigo_interno || c?.codigo_integracao || c?.codigo || c?.codigo_omie || '';

  const filtrados = useMemo(() => {
    return clientes.filter(c => {
      if (filters.status !== 'all' && c.status !== filters.status) return false;
      if (filters.vendedor_id !== 'all' && c.vendedor_id !== filters.vendedor_id) return false;
      if (filters.rede_id !== 'all' && c.rede_id !== filters.rede_id) return false;
      if (filters.segmento_id !== 'all' && c.segmento_id !== filters.segmento_id) return false;
      if (filters.rota_id !== 'all' && c.rota_id !== filters.rota_id) return false;
      if (filters.cidade && !c.cidade?.toLowerCase().includes(filters.cidade.toLowerCase())) return false;
      if (filters.bairro && !c.bairro?.toLowerCase().includes(filters.bairro.toLowerCase())) return false;
      if (filters.search) {
        const s = filters.search.toLowerCase();
        const match = [getCodigo(c), c.razao_social, c.nome_fantasia, c.cnpj_cpf, c.endereco]
          .some(v => v && String(v).toLowerCase().includes(s));
        if (!match) return false;
      }
      return true;
    }).slice(0, 200);
  }, [clientes, filters]);

  const clienteSelecionado = filtrados.find(c => c.id === selectedId);

  const handleBuscar = () => {
    if (!clienteSelecionado) return;
    const codigo = getCodigo(clienteSelecionado);
    onConfirm(codigo, clienteSelecionado);
    onOpenChange(false);
  };

  const handleClose = (v) => {
    if (!v) setSelectedId(null);
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 py-3 border-b shrink-0">
          <DialogTitle className="text-base flex items-center gap-2">
            <Search className="w-4 h-4 text-amber-500" />
            Busca Detalhada de Cliente
          </DialogTitle>
        </DialogHeader>

        {/* Filtros */}
        <div className="p-3 border-b bg-slate-50 grid grid-cols-2 md:grid-cols-4 gap-2 shrink-0">
          <div>
            <label className="text-[10px] text-slate-600">Vendedor</label>
            <Select value={filters.vendedor_id} onValueChange={(v) => setFilters({ ...filters, vendedor_id: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {vendedores.filter(v => v.status === 'ativo').map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-slate-600">Rede</label>
            <Select value={filters.rede_id} onValueChange={(v) => setFilters({ ...filters, rede_id: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {redes.filter(r => r.status === 'ativo').map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-slate-600">Segmento</label>
            <Select value={filters.segmento_id} onValueChange={(v) => setFilters({ ...filters, segmento_id: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {segmentos.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-slate-600">Rota</label>
            <Select value={filters.rota_id} onValueChange={(v) => setFilters({ ...filters, rota_id: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {rotas.filter(r => r.status !== 'inativo').map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-slate-600">Cidade</label>
            <div className="relative">
              <MapPin className="absolute left-2 top-2 w-3 h-3 text-slate-400" />
              <Input value={filters.cidade} onChange={(e) => setFilters({ ...filters, cidade: e.target.value })} className="h-8 text-xs pl-7" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-slate-600">Bairro</label>
            <Input value={filters.bairro} onChange={(e) => setFilters({ ...filters, bairro: e.target.value })} className="h-8 text-xs" />
          </div>
          <div>
            <label className="text-[10px] text-slate-600">Status</label>
            <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="ativo">Ativos</SelectItem>
                <SelectItem value="inativo">Inativos</SelectItem>
                <SelectItem value="prospecto">Prospectos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-slate-600">Busca geral</label>
            <div className="relative">
              <Search className="absolute left-2 top-2 w-3 h-3 text-slate-400" />
              <Input
                placeholder="Código, nome, CNPJ..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="h-8 text-xs pl-7"
              />
            </div>
          </div>
        </div>

        {/* Tabela */}
        <div className="flex-1 overflow-auto min-h-0">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 sticky top-0">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium w-20">Código</th>
                <th className="px-2 py-1.5 text-left font-medium">Razão Social / Fantasia</th>
                <th className="px-2 py-1.5 text-left font-medium">CNPJ/CPF</th>
                <th className="px-2 py-1.5 text-left font-medium">Cidade</th>
                <th className="px-2 py-1.5 text-left font-medium">Vendedor</th>
                <th className="px-2 py-1.5 text-left font-medium">Rota</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-slate-400">Nenhum cliente encontrado</td></tr>
              ) : (
                filtrados.map(c => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    onDoubleClick={() => { setSelectedId(c.id); setTimeout(handleBuscar, 0); }}
                    className={`border-t cursor-pointer hover:bg-amber-50 ${selectedId === c.id ? 'bg-amber-100' : ''}`}
                  >
                    <td className="px-2 py-1 font-mono">{getCodigo(c)}</td>
                    <td className="px-2 py-1">
                      <div className="font-medium">{c.nome_fantasia || c.razao_social}</div>
                      {c.nome_fantasia && c.razao_social && (
                        <div className="text-[10px] text-slate-500">{c.razao_social}</div>
                      )}
                    </td>
                    <td className="px-2 py-1">{c.cnpj_cpf || '-'}</td>
                    <td className="px-2 py-1">{c.cidade || '-'}</td>
                    <td className="px-2 py-1">{getNome(vendedores, c.vendedor_id)}</td>
                    <td className="px-2 py-1">{getNome(rotas, c.rota_id)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <DialogFooter className="px-4 py-3 border-t bg-slate-50 shrink-0">
          <div className="flex-1 text-xs text-slate-600">
            {clienteSelecionado ? (
              <span><strong>Selecionado:</strong> {getCodigo(clienteSelecionado)} — {clienteSelecionado.nome_fantasia || clienteSelecionado.razao_social}</span>
            ) : (
              <span>{filtrados.length} cliente(s) encontrado(s) — clique numa linha para selecionar</span>
            )}
          </div>
          <Button variant="outline" onClick={() => handleClose(false)}>Cancelar</Button>
          <Button
            className="bg-amber-500 hover:bg-amber-600 text-white"
            disabled={!clienteSelecionado}
            onClick={handleBuscar}
          >
            <Search className="w-3 h-3 mr-1" />
            Buscar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}