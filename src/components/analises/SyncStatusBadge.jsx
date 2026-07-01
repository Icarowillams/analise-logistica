import React from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';

function tempoRelativo(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h ${min % 60}min`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

function horaCurta(iso) {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function SyncStatusBadge({ ultimaSincronizacao, isSincronizando, erroSync, onAtualizar }) {
  if (isSincronizando) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-cyan-700 bg-cyan-50 border border-cyan-200 rounded-full px-3 py-1">
        <RefreshCw className="w-3 h-3 animate-spin" />
        atualizando...
      </div>
    );
  }

  if (erroSync) {
    return (
      <div className="inline-flex items-center gap-2">
        <div className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
          <AlertTriangle className="w-3 h-3" />
          não foi possível atualizar — mostrando último dado de {horaCurta(ultimaSincronizacao)}
        </div>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onAtualizar}>
          <RefreshCw className="w-3 h-3" /> Tentar novamente
        </Button>
      </div>
    );
  }

  const rel = tempoRelativo(ultimaSincronizacao);
  return (
    <div className="inline-flex items-center gap-2">
      {rel && (
        <div className="inline-flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-3 py-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
          atualizado {rel}
        </div>
      )}
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onAtualizar}>
        <RefreshCw className="w-3 h-3" /> Atualizar agora
      </Button>
    </div>
  );
}