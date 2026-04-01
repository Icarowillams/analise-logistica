import React, { useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { ArrowUpDown, FileSpreadsheet, Cloud, Link2 } from 'lucide-react';
import CompararCSVBase44 from '@/components/sincronizarCSV/CompararCSVBase44';
import EspelharBase44Omie from '@/components/sincronizarCSV/EspelharBase44Omie';
import RevincularReferencias from '@/components/sincronizarCSV/RevincularReferencias';

export default function SincronizarClientesCSVPage() {
  const [abaAtiva, setAbaAtiva] = useState('csv');

  return (
    <div>
      <PageHeader
        title="Sincronização de Clientes"
        subtitle="Compare e sincronize clientes via CSV ou com Omie"
        icon={ArrowUpDown}
      />

      <div className="max-w-5xl mx-auto space-y-4">
        {/* Tabs */}
        <div className="flex gap-2 border-b border-slate-200 pb-0">
          <button
            onClick={() => setAbaAtiva('csv')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              abaAtiva === 'csv'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            CSV × Base44
          </button>
          <button
            onClick={() => setAbaAtiva('omie')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              abaAtiva === 'omie'
                ? 'border-amber-500 text-amber-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Cloud className="w-4 h-4" />
            Base44 × Omie
          </button>
          <button
            onClick={() => setAbaAtiva('revincular')}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              abaAtiva === 'revincular'
                ? 'border-purple-500 text-purple-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Link2 className="w-4 h-4" />
            Revincular Referências
          </button>
        </div>

        {/* Aba CSV × Base44 */}
        {abaAtiva === 'csv' && <CompararCSVBase44 />}

        {/* Aba Base44 × Omie */}
        {abaAtiva === 'omie' && <EspelharBase44Omie />}

        {/* Aba Revincular Referências */}
        {abaAtiva === 'revincular' && <RevincularReferencias />}
      </div>
    </div>
  );
}