import React from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
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
    <div className="bg-white rounded-xl shadow-sm p-3 space-y-3">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1 max-w-2xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            className="h-10 pl-9 border-0 bg-slate-100 focus-visible:ring-1 focus-visible:ring-slate-300"
            placeholder="Busque cliente, pedido, cidade, rota ou produto"
            value={filtros.texto}
            onChange={(e) => update('texto', e.target.value)}
          />
        </div>
        <div className="text-xs text-slate-500 whitespace-nowrap">
          {filtrados}/{total} exibidos · {selecionados} selecionados
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
        <Select value={filtros.tipo} onValueChange={(v) => update('tipo', v)}>
          <SelectTrigger className="border-0 bg-slate-100"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Tipo: todos</SelectItem>
            <SelectItem value="venda">Venda Omie</SelectItem>
            <SelectItem value="d1">D1 Interno</SelectItem>
            <SelectItem value="troca">Troca</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filtros.rota} onValueChange={(v) => update('rota', v)}>
          <SelectTrigger className="border-0 bg-slate-100"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Rota: todas</SelectItem>
            {opcoes.rotas.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filtros.cidade} onValueChange={(v) => update('cidade', v)}>
          <SelectTrigger className="border-0 bg-slate-100"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Cidade: todas</SelectItem>
            {opcoes.cidades.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filtros.vendedor} onValueChange={(v) => update('vendedor', v)}>
          <SelectTrigger className="border-0 bg-slate-100"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Vendedor: todos</SelectItem>
            {opcoes.vendedores.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
          </SelectContent>
        </Select>

        <Input className="border-0 bg-slate-100" type="number" min="0" placeholder="Valor mín." value={filtros.valorMin} onChange={(e) => update('valorMin', e.target.value)} />
        <Input className="border-0 bg-slate-100" type="number" min="0" placeholder="Valor máx." value={filtros.valorMax} onChange={(e) => update('valorMax', e.target.value)} />

        <Button variant={filtros.apenasSelecionados ? 'default' : 'outline'} className="border-0" onClick={() => update('apenasSelecionados', !filtros.apenasSelecionados)}>
          <SlidersHorizontal className="w-4 h-4 mr-1" /> Selecionados
        </Button>
        <Button variant="ghost" onClick={limpar} className="text-slate-500">
          <X className="w-4 h-4 mr-1" /> Limpar
        </Button>
      </div>
    </div>
  );
}