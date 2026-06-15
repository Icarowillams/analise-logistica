import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ChevronRight, Calendar, User, Filter, Download } from 'lucide-react';
import { dentroPeriodo, exportarCSV, formatarMoeda } from '@/components/analises/utilsAnalises';

export default function RelatorioTrocas() {
  const [filtros, setFiltros] = useState({ inicio: '', fim: '', vendedor_id: '', motivo_id: '', cliente_id: '', rede_id: '', busca: '' });
  const [expClient, setExpClient] = useState({});
  const [expVisita, setExpVisita] = useState({});

  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: redes = [] } = useQuery({ queryKey: ['redes'], queryFn: () => base44.entities.Rede.list() });
  const { data: motivos = [] } = useQuery({ queryKey: ['motivosTroca'], queryFn: () => base44.entities.MotivoTroca.list() });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes_relatorio_trocas'], queryFn: () => base44.entities.Cliente.list('-updated_date', 1000, ['id', 'razao_social', 'rede_id']), staleTime: 5 * 60 * 1000 });
  const { data: visitas = [] } = useQuery({ queryKey: ['visitas'], queryFn: () => base44.entities.VisitaRoteiro.list('-data_visita', 10000) });

  const clienteRedeMap = useMemo(() => new Map(clientes.map(c => [c.id, c.rede_id])), [clientes]);

  const visitasComTroca = useMemo(() => visitas.filter(v => (v.trocas_itens || []).length > 0
    && (!filtros.vendedor_id || v.vendedor_id === filtros.vendedor_id)
    && (!filtros.cliente_id || v.cliente_id === filtros.cliente_id)
    && (!filtros.rede_id || clienteRedeMap.get(v.cliente_id) === filtros.rede_id)
    && (!filtros.motivo_id || (v.trocas_itens || []).some(i => i.motivo_id === filtros.motivo_id))
    && (!filtros.busca || `${v.cliente_nome} ${(v.trocas_itens || []).map(i => i.produto_nome + ' ' + (i.motivo_descricao || '')).join(' ')}`.toLowerCase().includes(filtros.busca.toLowerCase()))
    && ((!filtros.inicio && !filtros.fim) || dentroPeriodo(v.data_visita, filtros.inicio, filtros.fim))), [visitas, filtros, clienteRedeMap]);

  const totais = useMemo(() => {
    let qtd = 0; let valor = 0; let registros = 0;
    visitasComTroca.forEach(v => (v.trocas_itens || []).forEach(t => { qtd += t.quantidade || 0; valor += t.valor || 0; registros++; }));
    const clientesSet = new Set(visitasComTroca.map(v => v.cliente_id));
    return { registros, qtd, clientes: clientesSet.size, valor };
  }, [visitasComTroca]);

  const agrupado = useMemo(() => {
    const g = {};
    visitasComTroca.forEach(v => {
      const k = v.cliente_id;
      if (!g[k]) g[k] = { cliente_id: k, cliente_nome: v.cliente_nome, visitas: [], totalLanc: 0, totalUn: 0 };
      g[k].visitas.push(v);
      g[k].totalLanc += (v.trocas_itens || []).length;
      g[k].totalUn += (v.trocas_itens || []).reduce((a, i) => a + (i.quantidade || 0), 0);
    });
    return Object.values(g).sort((a, b) => a.cliente_nome.localeCompare(b.cliente_nome));
  }, [visitasComTroca]);

  const exportar = () => exportarCSV('relatorio_trocas',
    ['Cliente', 'Data', 'Vendedor', 'Produto', 'Qtd', 'Valor', 'Motivo'],
    visitasComTroca.flatMap(v => (v.trocas_itens || []).map(i => [v.cliente_nome, v.data_visita, v.vendedor_nome, i.produto_nome, i.quantidade, i.valor, i.motivo_descricao])));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center"><div><p className="text-sm text-slate-500">{totais.registros} registros</p></div><div className="flex gap-2"><Button variant="outline" size="sm"><Filter className="w-4 h-4" />Filtros</Button><Button variant="outline" size="sm" onClick={exportar}><Download className="w-4 h-4" />Exportar CSV</Button></div></div>

      <Card className="bg-rose-50 border-rose-200"><CardContent className="p-4"><h3 className="text-sm font-semibold text-rose-700">Trocas de Visitas</h3><p className="text-xs text-rose-600 mt-1">Registros de trocas coletados durante visitas pelos promotores nos formulários dos roteiros.</p></CardContent></Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="border-rose-200 bg-rose-50"><CardContent className="p-4"><p className="text-3xl font-bold text-rose-600">{totais.registros}</p><p className="text-xs text-rose-700">Registros</p></CardContent></Card>
        <Card className="border-amber-200 bg-amber-50"><CardContent className="p-4"><p className="text-3xl font-bold text-amber-600">{totais.qtd}</p><p className="text-xs text-amber-700">Quantidade Total</p></CardContent></Card>
        <Card className="border-purple-200 bg-purple-50"><CardContent className="p-4"><p className="text-3xl font-bold text-purple-600">{totais.clientes}</p><p className="text-xs text-purple-700">Clientes</p></CardContent></Card>
      </div>

      <Card><CardContent className="p-4 grid grid-cols-2 md:grid-cols-7 gap-3">
        <div><Label className="text-xs">Data Início</Label><Input type="date" value={filtros.inicio} onChange={(e) => setFiltros({ ...filtros, inicio: e.target.value })} /></div>
        <div><Label className="text-xs">Data Fim</Label><Input type="date" value={filtros.fim} onChange={(e) => setFiltros({ ...filtros, fim: e.target.value })} /></div>
        <div><Label className="text-xs">Func. Lançamento</Label><Select value={filtros.vendedor_id || '_t_'} onValueChange={(v) => setFiltros({ ...filtros, vendedor_id: v === '_t_' ? '' : v })}><SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent><SelectItem value="_t_">Todos</SelectItem>{vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-xs">Motivo</Label><Select value={filtros.motivo_id || '_t_'} onValueChange={(v) => setFiltros({ ...filtros, motivo_id: v === '_t_' ? '' : v })}><SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent><SelectItem value="_t_">Todos</SelectItem>{motivos.map(m => <SelectItem key={m.id} value={m.id}>{m.descricao}</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-xs">Rede</Label><Select value={filtros.rede_id || '_t_'} onValueChange={(v) => setFiltros({ ...filtros, rede_id: v === '_t_' ? '' : v })}><SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger><SelectContent><SelectItem value="_t_">Todas</SelectItem>{redes.map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-xs">Buscar</Label><Input value={filtros.busca} onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })} placeholder="Produto, motivo..." /></div>
        <div><Label className="text-xs">Cliente</Label><Select value={filtros.cliente_id || '_t_'} onValueChange={(v) => setFiltros({ ...filtros, cliente_id: v === '_t_' ? '' : v })}><SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent><SelectItem value="_t_">Todos</SelectItem>{clientes.slice(0, 200).map(c => <SelectItem key={c.id} value={c.id}>{c.razao_social}</SelectItem>)}</SelectContent></Select></div>
      </CardContent></Card>

      <div className="space-y-2">{agrupado.map(c => (
        <div key={c.cliente_id} className="rounded-xl bg-white border shadow-sm overflow-hidden">
          <div className="flex justify-between items-center p-3 cursor-pointer hover:bg-slate-50" onClick={() => setExpClient({ ...expClient, [c.cliente_id]: !expClient[c.cliente_id] })}>
            <div className="flex items-center gap-2"><ChevronRight className={`w-4 h-4 transition ${expClient[c.cliente_id] ? 'rotate-90' : ''}`} /><div><p className="font-bold uppercase">{c.cliente_nome}</p><p className="text-xs text-slate-500">{c.totalLanc} lanç. • {c.totalUn} un.</p></div></div>
            <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 text-xs">{c.visitas.length} vis.</span>
          </div>
          {expClient[c.cliente_id] && (
            <div className="border-t bg-slate-50 px-4 py-2 space-y-1">{c.visitas.map(v => (
              <div key={v.id} className="bg-white rounded border">
                <div className="flex justify-between items-center p-2 cursor-pointer hover:bg-slate-50" onClick={() => setExpVisita({ ...expVisita, [v.id]: !expVisita[v.id] })}>
                  <div className="flex items-center gap-2 text-sm"><ChevronRight className={`w-3 h-3 ${expVisita[v.id] ? 'rotate-90' : ''}`} /><Calendar className="w-3 h-3 text-slate-400" />{new Date(v.data_visita).toLocaleDateString('pt-BR')} <User className="w-3 h-3 text-slate-400 ml-2" /><span className="uppercase text-xs">{v.vendedor_nome}</span></div>
                  <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-700 text-xs">{(v.trocas_itens || []).length} prod.</span>
                </div>
                {expVisita[v.id] && (<div className="px-3 pb-2 space-y-1">{(v.trocas_itens || []).map((i, idx) => (<div key={idx} className="flex justify-between text-xs border-t pt-1"><span><span className="font-medium">{i.produto_nome}</span> <span className="text-slate-500">— {i.motivo_descricao || 'sem motivo'}</span></span><div className="flex items-center gap-2"><span>{i.quantidade} un</span>{i.valor > 0 && <span className="text-emerald-600">{formatarMoeda(i.valor)}</span>}</div></div>))}</div>)}
              </div>
            ))}</div>
          )}
        </div>
      ))}</div>
    </div>
  );
}