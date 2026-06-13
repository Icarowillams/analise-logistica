import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendingUp, TrendingDown, Target, Package, DollarSign, AlertTriangle, CheckCircle2, Clock, Users, BarChart3 } from 'lucide-react';

const PM_BENCHMARK = 5.17;
const PM_MINIMO = 5.00;
const PM_BLOQUEIO = 4.80;

// Calcula dias úteis de um mês
function diasUteisMes(ano, mes) {
  let count = 0;
  const diasNoMes = new Date(ano, mes, 0).getDate();
  for (let d = 1; d <= diasNoMes; d++) {
    const dow = new Date(ano, mes - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function diasUteisDecorridos(ano, mes) {
  const hoje = new Date();
  let count = 0;
  const ate = Math.min(hoje.getDate(), new Date(ano, mes, 0).getDate());
  for (let d = 1; d <= ate; d++) {
    const dow = new Date(ano, mes - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function Semaforo({ pct }) {
  if (pct >= 95) return <span className="inline-flex items-center gap-1 text-green-600 font-semibold"><CheckCircle2 className="w-4 h-4" />Verde</span>;
  if (pct >= 80) return <span className="inline-flex items-center gap-1 text-amber-500 font-semibold"><Clock className="w-4 h-4" />Amarelo</span>;
  return <span className="inline-flex items-center gap-1 text-red-600 font-semibold"><AlertTriangle className="w-4 h-4" />Vermelho</span>;
}

function SemaforoBadge({ pct }) {
  if (pct >= 95) return <Badge className="bg-green-100 text-green-800 border-green-300">{pct.toFixed(1)}%</Badge>;
  if (pct >= 80) return <Badge className="bg-amber-100 text-amber-800 border-amber-300">{pct.toFixed(1)}%</Badge>;
  return <Badge className="bg-red-100 text-red-800 border-red-300">{pct.toFixed(1)}%</Badge>;
}

export default function PainelMetas() {
  const hoje = new Date();
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [ano, setAno] = useState(hoje.getFullYear());

  const mesInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const mesFim = `${ano}-${String(mes).padStart(2, '0')}-${new Date(ano, mes, 0).getDate()}`;

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.filter({ status: 'ativo' }),
    staleTime: 5 * 60 * 1000,
  });

  const { data: metas = [] } = useQuery({
    queryKey: ['metas', mes, ano],
    queryFn: () => base44.entities.Meta.filter({ tipo: 'vendas' }, '-periodo_inicio', 200),
    staleTime: 2 * 60 * 1000,
  });

  const { data: pedidos = [] } = useQuery({
    queryKey: ['pedidos-painel', mes, ano],
    queryFn: () => base44.entities.Pedido.filter({ status: 'faturado' }, '-created_date', 2000),
    staleTime: 2 * 60 * 1000,
  });

  const { data: pedidosMontagem = [] } = useQuery({
    queryKey: ['pedidos-montagem', mes, ano],
    queryFn: () => base44.entities.Pedido.filter({ status: 'montagem' }, '-created_date', 500),
    staleTime: 2 * 60 * 1000,
  });

  const duMes = diasUteisMes(ano, mes);
  const duDecorridos = diasUteisDecorridos(ano, mes);

  const pedidosDoMes = useMemo(() => {
    const todos = [...pedidos, ...pedidosMontagem];
    return todos.filter(p => {
      const d = p.data_previsao_entrega || p.created_date?.slice(0, 10) || '';
      return d >= mesInicio && d <= mesFim && p.tipo === 'venda';
    });
  }, [pedidos, pedidosMontagem, mesInicio, mesFim]);

  const metasDoMes = useMemo(() => {
    return metas.filter(m => {
      return m.periodo_inicio >= mesInicio && m.periodo_inicio <= mesFim ||
             m.periodo_fim >= mesInicio && m.periodo_fim <= mesFim ||
             (m.periodo_inicio <= mesInicio && m.periodo_fim >= mesFim);
    });
  }, [metas, mesInicio, mesFim]);

  // Agrega por vendedor
  const dadosVendedor = useMemo(() => {
    const map = new Map();

    for (const p of pedidosDoMes) {
      const vid = p.vendedor_id || '__sem_vendedor__';
      if (!map.has(vid)) {
        map.set(vid, { vendedor_id: vid, vendedor_nome: p.vendedor_nome || '—', valor_total: 0, qtd_pacotes: 0, qtd_pedidos: 0 });
      }
      const d = map.get(vid);
      d.valor_total += Number(p.valor_total || 0);
      d.qtd_pacotes += Number(p.qtd_total_itens || 0);
      d.qtd_pedidos += 1;
    }

    // Calcular PM por vendedor
    const arr = [];
    for (const [vid, d] of map.entries()) {
      const meta = metasDoMes.find(m => m.vendedor_id === vid);
      const metaValor = Number(meta?.valor_meta || 0);
      const pct = metaValor > 0 ? (d.valor_total / metaValor) * 100 : 0;
      const pm = d.qtd_pacotes > 0 ? d.valor_total / d.qtd_pacotes : 0;
      const projecao = duDecorridos > 0 ? (d.valor_total / duDecorridos) * duMes : 0;
      const pctProjecao = metaValor > 0 ? (projecao / metaValor) * 100 : 0;
      arr.push({ ...d, meta_valor: metaValor, pct_atingimento: pct, pm_atual: pm, projecao_fechamento: projecao, pct_projecao: pctProjecao });
    }

    return arr.sort((a, b) => b.pct_atingimento - a.pct_atingimento);
  }, [pedidosDoMes, metasDoMes, duDecorridos, duMes]);

  // Totais gerais
  const totalRealizado = dadosVendedor.reduce((s, d) => s + d.valor_total, 0);
  const totalMeta = metasDoMes.reduce((s, m) => s + Number(m.valor_meta || 0), 0);
  const totalPacotes = dadosVendedor.reduce((s, d) => s + d.qtd_pacotes, 0);
  const pmGeral = totalPacotes > 0 ? totalRealizado / totalPacotes : 0;
  const projecaoGeral = duDecorridos > 0 ? (totalRealizado / duDecorridos) * duMes : 0;
  const pctGeral = totalMeta > 0 ? (totalRealizado / totalMeta) * 100 : 0;
  const pctProjecaoGeral = totalMeta > 0 ? (projecaoGeral / totalMeta) * 100 : 0;

  const meses = [
    { v: 1, l: 'Janeiro' }, { v: 2, l: 'Fevereiro' }, { v: 3, l: 'Março' },
    { v: 4, l: 'Abril' }, { v: 5, l: 'Maio' }, { v: 6, l: 'Junho' },
    { v: 7, l: 'Julho' }, { v: 8, l: 'Agosto' }, { v: 9, l: 'Setembro' },
    { v: 10, l: 'Outubro' }, { v: 11, l: 'Novembro' }, { v: 12, l: 'Dezembro' },
  ];

  const fmt = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtN = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-5">
      {/* Filtro */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {meses.map(m => <SelectItem key={m.v} value={String(m.v)}>{m.l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
          <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[2025, 2026, 2027].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-slate-500">{duDecorridos}/{duMes} dias úteis decorridos</span>
      </div>

      {/* KPIs Gerais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-cyan-600" />
              <span className="text-xs text-slate-500">R$ Realizado</span>
            </div>
            <div className="text-xl font-bold">{fmt(totalRealizado)}</div>
            <div className="text-xs text-slate-400">Meta: {fmt(totalMeta)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-purple-600" />
              <span className="text-xs text-slate-500">% Atingimento</span>
            </div>
            <div className="text-xl font-bold">{fmtN(pctGeral)}%</div>
            <div className="text-xs"><Semaforo pct={pctGeral} /></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="w-4 h-4 text-amber-600" />
              <span className="text-xs text-slate-500">PM Geral</span>
            </div>
            <div className={`text-xl font-bold ${pmGeral < PM_BENCHMARK ? 'text-red-600' : 'text-green-600'}`}>
              R$ {fmtN(pmGeral)}
            </div>
            <div className="text-xs text-slate-400">Benchmark: R$ {PM_BENCHMARK}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <span className="text-xs text-slate-500">Projeção Fechamento</span>
            </div>
            <div className="text-xl font-bold">{fmt(projecaoGeral)}</div>
            <div className="text-xs"><SemaforoBadge pct={pctProjecaoGeral} /> da meta</div>
          </CardContent>
        </Card>
      </div>

      {/* Alerta PM abaixo do benchmark */}
      {pmGeral > 0 && pmGeral < PM_BENCHMARK && (
        <div className={`rounded-lg p-3 border flex items-center gap-2 text-sm ${pmGeral < PM_BLOQUEIO ? 'bg-red-50 border-red-300 text-red-700' : 'bg-amber-50 border-amber-300 text-amber-700'}`}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {pmGeral < PM_BLOQUEIO
            ? `⛔ PM CRÍTICO (R$ ${fmtN(pmGeral)}) — abaixo de R$ ${PM_BLOQUEIO}! Alerta automático para Gerente.`
            : `⚠️ PM abaixo do benchmark (R$ ${fmtN(pmGeral)} < R$ ${PM_BENCHMARK}). Compensar com maior volume.`
          }
        </div>
      )}

      {/* Barra de progresso geral */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Progresso Geral do Mês
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-slate-500">
              <span>{fmt(totalRealizado)} realizado</span>
              <span>Meta: {fmt(totalMeta)}</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-4">
              <div
                className={`h-4 rounded-full transition-all ${pctGeral >= 95 ? 'bg-green-500' : pctGeral >= 80 ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{ width: `${Math.min(pctGeral, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Projeção: {fmt(projecaoGeral)} ({fmtN(pctProjecaoGeral)}%)</span>
              <SemaforoBadge pct={pctGeral} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ranking de Vendedores */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="w-4 h-4" /> Ranking de Vendedores
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-500">
                  <th className="text-left py-2 pr-3">#</th>
                  <th className="text-left py-2 pr-3">Vendedor</th>
                  <th className="text-right py-2 pr-3">R$ Realizado</th>
                  <th className="text-right py-2 pr-3">Meta</th>
                  <th className="text-right py-2 pr-3">% Ating.</th>
                  <th className="text-right py-2 pr-3">PM</th>
                  <th className="text-right py-2 pr-3">Projeção</th>
                  <th className="text-right py-2">Semáforo</th>
                </tr>
              </thead>
              <tbody>
                {dadosVendedor.map((d, i) => (
                  <tr key={d.vendedor_id} className="border-b hover:bg-slate-50 last:border-0">
                    <td className="py-2 pr-3 text-slate-400 font-medium">{i + 1}</td>
                    <td className="py-2 pr-3 font-medium truncate max-w-[140px]">{d.vendedor_nome}</td>
                    <td className="py-2 pr-3 text-right">{fmt(d.valor_total)}</td>
                    <td className="py-2 pr-3 text-right text-slate-500">{d.meta_valor > 0 ? fmt(d.meta_valor) : '—'}</td>
                    <td className="py-2 pr-3 text-right">
                      {d.meta_valor > 0 ? <SemaforoBadge pct={d.pct_atingimento} /> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className={`py-2 pr-3 text-right font-medium ${d.pm_atual > 0 && d.pm_atual < PM_BENCHMARK ? 'text-red-600' : 'text-green-700'}`}>
                      {d.pm_atual > 0 ? `R$ ${fmtN(d.pm_atual)}` : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right text-slate-600">{d.projecao_fechamento > 0 ? fmt(d.projecao_fechamento) : '—'}</td>
                    <td className="py-2 text-right">
                      {d.meta_valor > 0 ? <Semaforo pct={d.pct_projecao} /> : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
                {dadosVendedor.length === 0 && (
                  <tr><td colSpan={8} className="py-8 text-center text-slate-400">Nenhum pedido faturado no período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Alertas PM por vendedor */}
      {dadosVendedor.filter(d => d.pm_atual > 0 && d.pm_atual < PM_BENCHMARK).length > 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Vendedores com PM abaixo do benchmark (R$ {PM_BENCHMARK})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {dadosVendedor.filter(d => d.pm_atual > 0 && d.pm_atual < PM_BENCHMARK).map(d => (
                <div key={d.vendedor_id} className={`flex items-center justify-between p-2 rounded-lg ${d.pm_atual < PM_BLOQUEIO ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
                  <span className="font-medium text-sm">{d.vendedor_nome}</span>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold ${d.pm_atual < PM_BLOQUEIO ? 'text-red-700' : 'text-amber-700'}`}>
                      PM: R$ {fmtN(d.pm_atual)}
                    </span>
                    {d.pm_atual < PM_BLOQUEIO && <Badge className="bg-red-100 text-red-800 text-xs">BLOQUEIO</Badge>}
                    {d.pm_atual >= PM_BLOQUEIO && d.pm_atual < PM_MINIMO && <Badge className="bg-amber-100 text-amber-800 text-xs">ALERTA</Badge>}
                    {d.pm_atual >= PM_MINIMO && <Badge className="bg-yellow-100 text-yellow-800 text-xs">ATENÇÃO</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legenda */}
      <div className="text-xs text-slate-400 flex flex-wrap gap-4">
        <span>🟢 Verde: ≥95% da meta</span>
        <span>🟡 Amarelo: 80–95%</span>
        <span>🔴 Vermelho: &lt;80%</span>
        <span>PM benchmark: R$ {PM_BENCHMARK} líquido</span>
        <span>PM mínimo: R$ {PM_MINIMO} (alerta supervisor)</span>
        <span>PM bloqueio: R$ {PM_BLOQUEIO} (alerta gerente)</span>
      </div>
    </div>
  );
}