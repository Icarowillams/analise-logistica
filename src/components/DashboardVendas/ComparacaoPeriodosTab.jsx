import React, { useMemo, useState } from 'react';
import { CalendarRange, Scale, TrendingDown, TrendingUp, Search } from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import FiltrosDashboardVendas from '@/components/DashboardVendas/FiltrosDashboardVendas';
import ClienteVendaAccordion from '@/components/DashboardVendas/ClienteVendaAccordion';
import {
  agruparVendasPorCliente,
  agruparVendasPorProduto,
  agruparVendasPorVendedor,
  calcularResumoVendas,
  calcularVariacao,
  filtrarVendasDashboard
} from '@/components/DashboardVendas/dashboardVendasUtils';

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

function ListaVendedores({ titulo, dados, corBadge }) {
  return (
    <Card className="border-0 shadow-lg">
      <CardHeader><CardTitle className="text-base">{titulo}</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-2">
          {dados.map((v, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs items-center">
              <div className="col-span-5 font-medium text-slate-800 truncate">{v.nome}</div>
              <div className="col-span-2 text-center"><Badge className={corBadge}>{v.qtd}</Badge></div>
              <div className="col-span-3 text-right font-semibold">{v.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
              <div className="col-span-2 text-right">{v.precoMedio.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ListaProdutos({ titulo, dados, cardClass, badgeClass, codigoClass, nomeClass }) {
  return (
    <Card className="border-0 shadow-lg">
      <CardHeader><CardTitle className="text-base">{titulo}</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-2">
          {dados.map((p, idx) => (
            <div key={idx} className={`grid grid-cols-12 gap-2 p-3 rounded-lg border text-xs items-center ${cardClass}`}>
              <div className={`col-span-2 font-mono truncate ${codigoClass}`}>{p.codigo}</div>
              <div className={`col-span-4 font-medium truncate ${nomeClass}`}>{p.nome}</div>
              <div className="col-span-2 text-center"><Badge className={badgeClass}>{p.qtd}</Badge></div>
              <div className="col-span-2 text-right font-semibold">{p.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
              <div className="col-span-2 text-right">{p.precoMedio.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ListaClientes({ titulo, busca, setBusca, clientes }) {
  return (
    <Card className="border-0 shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">{titulo}</CardTitle>
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-400" />
            <Input placeholder="Buscar cliente..." value={busca} onChange={(e) => setBusca(e.target.value)} className="w-56 h-9" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-[520px] overflow-y-auto pr-2">
          {clientes.map((cliente, idx) => <ClienteVendaAccordion key={idx} cliente={cliente} />)}
        </div>
      </CardContent>
    </Card>
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
  const [buscaClienteX, setBuscaClienteX] = useState('');
  const [buscaClienteY, setBuscaClienteY] = useState('');

  const vendasPeriodoX = useMemo(() => filtrarVendasDashboard(vendasPermitidas, filtrosX, vendedoresAll, clientes), [vendasPermitidas, filtrosX, vendedoresAll, clientes]);
  const vendasPeriodoY = useMemo(() => filtrarVendasDashboard(vendasPermitidas, filtrosY, vendedoresAll, clientes), [vendasPermitidas, filtrosY, vendedoresAll, clientes]);

  const resumoX = useMemo(() => calcularResumoVendas(vendasPeriodoX), [vendasPeriodoX]);
  const resumoY = useMemo(() => calcularResumoVendas(vendasPeriodoY), [vendasPeriodoY]);
  const vendasPorVendedorX = useMemo(() => agruparVendasPorVendedor(vendasPeriodoX), [vendasPeriodoX]);
  const vendasPorVendedorY = useMemo(() => agruparVendasPorVendedor(vendasPeriodoY), [vendasPeriodoY]);
  const vendasPorProdutoX = useMemo(() => agruparVendasPorProduto(vendasPeriodoX, produtos), [vendasPeriodoX, produtos]);
  const vendasPorProdutoY = useMemo(() => agruparVendasPorProduto(vendasPeriodoY, produtos), [vendasPeriodoY, produtos]);
  const vendasPorClienteX = useMemo(() => agruparVendasPorCliente(vendasPeriodoX, clientes, produtos), [vendasPeriodoX, clientes, produtos]);
  const vendasPorClienteY = useMemo(() => agruparVendasPorCliente(vendasPeriodoY, clientes, produtos), [vendasPeriodoY, clientes, produtos]);

  const clientesFiltradosX = useMemo(() => {
    if (!buscaClienteX.trim()) return vendasPorClienteX;
    const termo = buscaClienteX.toLowerCase();
    return vendasPorClienteX.filter(c => c.codigo.toLowerCase().includes(termo) || c.nome.toLowerCase().includes(termo));
  }, [vendasPorClienteX, buscaClienteX]);

  const clientesFiltradosY = useMemo(() => {
    if (!buscaClienteY.trim()) return vendasPorClienteY;
    const termo = buscaClienteY.toLowerCase();
    return vendasPorClienteY.filter(c => c.codigo.toLowerCase().includes(termo) || c.nome.toLowerCase().includes(termo));
  }, [vendasPorClienteY, buscaClienteY]);

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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ListaVendedores titulo="Período X • Total por Vendedor" dados={vendasPorVendedorX} corBadge="bg-blue-100 text-blue-700" />
        <ListaVendedores titulo="Período Y • Total por Vendedor" dados={vendasPorVendedorY} corBadge="bg-violet-100 text-violet-700" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ListaProdutos titulo="Período X • Produtos no geral" dados={vendasPorProdutoX} cardClass="bg-blue-50 border-blue-200" badgeClass="bg-blue-200 text-blue-800" codigoClass="text-blue-800" nomeClass="text-blue-900" />
        <ListaProdutos titulo="Período Y • Produtos no geral" dados={vendasPorProdutoY} cardClass="bg-violet-50 border-violet-200" badgeClass="bg-violet-200 text-violet-800" codigoClass="text-violet-800" nomeClass="text-violet-900" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ListaClientes titulo="Período X • Clientes no geral" busca={buscaClienteX} setBusca={setBuscaClienteX} clientes={clientesFiltradosX} />
        <ListaClientes titulo="Período Y • Clientes no geral" busca={buscaClienteY} setBusca={setBuscaClienteY} clientes={clientesFiltradosY} />
      </div>
    </div>
  );
}