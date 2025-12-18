import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

export default function FiltrosDashboard({ filtros, setFiltros, vendedores, supervisores, segmentos, rotas, redes, produtos, motivos }) {
  const limparFiltros = () => {
    setFiltros({
      vendedor: 'todos',
      supervisor: 'todos',
      dataInicio: '',
      dataFim: '',
      segmento: 'todos',
      rota: 'todos',
      numPedido: '',
      busca: '',
      rede: 'todos',
      produto: 'todos',
      motivo: 'todos'
    });
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-900">Filtros</h3>
        <Button variant="outline" size="sm" onClick={limparFiltros} className="text-slate-600">
          <X className="w-4 h-4 mr-2" />
          Limpar Filtros
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Período */}
        <div>
          <Label className="text-sm font-medium text-slate-700">Data Início</Label>
          <Input
            type="date"
            value={filtros.dataInicio}
            onChange={(e) => setFiltros({ ...filtros, dataInicio: e.target.value })}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-sm font-medium text-slate-700">Data Fim</Label>
          <Input
            type="date"
            value={filtros.dataFim}
            onChange={(e) => setFiltros({ ...filtros, dataFim: e.target.value })}
            className="mt-1"
          />
        </div>

        {/* Vendedor */}
        <div>
          <Label className="text-sm font-medium text-slate-700">Vendedor</Label>
          <Select value={filtros.vendedor} onValueChange={(v) => setFiltros({ ...filtros, vendedor: v })}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="todos">Todos</SelectItem>
              {vendedores.map(v => (
                <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Supervisor */}
        <div>
          <Label className="text-sm font-medium text-slate-700">Supervisor</Label>
          <Select value={filtros.supervisor} onValueChange={(v) => setFiltros({ ...filtros, supervisor: v })}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="todos">Todos</SelectItem>
              {supervisores.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Segmento */}
        <div>
          <Label className="text-sm font-medium text-slate-700">Segmento</Label>
          <Select value={filtros.segmento} onValueChange={(v) => setFiltros({ ...filtros, segmento: v })}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="todos">Todos</SelectItem>
              {segmentos.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Rota */}
        <div>
          <Label className="text-sm font-medium text-slate-700">Rota</Label>
          <Select value={filtros.rota} onValueChange={(v) => setFiltros({ ...filtros, rota: v })}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="todos">Todos</SelectItem>
              {rotas.map(r => (
                <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Rede */}
        <div>
          <Label className="text-sm font-medium text-slate-700">Rede</Label>
          <Select value={filtros.rede} onValueChange={(v) => setFiltros({ ...filtros, rede: v })}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="todos">Todos</SelectItem>
              {redes.map(r => (
                <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Produto */}
        <div>
          <Label className="text-sm font-medium text-slate-700">Produto</Label>
          <Select value={filtros.produto} onValueChange={(v) => setFiltros({ ...filtros, produto: v })}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="todos">Todos</SelectItem>
              {produtos.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Motivo */}
        <div>
          <Label className="text-sm font-medium text-slate-700">Motivo</Label>
          <Select value={filtros.motivo} onValueChange={(v) => setFiltros({ ...filtros, motivo: v })}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              <SelectItem value="todos">Todos</SelectItem>
              {motivos.map(m => (
                <SelectItem key={m.id} value={m.id}>{m.descricao}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Número de Pedido */}
        <div>
          <Label className="text-sm font-medium text-slate-700">Nº Pedido</Label>
          <Input
            type="text"
            placeholder="Digite o número"
            value={filtros.numPedido}
            onChange={(e) => {
              const valor = e.target.value.replace(/\D/g, '');
              setFiltros({ ...filtros, numPedido: valor });
            }}
            className="mt-1"
          />
        </div>

        {/* Busca Geral */}
        <div className="md:col-span-2">
          <Label className="text-sm font-medium text-slate-700">Busca Geral</Label>
          <Input
            type="text"
            placeholder="Buscar em todos os campos..."
            value={filtros.busca}
            onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })}
            className="mt-1"
          />
        </div>
      </div>
    </div>
  );
}