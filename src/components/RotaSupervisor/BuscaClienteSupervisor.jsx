import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, X } from 'lucide-react';

export default function BuscaClienteSupervisor({ onSelectCliente, clientesJaAdicionados = [] }) {
  const [filtros, setFiltros] = useState({
    busca: '',
    cidade: '',
    segmento_id: '',
    rede_id: ''
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: segmentos = [] } = useQuery({
    queryKey: ['segmentos'],
    queryFn: () => base44.entities.Segmento.list()
  });

  const { data: redes = [] } = useQuery({
    queryKey: ['redes'],
    queryFn: () => base44.entities.Rede.list()
  });

  const cidades = [...new Set(clientes.map(c => c.cidade).filter(Boolean))].sort();

  const clientesFiltrados = clientes.filter(c => {
    if (clientesJaAdicionados.includes(c.id)) return false;

    if (filtros.busca) {
      const busca = filtros.busca.toLowerCase();
      const match = c.razao_social?.toLowerCase().includes(busca) ||
        c.nome_fantasia?.toLowerCase().includes(busca) ||
        c.codigo?.toLowerCase().includes(busca) ||
        c.cpf_cnpj?.toLowerCase().includes(busca);
      if (!match) return false;
    }
    if (filtros.cidade && c.cidade !== filtros.cidade) return false;
    if (filtros.segmento_id && c.segmento_id !== filtros.segmento_id) return false;
    if (filtros.rede_id && c.rede_id !== filtros.rede_id) return false;
    return true;
  });

  const limparFiltros = () => setFiltros({ busca: '', cidade: '', segmento_id: '', rede_id: '' });
  const temFiltro = Object.values(filtros).some(v => v);

  return (
    <div className="border rounded-lg p-4 bg-slate-50 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm flex items-center gap-2">
          <Search className="w-4 h-4" /> Buscar Cliente
        </h4>
        {temFiltro && (
          <Button variant="ghost" size="sm" onClick={limparFiltros}>
            <X className="w-3 h-3 mr-1" /> Limpar
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Busca Geral (Nome, CNPJ, Código)</Label>
          <Input
            placeholder="Digite para buscar..."
            value={filtros.busca}
            onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })}
            className="h-9"
          />
        </div>
        <div>
          <Label className="text-xs">Cidade</Label>
          <Select value={filtros.cidade} onValueChange={(v) => setFiltros({ ...filtros, cidade: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>Todas</SelectItem>
              {cidades.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Segmento</Label>
          <Select value={filtros.segmento_id} onValueChange={(v) => setFiltros({ ...filtros, segmento_id: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>Todos</SelectItem>
              {segmentos.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Rede / Bandeira</Label>
          <Select value={filtros.rede_id} onValueChange={(v) => setFiltros({ ...filtros, rede_id: v })}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={null}>Todas</SelectItem>
              {redes.map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-h-60 overflow-y-auto border-t pt-2 space-y-1">
        {!temFiltro ? (
          <p className="text-sm text-slate-500 text-center py-4">Use os filtros para buscar clientes</p>
        ) : clientesFiltrados.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">Nenhum cliente encontrado</p>
        ) : (
          <>
            <p className="text-xs text-slate-500 mb-1">{clientesFiltrados.length} encontrado(s) — mostrando até 50</p>
            {clientesFiltrados.slice(0, 50).map(c => (
              <div
                key={c.id}
                className="flex items-center justify-between p-2 hover:bg-white rounded cursor-pointer border border-transparent hover:border-amber-200"
                onClick={() => onSelectCliente(c)}
              >
                <div>
                  <p className="text-sm font-medium">{c.codigo} - {c.nome_fantasia || c.razao_social}</p>
                  <p className="text-xs text-slate-500">{c.cidade} {c.cpf_cnpj ? `• ${c.cpf_cnpj}` : ''}</p>
                </div>
                <Button size="sm" variant="outline" className="text-xs h-7">Selecionar</Button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}