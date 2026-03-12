import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { XCircle, ShoppingCart, ChevronDown, ChevronUp, X, AlertTriangle } from 'lucide-react';

export default function RankingMotivos({ visitasRoteiroFiltradas, visitasFiltradas, vendedoresMap, visitaPedidoMap }) {
  const [selectedFuncionario, setSelectedFuncionario] = useState(null);
  const [sortNaoVisita, setSortNaoVisita] = useState({ field: 'total', dir: 'desc' });
  const [sortNaoPedido, setSortNaoPedido] = useState({ field: 'total', dir: 'desc' });

  // Ranking Não Visitas (status nao_atendido)
  const rankingNaoVisitas = useMemo(() => {
    const map = {};
    visitasRoteiroFiltradas.forEach(v => {
      if (v.status !== 'nao_atendido') return;
      const vid = v.vendedor_id;
      if (!map[vid]) map[vid] = { vendedorId: vid, nome: vendedoresMap[vid]?.nome || v.vendedor_nome || 'Sem Nome', total: 0 };
      map[vid].total++;
    });
    const arr = Object.values(map);
    const totalGeral = arr.reduce((s, i) => s + i.total, 0);
    arr.forEach(i => { i.percentual = totalGeral > 0 ? parseFloat(((i.total / totalGeral) * 100).toFixed(1)) : 0; });
    const { field, dir } = sortNaoVisita;
    arr.sort((a, b) => dir === 'desc' ? b[field] - a[field] : a[field] - b[field]);
    return { items: arr, totalGeral };
  }, [visitasRoteiroFiltradas, vendedoresMap, sortNaoVisita]);

  // Ranking Não Pedidos (pedido_solicitado === false em visitas atendidas)
  const rankingNaoPedidos = useMemo(() => {
    const map = {};
    visitasRoteiroFiltradas.forEach(v => {
      if (v.status !== 'concluida' && v.status !== 'checkin_realizado' && v.status !== 'em_andamento') return;
      const pedido = v.pedido_solicitado != null
        ? v.pedido_solicitado
        : visitaPedidoMap[`${v.vendedor_id}_${v.cliente_id}_${v.data_visita}`];
      if (pedido !== false) return;
      const vid = v.vendedor_id;
      if (!map[vid]) map[vid] = { vendedorId: vid, nome: vendedoresMap[vid]?.nome || v.vendedor_nome || 'Sem Nome', total: 0 };
      map[vid].total++;
    });
    const arr = Object.values(map);
    const totalGeral = arr.reduce((s, i) => s + i.total, 0);
    arr.forEach(i => { i.percentual = totalGeral > 0 ? parseFloat(((i.total / totalGeral) * 100).toFixed(1)) : 0; });
    const { field, dir } = sortNaoPedido;
    arr.sort((a, b) => dir === 'desc' ? b[field] - a[field] : a[field] - b[field]);
    return { items: arr, totalGeral };
  }, [visitasRoteiroFiltradas, vendedoresMap, visitaPedidoMap, sortNaoPedido]);

  // Detalhamento por funcionário selecionado
  const detalheFuncionario = useMemo(() => {
    if (!selectedFuncionario) return null;
    const vid = selectedFuncionario;

    // Motivos de não visita
    const motivosNaoVisita = {};
    visitasRoteiroFiltradas.forEach(v => {
      if (v.vendedor_id !== vid || v.status !== 'nao_atendido') return;
      const motivo = v.motivo_nao_atendimento || 'Sem motivo informado';
      if (!motivosNaoVisita[motivo]) motivosNaoVisita[motivo] = 0;
      motivosNaoVisita[motivo]++;
    });
    const totalNaoVisita = Object.values(motivosNaoVisita).reduce((s, v) => s + v, 0);
    const listaNaoVisita = Object.entries(motivosNaoVisita)
      .map(([motivo, qtd]) => ({ motivo, qtd, pct: totalNaoVisita > 0 ? parseFloat(((qtd / totalNaoVisita) * 100).toFixed(1)) : 0 }))
      .sort((a, b) => b.qtd - a.qtd);

    // Motivos de não pedido
    const motivosNaoPedido = {};
    visitasRoteiroFiltradas.forEach(v => {
      if (v.vendedor_id !== vid) return;
      if (v.status !== 'concluida' && v.status !== 'checkin_realizado' && v.status !== 'em_andamento') return;
      const pedido = v.pedido_solicitado != null
        ? v.pedido_solicitado
        : visitaPedidoMap[`${v.vendedor_id}_${v.cliente_id}_${v.data_visita}`];
      if (pedido !== false) return;
      // Buscar motivo do VisitaRoteiro ou da Visita
      let motivo = v.motivo_nao_pedido;
      if (!motivo) {
        const visitaKey = `${v.vendedor_id}_${v.cliente_id}_${v.data_visita}`;
        const visitaEntidade = visitasFiltradas.find(vi =>
          `${vi.vendedor_id}_${vi.cliente_id}_${vi.data_visita}` === visitaKey
        );
        motivo = visitaEntidade?.motivo_nao_solicitacao_descricao;
      }
      motivo = motivo || 'Sem motivo informado';
      if (!motivosNaoPedido[motivo]) motivosNaoPedido[motivo] = 0;
      motivosNaoPedido[motivo]++;
    });
    const totalNaoPedido = Object.values(motivosNaoPedido).reduce((s, v) => s + v, 0);
    const listaNaoPedido = Object.entries(motivosNaoPedido)
      .map(([motivo, qtd]) => ({ motivo, qtd, pct: totalNaoPedido > 0 ? parseFloat(((qtd / totalNaoPedido) * 100).toFixed(1)) : 0 }))
      .sort((a, b) => b.qtd - a.qtd);

    return {
      nome: vendedoresMap[vid]?.nome || 'Sem Nome',
      naoVisita: { items: listaNaoVisita, total: totalNaoVisita },
      naoPedido: { items: listaNaoPedido, total: totalNaoPedido }
    };
  }, [selectedFuncionario, visitasRoteiroFiltradas, visitasFiltradas, vendedoresMap, visitaPedidoMap]);

  const toggleSort = (type, field) => {
    const setter = type === 'naoVisita' ? setSortNaoVisita : setSortNaoPedido;
    setter(prev => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc'
    }));
  };

  const SortIcon = ({ type, field }) => {
    const s = type === 'naoVisita' ? sortNaoVisita : sortNaoPedido;
    if (s.field !== field) return <ChevronDown className="w-3 h-3 opacity-30" />;
    return s.dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />;
  };

  const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <CardTitle className="text-lg">Análise de Motivos — Não Visitas e Não Pedidos</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs defaultValue="naoVisitas">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="naoVisitas" className="gap-1.5">
              <XCircle className="w-4 h-4" /> Não Visitas ({rankingNaoVisitas.totalGeral})
            </TabsTrigger>
            <TabsTrigger value="naoPedidos" className="gap-1.5">
              <ShoppingCart className="w-4 h-4" /> Não Pedidos ({rankingNaoPedidos.totalGeral})
            </TabsTrigger>
          </TabsList>

          {/* Aba Não Visitas */}
          <TabsContent value="naoVisitas">
            <RankingTable
              items={rankingNaoVisitas.items}
              type="naoVisita"
              selected={selectedFuncionario}
              onSelect={setSelectedFuncionario}
              onSort={(f) => toggleSort('naoVisita', f)}
              SortIcon={SortIcon}
            />
          </TabsContent>

          {/* Aba Não Pedidos */}
          <TabsContent value="naoPedidos">
            <RankingTable
              items={rankingNaoPedidos.items}
              type="naoPedido"
              selected={selectedFuncionario}
              onSelect={setSelectedFuncionario}
              onSort={(f) => toggleSort('naoPedido', f)}
              SortIcon={SortIcon}
            />
          </TabsContent>
        </Tabs>

        {/* Detalhe do funcionário selecionado */}
        {detalheFuncionario && (
          <DetalheMotivos
            detalhe={detalheFuncionario}
            onClose={() => setSelectedFuncionario(null)}
            colors={COLORS}
          />
        )}
      </CardContent>
    </Card>
  );
}

