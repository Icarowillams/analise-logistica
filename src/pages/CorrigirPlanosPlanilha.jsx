import React from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { FileSpreadsheet } from 'lucide-react';
import CorrigirPlanosPlanilha from '@/components/clientes/CorrigirPlanosPlanilha';

export default function CorrigirPlanosPlanilhaPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Corrigir Planos (Planilha)"
        subtitle="Preencher plano de pagamento e modalidade dos clientes via planilha CADASTROS-ATIVOS"
        icon={FileSpreadsheet}
      />
      <CorrigirPlanosPlanilha />
    </div>
  );
}