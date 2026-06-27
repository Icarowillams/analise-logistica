import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, ShieldCheck, Loader2, Inbox } from 'lucide-react';
import CargaRevalidarCard from '@/components/auditoria/CargaRevalidarCard';

// Cargas que ainda faltam faturar / concluir o processamento no Omie.
// São essas que geram pedidos aparecendo como "cancelados/inexistentes" quando o espelho
// está desatualizado. Revalidar consulta a etapa real no Omie e corrige o espelho.
function precisaRevalidar(carga) {
  const status = String(carga.status_carga || '').toLowerCase();
  const proc = String(carga.processamento_omie_status || '').toLowerCase();
  const temPedidos55 = (carga.pedidos_omie || []).some((p) => p.tipo_nota !== 'D1' && p.codigo_pedido);
  if (!temPedidos55) return false;
  if (status === 'montagem') return true;
  if (status === 'faturada' && proc !== 'concluido') return true;
  return false;
}

export default function AuditoriaCancelados() {
  const [cargas, setCargas] = useState([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const todas = await base44.entities.Carga.list('-created_date', 500).catch(() => []);
    setCargas(todas.filter(precisaRevalidar));
    setCarregando(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-cyan-600 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Auditoria de Cancelados</h1>
            <p className="text-sm text-slate-500">
              Revalide no Omie as cargas que ainda faltam faturar para corrigir pedidos que aparecem como cancelados.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={carregar} disabled={carregando}>
          {carregando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Atualizar
        </Button>
      </div>

      {carregando ? (
        <Card className="p-12 flex flex-col items-center justify-center text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin mb-3" />
          Carregando cargas pendentes...
        </Card>
      ) : cargas.length === 0 ? (
        <Card className="p-12 flex flex-col items-center justify-center text-slate-500">
          <Inbox className="w-10 h-10 mb-3 text-slate-400" />
          <p className="font-medium text-slate-700">Nenhuma carga pendente de faturamento</p>
          <p className="text-sm">Todas as cargas estão com o processamento Omie concluído.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">{cargas.length} carga(s) pendente(s) de revalidação:</p>
          {cargas.map((carga) => (
            <CargaRevalidarCard key={carga.id} carga={carga} onRevalidado={carregar} />
          ))}
        </div>
      )}
    </div>
  );
}