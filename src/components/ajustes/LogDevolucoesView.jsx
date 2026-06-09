import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Loader2, Undo2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STATUS_MAP = {
  pendente: { label: 'Pendente', color: 'bg-amber-100 text-amber-800' },
  processado: { label: 'Processado', color: 'bg-blue-100 text-blue-800' },
  devolvido_omie: { label: 'Devolvido (Omie)', color: 'bg-green-100 text-green-800' },
  cancelado: { label: 'Cancelado', color: 'bg-red-100 text-red-800' },
};

const TIPO_MAP = {
  devolucao_total: 'Devolução total',
  devolucao_parcial: 'Devolução parcial',
  troca: 'Troca',
  recusa_cliente: 'Recusa do cliente',
  nao_entregue: 'Não entregue',
  avaria: 'Avaria',
};

function ProdutosExpand({ produtos }) {
  const [open, setOpen] = useState(false);
  if (!produtos || produtos.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {produtos.length} produto(s)
      </button>
      {open && (
        <div className="mt-1 space-y-1">
          {produtos.map((p, i) => (
            <div key={i} className="text-[11px] text-slate-600 bg-slate-50 rounded px-2 py-1">
              <span className="font-medium">{p.descricao || p.codigo_produto}</span>
              {' — '}Qtd: {p.quantidade} × R$ {Number(p.valor_unitario || 0).toFixed(2)}
              {p.motivo ? <span className="text-slate-400"> ({p.motivo})</span> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LogDevolucoesView() {
  const [busca, setBusca] = useState('');

  const { data: registros = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['log-devolucoes'],
    queryFn: () => base44.entities.Retorno.list('-created_date', 200),
    staleTime: 30000,
  });

  const filtrados = registros.filter(r => {
    if (!busca.trim()) return true;
    const t = busca.toLowerCase();
    return (
      (r.numero_pedido || '').toLowerCase().includes(t) ||
      (r.pedido_codigo_omie || '').includes(t) ||
      (r.cliente_nome || '').toLowerCase().includes(t) ||
      (r.motivo_geral || '').toLowerCase().includes(t) ||
      (r.motorista_nome || '').toLowerCase().includes(t)
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
              placeholder="Buscar por pedido, cliente, motivo..."
              className="pl-9 h-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="text-xs text-slate-500">{filtrados.length} devolução(ões)</div>

        {isLoading ? (
          <div className="p-8 text-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin inline mr-2" />Carregando...
          </div>
        ) : filtrados.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <Undo2 className="w-8 h-8 inline mb-2 text-slate-300" />
            <div>Nenhuma devolução registrada</div>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden max-h-[500px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="p-2 text-left">Data</th>
                  <th className="p-2 text-left">Pedido</th>
                  <th className="p-2 text-left">Cliente</th>
                  <th className="p-2 text-left">Tipo</th>
                  <th className="p-2 text-right">Valor</th>
                  <th className="p-2 text-left">Produtos</th>
                  <th className="p-2 text-left">Motivo</th>
                  <th className="p-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(r => {
                  const st = STATUS_MAP[r.status] || { label: r.status, color: 'bg-slate-100' };
                  return (
                    <tr key={r.id} className="border-t hover:bg-slate-50 align-top">
                      <td className="p-2 text-xs text-slate-600 whitespace-nowrap">
                        {r.data_retorno ? new Date(r.data_retorno + 'T00:00:00').toLocaleDateString('pt-BR') : r.created_date ? new Date(r.created_date).toLocaleDateString('pt-BR') : '-'}
                      </td>
                      <td className="p-2 font-medium">{String(r.numero_pedido || r.pedido_codigo_omie || '-').replace(/^0+/, '') || '-'}</td>
                      <td className="p-2 truncate max-w-[160px]" title={r.cliente_nome}>{r.cliente_nome || '-'}</td>
                      <td className="p-2 text-xs">{TIPO_MAP[r.tipo_retorno] || r.tipo_retorno || '-'}</td>
                      <td className="p-2 text-right font-medium">R$ {Number(r.valor_total_retorno || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      <td className="p-2"><ProdutosExpand produtos={r.produtos} /></td>
                      <td className="p-2 text-xs truncate max-w-[180px]" title={r.motivo_geral}>{r.motivo_geral || '-'}</td>
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