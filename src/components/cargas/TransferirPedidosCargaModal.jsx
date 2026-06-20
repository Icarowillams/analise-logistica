import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';

export default function TransferirPedidosCargaModal({ open, onOpenChange, carga, onTransferido }) {
  const [selecionados, setSelecionados] = useState([]);
  const [cargaDestinoId, setCargaDestinoId] = useState('');
  const [transferindo, setTransferindo] = useState(false);

  // Cargas em montagem (exceto a atual)
  const { data: cargasDestino = [] } = useQuery({
    queryKey: ['cargas-montagem'],
    queryFn: () => base44.entities.Carga.filter({ status_carga: 'montagem' }, '-created_date', 100),
    staleTime: 30000,
    enabled: open
  });

  const cargasDisp = useMemo(() =>
    cargasDestino.filter(c => c.id !== carga?.id),
    [cargasDestino, carga]
  );

  // Todos os pedidos da carga (Omie + Internos + Trocas)
  const todosPedidos = useMemo(() => {
    if (!carga) return [];
    const lista = [];
    for (const p of (carga.pedidos_omie || [])) {
      lista.push({
        id: p.codigo_pedido,
        tipo: 'omie',
        numero: p.numero_pedido || p.codigo_pedido,
        cliente: p.nome_fantasia || p.nome_cliente || '',
        valor: p.valor_total_pedido || 0,
        nf: p.numero_nf || ''
      });
    }
    for (const p of (carga.pedidos_internos || [])) {
      lista.push({
        id: p.pedido_id,
        tipo: 'interno',
        numero: p.numero_pedido || p.pedido_id,
        cliente: p.nome_fantasia || p.nome_cliente || '',
        valor: p.valor_total_pedido || 0,
        nf: ''
      });
    }
    for (const p of (carga.pedidos_troca || [])) {
      lista.push({
        id: p.pedido_troca_id || p.numero_pedido,
        tipo: 'troca',
        numero: p.numero_pedido || '',
        cliente: p.nome_fantasia || p.nome_cliente || '',
        valor: p.valor_total_pedido || 0,
        nf: ''
      });
    }
    return lista;
  }, [carga]);

  const togglePedido = (id) => {
    setSelecionados(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleTodos = () => {
    setSelecionados(prev =>
      prev.length === todosPedidos.length ? [] : todosPedidos.map(p => p.id)
    );
  };

  const transferir = async () => {
    if (selecionados.length === 0) { toast.error('Selecione ao menos um pedido'); return; }
    if (!cargaDestinoId) { toast.error('Selecione a carga destino'); return; }

    setTransferindo(true);
    try {
      // Separa pedidos Omie dos internos/trocas
      const pedidosSelecionados = todosPedidos.filter(p => selecionados.includes(p.id));
      const omieIds = pedidosSelecionados.filter(p => p.tipo === 'omie').map(p => p.id);

      if (omieIds.length > 0) {
        // Usa a função backend existente para pedidos Omie
        const { data } = await base44.functions.invoke('transferirPedidoCarga', {
          pedidos_codigos_omie: omieIds,
          carga_origem_id: carga.id,
          carga_destino_id: cargaDestinoId,
          motivo: 'Transferência via contingência de cargas'
        });
        if (data?.error) throw new Error(data.error);
      }

      // Pedidos internos D1 e trocas: move manualmente
      const internosIds = pedidosSelecionados.filter(p => p.tipo === 'interno').map(p => p.id);
      const trocasIds = pedidosSelecionados.filter(p => p.tipo === 'troca').map(p => p.id);

      if (internosIds.length > 0 || trocasIds.length > 0) {
        const destino = await base44.entities.Carga.get(cargaDestinoId);

        // Move internos
        if (internosIds.length > 0) {
          const novosInternosOrigem = (carga.pedidos_internos || []).filter(p => !internosIds.includes(p.pedido_id));
          const mover = (carga.pedidos_internos || []).filter(p => internosIds.includes(p.pedido_id));
          const novosInternosDestino = [...(destino.pedidos_internos || []), ...mover];

          await base44.entities.Carga.update(carga.id, { pedidos_internos: novosInternosOrigem });
          await base44.entities.Carga.update(cargaDestinoId, { pedidos_internos: novosInternosDestino });

          for (const p of mover) {
            if (p.pedido_id) {
              await base44.entities.Pedido.update(p.pedido_id, {
                carga_id: cargaDestinoId, numero_carga: destino.numero_carga
              }).catch(() => {});
            }
          }
        }

        // Move trocas
        if (trocasIds.length > 0) {
          const novasTrocasOrigem = (carga.pedidos_troca || []).filter(p => !trocasIds.includes(p.pedido_troca_id || p.numero_pedido));
          const mover = (carga.pedidos_troca || []).filter(p => trocasIds.includes(p.pedido_troca_id || p.numero_pedido));
          const novasTrocasDestino = [...(destino.pedidos_troca || []), ...mover];

          await base44.entities.Carga.update(carga.id, { pedidos_troca: novasTrocasOrigem });
          await base44.entities.Carga.update(cargaDestinoId, { pedidos_troca: novasTrocasDestino });
        }
      }

      toast.success(`${selecionados.length} pedido(s) transferido(s) com sucesso`);
      setSelecionados([]);
      setCargaDestinoId('');
      onTransferido?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e.message);
    }
    setTransferindo(false);
  };

  if (!carga) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transferir Pedidos — Carga {carga.numero_carga}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Seleção de pedidos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium">Pedidos da carga</Label>
              <Button variant="ghost" size="sm" onClick={toggleTodos} className="text-xs h-6">
                {selecionados.length === todosPedidos.length ? 'Desmarcar todos' : 'Selecionar todos'}
              </Button>
            </div>
            <div className="border rounded-lg divide-y max-h-60 overflow-y-auto">
              {todosPedidos.length === 0 && (
                <p className="text-sm text-slate-500 p-3">Nenhum pedido na carga</p>
              )}
              {todosPedidos.map(p => (
                <label key={p.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                  <Checkbox
                    checked={selecionados.includes(p.id)}
                    onCheckedChange={() => togglePedido(p.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">#{formatarNumeroPedido(p.numero)}</span>
                      <Badge variant="outline" className="text-[10px]">{p.tipo}</Badge>
                      {p.nf && <Badge className="bg-green-100 text-green-700 text-[10px]">NF {p.nf}</Badge>}
                    </div>
                    <span className="text-xs text-slate-500 truncate block">{p.cliente}</span>
                  </div>
                  <span className="text-sm font-medium whitespace-nowrap">
                    R$ {Number(p.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Carga destino */}
          <div>
            <Label>Carga destino</Label>
            <Select value={cargaDestinoId} onValueChange={setCargaDestinoId}>
              <SelectTrigger><SelectValue placeholder="Selecione a carga destino..." /></SelectTrigger>
              <SelectContent>
                {cargasDisp.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.numero_carga} — {c.motorista_nome || 'Sem motorista'} ({c.data_carga || ''})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cargasDisp.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">Nenhuma carga em montagem disponível. Crie uma nova carga primeiro.</p>
            )}
          </div>

          {selecionados.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
              <ArrowRight className="w-4 h-4 inline mr-1 text-blue-600" />
              {selecionados.length} pedido(s) serão transferidos da carga {carga.numero_carga}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={transferir} disabled={transferindo || selecionados.length === 0 || !cargaDestinoId}>
            {transferindo && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Transferir {selecionados.length} pedido(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}