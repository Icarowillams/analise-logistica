import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { XCircle, ShoppingCart, ChevronDown, ChevronUp, X, AlertTriangle, ListOrdered, Users } from 'lucide-react';

export default function RankingMotivos({ visitasRoteiroFiltradas, visitasFiltradas, vendedoresMap, visitaPedidoMap }) {
  const [selectedFuncionarioNV, setSelectedFuncionarioNV] = useState(null);
  const [selectedFuncionarioNP, setSelectedFuncionarioNP] = useState(null);
  const [selectedMotivoNV, setSelectedMotivoNV] = useState(null);
  const [selectedMotivoNP, setSelectedMotivoNP] = useState(null);
  const [sortNaoVisita, setSortNaoVisita] = useState({ field: 'total', dir: 'desc' });
  const [sortNaoPedido, setSortNaoPedido] = useState({ field: 'total', dir: 'desc' });
  const [sortMotivoNV, setSortMotivoNV] = useState({ field: 'total', dir: 'desc' });
  const [sortMotivoNP, setSortMotivoNP] = useState({ field: 'total', dir: 'desc' });

  // ===== RANKING POR FUNCIONÁRIO =====

  // Ranking Não Visitas por funcionário
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

  // Ranking Não Pedidos por funcionário
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

  // ===== RANKING POR MOTIVO (GERAL) =====

  // Ranking de Motivos de Não Visita (agregado por motivo)
  const rankingMotivosNaoVisita = useMemo(() => {
    const map = {};
    visitasRoteiroFiltradas.forEach(v => {
      if (v.status !== 'nao_atendido') return;
      const motivo = v.motivo_nao_atendimento || 'Sem motivo informado';
      if (!map[motivo]) map[motivo] = { motivo, total: 0 };
      map[motivo].total++;
    });
    const arr = Object.values(map);
    const totalGeral = arr.reduce((s, i) => s + i.total, 0);
    arr.forEach(i => { i.percentual = totalGeral > 0 ? parseFloat(((i.total / totalGeral) * 100).toFixed(1)) : 0; });
    const { field, dir } = sortMotivoNV;
    arr.sort((a, b) => dir === 'desc' ? b[field] - a[field] : a[field] - b[field]);
    return { items: arr, totalGeral };
  }, [visitasRoteiroFiltradas, sortMotivoNV]);

  // Ranking de Motivos de Não Pedido (agregado por motivo)
  const rankingMotivosNaoPedido = useMemo(() => {
    const map = {};
    visitasRoteiroFiltradas.forEach(v => {
      if (v.status !== 'concluida' && v.status !== 'checkin_realizado' && v.status !== 'em_andamento') return;
      const pedido = v.pedido_solicitado != null
        ? v.pedido_solicitado
        : visitaPedidoMap[`${v.vendedor_id}_${v.cliente_id}_${v.data_visita}`];
      if (pedido !== false) return;
      let motivo = v.motivo_nao_pedido;
      if (!motivo) {
        const visitaKey = `${v.vendedor_id}_${v.cliente_id}_${v.data_visita}`;
        const visitaEntidade = visitasFiltradas.find(vi =>
          `${vi.vendedor_id}_${vi.cliente_id}_${vi.data_visita}` === visitaKey
        );
        motivo = visitaEntidade?.motivo_nao_solicitacao_descricao;
      }
      motivo = motivo || 'Sem motivo informado';
      if (!map[motivo]) map[motivo] = { motivo, total: 0 };
      map[motivo].total++;
    });
    const arr = Object.values(map);
    const totalGeral = arr.reduce((s, i) => s + i.total, 0);
    arr.forEach(i => { i.percentual = totalGeral > 0 ? parseFloat(((i.total / totalGeral) * 100).toFixed(1)) : 0; });
    const { field, dir } = sortMotivoNP;
    arr.sort((a, b) => dir === 'desc' ? b[field] - a[field] : a[field] - b[field]);
    return { items: arr, totalGeral };
  }, [visitasRoteiroFiltradas, visitasFiltradas, visitaPedidoMap, sortMotivoNP]);

  // ===== DETALHAMENTO POR FUNCIONÁRIO SELECIONADO =====

  const buildDetalheFuncionario = (vid) => {
    if (!vid) return null;
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

    const motivosNaoPedido = {};
    visitasRoteiroFiltradas.forEach(v => {
      if (v.vendedor_id !== vid) return;
      if (v.status !== 'concluida' && v.status !== 'checkin_realizado' && v.status !== 'em_andamento') return;
      const pedido = v.pedido_solicitado != null
        ? v.pedido_solicitado
        : visitaPedidoMap[`${v.vendedor_id}_${v.cliente_id}_${v.data_visita}`];
      if (pedido !== false) return;
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
  };

  const detalheNV = useMemo(() => buildDetalheFuncionario(selectedFuncionarioNV), [selectedFuncionarioNV, visitasRoteiroFiltradas, visitasFiltradas, vendedoresMap, visitaPedidoMap]);
  const detalheNP = useMemo(() => buildDetalheFuncionario(selectedFuncionarioNP), [selectedFuncionarioNP, visitasRoteiroFiltradas, visitasFiltradas, vendedoresMap, visitaPedidoMap]);

  // ===== DETALHAMENTO POR MOTIVO SELECIONADO (funcionários que usaram esse motivo) =====
  const detalheMotivoNV = useMemo(() => {
    if (!selectedMotivoNV) return null;
    const map = {};
    visitasRoteiroFiltradas.forEach(v => {
      if (v.status !== 'nao_atendido') return;
      const motivo = v.motivo_nao_atendimento || 'Sem motivo informado';
      if (motivo !== selectedMotivoNV) return;
      const vid = v.vendedor_id;
      if (!map[vid]) map[vid] = { nome: vendedoresMap[vid]?.nome || v.vendedor_nome || 'Sem Nome', qtd: 0 };
      map[vid].qtd++;
    });
    const arr = Object.values(map);
    const total = arr.reduce((s, i) => s + i.qtd, 0);
    arr.forEach(i => { i.pct = total > 0 ? parseFloat(((i.qtd / total) * 100).toFixed(1)) : 0; });
    arr.sort((a, b) => b.qtd - a.qtd);
    return { motivo: selectedMotivoNV, items: arr, total };
  }, [selectedMotivoNV, visitasRoteiroFiltradas, vendedoresMap]);

  const detalheMotivoNP = useMemo(() => {
    if (!selectedMotivoNP) return null;
    const map = {};
    visitasRoteiroFiltradas.forEach(v => {
      if (v.status !== 'concluida' && v.status !== 'checkin_realizado' && v.status !== 'em_andamento') return;
      const pedido = v.pedido_solicitado != null
        ? v.pedido_solicitado
        : visitaPedidoMap[`${v.vendedor_id}_${v.cliente_id}_${v.data_visita}`];
      if (pedido !== false) return;
      let motivo = v.motivo_nao_pedido;
      if (!motivo) {
        const visitaKey = `${v.vendedor_id}_${v.cliente_id}_${v.data_visita}`;
        const visitaEntidade = visitasFiltradas.find(vi =>
          `${vi.vendedor_id}_${vi.cliente_id}_${vi.data_visita}` === visitaKey
        );
        motivo = visitaEntidade?.motivo_nao_solicitacao_descricao;
      }
      motivo = motivo || 'Sem motivo informado';
      if (motivo !== selectedMotivoNP) return;
      const vid = v.vendedor_id;
      if (!map[vid]) map[vid] = { nome: vendedoresMap[vid]?.nome || v.vendedor_nome || 'Sem Nome', qtd: 0 };
      map[vid].qtd++;
    });
    const arr = Object.values(map);
    const total = arr.reduce((s, i) => s + i.qtd, 0);
    arr.forEach(i => { i.pct = total > 0 ? parseFloat(((i.qtd / total) * 100).toFixed(1)) : 0; });
    arr.sort((a, b) => b.qtd - a.qtd);
    return { motivo: selectedMotivoNP, items: arr, total };
  }, [selectedMotivoNP, visitasRoteiroFiltradas, visitasFiltradas, vendedoresMap, visitaPedidoMap]);

  const toggleSort = (type, field) => {
    const setters = { naoVisita: setSortNaoVisita, naoPedido: setSortNaoPedido, motivoNV: setSortMotivoNV, motivoNP: setSortMotivoNP };
    setters[type](prev => ({ field, dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc' }));
  };

  const getSortState = (type) => {
    const states = { naoVisita: sortNaoVisita, naoPedido: sortNaoPedido, motivoNV: sortMotivoNV, motivoNP: sortMotivoNP };
    return states[type];
  };

  const SortIcon = ({ type, field }) => {
    const s = getSortState(type);
    if (s.field !== field) return <ChevronDown className="w-3 h-3 opacity-30" />;
    return s.dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />;
  };

  const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

  return (
    <div className="space-y-6">
      {/* ===== SEÇÃO NÃO VISITAS ===== */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <XCircle className="w-5 h-5 text-red-600" />
            <CardTitle className="text-lg">Não Visitas ({rankingNaoVisitas.totalGeral})</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs defaultValue="porFuncionario">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="porFuncionario" className="gap-1.5">
                Por Funcionário
              </TabsTrigger>
              <TabsTrigger value="porMotivo" className="gap-1.5">
                <ListOrdered className="w-4 h-4" /> Por Motivo
              </TabsTrigger>
            </TabsList>

            <TabsContent value="porFuncionario">
              <FuncionarioTable
                items={rankingNaoVisitas.items}
                type="naoVisita"
                selected={selectedFuncionarioNV}
                onSelect={setSelectedFuncionarioNV}
                onSort={(f) => toggleSort('naoVisita', f)}
                SortIcon={SortIcon}
              />
              {detalheNV && (
                <div className="mt-4">
                  <DetalheMotivos
                    detalhe={detalheNV}
                    onClose={() => setSelectedFuncionarioNV(null)}
                    colors={COLORS}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="porMotivo">
              <MotivoTable
                items={rankingMotivosNaoVisita.items}
                type="motivoNV"
                onSort={(f) => toggleSort('motivoNV', f)}
                SortIcon={SortIcon}
                colors={COLORS}
                selected={selectedMotivoNV}
                onSelect={setSelectedMotivoNV}
                detalhe={detalheMotivoNV}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* ===== SEÇÃO NÃO PEDIDOS ===== */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-orange-600" />
            <CardTitle className="text-lg">Não Pedidos ({rankingNaoPedidos.totalGeral})</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs defaultValue="porFuncionario">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="porFuncionario" className="gap-1.5">
                Por Funcionário
              </TabsTrigger>
              <TabsTrigger value="porMotivo" className="gap-1.5">
                <ListOrdered className="w-4 h-4" /> Por Motivo
              </TabsTrigger>
            </TabsList>

            <TabsContent value="porFuncionario">
              <FuncionarioTable
                items={rankingNaoPedidos.items}
                type="naoPedido"
                selected={selectedFuncionarioNP}
                onSelect={setSelectedFuncionarioNP}
                onSort={(f) => toggleSort('naoPedido', f)}
                SortIcon={SortIcon}
              />
              {detalheNP && (
                <div className="mt-4">
                  <DetalheMotivos
                    detalhe={detalheNP}
                    onClose={() => setSelectedFuncionarioNP(null)}
                    colors={COLORS}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="porMotivo">
              <MotivoTable
                items={rankingMotivosNaoPedido.items}
                type="motivoNP"
                onSort={(f) => toggleSort('motivoNP', f)}
                SortIcon={SortIcon}
                colors={COLORS}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

// ===== TABELA POR FUNCIONÁRIO =====
function FuncionarioTable({ items, type, selected, onSelect, onSort, SortIcon }) {
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
            <TableHead className="font-semibold text-center cursor-pointer select-none" onClick={() => onSort('total')}>
              <span className="inline-flex items-center gap-1">Total <SortIcon type={type} field="total" /></span>
            </TableHead>
            <TableHead className="font-semibold text-center cursor-pointer select-none" onClick={() => onSort('percentual')}>
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
              <TableCell><Badge variant="outline" className="text-xs">{idx + 1}</Badge></TableCell>
              <TableCell className="font-medium">{item.nome}</TableCell>
              <TableCell className="text-center"><span className="font-semibold text-red-600">{item.total}</span></TableCell>
              <TableCell className="text-center"><Badge className="bg-slate-100 text-slate-700 text-xs">{item.percentual}%</Badge></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ===== TABELA POR MOTIVO (com gráfico) =====
function MotivoTable({ items, type, onSort, SortIcon, colors }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500 text-center py-6">Nenhum registro encontrado no período.</p>;
  }
  return (
    <div className="space-y-4">
      {/* Gráfico de barras horizontais */}
      <ResponsiveContainer width="100%" height={Math.max(items.length * 40, 100)}>
        <BarChart data={items} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" fontSize={11} />
          <YAxis type="category" dataKey="motivo" width={160} fontSize={11} tick={{ fill: '#475569' }} />
          <Tooltip formatter={(val, name, props) => [`${val} (${props.payload.percentual}%)`, 'Quantidade']} />
          <Bar dataKey="total" radius={[0, 4, 4, 0]} maxBarSize={28}>
            {items.map((_, i) => (
              <Cell key={i} fill={colors[i % colors.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Tabela */}
      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="font-semibold w-10">#</TableHead>
              <TableHead className="font-semibold">Motivo</TableHead>
              <TableHead className="font-semibold text-center cursor-pointer select-none" onClick={() => onSort('total')}>
                <span className="inline-flex items-center gap-1">Total <SortIcon type={type} field="total" /></span>
              </TableHead>
              <TableHead className="font-semibold text-center cursor-pointer select-none" onClick={() => onSort('percentual')}>
                <span className="inline-flex items-center gap-1">% Total <SortIcon type={type} field="percentual" /></span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, idx) => (
              <TableRow key={item.motivo} className="hover:bg-slate-50">
                <TableCell><Badge variant="outline" className="text-xs">{idx + 1}</Badge></TableCell>
                <TableCell className="font-medium text-sm">{item.motivo}</TableCell>
                <TableCell className="text-center"><span className="font-semibold text-red-600">{item.total}</span></TableCell>
                <TableCell className="text-center"><Badge className="bg-slate-100 text-slate-700 text-xs">{item.percentual}%</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ===== DETALHE DO FUNCIONÁRIO =====
function DetalheMotivos({ detalhe, onClose, colors }) {
  return (
    <Card className="border border-indigo-200 bg-indigo-50/30">
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base text-indigo-800">Detalhamento — {detalhe.nome}</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MotivoSection titulo="Motivos de Não Visita" icon={<XCircle className="w-4 h-4 text-red-600" />} items={detalhe.naoVisita.items} total={detalhe.naoVisita.total} colors={colors} />
          <MotivoSection titulo="Motivos de Não Pedido" icon={<ShoppingCart className="w-4 h-4 text-orange-600" />} items={detalhe.naoPedido.items} total={detalhe.naoPedido.total} colors={colors} />
        </div>
      </CardContent>
    </Card>
  );
}

function MotivoSection({ titulo, icon, items, total, colors }) {
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
      <ResponsiveContainer width="100%" height={Math.max(items.length * 36, 80)}>
        <BarChart data={items} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" fontSize={10} />
          <YAxis type="category" dataKey="motivo" width={130} fontSize={10} tick={{ fill: '#475569' }} />
          <Tooltip formatter={(val, name, props) => [`${val} (${props.payload.pct}%)`, 'Quantidade']} />
          <Bar dataKey="qtd" radius={[0, 4, 4, 0]} maxBarSize={24}>
            {items.map((_, i) => (<Cell key={i} fill={colors[i % colors.length]} />))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
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
                <TableCell className="text-xs text-center"><Badge className="bg-slate-100 text-slate-600 text-[10px]">{m.pct}%</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}