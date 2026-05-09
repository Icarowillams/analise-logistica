import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Download, FileSpreadsheet } from 'lucide-react';

const baixarCSV = (linhas) => {
  const csv = ['vendedor;dia;status;clientes;visitas_realizadas', ...linhas.map(l => `${l.vendedor};${l.dia};${l.status};${l.clientes};${l.realizadas}`)].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `roteiros_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
};

export default function PainelGestorRoteiros({ roteiros, visitas, vendedores }) {
  const linhas = useMemo(() => roteiros.map(r => {
    const realizadas = visitas.filter(v => v.roteiro_id === r.id && v.status === 'visitado').length;
    return { vendedor: r.vendedor_nome || vendedores.find(v => v.id === r.vendedor_id)?.nome || '-', dia: r.dia_semana, status: r.status, clientes: r.clientes_ids?.length || r.clientes_detalhes?.length || 0, realizadas };
  }), [roteiros, visitas, vendedores]);

  const totalPlanejadas = linhas.reduce((acc, l) => acc + l.clientes, 0);
  const totalRealizadas = visitas.filter(v => v.status === 'visitado').length;
  const perc = totalPlanejadas ? Math.round((totalRealizadas / totalPlanejadas) * 100) : 0;
  const ativos = roteiros.filter(r => r.status === 'ativo').length;
  const concluidos = roteiros.filter(r => r.status === 'concluido').length;
  const gargalos = linhas.filter(l => l.clientes > 12);

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4"><p className="text-sm text-slate-500">Roteiros ativos</p><p className="text-3xl font-bold text-cyan-700">{ativos}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-slate-500">Concluídos</p><p className="text-3xl font-bold text-emerald-700">{concluidos}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-slate-500">Visitas realizadas</p><p className="text-3xl font-bold text-amber-700">{perc}%</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-slate-500">Possíveis gargalos</p><p className="text-3xl font-bold text-red-700">{gargalos.length}</p></CardContent></Card>
      </div>

      <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => baixarCSV(linhas)}><FileSpreadsheet className="w-4 h-4" />Exportar CSV</Button><Button variant="outline" onClick={() => window.print()}><Download className="w-4 h-4" />PDF/Imprimir</Button></div>

      <Card>
        <CardHeader><CardTitle>Desempenho por roteiro</CardTitle></CardHeader>
        <CardContent className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="p-2 text-left">Vendedor</th><th className="p-2 text-left">Dia</th><th className="p-2 text-left">Status</th><th className="p-2 text-right">Planejadas</th><th className="p-2 text-right">Realizadas</th></tr></thead>
            <tbody>{linhas.map((l, i) => <tr key={i} className="border-t"><td className="p-2">{l.vendedor}</td><td className="p-2">{l.dia}</td><td className="p-2"><Badge variant="outline">{l.status}</Badge></td><td className="p-2 text-right">{l.clientes}</td><td className="p-2 text-right">{l.realizadas}</td></tr>)}</tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}