import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeftRight, AlertTriangle, Package, DollarSign, TrendingDown, Percent } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line
} from 'recharts';
import KpiCard from './KpiCard';
import FiltrosBase from './FiltrosBase';
import { dentroPeriodo, exportarCSV, formatarMoeda, formatarNumero, mesKey, arredondar2 } from './utilsAnalises';
import * as XLSX from 'xlsx';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';

const CORES = ['#dc2626', '#f59e0b', '#0891b2', '#7c3aed', '#16a34a', '#f97316', '#64748b'];
const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const formatMes = (k) => { const [a, m] = k.split('-'); return `${MESES_PT[+m-1]}/${a.slice(2)}`; };

export default function DashboardTrocas() {
  const [filtros, setFiltros] = useState({ inicio: '', fim: '', vendedor_id: '', motivo_id: '', rota_id: '' });
  const [exportando, setExportando] = useState(false);

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores_analise'],
    queryFn: () => base44.entities.Vendedor.list()
  });
  const { data: motivosTroca = [] } = useQuery({
    queryKey: ['motivosTroca'],
    queryFn: () => base44.entities.MotivoTroca.list()
  });
  const { data: rotas = [] } = useQuery({
    queryKey: ['rotas_analise'],
    queryFn: () => base44.entities.Rota.list()
  });
  // Só precisamos do vínculo cliente→vendedor/rota: projetar campos mínimos e limitar a 1000 (base tem ~958).
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes_vinculo_vendedor'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 2000),
    staleTime: 5 * 60 * 1000
  });
  // Trocas via Pedido tipo=troca faturados (fonte principal — integração Omie)
  const { data: trocasPedido = [], isLoading: loadingTP } = useQuery({
    queryKey: ['pedidos_troca_faturados'],
    queryFn: () => base44.entities.Pedido.filter({ tipo: 'troca', status: 'faturado' }, '-data_faturamento', 5000)
  });
  // Itens das trocas faturadas — é AQUI que ficam a quantidade (pacotes) e o motivo por item.
  // O cabeçalho do Pedido só traz valor_total; sem os itens não há quantidade nem motivo.
  const { data: itensTroca = [] } = useQuery({
    queryKey: ['pedido_itens_troca'],
    queryFn: () => base44.entities.PedidoItem.filter({}, '-created_date', 20000),
    staleTime: 5 * 60 * 1000
  });
  // Trocas de visita (registradas pelo app do vendedor em campo)
  const { data: trocasVisita = [], isLoading: loadingTV } = useQuery({
    queryKey: ['trocas_visita'],
    queryFn: () => base44.entities.TrocaVisita.list('-created_date', 5000)
  });
  // LogCorte — cortes de produto nos pedidos
  const { data: cortes = [] } = useQuery({
    queryKey: ['log_cortes'],
    queryFn: () => base44.entities.LogCorte.list('-created_date', 5000)
  });

  // Mapa cliente_id → vendedor (rota resolvida pelo cadastro de rotas)
  const vendedorPorCliente = useMemo(() => {
    const nomesVend = new Map(vendedores.map(v => [v.id, v.nome]));
    const nomesRota = new Map(rotas.map(r => [r.id, r.nome]));
    const map = new Map();
    clientes.forEach(c => {
      if (c.id && c.vendedor_id) map.set(c.id, { id: c.vendedor_id, nome: nomesVend.get(c.vendedor_id) || '-', rota_id: c.rota_id, rota_nome: nomesRota.get(c.rota_id) || '' });
    });
    return map;
  }, [clientes, vendedores, rotas]);

  // Agrega os itens por pedido: soma de quantidade (pacotes) e motivo (do item).
  // O motivo costuma vir nos itens da troca, não no cabeçalho do pedido.
  const resumoItensPorPedido = useMemo(() => {
    const map = new Map();
    const nomeMotivo = new Map(motivosTroca.map(m => [m.id, m.descricao || m.nome]));
    itensTroca.forEach(it => {
      if (!it.pedido_id) return;
      if (!map.has(it.pedido_id)) map.set(it.pedido_id, { quantidade: 0, motivos: new Set() });
      const r = map.get(it.pedido_id);
      r.quantidade += Number(it.quantidade || 0);
      const mot = it.motivo_troca_descricao || nomeMotivo.get(it.motivo_troca_id) || '';
      if (mot) r.motivos.add(mot);
    });
    return map;
  }, [itensTroca, motivosTroca]);

  const trocasEnriquecidas = useMemo(() => trocasPedido.map(t => {
    const v = vendedorPorCliente.get(t.cliente_id);
    const resItens = resumoItensPorPedido.get(t.id);
    const qtdPacotes = resItens?.quantidade ?? Number(t.qtd_total_itens || t.total_itens || 0);
    const motivosItens = resItens && resItens.motivos.size ? Array.from(resItens.motivos).join(', ') : '';
    const motivoFinal = t.motivo_troca_descricao || motivosItens || '';
    return { ...t, vendedor_id: v?.id || t.vendedor_id, vendedor_nome: v?.nome || t.vendedor_nome, rota_id: v?.rota_id || t.rota_id, rota_nome: v?.rota_nome || t.rota_nome, qtd_pacotes: qtdPacotes, motivo_troca_descricao: motivoFinal };
  }), [trocasPedido, vendedorPorCliente, resumoItensPorPedido]);

  const filtradas = useMemo(() => trocasEnriquecidas.filter(t => {
    if (filtros.vendedor_id && t.vendedor_id !== filtros.vendedor_id) return false;
    if (filtros.rota_id && t.rota_id !== filtros.rota_id) return false;
    if (filtros.motivo_id && t.motivo_troca_id !== filtros.motivo_id) return false;
    const dataRef = t.data_faturamento || t.created_date;
    if ((filtros.inicio || filtros.fim) && !dentroPeriodo(dataRef, filtros.inicio, filtros.fim)) return false;
    return true;
  }), [trocasEnriquecidas, filtros]);

  // Trocas de visita filtradas pelo período
  const trocasVisitaFiltradas = useMemo(() => trocasVisita.filter(t => {
    if (filtros.vendedor_id && t.vendedor_id !== filtros.vendedor_id) return false;
    if ((filtros.inicio || filtros.fim) && !dentroPeriodo(t.created_date, filtros.inicio, filtros.fim)) return false;
    return true;
  }), [trocasVisita, filtros]);

  const totais = useMemo(() => {
    const valor = arredondar2(filtradas.reduce((a, t) => a + arredondar2(t.valor_total), 0));
    const ticket = filtradas.length ? arredondar2(valor / filtradas.length) : 0;
    const pacotes = filtradas.reduce((a, t) => a + (t.qtd_pacotes || 0), 0);
    const qtdVisita = trocasVisitaFiltradas.length;
    // Qtd de itens trocados via visita
    const itensTrocadosVisita = trocasVisitaFiltradas.reduce((a, t) => a + (t.quantidade || 0), 0);
    return { total: filtradas.length, valor, ticket, pacotes, qtdVisita, itensTrocadosVisita };
  }, [filtradas, trocasVisitaFiltradas]);

  // Por motivo (pedido) — agrega quantidade de PACOTES por motivo (não só nº de pedidos)
  const porMotivo = useMemo(() => {
    const m = {};
    filtradas.forEach(t => {
      const k = t.motivo_troca_descricao || motivosTroca.find(x => x.id === t.motivo_troca_id)?.descricao || 'Sem motivo';
      if (!m[k]) m[k] = { qtd: 0, pacotes: 0 };
      m[k].qtd += 1;
      m[k].pacotes += Number(t.qtd_pacotes || 0);
    });
    return Object.entries(m).map(([motivo, v]) => ({ motivo, qtd: v.qtd, pacotes: v.pacotes })).sort((a, b) => b.qtd - a.qtd).slice(0, 7);
  }, [filtradas, motivosTroca]);

  // Motivos de troca via visita
  const porMotivoVisita = useMemo(() => {
    const m = {};
    trocasVisitaFiltradas.forEach(t => {
      const k = t.motivo_troca || 'Sem motivo';
      if (!m[k]) m[k] = { motivo: k.replace(/_/g, ' '), qtd: 0, itens: 0 };
      m[k].qtd++;
      m[k].itens += t.quantidade || 0;
    });
    return Object.values(m).sort((a, b) => b.itens - a.itens).slice(0, 7);
  }, [trocasVisitaFiltradas]);

  // Por vendedor
  const porVendedor = useMemo(() => {
    const v = {};
    filtradas.forEach(t => {
      const k = t.vendedor_nome || '-';
      if (!v[k]) v[k] = { nome: k, qtd: 0, valor: 0 };
      v[k].qtd++; v[k].valor = arredondar2(v[k].valor + arredondar2(t.valor_total));
    });
    return Object.values(v).sort((a, b) => b.valor - a.valor).slice(0, 10);
  }, [filtradas]);

  // Top produtos trocados via visita
  const topProdutosVisita = useMemo(() => {
    const p = {};
    trocasVisitaFiltradas.forEach(t => {
      const k = t.produto_nome || t.produto_codigo || 'Desconhecido';
      if (!p[k]) p[k] = { nome: k, qtd: 0, ocorrencias: 0 };
      p[k].qtd += t.quantidade || 0;
      p[k].ocorrencias++;
    });
    return Object.values(p).sort((a, b) => b.qtd - a.qtd).slice(0, 8);
  }, [trocasVisitaFiltradas]);

  // Evolução mensal
  const evolucaoMensal = useMemo(() => {
    const grupo = {};
    filtradas.forEach(t => {
      const k = mesKey(t.data_faturamento || t.created_date);
      if (!k || k.length < 7) return;
      if (!grupo[k]) grupo[k] = { mes: k, label: formatMes(k), valor: 0, qtd: 0 };
      grupo[k].valor = arredondar2(grupo[k].valor + arredondar2(t.valor_total));
      grupo[k].qtd++;
    });
    return Object.values(grupo).sort((a, b) => a.mes.localeCompare(b.mes)).slice(-12);
  }, [filtradas]);

  // Cortes no período (análise complementar de trocas)
  const analiseCortes = useMemo(() => {
    const cf = cortes.filter(c => {
      if (!filtros.inicio && !filtros.fim) return true;
      return dentroPeriodo(c.created_date, filtros.inicio, filtros.fim);
    });
    const valorCortado = arredondar2(cf.reduce((a, c) => a + arredondar2(c.valor_cortado), 0));
    return { total: cf.length, valorCortado };
  }, [cortes, filtros]);

  const exportar = async () => {
    if (exportando) return;
    setExportando(true);
    try {
      if (filtradas.length === 0) {
        alert('Nenhuma troca no filtro atual para exportar.');
        return;
      }

      // Chama getItensPedidosLote em lotes de 200 ids para evitar payload enorme / 500
      const pedido_ids = filtradas.map(t => t.id);
      const LOTE = 200;
      const itensPorPedidoRaw = {};
      for (let i = 0; i < pedido_ids.length; i += LOTE) {
        const chunk = pedido_ids.slice(i, i + LOTE);
        const resp = await base44.functions.invoke('getItensPedidosLote', { pedido_ids: chunk, troca_ids: [] });
        const parcial = resp?.data?.itens_pedido || {};
        Object.assign(itensPorPedidoRaw, parcial);
      }

      const itensSemDup = Object.values(itensPorPedidoRaw).flat();

      // Indexa: pedido_id → Map(produto_nome → { qtd, motivo })
      const itensPorPedido = new Map();
      itensSemDup.forEach(it => {
        if (!it.pedido_id) return;
        if (!itensPorPedido.has(it.pedido_id)) itensPorPedido.set(it.pedido_id, new Map());
        const prods = itensPorPedido.get(it.pedido_id);
        const nome = it.produto_nome || it.produto_codigo || '(sem nome)';
        const atual = prods.get(nome) || { qtd: 0, motivo: '' };
        atual.qtd += Number(it.quantidade || 0);
        if (!atual.motivo && it.motivo_troca_descricao) atual.motivo = it.motivo_troca_descricao;
        prods.set(nome, atual);
      });


      // Aba Resumo: produto × motivo agregado, Qtd como número
      const resumoMap = new Map();
      filtradas.forEach(t => {
        const prods = itensPorPedido.get(t.id);
        if (prods && prods.size > 0) {
          prods.forEach(({ qtd, motivo }, nomeProd) => {
            const motFinal = motivo || t.motivo_troca_descricao || 'Sem motivo';
            const chave = nomeProd + '||' + motFinal;
            const r = resumoMap.get(chave) || { produto: nomeProd, motivo: motFinal, qtd: 0 };
            r.qtd += qtd;
            resumoMap.set(chave, r);
          });
        } else {
          const motFinal = t.motivo_troca_descricao || 'Sem motivo';
          const chave = '(sem itens detalhados)||' + motFinal;
          const r = resumoMap.get(chave) || { produto: '(sem itens detalhados)', motivo: motFinal, qtd: 0 };
          r.qtd += Number(t.qtd_total_itens || t.total_itens || 0);
          resumoMap.set(chave, r);
        }
      });
      const linhasResumo = [...resumoMap.values()].sort((a, b) => b.qtd - a.qtd);

      // Aba Detalhe: uma linha por produto por troca, Qtd e Valor como número
      const linhasDetalhe = [];
      filtradas.forEach(t => {
        const data = (t.data_faturamento || t.created_date)?.slice(0, 10) || '';
        const numPed = formatarNumeroPedido(t);
        const prods = itensPorPedido.get(t.id);
        if (prods && prods.size > 0) {
          prods.forEach(({ qtd, motivo }, nomeProd) => {
            linhasDetalhe.push([data, numPed, t.cliente_nome, t.vendedor_nome, t.rota_nome,
              motivo || t.motivo_troca_descricao, nomeProd, Number(qtd), Number(t.valor_total || 0), t.status]);
          });
        } else {
          linhasDetalhe.push([data, numPed, t.cliente_nome, t.vendedor_nome, t.rota_nome,
            t.motivo_troca_descricao, '(sem itens detalhados)',
            Number(t.qtd_total_itens || t.total_itens || 0), Number(t.valor_total || 0), t.status]);
        }
      });

      const wb = XLSX.utils.book_new();
      const wsResumo = XLSX.utils.aoa_to_sheet([
        ['Produto', 'Motivo', 'Qtd Total (pacotes)'],
        ...linhasResumo.map(r => [r.produto, r.motivo, r.qtd])
      ]);
      const wsDetalhe = XLSX.utils.aoa_to_sheet([
        ['Data Faturamento', 'Nº Pedido', 'Cliente', 'Vendedor', 'Rota', 'Motivo', 'Produto', 'Qtd (pacotes)', 'Valor Troca', 'Status'],
        ...linhasDetalhe
      ]);
      wsResumo['!cols'] = [{wch:45},{wch:30},{wch:18}];
      wsDetalhe['!cols'] = [{wch:14},{wch:12},{wch:32},{wch:26},{wch:14},{wch:20},{wch:40},{wch:14},{wch:14},{wch:12}];
      XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');
      XLSX.utils.book_append_sheet(wb, wsDetalhe, 'Detalhe');
      XLSX.writeFile(wb, `dashboard_trocas_detalhado_${new Date().toISOString().slice(0,10)}.xlsx`);

      console.log(`[Exportar Trocas] linhasDetalhe=${linhasDetalhe.length} | linhasResumo=${linhasResumo.length} | itens=${itensSemDup.length}`);
    } finally {
      setExportando(false);
    }
  };

  return (
    <div className="space-y-4">
      <FiltrosBase filtros={filtros} setFiltros={setFiltros} vendedores={vendedores}
        onLimpar={() => setFiltros({ inicio: '', fim: '', vendedor_id: '', motivo_id: '', rota_id: '' })}
        onExportar={exportar} exportandoCSV={exportando}>
        <div>
          <Label className="text-xs">Motivo</Label>
          <Select value={filtros.motivo_id || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, motivo_id: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todos os motivos</SelectItem>
              {motivosTroca.map(m => <SelectItem key={m.id} value={m.id}>{m.descricao || m.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Rota</Label>
          <Select value={filtros.rota_id || '_todos_'} onValueChange={(v) => setFiltros({ ...filtros, rota_id: v === '_todos_' ? '' : v })}>
            <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_todos_">Todas as rotas</SelectItem>
              {rotas.map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </FiltrosBase>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard titulo="Trocas (faturadas)" valor={formatarNumero(totais.total)} icon={ArrowLeftRight} cor="red" />
        <KpiCard titulo="Pacotes trocados" valor={formatarNumero(totais.pacotes)} icon={Package} cor="orange" />
        <KpiCard titulo="Valor total" valor={formatarMoeda(totais.valor)} icon={DollarSign} cor="amber" />
        <KpiCard titulo="Ticket médio" valor={formatarMoeda(totais.ticket)} icon={AlertTriangle} cor="indigo" />
        <KpiCard titulo="Trocas visita" valor={formatarNumero(totais.qtdVisita)} sub={`${formatarNumero(totais.itensTrocadosVisita)} itens`} icon={Package} cor="cyan" />
        <KpiCard titulo="Cortes de produto" valor={formatarNumero(analiseCortes.total)} sub={formatarMoeda(analiseCortes.valorCortado)} icon={TrendingDown} cor="slate" />
      </div>

      {/* Motivos pedido + motivos visita */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Motivos de troca (pedidos faturados)</CardTitle></CardHeader>
          <CardContent>
            {porMotivo.length === 0
              ? <p className="text-sm text-slate-400 text-center py-12">Sem dados</p>
              : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={porMotivo} dataKey="qtd" nameKey="motivo" outerRadius={90} label={({ motivo, percent }) => `${motivo.slice(0,15)} ${(percent*100).toFixed(0)}%`}>
                    {porMotivo.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v, n, item) => [`${v} troca(s) • ${formatarNumero(item?.payload?.pacotes || 0)} pacotes`, item?.payload?.motivo]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Motivos de troca (registros em visita)</CardTitle>
          </CardHeader>
          <CardContent>
            {porMotivoVisita.length === 0
              ? <p className="text-sm text-slate-400 text-center py-12">Sem registros de visita</p>
              : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={porMotivoVisita} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="motivo" type="category" width={130} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="itens" fill="#f59e0b" name="Itens trocados" />
                  <Bar dataKey="qtd" fill="#dc2626" name="Ocorrências" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Por vendedor + Evolução mensal */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Trocas por vendedor</CardTitle></CardHeader>
          <CardContent>
            {porVendedor.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
              : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={porVendedor} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="nome" type="category" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, n) => n === 'valor' ? formatarMoeda(v) : v} />
                  <Legend />
                  <Bar dataKey="qtd" fill="#dc2626" name="Qtd trocas" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Evolução mensal de trocas</CardTitle></CardHeader>
          <CardContent>
            {evolucaoMensal.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">Sem dados</p>
              : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={evolucaoMensal}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v, n) => n === 'valor' ? formatarMoeda(v) : v} />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="qtd" stroke="#dc2626" strokeWidth={2} name="Qtd trocas" />
                  <Line yAxisId="right" type="monotone" dataKey="valor" stroke="#f59e0b" strokeWidth={2} name="Valor" strokeDasharray="4 4" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top produtos trocados em visita */}
      {topProdutosVisita.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Top produtos trocados em visita</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topProdutosVisita} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="nome" type="category" width={160} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="qtd" fill="#7c3aed" name="Qtd itens" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Tabela */}
      <Card>
        <CardHeader><CardTitle className="text-base">Detalhe das trocas</CardTitle></CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="p-2 text-left">Faturamento</th>
                <th className="p-2 text-left">Nº</th>
                <th className="p-2 text-left">Cliente</th>
                <th className="p-2 text-left">Vendedor</th>
                <th className="p-2 text-left">Rota</th>
                <th className="p-2 text-left">Motivo</th>
                <th className="p-2 text-right">Qtd (pacotes)</th>
                <th className="p-2 text-right">Valor</th>
                <th className="p-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.slice(0, 200).map(t => (
                <tr key={t.id} className="border-t hover:bg-slate-50">
                  <td className="p-2 text-xs">{(t.data_faturamento || t.created_date || '').slice(0,10)}</td>
                  <td className="p-2 font-mono text-xs">{t.numero_pedido ? formatarNumeroPedido(t) : '-'}</td>
                  <td className="p-2 max-w-[180px] truncate">{t.cliente_nome || '-'}</td>
                  <td className="p-2 max-w-[120px] truncate">{t.vendedor_nome || '-'}</td>
                  <td className="p-2 text-xs text-slate-600">{t.rota_nome || '-'}</td>
                  <td className="p-2 text-xs text-slate-600 max-w-[140px] truncate">{t.motivo_troca_descricao || '-'}</td>
                  <td className="p-2 text-right font-medium">{formatarNumero(t.qtd_pacotes || 0)}</td>
                  <td className="p-2 text-right font-medium">{formatarMoeda(t.valor_total)}</td>
                  <td className="p-2"><Badge>{t.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtradas.length > 200 && <p className="text-xs text-slate-500 mt-2">Exibindo 200 de {filtradas.length}. Use Exportar para o relatório completo.</p>}
        </CardContent>
      </Card>
    </div>
  );
}