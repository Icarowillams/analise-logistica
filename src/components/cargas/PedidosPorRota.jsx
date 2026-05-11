import React, { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronDown, ChevronRight, Layers, MousePointer2 } from 'lucide-react';
import { formatCurrency, qtdPacotesPedido } from './montagemUtils';

export default function PedidosPorRota({ pedidos, selecionados, setSelecionados }) {
  const [colapsadas, setColapsadas] = useState(new Set());
  const selSet = useMemo(() => new Set(selecionados), [selecionados]);

  const grupos = useMemo(() => {
    const map = new Map();
    pedidos.forEach(p => {
      const rota = p.rota_nome || 'Sem Rota';
      if (!map.has(rota)) map.set(rota, []);
      map.get(rota).push(p);
    });
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [pedidos]);

  useEffect(() => {
    setColapsadas(new Set(grupos.map(([rota]) => rota)));
  }, [grupos.length]);

  const toggle = (cod) => {
    setSelecionados(prev => prev.includes(cod) ? prev.filter(c => c !== cod) : [...prev, cod]);
  };

  const selecionarTodos = () => {
    const ids = pedidos.map(p => p.codigo_pedido);
    const todosSelecionados = ids.length > 0 && ids.every(id => selSet.has(id));
    setSelecionados(prev => todosSelecionados ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
  };

  const toggleRota = (rotaPedidos) => {
    const ids = rotaPedidos.map(p => p.codigo_pedido);
    const todosSelecionados = ids.every(id => selSet.has(id));
    setSelecionados(prev => todosSelecionados ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
  };

  const toggleColapso = (rota) => {
    setColapsadas(prev => {
      const n = new Set(prev);
      n.has(rota) ? n.delete(rota) : n.add(rota);
      return n;
    });
  };

  const abrirTodas = () => setColapsadas(new Set());
  const fecharTodas = () => setColapsadas(new Set(grupos.map(([rota]) => rota)));

  return (
    <Card className="border-0 bg-white shadow-sm rounded-xl">
      <CardContent className="p-0">
        <div className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Pedidos por rota</h2>
            <p className="text-xs text-slate-500">Abra uma rota e clique nos pedidos para selecionar.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={abrirTodas}>Abrir</Button>
            <Button size="sm" variant="ghost" onClick={fecharTodas}>Fechar</Button>
            <Button size="sm" className="bg-cyan-500 text-white hover:bg-cyan-600" onClick={selecionarTodos} disabled={pedidos.length === 0}>
              {pedidos.length > 0 && pedidos.every(p => selSet.has(p.codigo_pedido)) ? 'Desmarcar filtrados' : 'Selecionar filtrados'}
            </Button>
          </div>
        </div>

        <div className="max-h-[68vh] overflow-auto">
          {grupos.length === 0 ? (
            <div className="py-16 text-center text-slate-500">
              <MousePointer2 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              Nenhum pedido encontrado com os filtros atuais.
            </div>
          ) : grupos.map(([rota, rotaPedidos]) => {
            const colapsada = colapsadas.has(rota);
            const totalRota = rotaPedidos.reduce((s, p) => s + (p.valor_total_pedido || 0), 0);
            const pacotesRota = rotaPedidos.reduce((s, p) => s + qtdPacotesPedido(p), 0);
            const selecRota = rotaPedidos.filter(p => selSet.has(p.codigo_pedido)).length;

            return (
              <div key={rota} className="border-t border-slate-100 first:border-t-0">
                <div className="sticky top-0 z-10 flex items-center gap-3 bg-white px-4 py-3 cursor-pointer hover:bg-cyan-50" onClick={() => toggleColapso(rota)}>
                  <button className="h-8 w-8 rounded-md bg-slate-100 flex items-center justify-center text-slate-600" onClick={(e) => { e.stopPropagation(); toggleColapso(rota); }}>
                    {colapsada ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900 truncate">{rota}</div>
                    <div className="text-xs text-slate-500">
                      {rotaPedidos.length} pedidos • {selecRota} selecionados • {pacotesRota.toLocaleString('pt-BR')} pacotes • {formatCurrency(totalRota)}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="bg-white" onClick={(e) => { e.stopPropagation(); toggleRota(rotaPedidos); }}>
                    {selecRota === rotaPedidos.length ? 'Desmarcar rota' : 'Selecionar rota'}
                  </Button>
                </div>

                {!colapsada && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[820px] text-xs">
                      <thead className="bg-white text-[11px] uppercase tracking-wide text-slate-500">
                        <tr className="border-b border-slate-200">
                          <th className="p-3 w-10"></th>
                          <th className="p-2 text-left w-24">Tipo</th>
                          <th className="p-2 text-left w-20">Pedido</th>
                          <th className="p-2 text-left w-28">Código</th>
                          <th className="p-2 text-left min-w-48">Cliente</th>
                          <th className="p-2 text-left w-24">Cidade</th>
                          <th className="p-2 text-left w-28">Vendedor</th>
                          <th className="p-2 text-right w-14">Itens</th>
                          <th className="p-2 text-right w-16">Pacotes</th>
                          <th className="p-2 text-right w-24">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rotaPedidos.map(p => {
                          const selecionado = selSet.has(p.codigo_pedido);
                          return (
                            <tr key={p.codigo_pedido} onClick={() => toggle(p.codigo_pedido)} className={`border-b border-slate-100 transition-colors cursor-pointer ${selecionado ? 'bg-cyan-50/90' : 'hover:bg-slate-50'}`}>
                              <td className="p-3" onClick={(e) => e.stopPropagation()}>
                                <Checkbox checked={selecionado} onCheckedChange={() => toggle(p.codigo_pedido)} />
                              </td>
                              <td className="p-2">
                                <Badge className={p.tipo === 'troca' ? 'border-orange-200 bg-orange-50 text-orange-700' : p.tipo === 'd1' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-blue-200 bg-blue-50 text-blue-700'}>
                                  {p.tipo === 'troca' ? 'Troca' : p.tipo === 'd1' ? 'D1' : 'Venda'}
                                </Badge>
                              </td>
                              <td className="p-2 font-mono text-xs text-slate-700">{p.numero_pedido || '-'}</td>
                              <td className="p-2 font-mono text-xs text-slate-500">{p.codigo_cliente_cod || '-'}</td>
                              <td className="p-2">
                                <div className="font-medium text-slate-900 truncate" title={p.nome_fantasia || p.nome_cliente || ''}>{p.nome_fantasia || p.nome_cliente || '-'}</div>
                                {p.nome_fantasia && p.nome_cliente && p.nome_fantasia !== p.nome_cliente && <div className="text-xs text-slate-500 truncate" title={p.nome_cliente}>{p.nome_cliente}</div>}
                              </td>
                              <td className="p-2 text-slate-600 truncate">{p.cidade || '-'}</td>
                              <td className="p-2 text-slate-600 truncate">{p.vendedor_nome || '-'}</td>
                              <td className="p-2 text-right text-slate-700">{p.quantidade_itens || 0}</td>
                              <td className="p-2 text-right font-semibold text-slate-900">{qtdPacotesPedido(p).toLocaleString('pt-BR')}</td>
                              <td className="p-2 text-right font-semibold text-slate-900">{formatCurrency(p.valor_total_pedido)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}