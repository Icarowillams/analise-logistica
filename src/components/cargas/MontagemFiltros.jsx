import React from 'react';
import { Filter, Search, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const inicial = {
  texto: '',
  tipo: '__all__',
  rota: '__all__',
  cidade: '__all__',
  vendedor: '__all__',
  valorMin: '',
  valorMax: '',
  apenasSelecionados: false
};

export { inicial as filtrosIniciaisMontagem };

export default function MontagemFiltros({ filtros, setFiltros, opcoes, total, filtrados, selecionados }) {
  const update = (campo, valor) => setFiltros(prev => ({ ...prev, [campo]: valor }));
  const limpar = () => setFiltros(inicial);

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-slate-900 text-white flex items-center justify-center">
              <Filter className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Filtros operacionais</h2>
              <p className="text-xs text-slate-500">{filtrados} de {total} pedidos exibidos • {selecionados} selecionados</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant={filtros.apenasSelecionados ? 'default' : 'outline'} size="sm" onClick={() => update('apenasSelecionados', !filtros.apenasSelecionados)}>
              Apenas selecionados
            </Button>
            <Button variant="outline" size="sm" onClick={limpar}>
              <X className="w-4 h-4 mr-1" /> Limpar
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-3">
          <div className="relative xl:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              className="pl-9 border-slate-200 bg-slate-50 focus:bg-white"
              placeholder="Cliente, pedido, código, produto..."
              value={filtros.texto}
              onChange={(e) => update('texto', e.target.value)}
            />
          </div>

          <Select value={filtros.tipo} onValueChange={(v) => update('tipo', v)}>
            <SelectTrigger className="border-slate-200 bg-slate-50"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos os tipos</SelectItem>
              <SelectItem value="venda">Venda</SelectItem>
              <SelectItem value="troca">Troca</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filtros.rota} onValueChange={(v) => update('rota', v)}>
            <SelectTrigger className="border-slate-200 bg-slate-50"><SelectValue placeholder="Rota" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas as rotas</SelectItem>
              {opcoes.rotas.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filtros.cidade} onValueChange={(v) => update('cidade', v)}>
            <SelectTrigger className="border-slate-200 bg-slate-50"><SelectValue placeholder="Cidade" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas as cidades</SelectItem>
              {opcoes.cidades.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filtros.vendedor} onValueChange={(v) => update('vendedor', v)}>
            <SelectTrigger className="border-slate-200 bg-slate-50"><SelectValue placeholder="Vendedor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos vendedores</SelectItem>
              {opcoes.vendedores.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>

          <div className="grid grid-cols-2 gap-2">
            <Input className="border-slate-200 bg-slate-50" type="number" min="0" placeholder="R$ mín." value={filtros.valorMin} onChange={(e) => update('valorMin', e.target.value)} />
            <Input className="border-slate-200 bg-slate-50" type="number" min="0" placeholder="R$ máx." value={filtros.valorMax} onChange={(e) => update('valorMax', e.target.value)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}