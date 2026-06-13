import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Users, CheckCircle2, Clock, AlertTriangle, Target, Activity } from 'lucide-react';

export default function CoberturaVisitas() {
  const hoje = new Date();
  const mes = hoje.getMonth() + 1;
  const ano = hoje.getFullYear();
  const mesInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const mesFim = `${ano}-${String(mes).padStart(2, '0')}-${new Date(ano, mes, 0).getDate()}`;
  const hojeStr = hoje.toISOString().slice(0, 10);

  const { data: roteiros = [] } = useQuery({
    queryKey: ['cob-roteiros'],
    queryFn: () => base44.entities.Roteiro.list('-created_date', 200),
    staleTime: 5 * 60 * 1000,
  });

  const { data: visitas = [] } = useQuery({
    queryKey: ['cob-visitas'],
    queryFn: () => base44.entities.VisitaRoteiro.list('-created_date', 2000),
    staleTime: 3 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.filter({ status: 'ativo' }),
    staleTime: 5 * 60 * 1000,
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.filter({ status: 'ativo' }),
    staleTime: 10 * 60 * 1000,
  });

  // Total de clientes ativos na base
  const totalClientes = clientes.length;

  // Visitas do mês
  const visitasDoMes = useMemo(() => {
    return visitas.filter(v => {
      const d = v.data_visita || v.created_date?.slice(0, 10) || '';
      return d >= mesInicio && d <= mesFim;
    });
  }, [visitas, mesInicio, mesFim]);

  // Visitas de hoje
  const visitasHoje = useMemo(() => {
    return visitas.filter(v => {
      const d = v.data_visita || v.created_date?.slice(0, 10) || '';
      return d === hojeStr;
    });
  }, [visitas, hojeStr]);

  // Clientes únicos visitados no mês
  const clientesVisitados = useMemo(() => {
    return new Set(visitasDoMes.map(v => v.cliente_id).filter(Boolean));
  }, [visitasDoMes]);

  // Por vendedor: planejado vs realizado
  const porVendedor = useMemo(() => {
    const map = new Map();

    // Planejado - dos roteiros ativos
    for (const r of roteiros) {
      if (!r.vendedor_id || !r.ativo) continue;
      const vid = r.vendedor_id;
      const totalRoteiro = (r.clientes_ids || []).length + (r.clientes_detalhes || []).length;
      if (!map.has(vid)) {
        map.set(vid, {
          vendedor_id: vid,
          vendedor_nome: r.vendedor_nome || '—',
          planejados: 0,
          visitados: 0,
          concluidos: 0,
          pendentes: 0,
          nao_atendidos: 0,
        });
      }
      const d = map.get(vid);
      d.planejados += totalRoteiro;
    }

    // Realizado - visitas
    for (const v of visitasDoMes) {
      const vid = v.vendedor_id || '__';
      if (!map.has(vid)) {
        map.set(vid, {
          vendedor_id: vid,
          vendedor_nome: v.vendedor_nome || '—',
          planejados: 0,
          visitados: 0,
          concluidos: 0,
          pendentes: 0,
          nao_atendidos: 0,
        });
      }
      const d = map.get(vid);
      d.visitados += 1;
      if (v.status === 'concluida') d.concluidos += 1;
      if (v.status === 'nao_atendimento' || v.status === 'reagendada') d.nao_atendidos += 1;
      if (v.status === 'pendente' || v.status === 'planejada' || v.status === 'em_andamento') d.pendentes += 1;
    }

    return Array.from(map.values()).map(d => ({
      ...d,
      pct_cobertura: d.planejados > 0 ? (d.visitados / d.planejados) * 100 : (d.visitados > 0 ? 100 : 0),
    })).sort((a, b) => b.visitados - a.visitados);
  }, [roteiros, visitasDoMes]);

  const totalPlanejados = porVendedor.reduce((s, d) => s + d.planejados, 0);
  const totalVisitados = visitasDoMes.length;
  const totalConcluidos = visitasDoMes.filter(v => v.status === 'concluida').length;
  const totalNaoAtendidos = visitasDoMes.filter(v => v.status === 'nao_atendimento' || v.status === 'reagendada').length;
  const pctCobertura = totalPlanejados > 0 ? (totalVisitados / totalPlanejados) * 100 : (totalVisitados > 0 ? 100 : 0);

  const clientePct = totalClientes > 0 ? (clientesVisitados.size / totalClientes) * 100 : 0;

  const fmtN = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <div className="space-y-5">
      <div className="text-sm text-slate-500 flex items-center gap-2">
        <Activity className="w-4 h-4" />
        <span>{hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })} — {totalClientes} clientes ativos na base</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <MapPin className="w-4 h-4 text-blue-600" />
              <span className="text-xs text-slate-500">Clientes Base</span>
            </div>
            <div className="text-xl font-bold">{totalClientes}</div>
            <div className="text-xs text-slate-400">{clientesVisitados.size} visitados ({fmtN(clientePct)}%)</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-purple-600" />
              <span className="text-xs text-slate-500">Planejados (Mês)</span>
            </div>
            <div className="text-xl font-bold">{totalPlanejados}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-cyan-600" />
              <span className="text-xs text-slate-500">Visitados (Mês)</span>
            </div>
            <div className="text-xl font-bold">{totalVisitados}</div>
            <div className="text-xs text-slate-400">Cobertura: {fmtN(pctCobertura)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span className="text-xs text-slate-500">Concluídas</span>
            </div>
            <div className="text-xl font-bold">{totalConcluidos}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span className="text-xs text-slate-500">Não Atendidas</span>
            </div>
            <div className="text-xl font-bold">{totalNaoAtendidos}</div>
          </CardContent>
        </Card>
      </div>

      {/* Visitas de hoje */}
      {visitasHoje.length > 0 && (
        <Card className="border-cyan-200 bg-cyan-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-cyan-800">🚶 Visitas de Hoje ({visitasHoje.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {visitasHoje.map(v => (
                <Badge key={v.id} className={`text-xs ${v.status === 'concluida' ? 'bg-green-100 text-green-800' : v.status === 'em_andamento' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'}`}>
                  {v.cliente_nome || 'Cliente'} — {v.status === 'concluida' ? '✓' : v.status === 'em_andamento' ? '▶' : '⏳'}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cobertura por vendedor */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4" /> Cobertura por Vendedor — {new Date(ano, mes - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-500">
                  <th className="text-left py-2 pr-3">Vendedor</th>
                  <th className="text-right py-2 pr-3">Planejados</th>
                  <th className="text-right py-2 pr-3">Visitados</th>
                  <th className="text-right py-2 pr-3">Concluídos</th>
                  <th className="text-right py-2 pr-3">Não Atend.</th>
                  <th className="text-right py-2 pr-3">Pendentes</th>
                  <th className="text-right py-2">% Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {porVendedor.map(d => (
                  <tr key={d.vendedor_id} className="border-b hover:bg-slate-50 last:border-0">
                    <td className="py-2 pr-3 font-medium truncate max-w-[150px]">{d.vendedor_nome}</td>
                    <td className="py-2 pr-3 text-right">{d.planejados}</td>
                    <td className="py-2 pr-3 text-right">{d.visitados}</td>
                    <td className="py-2 pr-3 text-right text-emerald-600">{d.concluidos}</td>
                    <td className="py-2 pr-3 text-right text-red-500">{d.nao_atendidos}</td>
                    <td className="py-2 pr-3 text-right text-slate-400">{d.pendentes}</td>
                    <td className="py-2 text-right">
                      <Badge className={`text-xs ${d.pct_cobertura >= 80 ? 'bg-green-100 text-green-800' : d.pct_cobertura >= 50 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
                        {fmtN(d.pct_cobertura)}%
                      </Badge>
                    </td>
                  </tr>
                ))}
                {porVendedor.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-slate-400">Nenhum roteiro ou visita no mês</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Barra de progresso de cobertura */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Progresso de Cobertura da Base ({clientesVisitados.size}/{totalClientes} clientes)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="w-full bg-slate-200 rounded-full h-4">
            <div
              className="h-4 rounded-full bg-gradient-to-r from-blue-500 to-cyan-500 transition-all"
              style={{ width: `${Math.min(clientePct, 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-xs text-slate-500">
            <span>{fmtN(clientePct)}% da base visitada</span>
            <span>Faltam {totalClientes - clientesVisitados.size} clientes</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}