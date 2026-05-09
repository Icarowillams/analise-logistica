import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Filter, ChevronDown, Users, MapPin, CheckCircle2, ShoppingCart, XCircle, ClipboardList } from 'lucide-react';
import { DIAS_SEMANA, diaParaKey } from './roteirosUtils';

const KpiPainel = ({ titulo, valor, sub, icon: Icon, cor }) => (
  <div className={`rounded-2xl p-4 text-white shadow-md ${cor}`}>
    <div className="flex justify-between items-start"><div><p className="text-xs opacity-80">{titulo}</p><p className="text-3xl font-bold mt-1">{valor}</p><p className="text-[11px] opacity-80 mt-1 truncate">{sub}</p></div><Icon className="w-7 h-7 opacity-70" /></div>
  </div>
);

export default function PainelRoteiros({ vendedores, supervisores }) {
  const [filtros, setFiltros] = useState({ dia: '', vendedor_id: '', funcao: '', supervisor_id: '', inicio: '', fim: '', busca: '' });
  const { data: roteiros = [] } = useQuery({ queryKey: ['roteiros'], queryFn: () => base44.entities.Roteiro.list('-updated_date', 5000) });
  const { data: visitas = [] } = useQuery({ queryKey: ['visitasRoteiro'], queryFn: () => base44.entities.VisitaRoteiro.list('-updated_date', 10000) });

  const filtrados = useMemo(() => roteiros.filter(r => {
    if (filtros.dia && diaParaKey(r.dia_semana) !== filtros.dia) return false;
    if (filtros.vendedor_id && r.vendedor_id !== filtros.vendedor_id) return false;
    if (filtros.supervisor_id) {
      const v = vendedores.find(x => x.id === r.vendedor_id);
      if (!v || (v.supervisor_id !== filtros.supervisor_id && !v.supervisor_ids?.includes(filtros.supervisor_id))) return false;
    }
    if (filtros.busca && !(r.vendedor_nome || '').toLowerCase().includes(filtros.busca.toLowerCase())) return false;
    return true;
  }), [roteiros, filtros, vendedores]);

  const totaisGerais = useMemo(() => {
    const clientesUnicos = new Set();
    roteiros.forEach(r => (r.clientes_ids || []).forEach(id => clientesUnicos.add(id)));
    const realizadas = visitas.filter(v => v.status === 'concluida').length;
    const naoAtendidas = visitas.filter(v => v.status === 'nao_atendimento').length;
    const comPedido = visitas.filter(v => v.gerou_pedido).length;
    const semPedido = realizadas - comPedido;
    return { totalRoteiros: roteiros.length, vendedoresAtivos: new Set(roteiros.map(r => r.vendedor_id)).size, clientes: clientesUnicos.size, realizadas, comPedido: Math.max(comPedido, 0), semPedido: Math.max(semPedido, 0) };
  }, [roteiros, visitas]);

  const porFuncionario = useMemo(() => {
    const grupo = {};
    filtrados.forEach(r => {
      const v = vendedores.find(x => x.id === r.vendedor_id);
      if (!v) return;
      if (!grupo[v.id]) {
        const sup = vendedores.find(x => x.id === v.supervisor_id);
        grupo[v.id] = { id: v.id, nome: v.nome, supervisor: sup?.nome || '-', clientes: 0, atendidos: 0, naoAtendidos: 0, pendentes: 0, dias: 0, roteiros: [] };
      }
      grupo[v.id].roteiros.push(r);
      grupo[v.id].dias += 1;
      const cs = r.clientes_detalhes || [];
      cs.forEach(c => {
        grupo[v.id].clientes++;
        const visita = visitas.find(x => x.roteiro_id === r.id && x.cliente_id === c.cliente_id);
        if (visita?.status === 'concluida') grupo[v.id].atendidos++;
        else if (visita?.status === 'nao_atendimento') grupo[v.id].naoAtendidos++;
        else grupo[v.id].pendentes++;
      });
    });
    return Object.values(grupo).map(g => ({ ...g, conversao: g.clientes ? Math.round((g.atendidos / g.clientes) * 1000) / 10 : 0 })).sort((a, b) => b.clientes - a.clientes);
  }, [filtrados, vendedores, visitas]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiPainel titulo="Roteiros" valor={totaisGerais.totalRoteiros} sub="cadastrados" icon={ClipboardList} cor="bg-gradient-to-br from-amber-400 to-amber-600" />
        <KpiPainel titulo="Vendedores" valor={totaisGerais.vendedoresAtivos} sub="com roteiro" icon={Users} cor="bg-gradient-to-br from-sky-400 to-blue-600" />
        <KpiPainel titulo="Clientes" valor={totaisGerais.clientes.toLocaleString('pt-BR')} sub="nos roteiros" icon={MapPin} cor="bg-gradient-to-br from-purple-400 to-purple-700" />
        <KpiPainel titulo="Visitas" valor={totaisGerais.realizadas} sub="realizadas" icon={CheckCircle2} cor="bg-gradient-to-br from-emerald-400 to-emerald-700" />
        <KpiPainel titulo="Pedidos" valor={totaisGerais.comPedido} sub="solicitados" icon={ShoppingCart} cor="bg-gradient-to-br from-orange-400 to-orange-600" />
        <KpiPainel titulo="Sem Pedido" valor={totaisGerais.semPedido} sub="não solicitaram" icon={XCircle} cor="bg-gradient-to-br from-red-400 to-rose-600" />
      </div>

      <Tabs defaultValue="roteiros" className="w-full">
        <TabsList className="bg-transparent border-b w-full justify-start rounded-none p-0">
          <TabsTrigger value="roteiros" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-amber-500">Roteiros</TabsTrigger>
          <TabsTrigger value="visitasdia" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-amber-500">Visitas do Dia</TabsTrigger>
          <TabsTrigger value="pendentes" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-amber-500">Visitas Pendentes</TabsTrigger>
          <TabsTrigger value="analises" className="rounded-none data-[state=active]:border-b-2 data-[state=active]:border-amber-500">Análises</TabsTrigger>
        </TabsList>

        <TabsContent value="roteiros" className="space-y-4 pt-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2"><Filter className="w-4 h-4" />Filtros</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><Label className="text-xs">Dia da Semana</Label><Select value={filtros.dia || '_t_'} onValueChange={(v) => setFiltros({ ...filtros, dia: v === '_t_' ? '' : v })}><SelectTrigger><SelectValue placeholder="Todos os dias" /></SelectTrigger><SelectContent><SelectItem value="_t_">Todos os dias</SelectItem>{DIAS_SEMANA.map(d => <SelectItem key={d.key} value={d.key}>{d.curto}</SelectItem>)}</SelectContent></Select></div>
                <div><Label className="text-xs">Funcionário</Label><Select value={filtros.vendedor_id || '_t_'} onValueChange={(v) => setFiltros({ ...filtros, vendedor_id: v === '_t_' ? '' : v })}><SelectTrigger><SelectValue placeholder="Todos os funcionários" /></SelectTrigger><SelectContent><SelectItem value="_t_">Todos os funcionários</SelectItem>{vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent></Select></div>
                <div><Label className="text-xs">Supervisor</Label><Select value={filtros.supervisor_id || '_t_'} onValueChange={(v) => setFiltros({ ...filtros, supervisor_id: v === '_t_' ? '' : v })}><SelectTrigger><SelectValue placeholder="Todos os supervisores" /></SelectTrigger><SelectContent><SelectItem value="_t_">Todos os supervisores</SelectItem>{supervisores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}</SelectContent></Select></div>
                <div><Label className="text-xs">Buscar</Label><Input placeholder="Buscar roteiros..." value={filtros.busca} onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })} /></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <p className="font-semibold mb-3">Roteiros por Funcionário ({porFuncionario.length} funcionários)</p>
              <div className="space-y-2">
                {porFuncionario.map(f => (
                  <div key={f.id} className="rounded-lg border bg-white p-3 flex flex-wrap items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold">{f.nome[0]}</div>
                    <div className="flex-1 min-w-[180px]">
                      <p className="font-semibold uppercase text-sm">{f.nome}</p>
                      <span className="inline-block text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-700 mt-1">Sup: {f.supervisor}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <span className="px-2 py-0.5 rounded bg-slate-100">{f.clientes} clientes</span>
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">{f.atendidos} at.</span>
                      <span className="px-2 py-0.5 rounded bg-red-100 text-red-700">{f.naoAtendidos} não at.</span>
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-700">{f.pendentes} pend.</span>
                      <span className="px-2 py-0.5 rounded bg-purple-100 text-purple-700">{f.conversao}%</span>
                      <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-700">{f.dias} dia(s)</span>
                    </div>
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="visitasdia" className="pt-4">
          <Card><CardContent className="p-4 overflow-auto">
            <table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2 text-left">Vendedor</th><th className="p-2 text-left">Cliente</th><th className="p-2 text-left">Status</th><th className="p-2 text-left">Início</th><th className="p-2 text-right">Duração</th></tr></thead>
              <tbody>{visitas.filter(v => v.data_visita === new Date().toISOString().slice(0,10)).slice(0, 100).map(v => (
                <tr key={v.id} className="border-t"><td className="p-2">{v.vendedor_nome}</td><td className="p-2">{v.cliente_nome}</td><td className="p-2">{v.status}</td><td className="p-2 text-xs">{v.checkin_em ? new Date(v.checkin_em).toLocaleTimeString('pt-BR') : '-'}</td><td className="p-2 text-right">{v.duracao_min || 0} min</td></tr>
              ))}</tbody></table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="pendentes" className="pt-4">
          <Card><CardContent className="p-4 text-sm">
            <p className="text-slate-500 mb-3">Visitas pendentes (sem check-in)</p>
            <ul className="space-y-1 max-h-96 overflow-auto">
              {filtrados.flatMap(r => (r.clientes_detalhes || []).filter(c => !visitas.find(v => v.roteiro_id === r.id && v.cliente_id === c.cliente_id)).map(c => (
                <li key={r.id + c.cliente_id} className="border-b py-2 flex justify-between"><span>{r.vendedor_nome} • {c.cliente_nome}</span><span className="text-xs text-slate-500">{r.dia_semana}</span></li>
              ))).slice(0, 200)}
            </ul>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="analises" className="pt-4">
          <Card><CardContent className="p-6 text-center text-slate-500">Análises consolidadas disponíveis em <strong>Análises Comercial</strong>.</CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}