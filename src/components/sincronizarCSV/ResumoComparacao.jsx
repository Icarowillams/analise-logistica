import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Database, Cloud, ArrowLeftRight, AlertTriangle, CheckCircle } from 'lucide-react';

export default function ResumoComparacao({ comparacao }) {
  if (!comparacao) return null;

  const cards = [
    { label: 'Total Base44', valor: comparacao.total_base44, cor: 'green', icon: Database },
    { label: 'Total Omie', valor: comparacao.total_omie, cor: 'blue', icon: Cloud },
    { label: 'Iguais', valor: comparacao.iguais, cor: 'emerald', icon: CheckCircle },
    { label: 'Diferentes', valor: comparacao.diferentes, cor: 'amber', icon: ArrowLeftRight },
    { label: 'Só Base44 (criar no Omie)', valor: comparacao.so_no_base44, cor: 'purple', icon: Database },
    { label: 'Só Omie (excluir do Omie)', valor: comparacao.so_no_omie, cor: 'red', icon: AlertTriangle },
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