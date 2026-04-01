import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { FileSpreadsheet, Database, CheckCircle, ArrowLeftRight, AlertTriangle, Plus, RefreshCw, Trash2 } from 'lucide-react';

export default function ResumoCSVBase44({ comparacao }) {
  if (!comparacao) return null;

  // Usa contagens reais de ação se disponíveis
  const totalAtualizar = comparacao.atualizar_real ?? comparacao.diferentes ?? 0;
  const totalCriar = comparacao.criar_real ?? comparacao.nao_encontrados ?? 0;
  const totalExcluir = comparacao.excluir_real ?? comparacao.so_no_base44 ?? 0;

  const cards = [
    { label: 'Total CSV', valor: comparacao.csv_total, cor: 'blue', icon: FileSpreadsheet },
    { label: 'Total Base44', valor: comparacao.base44_total, cor: 'green', icon: Database },
    { label: 'A Atualizar', valor: totalAtualizar, cor: 'amber', icon: RefreshCw },
    { label: 'A Criar', valor: totalCriar, cor: 'purple', icon: Plus },
    { label: 'A Excluir', valor: totalExcluir, cor: 'red', icon: Trash2 },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
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