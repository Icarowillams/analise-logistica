import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { History, Search, ArrowLeftRight, Loader2 } from 'lucide-react';
import { fmtDataHora } from '@/lib/dateFormat';

const fmtMoney = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

export default function LogTransferenciasView() {
  const [busca, setBusca] = useState('');
  const [dataIni, setDataIni] = useState('');
  const [dataFim, setDataFim] = useState('');

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['logs-transferencia'],
    queryFn: () => base44.entities.Transferencia.list('-created_date', 1000)
  });

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return logs.filter(l => {
      if (termo) {
        const blob = [
          l.carga_origem_numero, l.carga_destino_numero, l.numero_pedido, l.numero_nf,
          l.cliente_nome, l.motivo, l.funcionario_nome
        ].filter(Boolean).join(' ').toLowerCase();
        if (!blob.includes(termo)) return false;
      }
      if (dataIni && l.created_date && l.created_date.split('T')[0] < dataIni) return false;
      if (dataFim && l.created_date && l.created_date.split('T')[0] > dataFim) return false;
      return true;
    });
  }, [logs, busca, dataIni, dataFim]);

  const totalValor = filtrados.reduce((s, l) => s + Number(l.valor_nf || 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <History className="w-5 h-5 text-indigo-500" />
          Histórico de Transferências
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <Label className="flex items-center gap-1.5"><Search className="w-4 h-4" /> Buscar</Label>
            <Input
              placeholder="Carga, pedido, NF, cliente, funcionário..."
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
          <span>Valor total transferido: <b className="text-indigo-700">{fmtMoney(totalValor)}</b></span>
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
                  <th className="p-2 text-left">Pedido</th>
                  <th className="p-2 text-left">NF</th>
                  <th className="p-2 text-left">Cliente</th>
                  <th className="p-2 text-center">Carga Origem</th>
                  <th className="p-2 text-center"></th>
                  <th className="p-2 text-center">Carga Destino</th>
                  <th className="p-2 text-right">Qtd. Itens</th>
                  <th className="p-2 text-right">Valor NF</th>
                  <th className="p-2 text-left">Transferido por</th>
                  <th className="p-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.length === 0 ? (
                  <tr><td colSpan="11" className="p-6 text-center text-slate-400">Nenhum registro de transferência.</td></tr>
                ) : filtrados.map(l => (
                  <tr key={l.id} className="border-t hover:bg-slate-50">
                    <td className="p-2 whitespace-nowrap">{fmtDataHora(l.created_date)}</td>
                    <td className="p-2 font-medium">{l.numero_pedido || '-'}</td>
                    <td className="p-2">{l.numero_nf || '-'}</td>
                    <td className="p-2">{l.cliente_nome || '-'}</td>
                    <td className="p-2 text-center">
                      <Badge variant="outline" className="border-slate-300">{l.carga_origem_numero || '-'}</Badge>
                    </td>
                    <td className="p-2 text-center text-slate-400">
                      <ArrowLeftRight className="w-4 h-4 inline" />
                    </td>
                    <td className="p-2 text-center">
                      <Badge variant="outline" className="border-indigo-300 text-indigo-700">{l.carga_destino_numero || '-'}</Badge>
                    </td>
                    <td className="p-2 text-right">{l.quantidade_itens || '-'}</td>
                    <td className="p-2 text-right">{fmtMoney(l.valor_nf)}</td>
                    <td className="p-2">{l.funcionario_nome || l.created_by || '-'}</td>
                    <td className="p-2">
                      <Badge variant="outline" className={`text-[10px] ${
                        l.status === 'concluida' ? 'border-green-300 text-green-700' :
                        l.status === 'cancelada' ? 'border-red-300 text-red-700' :
                        'border-amber-300 text-amber-700'
                      }`}>
                        {l.status || 'concluida'}
                      </Badge>
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