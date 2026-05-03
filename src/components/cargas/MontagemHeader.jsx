import React from 'react';
import { RefreshCw, ShieldCheck, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function MontagemHeader({ loading, onRefresh }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-white shadow-lg">
      <div className="bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.22),_transparent_34%),linear-gradient(135deg,#020617_0%,#111827_55%,#1f2937_100%)] p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Truck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-200 uppercase tracking-[0.22em]">
                <ShieldCheck className="w-4 h-4" /> Operação logística
              </div>
              <h1 className="mt-1 text-2xl md:text-3xl font-bold tracking-tight">Montagem de Carga</h1>
              <p className="mt-1 text-sm text-slate-300 max-w-3xl">
                Selecione pedidos em Aprovação no Omie e trocas aprovadas, organize por rota e feche cargas com visão operacional clara.
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={onRefresh} disabled={loading} className="bg-white/10 border-white/20 text-white hover:bg-white/20 hover:text-white">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Atualizar dados
          </Button>
        </div>
      </div>
    </div>
  );
}