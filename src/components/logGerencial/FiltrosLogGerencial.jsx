import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, X } from 'lucide-react';
import { TIPOS_ACAO } from './TIPOS_ACAO';

export default function FiltrosLogGerencial({ filtros, setFiltros, onLimpar, usuariosUnicos = [], entidadesUnicas = [] }) {
  return (
    <div className="bg-white p-4 rounded-lg border space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
        <div>
          <Label className="text-xs">Início</Label>
          <Input type="date" value={filtros.inicio} onChange={(e) => setFiltros({ ...filtros, inicio: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Fim</Label>
          <Input type="date" value={filtros.fim} onChange={(e) => setFiltros({ ...filtros, fim: e.target.value })} />
        </div>
        <div>
          <Label className="text-xs">Tipo de ação</Label>
          <Select value={filtros.tipo_acao || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, tipo_acao: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos os tipos</SelectItem>
              {TIPOS_ACAO.map(t => <SelectItem key={t.valor} value={t.valor}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Usuário</Label>
          <Select value={filtros.usuario_email || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, usuario_email: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos</SelectItem>
              {usuariosUnicos.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Entidade</Label>
          <Select value={filtros.entidade_tipo || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, entidade_tipo: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todas</SelectItem>
              {entidadesUnicas.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Busca livre</Label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-2.5 text-slate-400" />
            <Input className="pl-8" placeholder="Texto, nº pedido..." value={filtros.busca} onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })} />
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onLimpar}><X className="w-4 h-4 mr-1" />Limpar filtros</Button>
      </div>
    </div>
  );
}