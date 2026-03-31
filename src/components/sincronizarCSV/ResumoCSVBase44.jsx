import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { FileSpreadsheet, Database, CheckCircle, ArrowLeftRight, AlertTriangle, Plus } from 'lucide-react';

export default function ResumoCSVBase44({ comparacao }) {
  if (!comparacao) return null;

  const cards = [
    { label: 'Total CSV', valor: comparacao.csv_total, cor: 'blue', icon: FileSpreadsheet },
    { label: 'Total Base44', valor: comparacao.base44_total, cor: 'green', icon: Database },
    { label: 'Iguais', valor: comparacao.iguais, cor: 'emerald', icon: CheckCircle },
    { label: 'Diferentes', valor: comparacao.diferentes, cor: 'amber', icon: ArrowLeftRight },
    { label: 'Faltam no Base44', valor: comparacao.nao_encontrados, cor: 'purple', icon: Plus },
    { label: 'Só no Base44', valor: comparacao.so_no_base44, cor: 'red', icon: AlertTriangle },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((c) => (
        <Card key={c.label} className={`border-${c.cor}-200`}>
          <CardContent className="py-3 text-center">
            <c.icon className={`w-5 h-5 mx-auto mb-1 text-${c.cor}-500`} />
            <p className={`text-2xl font-bold text-${c.cor}-600`}>{(c.valor || 0).toLocaleString()}</p>
            <p className="text-xs text-slate-500 leading-tight">{c.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}