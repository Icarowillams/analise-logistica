import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Loader2, Ban, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STATUS_MAP = {
  cancelado: { label: 'Cancelado', color: 'bg-red-100 text-red-800' },
  ja_cancelado: { label: 'Já cancelado', color: 'bg-yellow-100 text-yellow-800' },
  pendente: { label: 'Pendente', color: 'bg-amber-100 text-amber-800' },
  erro: { label: 'Erro', color: 'bg-red-100 text-red-700' },
};

const ORIGEM_MAP = {
  manual: 'Manual',
  acerto_caixa: 'Acerto de caixa',
  rota_devolucao: 'Rota/Devolução',
  outros: 'Outros',
};

export default function LogCancelamentosView() {
  const [busca, setBusca] = useState('');

  const { data: registros = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['log-cancelamentos'],
    queryFn: () => base44.entities.Cancelamento.list('-created_date', 200),
    staleTime: 30000,
  });

  const filtrados = registros.filter(r => {
    if (!busca.trim()) return true;
    const t = busca.toLowerCase();
    return (
      (r.numero_pedido || '').toLowerCase().includes(t) ||
      (r.pedido_codigo_omie || '').includes(t) ||
      (r.cliente_nome || '').toLowerCase().includes(t) ||
      (r.numero_nf || '').includes(t) ||
      (r.motivo || '').toLowerCase().includes(t) ||
      (r.funcionario_nome || '').toLowerCase().includes(t)
    );
  });

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por pedido, cliente, NF, motivo..."
              className="pl-9 h-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="text-xs text-slate-500">{filtrados.length} cancelamento(s)</div>

        {isLoading ? (
          <div className="p-8 text-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin inline mr-2" />Carregando...
          </div>
        ) : filtrados.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <Ban className="w-8 h-8 inline mb-2 text-slate-300" />
            <div>Nenhum cancelamento registrado</div>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden max-h-[500px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="p-2 text-left">Data</th>
                  <th className="p-2 text-left">Pedido</th>
                  <th className="p-2 text-left">NF</th>
                  <th className="p-2 text-left">Cliente</th>
                  <th className="p-2 text-right">Valor</th>
                  <th className="p-2 text-left">Origem</th>
                  <th className="p-2 text-left">Motivo</th>
                  <th className="p-2 text-left">Quem</th>
                  <th className="p-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(r => {
                  const st = STATUS_MAP[r.status] || { label: r.status, color: 'bg-slate-100' };
                  return (
                    <tr key={r.id} className="border-t hover:bg-slate-50">
                      <td className="p-2 text-xs text-slate-600 whitespace-nowrap">
                        {r.data_cancelamento ? new Date(r.data_cancelamento).toLocaleDateString('pt-BR') : r.created_date ? new Date(r.created_date).toLocaleDateString('pt-BR') : '-'}
                      </td>
                      <td className="p-2 font-medium">{String(r.numero_pedido || r.pedido_codigo_omie || '-').replace(/^0+/, '') || '-'}</td>
                      <td className="p-2 text-slate-600">{r.numero_nf || '-'}</td>
                      <td className="p-2 truncate max-w-[180px]" title={r.cliente_nome}>{r.cliente_nome || '-'}</td>
                      <td className="p-2 text-right">R$ {Number(r.valor_nf || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="p-2 text-xs">{ORIGEM_MAP[r.origem] || r.origem || '-'}</td>
                      <td className="p-2 text-xs truncate max-w-[200px]" title={r.motivo}>{r.motivo || '-'}</td>
                      <td className="p-2 text-xs text-slate-500">{r.funcionario_nome || '-'}</td>
                      <td className="p-2">
                        <Badge className={`${st.color} text-[10px]`}>{st.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}