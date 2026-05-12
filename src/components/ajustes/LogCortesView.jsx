import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { History, Search, Scissors, Loader2 } from 'lucide-react';

const fmtMoney = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
const fmtDataHora = (iso) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch { return '-'; }
};

export default function LogCortesView() {
  const [busca, setBusca] = useState('');
  const [dataIni, setDataIni] = useState('');
  const [dataFim, setDataFim] = useState('');

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['logs-corte'],
    queryFn: () => base44.entities.LogCorte.list('-created_date', 1000)
  });

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return logs.filter(l => {
      if (termo) {
        const blob = [
          l.carga_numero, l.numero_pedido, l.cliente_nome, l.produto_codigo,
          l.produto_descricao, l.motivo, l.funcionario_nome
        ].filter(Boolean).join(' ').toLowerCase();
        if (!blob.includes(termo)) return false;
      }
      if (dataIni && l.created_date && l.created_date.split('T')[0] < dataIni) return false;
      if (dataFim && l.created_date && l.created_date.split('T')[0] > dataFim) return false;
      return true;
    });
  }, [logs, busca, dataIni, dataFim]);

  const totalCortado = filtrados.reduce((s, l) => s + Number(l.valor_cortado || 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <History className="w-5 h-5 text-amber-500" />
          Histórico de Cortes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <Label className="flex items-center gap-1.5"><Search className="w-4 h-4" /> Buscar</Label>
            <Input
              placeholder="Carga, pedido, cliente, produto, motivo, funcionário..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <div>
            <Label>Data inicial</Label>
            <Input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} />
          </div>
          <div>
            <Label>Data final</Label>
            <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
        </div>

        <div className="rounded-lg border bg-slate-50 px-3 py-2 text-xs text-slate-600 flex flex-wrap gap-x-6 gap-y-1">
          <span>Registros: <b>{filtrados.length}</b></span>
          <span>Valor cortado total: <b className="text-red-600">{fmtMoney(totalCortado)}</b></span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
          </div>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-2 text-left">Data/Hora</th>
                  <th className="p-2 text-left">Carga</th>
                  <th className="p-2 text-left">Pedido</th>
                  <th className="p-2 text-left">Cliente</th>
                  <th className="p-2 text-left">Produto</th>
                  <th className="p-2 text-right">Qtd. Antes</th>
                  <th className="p-2 text-right">Qtd. Depois</th>
                  <th className="p-2 text-right">Cortado</th>
                  <th className="p-2 text-right">Valor Cortado</th>
                  <th className="p-2 text-left">Motivo</th>
                  <th className="p-2 text-left">Cortado por</th>
                  <th className="p-2 text-left">Origem</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.length === 0 ? (
                  <tr><td colSpan="12" className="p-6 text-center text-slate-400">Nenhum registro de corte.</td></tr>
                ) : filtrados.map(l => (
                  <tr key={l.id} className="border-t hover:bg-slate-50">
                    <td className="p-2 whitespace-nowrap">{fmtDataHora(l.created_date)}</td>
                    <td className="p-2">{l.carga_numero || <span className="text-slate-400">-</span>}</td>
                    <td className="p-2 font-medium">{l.numero_pedido || '-'}</td>
                    <td className="p-2">{l.cliente_nome || '-'}</td>
                    <td className="p-2">
                      <div className="text-xs text-slate-500">{l.produto_codigo}</div>
                      <div>{l.produto_descricao || '-'}</div>
                    </td>
                    <td className="p-2 text-right">{l.quantidade_anterior ?? '-'}</td>
                    <td className="p-2 text-right">{l.quantidade_nova ?? '-'}</td>
                    <td className="p-2 text-right text-red-600 font-medium">{l.quantidade_cortada ?? '-'}</td>
                    <td className="p-2 text-right">{fmtMoney(l.valor_cortado)}</td>
                    <td className="p-2 max-w-[240px] truncate" title={l.motivo}>{l.motivo || '-'}</td>
                    <td className="p-2">{l.funcionario_nome || l.created_by || '-'}</td>
                    <td className="p-2">
                      <Badge variant="outline" className={`text-[10px] ${l.origem_pedido === 'interno_d1' ? 'border-purple-300 text-purple-700' : 'border-blue-300 text-blue-700'}`}>
                        {l.origem_pedido === 'interno_d1' ? 'D1' : 'Omie'}
                      </Badge>
                      {l.sincronizado_omie === false && l.origem_pedido !== 'interno_d1' && (
                        <Badge variant="outline" className="text-[10px] border-red-300 text-red-700 ml-1">Falha Omie</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}