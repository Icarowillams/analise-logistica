import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, X, Loader2 } from 'lucide-react';
import useBuscaClientes from '@/components/hooks/useBuscaClientes';

export default function BuscaClienteSupervisor({ onSelectCliente, clientesJaAdicionados = [] }) {
  const [filtros, setFiltros] = useState({ busca: '', cidade: '', segmento_id: '', rede_id: '' });

  // Busca SERVER-SIDE — nada carrega antes de digitar (a base inteira não é mais baixada).
  const { clientes, isFetching, termoAtivo } = useBuscaClientes(filtros.busca, { minChars: 2, limite: 50 });
  const { data: segmentos = [] } = useQuery({ queryKey: ['segmentos'], queryFn: () => base44.entities.Segmento.list(), staleTime: 5 * 60 * 1000 });
  const { data: redes = [] } = useQuery({ queryKey: ['redes'], queryFn: () => base44.entities.Rede.list(), staleTime: 5 * 60 * 1000 });

  const clientesFiltrados = clientes.filter(c => {
    if (clientesJaAdicionados.includes(c.id)) return false;
    if (filtros.cidade && c.cidade !== filtros.cidade) return false;
    if (filtros.segmento_id && c.segmento_id !== filtros.segmento_id) return false;
    if (filtros.rede_id && c.rede_id !== filtros.rede_id) return false;
    return true;
  });

  const cidades = [...new Set(clientes.map(c => c.cidade).filter(Boolean))].sort();

  const limparFiltros = () => setFiltros({ busca: '', cidade: '', segmento_id: '', rede_id: '' });
  const temFiltro = Object.values(filtros).some(v => v);

  return (
    <div className="border rounded-lg p-4 bg-slate-50 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm flex items-center gap-2"><Search className="w-4 h-4" />Buscar Cliente</h4>
        {temFiltro && <Button variant="ghost" size="sm" onClick={limparFiltros}><X className="w-3 h-3 mr-1" />Limpar</Button>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input placeholder="Buscar (Nome, CNPJ, Código)..." value={filtros.busca} onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })} className="h-9" />
        <Select value={filtros.cidade || '_t_'} onValueChange={(v) => setFiltros({ ...filtros, cidade: v === '_t_' ? '' : v })}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Cidade" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_t_">Todas</SelectItem>
            {cidades.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtros.segmento_id || '_t_'} onValueChange={(v) => setFiltros({ ...filtros, segmento_id: v === '_t_' ? '' : v })}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Segmento" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_t_">Todos</SelectItem>
            {segmentos.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtros.rede_id || '_t_'} onValueChange={(v) => setFiltros({ ...filtros, rede_id: v === '_t_' ? '' : v })}>
          <SelectTrigger className="h-9"><SelectValue placeholder="Rede" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="_t_">Todas</SelectItem>
            {redes.map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="max-h-60 overflow-y-auto border-t pt-2 space-y-1">
        {!termoAtivo ? (
          <p className="text-sm text-slate-500 text-center py-4">Digite ao menos 2 letras para buscar</p>
        ) : isFetching ? (
          <p className="text-sm text-slate-500 text-center py-4"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Buscando...</p>
        ) : clientesFiltrados.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">Nenhum cliente</p>
        ) : (
          clientesFiltrados.map(c => (
            <div key={c.id} className="flex items-center justify-between p-2 hover:bg-white rounded cursor-pointer" onClick={() => onSelectCliente(c)}>
              <div>
                <p className="text-sm font-medium">{c.codigo_interno} - {c.nome_fantasia || c.razao_social}</p>
                <p className="text-xs text-slate-500">{c.cidade}</p>
              </div>
              <Button size="sm" variant="outline" className="text-xs h-7">Selecionar</Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}