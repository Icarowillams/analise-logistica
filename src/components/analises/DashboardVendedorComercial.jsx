import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DollarSign, ArrowLeftRight, Gift, Loader2, Filter, RefreshCw, Printer, Search } from 'lucide-react';
import KpiCard from './KpiCard';
import SyncStatusBadge from './SyncStatusBadge';
import { useEspelhoFaturamento } from '@/hooks/useEspelhoFaturamento';
import { formatarMoeda, formatarNumero, exportarCSV, arredondar2 } from './utilsAnalises';

// Default = mês corrente (dia 1 → hoje)
const hoje = new Date().toISOString().slice(0, 10);
const inicioMes = `${hoje.slice(0, 7)}-01`;

export default function DashboardVendedorComercial() {
  const [filtros, setFiltros] = useState({ inicio: inicioMes, fim: hoje, vendedor_nome: '' });
  const [aplicado, setAplicado] = useState({ inicio: inicioMes, fim: hoje, vendedor_nome: '' });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores_dash_comercial'],
    queryFn: () => base44.entities.Vendedor.list('nome', 2000)
  });

  // Fonte 1: ESPPELHO (venda — fonte Omie, só comissionável)
  const { dados: dadosEspelho, isLoading: isLoadingEspelho, isSincronizando, ultimaSincronizacao, erroSync, sincronizarAgora } =
    useEspelhoFaturamento(aplicado.inicio, aplicado.fim);

  // Fonte 2: agregadosVendedorComercial (troca/bonif/motivos)
  const { data, isFetching: isFetchingAgregados } = useQuery({
    queryKey: ['agregados_vendedor_comercial', aplicado],
    queryFn: async () => {
      const res = await base44.functions.invoke('agregadosVendedorComercial', aplicado);
      return res.data;
    }
  });

  // Venda por vendedor (do espelho — só comissionável, de-dup por vendedor_nome)
  const vendaPorNome = useMemo(() => {
    const v = {};
    dadosEspelho.filter(n => n.comissionavel).forEach(n => {
      const k = (n.vendedor_nome || '(sem vendedor)').trim() || '(sem vendedor)';
      if (!v[k]) v[k] = { venda_valor: 0, venda_qtd: 0 };
      v[k].venda_valor = arredondar2(v[k].venda_valor + (n.valor_venda || 0));
      v[k].venda_qtd++;
    });
    return v;
  }, [dadosEspelho]);

  // Merge das 2 fontes por vendedor_nome
  // - Venda vem do espelho; troca/bonif vêm do agregados.
  // - Vendedores que só têm venda (sem troca) aparecem com troca=0 e vice-versa.
  const { porVendedor, totais } = useMemo(() => {
    const trocaBonif = data?.por_vendedor || [];
    const mapa = new Map();

    // Inicializa com troca/bonif da função
    for (const r of trocaBonif) {
      mapa.set(r.vendedor_nome, {
        vendedor_nome: r.vendedor_nome,
        venda_valor: 0, venda_qtd: 0,
        troca_valor: r.troca_valor || 0, troca_qtd: r.troca_qtd || 0,
        bonif_valor: r.bonif_valor || 0, bonif_qtd: r.bonif_qtd || 0
      });
    }

    // Sobrescreve venda com o espelho (fonte correta)
    for (const [nome, vd] of Object.entries(vendaPorNome)) {
      if (!mapa.has(nome)) {
        mapa.set(nome, {
          vendedor_nome: nome,
          venda_valor: 0, venda_qtd: 0,
          troca_valor: 0, troca_qtd: 0,
          bonif_valor: 0, bonif_qtd: 0
        });
      }
      const r = mapa.get(nome);
      r.venda_valor = vd.venda_valor;
      r.venda_qtd = vd.venda_qtd;
    }

    // Filtro por vendedor_nome (aplicado nas 2 fontes; aqui aplica no merge final)
    let arr = Array.from(mapa.values());
    if (aplicado.vendedor_nome) {
      arr = arr.filter(r => r.vendedor_nome === aplicado.vendedor_nome);
    }

    // Recalcula % troca/venda com venda do espelho (denominador correto)
    arr = arr.map(r => ({
      ...r,
      perc_troca_venda: r.venda_valor > 0 ? +((r.troca_valor / r.venda_valor) * 100).toFixed(1) : 0
    })).sort((a, b) => b.venda_valor - a.venda_valor);

    const t = arr.reduce((acc, r) => ({
      venda_valor: arredondar2(acc.venda_valor + r.venda_valor),
      venda_qtd: acc.venda_qtd + r.venda_qtd,
      troca_valor: arredondar2(acc.troca_valor + r.troca_valor),
      troca_qtd: acc.troca_qtd + r.troca_qtd,
      bonif_valor: arredondar2(acc.bonif_valor + r.bonif_valor),
      bonif_qtd: acc.bonif_qtd + r.bonif_qtd
    }), { venda_valor: 0, venda_qtd: 0, troca_valor: 0, troca_qtd: 0, bonif_valor: 0, bonif_qtd: 0 });
    t.perc_troca_venda = t.venda_valor > 0 ? +((t.troca_valor / t.venda_valor) * 100).toFixed(1) : 0;

    return { porVendedor: arr, totais: t };
  }, [vendaPorNome, data, aplicado.vendedor_nome]);

  // Ranking de motivos: geral ou do vendedor selecionado
  const motivos = useMemo(() => {
    if (aplicado.vendedor_nome) {
      return data?.motivos_por_vendedor?.[aplicado.vendedor_nome] || [];
    }
    return data?.motivos || [];
  }, [data, aplicado.vendedor_nome]);

  const aplicar = () => setAplicado({ ...filtros });
  const limpar = () => {
    const reset = { inicio: inicioMes, fim: hoje, vendedor_nome: '' };
    setFiltros(reset);
    setAplicado(reset);
  };

  const exportar = () => exportarCSV('dashboard_vendedor',
    ['Vendedor', 'Vendas R$', 'Vendas Qtd', 'Trocas R$', 'Trocas Qtd', 'Bonif R$', 'Bonif Qtd', '% Troca/Venda'],
    [
      ...porVendedor.map(r => [r.vendedor_nome, r.venda_valor, r.venda_qtd, r.troca_valor, r.troca_qtd, r.bonif_valor, r.bonif_qtd, `${r.perc_troca_venda}%`]),
      ['TOTAL', totais.venda_valor, totais.venda_qtd, totais.troca_valor, totais.troca_qtd, totais.bonif_valor, totais.bonif_qtd, `${totais.perc_troca_venda}%`]
    ]
  );

  const carregando = (isLoadingEspelho && dadosEspelho.length === 0) || (isFetchingAgregados && !data);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card className="border-slate-200">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-slate-700"><Filter className="w-4 h-4" />Filtros</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={exportar}><Printer className="w-4 h-4" />Exportar / Imprimir</Button>
              <Button variant="ghost" size="sm" onClick={limpar}><RefreshCw className="w-4 h-4" />Limpar</Button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
            <div>
              <Label className="text-xs">Início</Label>
              <Input type="date" value={filtros.inicio} onChange={(e) => setFiltros({ ...filtros, inicio: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Fim</Label>
              <Input type="date" value={filtros.fim} onChange={(e) => setFiltros({ ...filtros, fim: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Vendedor</Label>
              <Select
                value={filtros.vendedor_nome || '_todos_'}
                onValueChange={(v) => setFiltros({ ...filtros, vendedor_nome: v === '_todos_' ? '' : v })}
              >
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_todos_">Todos os vendedores</SelectItem>
                  {vendedores.filter(v => v.status !== 'inativo' && v.nome).map(v => (
                    <SelectItem key={v.id} value={v.nome}>{v.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={aplicar} disabled={carregando} className="bg-indigo-600 hover:bg-indigo-700">
              {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Aplicar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Selinho de sync (venda vem do espelho) */}
      <div className="flex justify-end">
        <SyncStatusBadge
          ultimaSincronizacao={ultimaSincronizacao}
          isSincronizando={isSincronizando}
          erroSync={erroSync}
          onAtualizar={sincronizarAgora}
        />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard titulo="Vendas" valor={formatarMoeda(totais.venda_valor)} sub={`${formatarNumero(totais.venda_qtd)} NFs`} icon={DollarSign} cor="emerald" />
        <KpiCard titulo="Trocas" valor={formatarMoeda(totais.troca_valor)} sub={`${formatarNumero(totais.troca_qtd)} pedidos · ${totais.perc_troca_venda}% das vendas`} icon={ArrowLeftRight} cor="red" />
        <KpiCard titulo="Bonificações" valor={formatarMoeda(totais.bonif_valor)} sub={`${formatarNumero(totais.bonif_qtd)} pedidos`} icon={Gift} cor="amber" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Tabela por vendedor */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Por vendedor</CardTitle></CardHeader>
          <CardContent className="overflow-auto">
            {carregando && porVendedor.length === 0 ? (
              <div className="py-12 text-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
            ) : porVendedor.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-12">Nenhum dado no período.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-slate-600">
                    <th className="p-2 text-left">Vendedor</th>
                    <th className="p-2 text-right">Vendas R$</th>
                    <th className="p-2 text-right">Qtd</th>
                    <th className="p-2 text-right">Trocas R$</th>
                    <th className="p-2 text-right">Qtd</th>
                    <th className="p-2 text-right">Bonif R$</th>
                    <th className="p-2 text-right">Qtd</th>
                    <th className="p-2 text-right">% Troca/Venda</th>
                  </tr>
                </thead>
                <tbody>
                  {porVendedor.map((r) => (
                    <tr key={r.vendedor_nome} className="border-t hover:bg-slate-50">
                      <td className="p-2 font-medium">{r.vendedor_nome}</td>
                      <td className="p-2 text-right font-semibold text-emerald-700">{formatarMoeda(r.venda_valor)}</td>
                      <td className="p-2 text-right">{formatarNumero(r.venda_qtd)}</td>
                      <td className="p-2 text-right text-red-700">{formatarMoeda(r.troca_valor)}</td>
                      <td className="p-2 text-right">{formatarNumero(r.troca_qtd)}</td>
                      <td className="p-2 text-right text-amber-700">{formatarMoeda(r.bonif_valor)}</td>
                      <td className="p-2 text-right">{formatarNumero(r.bonif_qtd)}</td>
                      <td className={`p-2 text-right font-semibold ${r.perc_troca_venda >= 10 ? 'text-red-600' : 'text-slate-600'}`}>{r.perc_troca_venda}%</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                    <td className="p-2">TOTAL</td>
                    <td className="p-2 text-right text-emerald-700">{formatarMoeda(totais.venda_valor)}</td>
                    <td className="p-2 text-right">{formatarNumero(totais.venda_qtd)}</td>
                    <td className="p-2 text-right text-red-700">{formatarMoeda(totais.troca_valor)}</td>
                    <td className="p-2 text-right">{formatarNumero(totais.troca_qtd)}</td>
                    <td className="p-2 text-right text-amber-700">{formatarMoeda(totais.bonif_valor)}</td>
                    <td className="p-2 text-right">{formatarNumero(totais.bonif_qtd)}</td>
                    <td className="p-2 text-right">{totais.perc_troca_venda}%</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Motivos das trocas */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-red-500" />
              Motivos das Trocas
            </CardTitle>
            <p className="text-xs text-slate-500">
              {aplicado.vendedor_nome ? aplicado.vendedor_nome : 'Geral'} · por item ({formatarNumero(data?.total_itens_troca || 0)} itens)
            </p>
          </CardHeader>
          <CardContent>
            {motivos.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">Sem trocas no período.</p>
            ) : (
              <div className="space-y-2">
                {motivos.map((m) => (
                  <div key={m.motivo}>
                    <div className="flex justify-between text-sm mb-0.5">
                      <span className="font-medium text-slate-700">{m.motivo}</span>
                      <span className="text-slate-500">{formatarNumero(m.qtd)} · {m.perc}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-red-400 rounded-full" style={{ width: `${Math.min(m.perc, 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}