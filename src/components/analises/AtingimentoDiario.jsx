import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, TrendingUp, CheckCircle2, Clock, Activity } from 'lucide-react';

const PM_BENCHMARK = 5.17;

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

export default function AtingimentoDiario() {
  const hoje = new Date();
  const mes = hoje.getMonth() + 1;
  const ano = hoje.getFullYear();

  const mesInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const mesFim = `${ano}-${String(mes).padStart(2, '0')}-${new Date(ano, mes, 0).getDate()}`;
  const hojeStr = hoje.toISOString().slice(0, 10);

  const { data: pedidos = [] } = useQuery({
    queryKey: ['ating-pedidos'],
    queryFn: () => base44.entities.Pedido.filter({ status: 'faturado' }, '-created_date', 2000),
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const { data: pedidosMont = [] } = useQuery({
    queryKey: ['ating-montagem'],
    queryFn: () => base44.entities.Pedido.filter({ status: 'montagem' }, '-created_date', 500),
    staleTime: 60 * 1000,
  });

  const { data: metas = [] } = useQuery({
    queryKey: ['ating-metas'],
    queryFn: () => base44.entities.Meta.filter({ tipo: 'vendas' }, '-periodo_inicio', 200),
    staleTime: 5 * 60 * 1000,
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.filter({ status: 'ativo' }),
    staleTime: 5 * 60 * 1000,
  });

  const duMes = diasUteisMes(ano, mes);
  const duDecorridos = diasUteisDecorridos(ano, mes);
  const duRestantes = duMes - duDecorridos;

  const pedidosMes = useMemo(() => {
    return [...pedidos, ...pedidosMont].filter(p => {
      const d = p.data_previsao_entrega || p.created_date?.slice(0, 10) || '';
      return d >= mesInicio && d <= mesFim && p.tipo === 'venda';
    });
  }, [pedidos, pedidosMont, mesInicio, mesFim]);

  const pedidosHoje = useMemo(() => {
    return pedidosMes.filter(p => {
      const d = p.data_previsao_entrega || p.created_date?.slice(0, 10) || '';
      return d === hojeStr;
    });
  }, [pedidosMes, hojeStr]);

  const metasDoMes = useMemo(() => {
    return metas.filter(m =>
      m.periodo_inicio >= mesInicio && m.periodo_inicio <= mesFim ||
      m.periodo_fim >= mesInicio && m.periodo_fim <= mesFim ||
      (m.periodo_inicio <= mesInicio && m.periodo_fim >= mesFim)
    );
  }, [metas, mesInicio, mesFim]);

  // Por vendedor — atingimento do dia + do mês
  const porVendedor = useMemo(() => {
    const map = new Map();

    for (const p of pedidosMes) {
      const vid = p.vendedor_id || '__';
      if (!map.has(vid)) map.set(vid, { vid, nome: p.vendedor_nome || '—', mes_valor: 0, mes_pacotes: 0, hoje_valor: 0, hoje_pedidos: 0 });
      const d = map.get(vid);
      const dataP = p.data_previsao_entrega || p.created_date?.slice(0, 10) || '';
      d.mes_valor += Number(p.valor_total || 0);
      d.mes_pacotes += Number(p.qtd_total_itens || 0);
      if (dataP === hojeStr) { d.hoje_valor += Number(p.valor_total || 0); d.hoje_pedidos += 1; }
    }

    return Array.from(map.values()).map(d => {
      const meta = metasDoMes.find(m => m.vendedor_id === d.vid);
      const metaValor = Number(meta?.valor_meta || 0);
      const pct = metaValor > 0 ? (d.mes_valor / metaValor) * 100 : 0;
      const ritmo = duDecorridos > 0 ? d.mes_valor / duDecorridos : 0;
      const projecao = ritmo * duMes;
      const pctProj = metaValor > 0 ? (projecao / metaValor) * 100 : 0;
      const necessarioDia = duRestantes > 0 && metaValor > 0 ? (metaValor - d.mes_valor) / duRestantes : 0;
      const pm = d.mes_pacotes > 0 ? d.mes_valor / d.mes_pacotes : 0;
      return { ...d, meta_valor: metaValor, pct, projecao, pct_proj: pctProj, necessario_dia: necessarioDia, pm, ritmo };
    }).sort((a, b) => b.pct - a.pct);
  }, [pedidosMes, metasDoMes, duDecorridos, duMes, duRestantes, hojeStr]);

  const totalHoje = pedidosHoje.reduce((s, p) => s + Number(p.valor_total || 0), 0);
  const totalMes = pedidosMes.reduce((s, p) => s + Number(p.valor_total || 0), 0);
  const totalMeta = metasDoMes.reduce((s, m) => s + Number(m.valor_meta || 0), 0);
  const pctGeral = totalMeta > 0 ? (totalMes / totalMeta) * 100 : 0;

  const fmt = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtN = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const semaforo = (pct) => {
    if (pct >= 95) return { cor: 'green', icone: <CheckCircle2 className="w-4 h-4 text-green-600" />, label: 'No ritmo' };
    if (pct >= 80) return { cor: 'amber', icone: <Clock className="w-4 h-4 text-amber-500" />, label: 'Atenção' };
    return { cor: 'red', icone: <AlertTriangle className="w-4 h-4 text-red-600" />, label: 'Ritmo insuficiente' };
  };

  return (
    <div className="space-y-5">
      <div className="text-sm text-slate-500 flex items-center gap-2">
        <Activity className="w-4 h-4" />
        <span>Hoje: {hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })} — {duDecorridos}/{duMes} dias úteis</span>
      </div>

      {/* Cards do dia */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border-cyan-200 bg-cyan-50">
          <CardContent className="p-4">
            <div className="text-xs text-cyan-700 mb-1">Lançado Hoje</div>
            <div className="text-xl font-bold text-cyan-900">{fmt(totalHoje)}</div>
            <div className="text-xs text-cyan-600">{pedidosHoje.length} pedidos</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500 mb-1">Realizado no Mês</div>
            <div className="text-xl font-bold">{fmt(totalMes)}</div>
            <div className="text-xs text-slate-400">{fmtN(pctGeral)}% da meta</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500 mb-1">Meta do Mês</div>
            <div className="text-xl font-bold">{fmt(totalMeta)}</div>
            <div className="text-xs text-slate-400">Faltam {fmt(Math.max(0, totalMeta - totalMes))}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500 mb-1">Dias Úteis Restantes</div>
            <div className="text-xl font-bold">{duRestantes}</div>
            <div className="text-xs text-slate-400">
              Necessário/dia: {fmt(totalMeta > 0 && duRestantes > 0 ? (totalMeta - totalMes) / duRestantes : 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerta de ritmo geral */}
      {pctGeral < 80 && totalMeta > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-lg p-3 flex items-center gap-2 text-red-700 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Ritmo insuficiente! Com o ritmo atual ({fmt(totalMes / Math.max(duDecorridos, 1))}/dia), a projeção de fechamento é {fmtN((totalMes / Math.max(duDecorridos, 1) * duMes / totalMeta) * 100)}% da meta.
        </div>
      )}

      {/* Atingimento por vendedor */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Atingimento por Vendedor — {hoje.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {porVendedor.map(d => {
              const sem = semaforo(d.pct_proj);
              return (
                <div key={d.vid} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      {sem.icone}
                      <span className="font-medium">{d.nome}</span>
                      {d.hoje_valor > 0 && <Badge className="bg-cyan-100 text-cyan-700 text-xs">+{fmt(d.hoje_valor)} hoje</Badge>}
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-slate-500">{fmt(d.mes_valor)}</span>
                      {d.meta_valor > 0 && <>
                        <span className="text-slate-400">/ {fmt(d.meta_valor)}</span>
                        <Badge className={`text-xs ${d.pct >= 95 ? 'bg-green-100 text-green-800' : d.pct >= 80 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
                          {fmtN(d.pct)}%
                        </Badge>
                      </>}
                      {d.pm > 0 && (
                        <span className={`font-medium ${d.pm < PM_BENCHMARK ? 'text-red-600' : 'text-green-600'}`}>
                          PM R$ {fmtN(d.pm)}
                        </span>
                      )}
                    </div>
                  </div>
                  {d.meta_valor > 0 && (
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${d.pct >= 95 ? 'bg-green-500' : d.pct >= 80 ? 'bg-amber-400' : 'bg-red-500'}`}
                        style={{ width: `${Math.min(d.pct, 100)}%` }}
                      />
                    </div>
                  )}
                  {d.meta_valor > 0 && d.necessario_dia > 0 && (
                    <div className="text-xs text-slate-400">
                      Necessário/dia p/ meta: {fmt(d.necessario_dia)} · Projeção: {fmt(d.projecao)} ({fmtN(d.pct_proj)}%)
                    </div>
                  )}
                </div>
              );
            })}
            {porVendedor.length === 0 && (
              <p className="text-center text-slate-400 py-4">Nenhum dado de pedidos para o mês atual</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}