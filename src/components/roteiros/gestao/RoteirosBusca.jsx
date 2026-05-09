import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Filter, Eye, Pencil, Trash2, MoreVertical } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { DIAS_SEMANA, STATUS_OPTIONS, formatarDia } from './gestaoUtils';

export default function RoteirosBusca({ roteiros, vendedores, funcoes, onRecarregar, onVisualizar, onEditar }) {
  const [filtroDia, setFiltroDia] = useState('todos');
  const [filtroFuncionario, setFiltroFuncionario] = useState('todos');
  const [filtroFuncao, setFiltroFuncao] = useState('todas');
  const [busca, setBusca] = useState('');

  const filtrados = useMemo(() => {
    return roteiros.filter(r => {
      if (filtroDia !== 'todos' && !(r.dia_semana || '').includes(filtroDia)) return false;
      if (filtroFuncionario !== 'todos' && r.vendedor_id !== filtroFuncionario) return false;
      if (filtroFuncao !== 'todas') {
        const v = vendedores.find(x => x.id === r.vendedor_id);
        if (v?.funcao_id !== filtroFuncao) return false;
      }
      if (busca) {
        const q = busca.toLowerCase();
        const v = vendedores.find(x => x.id === r.vendedor_id);
        if (!(r.vendedor_nome || v?.nome || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [roteiros, vendedores, filtroDia, filtroFuncionario, filtroFuncao, busca]);

  const toggleAtivo = async (r) => {
    const novoStatus = r.status === 'ativo' ? 'pausado' : 'ativo';
    await base44.entities.Roteiro.update(r.id, { status: novoStatus });
    toast.success(`Roteiro ${novoStatus}.`);
    onRecarregar();
  };

  const excluir = async (r) => {
    if (!confirm('Excluir este roteiro?')) return;
    await base44.entities.Roteiro.delete(r.id);
    toast.success('Roteiro excluído.');
    onRecarregar();
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Filter className="w-4 h-4" />Filtros</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-4 gap-3">
          <div><Label className="text-xs">Filtrar por dia</Label>
            <Select value={filtroDia} onValueChange={setFiltroDia}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os dias</SelectItem>
                {DIAS_SEMANA.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Filtrar por funcionário</Label>
            <Select value={filtroFuncionario} onValueChange={setFiltroFuncionario}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="todos">Todos os funcionários</SelectItem>
                {vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Filtrar por função</Label>
            <Select value={filtroFuncao} onValueChange={setFiltroFuncao}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as funções</SelectItem>
                {funcoes.map(f => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Buscar</Label>
            <Input placeholder="Buscar roteiro..." value={busca} onChange={e => setBusca(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Roteiros Encontrados ({filtrados.length})</CardTitle></CardHeader>
        <CardContent className="overflow-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="text-left p-3 font-medium">Dia da Semana</th>
                <th className="text-left p-3 font-medium">Funcionário</th>
                <th className="text-left p-3 font-medium">IDs de Depuração</th>
                <th className="text-left p-3 font-medium">Clientes</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Ativo</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(r => {
                const v = vendedores.find(x => x.id === r.vendedor_id);
                const qtd = r.clientes_ids?.length || r.clientes_detalhes?.length || 0;
                const statusObj = STATUS_OPTIONS.find(s => s.value === r.status) || STATUS_OPTIONS[0];
                return (
                  <tr key={r.id} className="border-b hover:bg-amber-50/50">
                    <td className="p-3">{formatarDia(r.dia_semana)}</td>
                    <td className="p-3 font-medium">{r.vendedor_nome || v?.nome || '-'}</td>
                    <td className="p-3 text-xs text-slate-500">
                      <div>Func ID: {(r.vendedor_id || '').slice(0, 24)}...</div>
                      <div>Roteiro User ID: {r.created_by ? r.created_by.slice(0, 12) : 'N/A'}</div>
                    </td>
                    <td className="p-3"><Badge variant="outline">{qtd} clientes</Badge></td>
                    <td className="p-3"><Badge className={statusObj.cor}>{statusObj.label}</Badge></td>
                    <td className="p-3"><Switch checked={r.status === 'ativo'} onCheckedChange={() => toggleAtivo(r)} /></td>
                    <td className="p-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="w-4 h-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onVisualizar(r)}><Eye className="w-4 h-4 mr-2" />Visualizar</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onEditar(r)}><Pencil className="w-4 h-4 mr-2" />Editar</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => excluir(r)} className="text-red-600"><Trash2 className="w-4 h-4 mr-2" />Excluir</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-500">Nenhum roteiro encontrado.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}