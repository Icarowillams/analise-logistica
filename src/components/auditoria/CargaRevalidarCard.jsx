import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, CheckCircle2, AlertTriangle, Truck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_PROC = {
  nao_iniciado: { label: 'Não iniciado', cls: 'bg-slate-200 text-slate-800' },
  em_andamento: { label: 'Em andamento', cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  parcial: { label: 'Parcial', cls: 'bg-orange-100 text-orange-800 border-orange-300' },
  erro: { label: 'Erro', cls: 'bg-red-100 text-red-800 border-red-300' },
  concluido: { label: 'Concluído', cls: 'bg-green-100 text-green-800 border-green-300' },
};

const formatBRL = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function CargaRevalidarCard({ carga, onRevalidado }) {
  const [revalidando, setRevalidando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const pedidosOmie = (carga.pedidos_omie || []).filter((p) => p.tipo_nota !== 'D1' && p.codigo_pedido);
  const statusProc = STATUS_PROC[carga.processamento_omie_status] || STATUS_PROC.nao_iniciado;

  const handleRevalidar = async () => {
    setRevalidando(true);
    setResultado(null);
    try {
      const res = await base44.functions.invoke('revalidarCargaOmie', { carga_id: carga.id });
      const d = res?.data || res;
      if (d?.sucesso) {
        setResultado(d);
        toast.success(`Carga ${carga.numero_carga}: ${d.mensagem || 'revalidada'}`);
        onRevalidado?.();
      } else if (d?.omie_bloqueada) {
        toast.error('API Omie bloqueada no momento. Tente novamente em alguns minutos.');
      } else {
        toast.error(d?.error || 'Falha ao revalidar a carga.');
      }
    } catch (e) {
      toast.error(e.message || 'Erro ao revalidar a carga.');
    } finally {
      setRevalidando(false);
    }
  };

  return (
    <Card className="p-4 border-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-50 flex items-center justify-center">
            <Truck className="w-5 h-5 text-cyan-600" />
          </div>
          <div>
            <div className="font-semibold text-slate-800">Carga {carga.numero_carga || '—'}</div>
            <div className="text-xs text-slate-500">
              {carga.data_carga} · {carga.motorista_nome || 'sem motorista'} · {pedidosOmie.length} pedido(s) modelo 55
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="capitalize">{carga.status_carga}</Badge>
          <Badge variant="outline" className={statusProc.cls}>{statusProc.label}</Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
        <div className="text-sm text-slate-600">
          Valor: <span className="font-medium text-slate-800">{formatBRL(carga.valor_total)}</span>
        </div>
        <Button onClick={handleRevalidar} disabled={revalidando} className="bg-cyan-600 hover:bg-cyan-700 text-white">
          {revalidando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          {revalidando ? 'Consultando Omie...' : 'Revalidar no Omie'}
        </Button>
      </div>

      {resultado && (
        <div className="mt-3 p-3 rounded-lg bg-slate-50 border border-slate-200 text-sm space-y-2">
          <div className="flex flex-wrap gap-4">
            <span className="flex items-center gap-1 text-green-700">
              <CheckCircle2 className="w-4 h-4" /> {resultado.confirmados} confirmado(s)
            </span>
            <span className="flex items-center gap-1 text-blue-700">
              <RefreshCw className="w-4 h-4" /> {resultado.reenfileirados} reenfileirado(s)
            </span>
            {resultado.inconclusivos > 0 && (
              <span className="flex items-center gap-1 text-orange-700">
                <AlertTriangle className="w-4 h-4" /> {resultado.inconclusivos} inconclusivo(s)
              </span>
            )}
          </div>
          {Array.isArray(resultado.detalhes) && resultado.detalhes.length > 0 && (
            <div className="max-h-40 overflow-y-auto divide-y divide-slate-200">
              {resultado.detalhes.map((d, i) => (
                <div key={i} className="py-1 flex items-center justify-between text-xs">
                  <span className="text-slate-700">Pedido {d.numero_pedido || d.codigo_pedido}</span>
                  <span className="text-slate-500">
                    etapa {d.etapa ?? '?'} · <span className="font-medium">{d.acao}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}