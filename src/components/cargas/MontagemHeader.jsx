import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function MontagemHeader({ loading, onRefresh }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pão & Mel + Omie</div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Montagem de Carga</h1>
        <p className="text-sm text-slate-500">Selecione pedidos por rota e feche a carga com o mínimo de cliques.</p>
      </div>
      <Button variant="outline" onClick={onRefresh} disabled={loading} className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
        <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
        Atualizar
      </Button>
    </div>
  );
}