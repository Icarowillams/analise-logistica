import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Package, TrendingUp, TrendingDown, Search } from 'lucide-react';

export default function MonitoramentoGaleias() {
  const [busca, setBusca] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');

  const { data: saldos = [] } = useQuery({
    queryKey: ['saldosGaleia'],
    queryFn: () => base44.entities.SaldoGaleia.list()
  });

  const { data: tipos = [] } = useQuery({
    queryKey: ['tiposGaleia'],
    queryFn: () => base44.entities.TipoGaleia.list()
  });

  const { data: movimentacoes = [] } = useQuery({
    queryKey: ['movimentacoesGaleia'],
    queryFn: () => base44.entities.MovimentacaoGaleia.list('-data', 200)
  });

  const saldosFiltrados = useMemo(() => {
    return saldos.filter(s => {
      const matchBusca = !busca || s.cliente_nome?.toLowerCase().includes(busca.toLowerCase());
      const matchTipo = !filtroTipo || s.tipo_galeia_id === filtroTipo;
      return matchBusca && matchTipo;
    });
  }, [saldos, busca, filtroTipo]);

  const totaisPorTipo = useMemo(() => {
    const map = {};
    saldos.forEach(s => {
      if (!map[s.tipo_galeia_nome]) map[s.tipo_galeia_nome] = 0;
      map[s.tipo_galeia_nome] += s.saldo_atual || 0;
    });
    return map;
  }, [saldos]);

  return (
    <div className="space-y-4">
      <PageHeader title="Monitoramento de Galeias" icon={Package} subtitle="Saldo atual por cliente e tipo" />

      {/* Totais por tipo */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Object.entries(totaisPorTipo).map(([tipo, total]) => (
          <Card key={tipo} className="border-0 shadow-sm">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-amber-600">{total}</div>
              <div className="text-xs text-slate-500 mt-1">{tipo}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="Buscar cliente..." value={busca} onChange={e => setBusca(e.target.value)} className="pl-8 h-9" />
        </div>
        <Select value={filtroTipo} onValueChange={v => setFiltroTipo(v === '__all__' ? '' : v)}>
          <SelectTrigger className="h-9 w-48">
            <SelectValue placeholder="Tipo de galeia" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os tipos</SelectItem>
            {tipos.map(t => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Tabela de saldos */}
      <Card className="border-0 shadow-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Saldo por Cliente ({saldosFiltrados.length})</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {saldosFiltrados.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">Nenhum saldo encontrado.</p>
          ) : (
            <div className="space-y-2">
              {saldosFiltrados.map(s => (
                <div key={s.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div>
                    <div className="font-medium text-sm">{s.cliente_nome}</div>
                    <div className="text-xs text-slate-500">{s.tipo_galeia_nome}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={s.saldo_atual > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}>
                      {s.saldo_atual || 0} un.
                    </Badge>
                    <span className="text-xs text-slate-400">
                      {s.ultima_atualizacao && new Date(s.ultima_atualizacao + 'T12:00:00').toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Últimas movimentações */}
      <Card className="border-0 shadow-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Últimas Movimentações</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {movimentacoes.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">Sem movimentações registradas.</p>
          ) : (
            <div className="space-y-2">
              {movimentacoes.slice(0, 20).map(m => (
                <div key={m.id} className="flex items-center justify-between p-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    {m.tipo_movimento === 'deixada'
                      ? <TrendingDown className="w-4 h-4 text-red-400" />
                      : <TrendingUp className="w-4 h-4 text-green-400" />
                    }
                    <div>
                      <span className="text-sm font-medium">{m.cliente_nome}</span>
                      <span className="text-xs text-slate-500 ml-2">{m.tipo_galeia_nome}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{m.tipo_movimento === 'deixada' ? '-' : '+'}{m.quantidade}</div>
                    <div className="text-xs text-slate-400">{m.data && new Date(m.data + 'T12:00:00').toLocaleDateString('pt-BR')}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}