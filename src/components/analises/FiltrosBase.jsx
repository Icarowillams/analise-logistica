import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Filter, RefreshCw, Download } from 'lucide-react';

export default function FiltrosBase({ filtros, setFiltros, vendedores = [], children, onLimpar, onExportar }) {
  const atualizar = (chave, valor) => setFiltros({ ...filtros, [chave]: valor });
  return (
    <Card className="border-slate-200">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-700"><Filter className="w-4 h-4" />Filtros</h3>
          <div className="flex gap-2">
            {onExportar && <Button variant="outline" size="sm" onClick={onExportar}><Download className="w-4 h-4" />Exportar</Button>}
            {onLimpar && <Button variant="ghost" size="sm" onClick={onLimpar}><RefreshCw className="w-4 h-4" />Limpar</Button>}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          <div>
            <Label className="text-xs">Início</Label>
            <Input type="date" value={filtros.inicio || ''} onChange={(e) => atualizar('inicio', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Fim</Label>
            <Input type="date" value={filtros.fim || ''} onChange={(e) => atualizar('fim', e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Vendedor</Label>
            <Select value={filtros.vendedor_id || '_todos_'} onValueChange={(v) => atualizar('vendedor_id', v === '_todos_' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_todos_">Todos os vendedores</SelectItem>
                {vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {children}
        </div>
      </CardContent>
    </Card>
  );
}