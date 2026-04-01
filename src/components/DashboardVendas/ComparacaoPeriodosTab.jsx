import React, { useMemo } from 'react';
import { CalendarRange, Scale, TrendingDown, TrendingUp } from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import FiltrosDashboardVendas from '@/components/DashboardVendas/FiltrosDashboardVendas';
import { calcularResumoVendas, calcularVariacao, filtrarVendasDashboard } from '@/components/DashboardVendas/dashboardVendasUtils';

function LinhaComparacao({ label, valorX, valorY, formatador }) {
  const diff = valorY - valorX;
  const variacao = calcularVariacao(valorY, valorX);
  const positiva = diff >= 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div>
        <p className="text-sm font-semibold text-slate-900">{label}</p>
      </div>
      <div>
        <p className="text-xs text-slate-500">Período X</p>
        <p className="text-base font-bold text-slate-900">{formatador(valorX)}</p>
      </div>
      <div>
        <p className="text-xs text-slate-500">Período Y</p>
        <p className="text-base font-bold text-slate-900">{formatador(valorY)}</p>
      </div>
      <div>
        <p className="text-xs text-slate-500">Diferença</p>
        <div className="flex items-center gap-2">
          <p className={`text-base font-bold ${positiva ? 'text-emerald-600' : 'text-red-600'}`}>{formatador(diff)}</p>
          <Badge className={positiva ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}>
            {positiva ? '+' : ''}{variacao.toFixed(1)}%
          </Badge>
        </div>
      </div>
    </div>
  );
}

export default function ComparacaoPeriodosTab({
  filtrosX,
  setFiltrosX,
  filtrosY,
  setFiltrosY,
  vendasPermitidas,
  vendedores,
  vendedoresAll,
  supervisores,
  segmentos,
  rotas,
  redes,
  produtos,
  clientes
}) {
  const vendasPeriodoX = useMemo(() => filtrarVendasDashboard(vendasPermitidas, filtrosX, vendedoresAll, clientes), [vendasPermitidas, filtrosX, vendedoresAll, clientes]);
  const vendasPeriodoY = useMemo(() => filtrarVendasDashboard(vendasPermitidas, filtrosY, vendedoresAll, clientes), [vendasPermitidas, filtrosY, vendedoresAll, clientes]);

  const resumoX = useMemo(() => calcularResumoVendas(vendasPeriodoX), [vendasPeriodoX]);
  const resumoY = useMemo(() => calcularResumoVendas(vendasPeriodoY), [vendasPeriodoY]);

  const moeda = (valor) => valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const numero = (valor) => valor.toLocaleString('pt-BR');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><CalendarRange className="w-5 h-5 text-blue-600" />Período X</CardTitle>
          </CardHeader>
          <CardContent>
            <FiltrosDashboardVendas filtros={filtrosX} setFiltros={setFiltrosX} vendedores={vendedores} supervisores={supervisores} segmentos={segmentos} rotas={rotas} redes={redes} produtos={produtos} compact />
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><Scale className="w-5 h-5 text-violet-600" />Período Y</CardTitle>
          </CardHeader>
          <CardContent>
            <FiltrosDashboardVendas filtros={filtrosY} setFiltros={setFiltrosY} vendedores={vendedores} supervisores={supervisores} segmentos={segmentos} rotas={rotas} redes={redes} produtos={produtos} compact />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
        <StatsCard title="Valor Total" value={moeda(resumoX.valorTotal)} subtitle="Período X" icon={TrendingUp} gradient="from-blue-500 to-indigo-600" />
        <StatsCard title="Valor Total" value={moeda(resumoY.valorTotal)} subtitle="Período Y" icon={TrendingDown} gradient="from-violet-500 to-purple-600" />
        <StatsCard title="Pedidos" value={numero(resumoX.pedidosUnicos)} subtitle="Período X" icon={CalendarRange} gradient="from-emerald-500 to-teal-600" />
        <StatsCard title="Pedidos" value={numero(resumoY.pedidosUnicos)} subtitle="Período Y" icon={Scale} gradient="from-amber-500 to-orange-500" />
      </div>

      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg">Comparativo consolidado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <LinhaComparacao label="Quantidade Total" valorX={resumoX.quantidadeTotal} valorY={resumoY.quantidadeTotal} formatador={numero} />
          <LinhaComparacao label="Valor Total" valorX={resumoX.valorTotal} valorY={resumoY.valorTotal} formatador={moeda} />
          <LinhaComparacao label="Preço Médio" valorX={resumoX.precoMedio} valorY={resumoY.precoMedio} formatador={moeda} />
          <LinhaComparacao label="Pedidos Faturados" valorX={resumoX.pedidosUnicos} valorY={resumoY.pedidosUnicos} formatador={numero} />
          <LinhaComparacao label="Clientes Atendidos" valorX={resumoX.clientesUnicos} valorY={resumoY.clientesUnicos} formatador={numero} />
        </CardContent>
      </Card>
    </div>
  );
}