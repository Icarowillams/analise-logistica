import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DollarSign, CreditCard, AlertTriangle, CheckCircle2, Clock, Wallet, Receipt, TrendingUp, Package } from 'lucide-react';

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

export default function PainelCobrancas() {
  const hoje = new Date();
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [ano, setAno] = useState(hoje.getFullYear());

  const mesInicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const mesFim = `${ano}-${String(mes).padStart(2, '0')}-${new Date(ano, mes, 0).getDate()}`;

  const { data: acertos = [] } = useQuery({
    queryKey: ['acertos'],
    queryFn: () => base44.entities.AcertoCaixa.list('-created_date', 500),
    staleTime: 3 * 60 * 1000,
  });

  const { data: pedidos = [] } = useQuery({
    queryKey: ['cobr-pedidos'],
    queryFn: () => base44.entities.Pedido.filter({ tipo: 'venda' }, '-created_date', 2000),
    staleTime: 2 * 60 * 1000,
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.filter({ status: 'ativo' }),
    staleTime: 5 * 60 * 1000,
  });

  const duMes = diasUteisMes(ano, mes);
  const duDecorridos = diasUteisDecorridos(ano, mes);

  const pedidosDoMes = useMemo(() => {
    return pedidos.filter(p => {
      const d = p.created_date?.slice(0, 10) || '';
      return d >= mesInicio && d <= mesFim;
    });
  }, [pedidos, mesInicio, mesFim]);

  const acertosDoMes = useMemo(() => {
    return acertos.filter(a => {
      const d = a.created_date?.slice(0, 10) || a.data_acerto || '';
      return d >= mesInicio && d <= mesFim;
    });
  }, [acertos, mesInicio, mesFim]);

  const porVendedor = useMemo(() => {
    const map = new Map();

    for (const p of pedidosDoMes) {
      const vid = p.vendedor_id || '__';
      if (!map.has(vid)) map.set(vid, { vendedor_id: vid, vendedor_nome: p.vendedor_nome || '—', valor_pedidos: 0, qtd_pedidos: 0, valor_cobrado: 0, qtd_acertos: 0 });
      const d = map.get(vid);
      d.valor_pedidos += Number(p.valor_total || 0);
      d.qtd_pedidos += 1;
    }

    for (const a of acertosDoMes) {
      const vid = a.vendedor_id || '__';
      if (!map.has(vid)) map.set(vid, { vendedor_id: vid, vendedor_nome: a.vendedor_nome || '—', valor_pedidos: 0, qtd_pedidos: 0, valor_cobrado: 0, qtd_acertos: 0 });
      const d = map.get(vid);
      d.valor_cobrado += Number(a.valor_total || a.valor_recebido || 0);
      d.qtd_acertos += 1;
    }

    return Array.from(map.values()).map(d => ({
      ...d,
      saldo: d.valor_cobrado - d.valor_pedidos,
      pct_cobranca: d.valor_pedidos > 0 ? (d.valor_cobrado / d.valor_pedidos) * 100 : 0,
    })).sort((a, b) => b.valor_pedidos - a.valor_pedidos);
  }, [pedidosDoMes, acertosDoMes]);

  const totalPedidos = porVendedor.reduce((s, d) => s + d.valor_pedidos, 0);
  const totalCobrado = porVendedor.reduce((s, d) => s + d.valor_cobrado, 0);
  const totalSaldo = totalCobrado - totalPedidos;
  const pctCobrancaGeral = totalPedidos > 0 ? (totalCobrado / totalPedidos) * 100 : 0;

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
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>{meses.map(m => <SelectItem key={m.v} value={String(m.v)}>{m.l}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
          <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
          <SelectContent>{[2025, 2026, 2027].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-xs text-slate-500">{acertosDoMes.length} acertos · {pedidosDoMes.length} pedidos</span>
      </div>

      {/* KPIs de Cobrança */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-blue-600" />
              <span className="text-xs text-slate-500">Total Pedidos (Mês)</span>
            </div>
            <div className="text-xl font-bold">{fmt(totalPedidos)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Wallet className="w-4 h-4 text-emerald-600" />
              <span className="text-xs text-slate-500">Total Cobrado</span>
            </div>
            <div className="text-xl font-bold">{fmt(totalCobrado)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="w-4 h-4 text-purple-600" />
              <span className="text-xs text-slate-500">Saldo (Cobrado - Pedidos)</span>
            </div>
            <div className={`text-xl font-bold ${totalSaldo >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {fmt(totalSaldo)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-cyan-600" />
              <span className="text-xs text-slate-500">% Cobrança vs Pedidos</span>
            </div>
            <div className={`text-xl font-bold ${pctCobrancaGeral >= 95 ? 'text-green-600' : pctCobrancaGeral >= 80 ? 'text-amber-500' : 'text-red-600'}`}>
              {fmtN(pctCobrancaGeral)}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabela por vendedor */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CreditCard className="w-4 h-4" /> Cobranças vs Pedidos por Vendedor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-500">
                  <th className="text-left py-2 pr-3">Vendedor</th>
                  <th className="text-right py-2 pr-3">R$ Pedidos</th>
                  <th className="text-right py-2 pr-3">Qtd. Pedidos</th>
                  <th className="text-right py-2 pr-3">R$ Cobrado</th>
                  <th className="text-right py-2 pr-3">Qtd. Acertos</th>
                  <th className="text-right py-2 pr-3">Saldo</th>
                  <th className="text-right py-2">% Cobrança</th>
                </tr>
              </thead>
              <tbody>
                {porVendedor.map(d => (
                  <tr key={d.vendedor_id} className="border-b hover:bg-slate-50 last:border-0">
                    <td className="py-2 pr-3 font-medium truncate max-w-[150px]">{d.vendedor_nome}</td>
                    <td className="py-2 pr-3 text-right">{fmt(d.valor_pedidos)}</td>
                    <td className="py-2 pr-3 text-right text-slate-500">{d.qtd_pedidos}</td>
                    <td className="py-2 pr-3 text-right">{fmt(d.valor_cobrado)}</td>
                    <td className="py-2 pr-3 text-right text-slate-500">{d.qtd_acertos}</td>
                    <td className={`py-2 pr-3 text-right font-medium ${d.saldo >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {fmt(d.saldo)}
                    </td>
                    <td className="py-2 text-right">
                      {d.valor_pedidos > 0 ? (
                        <Badge className={`text-xs ${d.pct_cobranca >= 95 ? 'bg-green-100 text-green-800' : d.pct_cobranca >= 80 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
                          {fmtN(d.pct_cobranca)}%
                        </Badge>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                ))}
                {porVendedor.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-slate-400">Nenhum dado no período</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Alertas de saldo negativo */}
      {porVendedor.filter(d => d.saldo < 0).length > 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Vendedores com saldo negativo (cobrado &lt; pedidos)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {porVendedor.filter(d => d.saldo < 0).map(d => (
                <div key={d.vendedor_id} className="flex items-center justify-between p-2 rounded-lg bg-red-50 border border-red-200">
                  <span className="font-medium text-sm">{d.vendedor_nome}</span>
                  <span className="text-sm font-bold text-red-700">Falta: {fmt(Math.abs(d.saldo))}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}