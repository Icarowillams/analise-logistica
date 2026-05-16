import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2, Copy, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

/**
 * P5 (16/05) — Modal para duplicar pedidos Omie pedindo:
 *   - Cenário fiscal local (lista de CenarioFiscalLocal ativos)
 *   - Plano de pagamento (PlanoPagamento)
 *
 * Itens, cliente, valores são reaproveitados do pedido original.
 */
export default function DuplicarPedidosModal({ open, onOpenChange, pedidosSelecionados, onSucesso }) {
  const [cenarioLocalId, setCenarioLocalId] = useState('');
  const [planoPagamentoId, setPlanoPagamentoId] = useState('');
  const [duplicando, setDuplicando] = useState(false);

  const { data: cenarios = [], isLoading: loadingCen } = useQuery({
    queryKey: ['cenarios-fiscais-locais-duplicar'],
    queryFn: () => base44.entities.CenarioFiscalLocal.filter({ status: 'ativo' }, 'nome', 200),
    enabled: open
  });

  const { data: planos = [], isLoading: loadingPlanos } = useQuery({
    queryKey: ['planos-pagamento-duplicar'],
    queryFn: () => base44.entities.PlanoPagamento.filter({ status: 'ativo' }, 'nome', 200),
    enabled: open
  });

  const cenarioAtual = useMemo(
    () => cenarios.find(c => c.id === cenarioLocalId),
    [cenarios, cenarioLocalId]
  );

  const handleDuplicar = async () => {
    if (!cenarioLocalId) {
      toast.error('Selecione o cenário fiscal');
      return;
    }
    if (!planoPagamentoId) {
      toast.error('Selecione a forma de pagamento');
      return;
    }
    setDuplicando(true);
    try {
      const payload = {
        pedidos: pedidosSelecionados.map(p => ({
          codigo_pedido: p.codigo_pedido,
          codigo_pedido_integracao: p.codigo_pedido_integracao
        })),
        cenario_local_id: cenarioLocalId,
        plano_pagamento_id: planoPagamentoId
      };
      const { data } = await base44.functions.invoke('duplicarPedidoOmie', payload);
      if (data?.error) {
        toast.error(data.error);
      } else {
        const ok = data?.sucessos || 0;
        const fail = data?.erros || 0;
        if (ok > 0) toast.success(`${ok} pedido(s) duplicado(s) com sucesso.`);
        if (fail > 0) {
          const primeirosErros = (data?.resultados || []).filter(r => !r.sucesso).slice(0, 3).map(r => r.erro).join(' | ');
          toast.error(`${fail} falha(s): ${primeirosErros}`);
        }
        onSucesso?.();
        onOpenChange(false);
      }
    } catch (e) {
      toast.error(e.message || 'Erro ao duplicar pedidos');
    } finally {
      setDuplicando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="w-5 h-5 text-amber-500" />
            Duplicar {pedidosSelecionados.length} pedido{pedidosSelecionados.length > 1 ? 's' : ''}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-xs text-amber-800">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              Os itens, cliente e valores serão reaproveitados do pedido original. Apenas o
              <b> cenário fiscal</b> e a <b>forma de pagamento</b> serão aplicados conforme abaixo.
              Os novos pedidos entrarão como <b>Etapa 10 (Pedido)</b>.
            </div>
          </div>

          <div>
            <Label className="text-sm">Cenário Fiscal <span className="text-red-500">*</span></Label>
            <Select value={cenarioLocalId} onValueChange={setCenarioLocalId}>
              <SelectTrigger>
                <SelectValue placeholder={loadingCen ? 'Carregando...' : 'Selecione o cenário fiscal'} />
              </SelectTrigger>
              <SelectContent>
                {cenarios.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome} ({c.tipo_operacao})
                    {c.cenario_omie_nome ? ` → Omie: ${c.cenario_omie_nome}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cenarioAtual && !cenarioAtual.cenario_omie_codigo && (
              <p className="text-[11px] text-amber-600 mt-1">
                ⚠ Este cenário local não tem código Omie vinculado — pedido será duplicado sem cenário fiscal no Omie.
              </p>
            )}
          </div>

          <div>
            <Label className="text-sm">Forma de Pagamento <span className="text-red-500">*</span></Label>
            <Select value={planoPagamentoId} onValueChange={setPlanoPagamentoId}>
              <SelectTrigger>
                <SelectValue placeholder={loadingPlanos ? 'Carregando...' : 'Selecione a forma de pagamento'} />
              </SelectTrigger>
              <SelectContent>
                {planos.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2 mt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={duplicando}>
            Cancelar
          </Button>
          <Button
            className="bg-amber-600 hover:bg-amber-700"
            onClick={handleDuplicar}
            disabled={duplicando || !cenarioLocalId || !planoPagamentoId}
          >
            {duplicando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Copy className="w-4 h-4 mr-1" />}
            Duplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}