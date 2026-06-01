import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RotateCcw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const CONFIG = {
  nao_iniciado: { label: 'Aguardando fila', cls: 'bg-slate-200 text-slate-700' },
  em_andamento: { label: 'Processando', cls: 'bg-blue-100 text-blue-700' },
  concluido: { label: 'Concluído', cls: 'bg-green-100 text-green-800' },
  parcial: { label: 'Parcial', cls: 'bg-yellow-100 text-yellow-800' },
  erro: { label: 'Erro', cls: 'bg-red-100 text-red-700' }
};

export default function StatusProcessamentoOmie({ carga, onReprocessar }) {
  const status = carga.processamento_omie_status || 'nao_iniciado';
  const cfg = CONFIG[status] || CONFIG.nao_iniciado;
  const total = carga.processamento_omie_total || 0;

  // Só busca itens da fila quando há processamento relevante a exibir.
  const precisaDetalhe = ['em_andamento', 'parcial', 'erro'].includes(status);
  const { data: itens = [] } = useQuery({
    queryKey: ['fila-carga', carga.id],
    queryFn: () => base44.entities.FilaCargaOmie.filter({ carga_id: carga.id }, '-created_date', 500),
    enabled: precisaDetalhe,
    refetchInterval: status === 'em_andamento' ? 15000 : false
  });

  const concluidos = itens.filter(i => i.status === 'concluido').length;
  const comErro = itens.filter(i => i.status === 'erro');

  const reprocessar = async () => {
    const reprocessaveis = comErro.filter(i => (i.tentativas || 0) < 3);
    if (reprocessaveis.length === 0) {
      toast.error('Nenhum item com erro elegível para reprocessar (limite de tentativas atingido).');
      return;
    }
    await Promise.all(reprocessaveis.map(i =>
      base44.entities.FilaCargaOmie.update(i.id, { status: 'pendente', erro_log: '' })
    ));
    await base44.entities.Carga.update(carga.id, { processamento_omie_status: 'em_andamento' });
    toast.success(`${reprocessaveis.length} pedido(s) reenfileirado(s). Serão processados na próxima rodada.`);
    onReprocessar?.();
  };

  if (status === 'nao_iniciado' && total === 0) return <span className="text-xs text-slate-400">—</span>;

  return (
    <div className="flex flex-col gap-1">
      <Badge className={`${cfg.cls} text-xs w-fit`}>{cfg.label}</Badge>
      {precisaDetalhe && total > 0 && (
        <span className="text-[11px] text-slate-500">{concluidos} de {total} processados</span>
      )}
      {status === 'erro' && comErro.length > 0 && (
        <span className="text-[11px] text-red-600 max-w-[180px] truncate" title={comErro[0]?.erro_log}>
          {comErro[0]?.erro_log || 'Falha no processamento'}
        </span>
      )}
      {(status === 'erro' || status === 'parcial') && comErro.some(i => (i.tentativas || 0) < 3) && (
        <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] border-red-300 text-red-700 hover:bg-red-50 w-fit" onClick={reprocessar}>
          <RotateCcw className="w-3 h-3 mr-1" /> Reprocessar erros
        </Button>
      )}
    </div>
  );
}