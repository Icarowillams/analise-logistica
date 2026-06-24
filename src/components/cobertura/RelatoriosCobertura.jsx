import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, MapPin, AlertTriangle } from 'lucide-react';

function hojeStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function RelatoriosCobertura() {
  const [data, setData] = useState(hojeStr());

  const { data: visitas = [], isLoading } = useQuery({
    queryKey: ['rel-visitas', data],
    queryFn: () => base44.entities.Visita.filter({ data_visita: data }, '-hora_checkin', 2000),
  });
  const { data: estoque = [] } = useQuery({
    queryKey: ['rel-estoque-reposicao'],
    queryFn: () => base44.entities.EstoqueVisitaItem.filter({ tipo_registro: 'reposicao' }, '-criado_em', 2000),
  });

  const tempoMedio = useMemo(() => {
    const concl = visitas.filter((v) => v.duracao_minutos > 0);
    if (!concl.length) return 0;
    return Math.round(concl.reduce((s, v) => s + v.duracao_minutos, 0) / concl.length);
  }, [visitas]);

  const repostosPorLoja = useMemo(() => {
    const m = {};
    estoque.forEach((e) => {
      const k = e.cliente_nome || e.cliente_id;
      m[k] = (m[k] || 0) + (e.quantidade || 0);
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [estoque]);

  return (
    <div className="space-y-4">
      <Tabs defaultValue="diario">
        <TabsList>
          <TabsTrigger value="diario">Visitas do dia</TabsTrigger>
          <TabsTrigger value="tempo">Tempo médio</TabsTrigger>
          <TabsTrigger value="repostos">Itens repostos</TabsTrigger>
        </TabsList>

        <TabsContent value="diario" className="mt-4 space-y-3">
          <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="max-w-xs" />
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left p-3">Cliente</th>
                    <th className="text-left p-3">Responsável</th>
                    <th className="text-left p-3">Finalidade</th>
                    <th className="text-left p-3">Check-in</th>
                    <th className="text-left p-3">Check-out</th>
                    <th className="text-center p-3">Duração</th>
                    <th className="text-left p-3">Geo</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={7} className="p-8 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
                  ) : visitas.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-slate-400">Nenhuma visita registrada nesta data.</td></tr>
                  ) : visitas.map((v) => (
                    <tr key={v.id} className="border-t hover:bg-slate-50">
                      <td className="p-3 font-medium text-slate-800">{v.cliente_nome}</td>
                      <td className="p-3 text-slate-600">{v.vendedor_nome || '—'}</td>
                      <td className="p-3">{v.finalidade_visita === 'reposicao' ? 'Reposição' : 'Venda'}</td>
                      <td className="p-3 text-slate-500">{v.hora_checkin ? new Date(v.hora_checkin).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td className="p-3 text-slate-500">{v.hora_checkout ? new Date(v.hora_checkout).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : (v.checkout_pendente ? <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Pendente</Badge> : '—')}</td>
                      <td className="p-3 text-center">{v.duracao_minutos ? `${v.duracao_minutos} min` : '—'}</td>
                      <td className="p-3">
                        {v.fora_do_raio ? (
                          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 gap-1"><AlertTriangle className="w-3 h-3" /> {v.distancia_cadastro_m}m</Badge>
                        ) : v.distancia_cadastro_m != null ? (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 gap-1"><MapPin className="w-3 h-3" /> {v.distancia_cadastro_m}m</Badge>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="tempo" className="mt-4">
          <Card className="p-6">
            <div className="text-sm text-slate-500">Tempo médio de visita (data selecionada: {new Date(data + 'T00:00:00').toLocaleDateString('pt-BR')})</div>
            <div className="text-4xl font-bold text-cyan-600 mt-2">{tempoMedio} min</div>
            <div className="text-xs text-slate-400 mt-1">Considera visitas com check-out registrado.</div>
          </Card>
        </TabsContent>

        <TabsContent value="repostos" className="mt-4">
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr><th className="text-left p-3">Loja / Cliente</th><th className="text-right p-3">Total reposto</th></tr>
                </thead>
                <tbody>
                  {repostosPorLoja.length === 0 ? (
                    <tr><td colSpan={2} className="p-8 text-center text-slate-400">Nenhuma reposição registrada ainda.</td></tr>
                  ) : repostosPorLoja.map(([loja, qtd]) => (
                    <tr key={loja} className="border-t hover:bg-slate-50">
                      <td className="p-3 font-medium text-slate-800">{loja}</td>
                      <td className="p-3 text-right font-semibold text-cyan-600">{qtd}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}