function RankingTable({ items, type, selected, onSelect, onSort, SortIcon }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500 text-center py-6">Nenhum registro encontrado no período.</p>;
  }

  return (
    <div className="overflow-x-auto max-h-80 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead className="font-semibold w-10">#</TableHead>
            <TableHead className="font-semibold">Funcionário</TableHead>
            <TableHead
              className="font-semibold text-center cursor-pointer select-none"
              onClick={() => onSort('total')}
            >
              <span className="inline-flex items-center gap-1">Total <SortIcon type={type} field="total" /></span>
            </TableHead>
            <TableHead
              className="font-semibold text-center cursor-pointer select-none"
              onClick={() => onSort('percentual')}
            >
              <span className="inline-flex items-center gap-1">% Equipe <SortIcon type={type} field="percentual" /></span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, idx) => (
            <TableRow
              key={item.vendedorId}
              className={`cursor-pointer transition-colors ${selected === item.vendedorId ? 'bg-indigo-50 border-l-2 border-indigo-500' : 'hover:bg-slate-50'}`}
              onClick={() => onSelect(selected === item.vendedorId ? null : item.vendedorId)}
            >
              <TableCell>
                <Badge variant="outline" className="text-xs">{idx + 1}</Badge>
              </TableCell>
              <TableCell className="font-medium">{item.nome}</TableCell>
              <TableCell className="text-center">
                <span className="font-semibold text-red-600">{item.total}</span>
              </TableCell>
              <TableCell className="text-center">
                <Badge className="bg-slate-100 text-slate-700 text-xs">{item.percentual}%</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DetalheMotivos({ detalhe, onClose, colors }) {
  return (
    <Card className="border border-indigo-200 bg-indigo-50/30">
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base text-indigo-800">
            Detalhamento — {detalhe.nome}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Motivos Não Visita */}
          <MotivoSection
            titulo="Motivos de Não Visita"
            icon={<XCircle className="w-4 h-4 text-red-600" />}
            items={detalhe.naoVisita.items}
            total={detalhe.naoVisita.total}
            colors={colors}
            corBarra="#ef4444"
          />
          {/* Motivos Não Pedido */}
          <MotivoSection
            titulo="Motivos de Não Pedido"
            icon={<ShoppingCart className="w-4 h-4 text-orange-600" />}
            items={detalhe.naoPedido.items}
            total={detalhe.naoPedido.total}
            colors={colors}
            corBarra="#f97316"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MotivoSection({ titulo, icon, items, total, colors, corBarra }) {
  if (total === 0) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-2 font-semibold text-sm">{icon} {titulo}</div>
        <p className="text-sm text-slate-400 italic">Nenhum registro neste período.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 font-semibold text-sm">
        {icon} {titulo}
        <Badge variant="outline" className="text-xs ml-auto">{total} total</Badge>
      </div>

      {/* Gráfico de barras horizontais */}
      <ResponsiveContainer width="100%" height={Math.max(items.length * 36, 80)}>
        <BarChart data={items} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" fontSize={10} />
          <YAxis type="category" dataKey="motivo" width={130} fontSize={10} tick={{ fill: '#475569' }} />
          <Tooltip
            formatter={(val, name, props) => [`${val} (${props.payload.pct}%)`, 'Quantidade']}
          />
          <Bar dataKey="qtd" radius={[0, 4, 4, 0]} maxBarSize={24}>
            {items.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Tabela */}
      <div className="mt-2 overflow-x-auto max-h-48 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-white/60">
              <TableHead className="text-xs font-semibold">Motivo</TableHead>
              <TableHead className="text-xs font-semibold text-center">Qtd</TableHead>
              <TableHead className="text-xs font-semibold text-center">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((m, i) => (
              <TableRow key={i} className="hover:bg-white/50">
                <TableCell className="text-xs">{m.motivo}</TableCell>
                <TableCell className="text-xs text-center font-medium">{m.qtd}</TableCell>
                <TableCell className="text-xs text-center">
                  <Badge className="bg-slate-100 text-slate-600 text-[10px]">{m.pct}%</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}