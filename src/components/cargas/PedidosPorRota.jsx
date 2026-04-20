import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';

export default function PedidosPorRota({ pedidos, selecionados, setSelecionados }) {
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroRota, setFiltroRota] = useState('__all__');
  const [colapsadas, setColapsadas] = useState(new Set());

  const rotasUnicas = useMemo(() => {
    const set = new Set(pedidos.map(p => p.rota_nome || 'Sem Rota'));
    return Array.from(set).sort();
  }, [pedidos]);

  const filtrados = useMemo(() => {
    const f = filtroTexto.toLowerCase();
    return pedidos.filter(p => {
      if (filtroRota !== '__all__' && (p.rota_nome || 'Sem Rota') !== filtroRota) return false;
      if (!f) return true;
      return (
        (p.nome_cliente || '').toLowerCase().includes(f) ||
        (p.nome_fantasia || '').toLowerCase().includes(f) ||
        (p.numero_pedido || '').toLowerCase().includes(f) ||
        (p.codigo_cliente_cod || '').toLowerCase().includes(f)
      );
    });
  }, [pedidos, filtroTexto, filtroRota]);

  const grupos = useMemo(() => {
    const map = new Map();
    filtrados.forEach(p => {
      const rota = p.rota_nome || 'Sem Rota';
      if (!map.has(rota)) map.set(rota, []);
      map.get(rota).push(p);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtrados]);

  const selSet = new Set(selecionados);
  const toggle = (cod) => {
    setSelecionados(prev => prev.includes(cod) ? prev.filter(c => c !== cod) : [...prev, cod]);
  };

  const selecionarTodos = () => {
    const todosIds = filtrados.map(p => p.codigo_pedido);
    const todosSelecionados = todosIds.every(id => selSet.has(id));
    if (todosSelecionados) {
      setSelecionados(prev => prev.filter(id => !todosIds.includes(id)));
    } else {
      setSelecionados(prev => [...new Set([...prev, ...todosIds])]);
    }
  };

  const toggleRota = (rotaPedidos) => {
    const ids = rotaPedidos.map(p => p.codigo_pedido);
    const todosSelecionados = ids.every(id => selSet.has(id));
    if (todosSelecionados) {
      setSelecionados(prev => prev.filter(id => !ids.includes(id)));
    } else {
      setSelecionados(prev => [...new Set([...prev, ...ids])]);
    }
  };

  const toggleColapso = (rota) => {
    setColapsadas(prev => {
      const n = new Set(prev);
      if (n.has(rota)) n.delete(rota); else n.add(rota);
      return n;
    });
  };

  const qtdPacotes = (p) => (p.produtos || []).reduce((s, pr) => s + (Number(pr.quantidade) || 0), 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
          <span>{filtrados.length} pedidos | {selecionados.length} selecionados</span>
          <div className="flex gap-2 flex-wrap">
            <Input className="max-w-xs" placeholder="Cliente, pedido, COD..." value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)} />
            <Select value={filtroRota} onValueChange={setFiltroRota}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas as rotas</SelectItem>
                {rotasUnicas.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={selecionarTodos}>Selecionar Todos</Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 max-h-[70vh] overflow-auto">
        {grupos.length === 0 && (
          <div className="py-8 text-center text-slate-500">Nenhum pedido encontrado</div>
        )}
        {grupos.map(([rota, rotaPedidos]) => {
          const colapsada = colapsadas.has(rota);
          const totalRota = rotaPedidos.reduce((s, p) => s + (p.valor_total_pedido || 0), 0);
          const selecRota = rotaPedidos.filter(p => selSet.has(p.codigo_pedido)).length;
          return (
            <div key={rota} className="border-t">
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 sticky top-0 z-10">
                <button onClick={() => toggleColapso(rota)}>
                  {colapsada ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                <div className="flex-1">
                  <div className="font-semibold text-sm">{rota}</div>
                  <div className="text-xs text-slate-500">
                    {rotaPedidos.length} pedidos • {selecRota} selecionados • R$ {totalRota.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => toggleRota(rotaPedidos)}>
                  {selecRota === rotaPedidos.length ? 'Desmarcar Rota' : 'Selecionar Rota'}
                </Button>
              </div>
              {!colapsada && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b">
                      <th className="p-2 w-10"></th>
                      <th className="p-2 text-left">Tipo</th>
                      <th className="p-2 text-left">Pedido</th>
                      <th className="p-2 text-left">COD</th>
                      <th className="p-2 text-left">Cliente</th>
                      <th className="p-2 text-left">Cidade</th>
                      <th className="p-2 text-right">Itens</th>
                      <th className="p-2 text-right">Pacotes</th>
                      <th className="p-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rotaPedidos.map(p => (
                      <tr key={p.codigo_pedido} className={`border-t hover:bg-slate-50 ${selSet.has(p.codigo_pedido) ? 'bg-amber-50' : ''}`}>
                        <td className="p-2"><Checkbox checked={selSet.has(p.codigo_pedido)} onCheckedChange={() => toggle(p.codigo_pedido)} /></td>
                        <td className="p-2">
                          <Badge className={p.tipo === 'troca' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'}>
                            {p.tipo === 'troca' ? 'TROCA' : 'VENDA'}
                          </Badge>
                        </td>
                        <td className="p-2 font-mono text-xs">{p.numero_pedido}</td>
                        <td className="p-2 font-mono text-xs">{p.codigo_cliente_cod || '-'}</td>
                        <td className="p-2">{p.nome_fantasia || p.nome_cliente}</td>
                        <td className="p-2">{p.cidade || '-'}</td>
                        <td className="p-2 text-right">{p.quantidade_itens}</td>
                        <td className="p-2 text-right">{qtdPacotes(p)}</td>
                        <td className="p-2 text-right">R$ {Number(p.valor_total_pedido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}