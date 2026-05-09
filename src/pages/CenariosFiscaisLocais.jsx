import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { FileText } from 'lucide-react';
import AbaCenariosLocais from '@/components/cenariosFiscais/AbaCenariosLocais';

export default function CenariosFiscaisLocais() {
  const { data: cenarios = [] } = useQuery({
    queryKey: ['cenariosFiscais'],
    queryFn: () => base44.entities.CenarioFiscal.list('-created_date', 500)
  });

  const naturezas = cenarios.filter(c => (c.tipo_registro || 'cenario') === 'cenario');

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg">
          <FileText className="h-6 w-6 text-neutral-900" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Cenários Fiscais Locais</h1>
          <p className="text-sm text-neutral-500">Cadastros internos (Venda, Bonificação, Troca, etc.) — vinculáveis ao Omie quando cliente for Nota 55</p>
        </div>
      </div>

      <AbaCenariosLocais naturezasOmie={naturezas} />
    </div>
  );
}