import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import FiltrosBase from '@/components/analises/FiltrosBase';
import KpiCard from '@/components/analises/KpiCard';
import { Package, Truck, RotateCcw, AlertTriangle } from 'lucide-react';
import { dentroPeriodo, exportarCSV, formatarNumero, formatarMoeda } from '@/components/analises/utilsAnalises';

export default function RelatorioEstoque() {
  const [filtros, setFiltros] = useState({ inicio: '', fim: '', vendedor_id: '' });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: cargas = [] } = useQuery({ queryKey: ['cargas'], queryFn: () => base44.entities.Carga.list('-data_carga', 2000) });
  const { data: pedidos = [] } = useQuery({ queryKey: ['pedidos'], queryFn: () => base44.entities.Pedido.list('-created_date', 5000) });
  const { data: trocas = [] } = useQuery({ queryKey: ['pedidosTroca'], queryFn: () => base44.entities.PedidoTroca.list('-data_troca', 5000) });

  const linhas = useMemo(() => {
    const cargasFiltradas = cargas.filter(c => {
      if (filtros.vendedor_id && c.motorista_id !== filtros.vendedor_id) return false;
      if ((filtros.inicio || filtros.fim) && !dentroPeriodo(c.data_carga, filtros.inicio, filtros.fim)) return false;
      return true;
    });
    return cargasFiltradas.map(c => {
      const vendasCarga = pedidos.filter(p => p.carga_id === c.id);
      const trocasCarga = trocas.filter(t => t.carga_id === c.id);
      const valorVendas = vendasCarga.reduce((a, p) => a + (p.valor_total || 0), 0);
      const valorTrocas = trocasCarga.reduce((a, t) => a + (t.valor_total || 0), 0);
      const saldo = (c.valor_total || 0) - valorVendas - valorTrocas;
      return { ...c, vendas: vendasCarga.length, valorVendas, trocas: trocasCarga.length, valorTrocas, saldo };
    });
  }, [cargas, pedidos, trocas, filtros]);

  const totais = useMemo(() => ({
    cargas: linhas.length,
    valorCarga: linhas.reduce((a, l) => a + (l.valor_total || 0), 0),
    valorVendas: linhas.reduce((a, l) => a + l.valorVendas, 0),
    saldoPositivo: linhas.filter(l => l.saldo > 0).length
  }), [linhas]);

  const exportar = () => exportarCSV('relatorio_estoque',
    ['Carga', 'Data', 'Motorista', 'Veículo', 'Valor carga', 'Vendas', 'Valor vendas', 'Trocas', 'Valor trocas', 'Saldo'],
    linhas.map(l => [l.numero_carga, l.data_carga, l.motorista_nome, l.veiculo_placa, l.valor_total, l.vendas, l.valorVendas, l.trocas, l.valorTrocas, l.saldo])
  );

  return (
    <div className="space-y-4">
      <FiltrosBase filtros={filtros} setFiltros={setFiltros} vendedores={vendedores} onLimpar={() => setFiltros({ inicio: '', fim: '', vendedor_id: '' })} onExportar={exportar} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard titulo="Cargas" valor={formatarNumero(totais.cargas)} icon={Truck} cor="cyan" />
        <KpiCard titulo="Valor total carga" valor={formatarMoeda(totais.valorCarga)} icon={Package} cor="indigo" />
        <KpiCard titulo="Valor vendido" valor={formatarMoeda(totais.valorVendas)} icon={RotateCcw} cor="emerald" />
        <KpiCard titulo="Cargas com saldo" valor={formatarNumero(totais.saldoPositivo)} icon={AlertTriangle} cor="amber" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Movimentação de estoque por carga</CardTitle></CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="p-2 text-left">Nº Carga</th><th className="p-2 text-left">Data</th><th className="p-2 text-left">Motorista</th><th className="p-2 text-left">Veículo</th><th className="p-2 text-right">Valor carga</th><th className="p-2 text-right">Vendas</th><th className="p-2 text-right">Trocas</th><th className="p-2 text-right">Saldo</th></tr></thead>
            <tbody>{linhas.slice(0, 200).map(l => (
              <tr key={l.id} className="border-t hover:bg-slate-50">
                <td className="p-2 font-mono">{l.numero_carga}</td>
                <td className="p-2">{l.data_carga}</td>
                <td className="p-2">{l.motorista_nome || '-'}</td>
                <td className="p-2">{l.veiculo_placa || '-'}</td>
                <td className="p-2 text-right">{formatarMoeda(l.valor_total)}</td>
                <td className="p-2 text-right">{formatarMoeda(l.valorVendas)}</td>
                <td className="p-2 text-right">{formatarMoeda(l.valorTrocas)}</td>
                <td className={`p-2 text-right font-semibold ${l.saldo > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{formatarMoeda(l.saldo)}</td>
              </tr>
            ))}</tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}