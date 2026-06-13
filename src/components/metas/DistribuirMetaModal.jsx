import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';

const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Modal para distribuir uma meta (gerente→supervisores ou supervisor→vendedores)
 * @param {object} metaPai - A meta pai a ser distribuída
 * @param {array} destinatarios - Lista de { id, nome } para quem distribuir
 * @param {string} nivelFilho - 'supervisor' ou 'vendedor'
 * @param {array} metasExistentes - Metas já criadas para esse nível/pai
 */
export default function DistribuirMetaModal({ open, onClose, metaPai, destinatarios = [], nivelFilho, metasExistentes = [] }) {
  const queryClient = useQueryClient();
  const [valores, setValores] = useState({});
  const [pacotes, setPacotes] = useState({});
  const [salvando, setSalvando] = useState(false);

  // Pre-preencher com metas existentes
  useMemo(() => {
    const v = {}, p = {};
    for (const m of metasExistentes) {
      const destId = nivelFilho === 'supervisor' ? m.supervisor_id : m.vendedor_id;
      if (destId) {
        v[destId] = m.valor_meta || 0;
        p[destId] = m.volume_pacotes_meta || 0;
      }
    }
    setValores(v);
    setPacotes(p);
  }, [metasExistentes, nivelFilho]);

  const totalDistribuido = Object.values(valores).reduce((s, v) => s + Number(v || 0), 0);
  const totalMeta = Number(metaPai?.valor_meta || 0);
  const diferenca = totalMeta - totalDistribuido;
  const ok = Math.abs(diferenca) < 0.01;

  const handleSalvar = async () => {
    if (!metaPai) return;
    setSalvando(true);
    try {
      for (const dest of destinatarios) {
        const valorDest = Number(valores[dest.id] || 0);
        if (valorDest <= 0) continue;

        const mesRef = metaPai.mes_referencia || metaPai.periodo_inicio?.slice(0, 7);
        const metaExistente = metasExistentes.find(m => {
          const destId = nivelFilho === 'supervisor' ? m.supervisor_id : m.vendedor_id;
          return destId === dest.id;
        });

        const payload = {
          titulo: `Meta ${nivelFilho === 'supervisor' ? 'Supervisão' : 'Vendedor'} — ${dest.nome} — ${mesRef}`,
          tipo: metaPai.tipo || 'vendas',
          nivel: nivelFilho,
          meta_pai_id: metaPai.id,
          mes_referencia: mesRef,
          periodo_inicio: metaPai.periodo_inicio,
          periodo_fim: metaPai.periodo_fim,
          valor_meta: valorDest,
          volume_pacotes_meta: Number(pacotes[dest.id] || 0),
          status: 'ativa',
          supervisor_id: nivelFilho === 'supervisor' ? dest.id : (metaPai.supervisor_id || ''),
          supervisor_nome: nivelFilho === 'supervisor' ? dest.nome : (metaPai.supervisor_nome || ''),
          vendedor_id: nivelFilho === 'vendedor' ? dest.id : '',
          vendedor_nome: nivelFilho === 'vendedor' ? dest.nome : '',
          gerente_id: metaPai.gerente_id || metaPai.vendedor_id || '',
          gerente_nome: metaPai.gerente_nome || '',
        };

        if (metaExistente) {
          await base44.entities.Meta.update(metaExistente.id, payload);
        } else {
          await base44.entities.Meta.create(payload);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['metas'] });
      toast.success(`Metas distribuídas para ${destinatarios.filter(d => Number(valores[d.id] || 0) > 0).length} ${nivelFilho === 'supervisor' ? 'supervisores' : 'vendedores'}!`);
      onClose();
    } catch (e) {
      toast.error('Erro ao salvar: ' + e.message);
    } finally {
      setSalvando(false);
    }
  };

  if (!metaPai) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            Distribuir Meta → {nivelFilho === 'supervisor' ? 'Supervisores' : 'Vendedores'}
          </DialogTitle>
          <p className="text-xs text-slate-500 mt-1">
            Meta pai: <strong>{metaPai.titulo}</strong> — {fmt(totalMeta)}
          </p>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Barra de distribuição */}
          <div className={`rounded-lg p-3 border text-sm flex items-center gap-2 ${ok ? 'bg-green-50 border-green-200 text-green-700' : diferenca > 0 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            <span>
              Distribuído: <strong>{fmt(totalDistribuido)}</strong> de <strong>{fmt(totalMeta)}</strong>
              {!ok && ` — ${diferenca > 0 ? 'Falta' : 'Excesso'}: ${fmt(Math.abs(diferenca))}`}
            </span>
          </div>

          {/* Lista de destinatários */}
          {destinatarios.map(dest => (
            <div key={dest.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{dest.nome}</span>
                {metasExistentes.find(m => (nivelFilho === 'supervisor' ? m.supervisor_id : m.vendedor_id) === dest.id) && (
                  <Badge variant="outline" className="text-xs">já tem meta</Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">R$ Meta</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    className="h-8 text-sm"
                    value={valores[dest.id] || ''}
                    onChange={e => setValores(prev => ({ ...prev, [dest.id]: e.target.value }))}
                    placeholder="0,00"
                  />
                </div>
                <div>
                  <Label className="text-xs">Pacotes Meta</Label>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    className="h-8 text-sm"
                    value={pacotes[dest.id] || ''}
                    onChange={e => setPacotes(prev => ({ ...prev, [dest.id]: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button
            onClick={handleSalvar}
            disabled={salvando || totalDistribuido === 0}
            className="bg-amber-500 hover:bg-amber-600 text-neutral-900"
          >
            {salvando ? 'Salvando...' : 'Salvar Distribuição'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}