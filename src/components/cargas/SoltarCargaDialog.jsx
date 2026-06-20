import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';
import { formatCurrency } from './montagemUtils';

// Monta uma lista unificada dos pedidos da carga com uma chave estável por linha.
function montarLinhas(carga) {
  if (!carga) return [];
  const linhas = [];
  (carga.pedidos_omie || []).forEach((p) => {
    linhas.push({
      key: String(p.pedido_id || p.codigo_pedido),
      idSolto: String(p.pedido_id || p.codigo_pedido),
      numero: p.numero_pedido,
      cliente: p.nome_fantasia || p.nome_cliente || '—',
      valor: Number(p.valor_total_pedido || 0),
      tipo: 'Venda',
      etapa: p.etapa || '—'
    });
  });
  (carga.pedidos_internos || []).forEach((p) => {
    linhas.push({
      key: String(p.pedido_id),
      idSolto: String(p.pedido_id),
      numero: p.numero_pedido,
      cliente: p.nome_fantasia || p.nome_cliente || '—',
      valor: Number(p.valor_total_pedido || 0),
      tipo: 'D1',
      etapa: p.cenario_fiscal_nome || '—'
    });
  });
  (carga.pedidos_troca || []).forEach((t) => {
    linhas.push({
      key: String(t.pedido_troca_id || t.pedido_id),
      idSolto: String(t.pedido_troca_id || t.pedido_id),
      numero: t.numero_pedido,
      cliente: t.nome_fantasia || t.nome_cliente || '—',
      valor: Number(t.valor_total_pedido || 0),
      tipo: 'Troca',
      etapa: '—'
    });
  });
  return linhas;
}

const tipoBadge = {
  Venda: 'bg-blue-100 text-blue-800',
  D1: 'bg-purple-100 text-purple-800',
  Troca: 'bg-orange-100 text-orange-800'
};

export default function SoltarCargaDialog({ open, onOpenChange, carga, onSolto }) {
  const [motivo, setMotivo] = useState('');
  const [soltando, setSoltando] = useState(false);
  const [selecionados, setSelecionados] = useState([]);

  const jaFaturada = carga?.status_carga === 'faturada';
  const linhas = useMemo(() => montarLinhas(carga), [carga]);
  const totalPedidos = linhas.length;
  const todosMarcados = totalPedidos > 0 && selecionados.length === totalPedidos;

  const toggle = (idSolto) => {
    setSelecionados((prev) => prev.includes(idSolto) ? prev.filter((x) => x !== idSolto) : [...prev, idSolto]);
  };
  const toggleTodos = () => {
    setSelecionados(todosMarcados ? [] : linhas.map((l) => l.idSolto));
  };

  const executarSoltura = async (pedidosIds) => {
    setSoltando(true);
    try {
      const { data } = await base44.functions.invoke('soltarCarga', {
        carga_id: carga.id,
        motivo: motivo || 'Não informado',
        ...(pedidosIds ? { pedidos_ids: pedidosIds } : {})
      });
      if (data?.error) throw new Error(data.error);
      toast.success(data?.mensagem || 'Pedidos soltos com sucesso');
      setMotivo('');
      setSelecionados([]);
      onSolto?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e.message);
    }
    setSoltando(false);
  };

  if (!carga) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Soltar Pedidos — Carga {carga.numero_carga}</DialogTitle>
          <DialogDescription>
            Marque os pedidos para soltar apenas alguns, ou solte a carga toda. Pedidos soltos voltam para a Montagem.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {jaFaturada && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="text-sm text-red-800">
                <strong>Atenção!</strong> Esta carga já foi faturada (enviada ao Omie).
                Os pedidos podem estar em etapa avançada no Omie. A NF <strong>não</strong> é cancelada automaticamente — verifique antes de prosseguir.
              </div>
            </div>
          )}

          {/* Cabeçalho seleção */}
          <div className="flex items-center justify-between border-b pb-2">
            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <Checkbox checked={todosMarcados} onCheckedChange={toggleTodos} />
              Selecionar todos
            </label>
            <span className="text-sm text-slate-500">{selecionados.length} de {totalPedidos}</span>
          </div>

          {/* Lista de pedidos */}
          <div className="space-y-1.5 max-h-[40vh] overflow-y-auto pr-1">
            {linhas.map((l) => {
              const marcado = selecionados.includes(l.idSolto);
              return (
                <div
                  key={l.key}
                  onClick={() => toggle(l.idSolto)}
                  className={`flex items-center gap-3 rounded-lg border p-2.5 cursor-pointer transition-colors ${marcado ? 'border-cyan-400 bg-cyan-50' : 'border-slate-200 hover:bg-slate-50'}`}
                >
                  <Checkbox checked={marcado} onCheckedChange={() => toggle(l.idSolto)} onClick={(e) => e.stopPropagation()} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">#{formatarNumeroPedido(l.numero)}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${tipoBadge[l.tipo]}`}>{l.tipo}</span>
                      <span className="text-[10px] text-slate-400">{l.etapa}</span>
                    </div>
                    <div className="text-xs text-slate-600 truncate">{l.cliente}</div>
                  </div>
                  <div className="text-sm font-medium text-slate-700 shrink-0">{formatCurrency(l.valor)}</div>
                </div>
              );
            })}
          </div>

          <div>
            <Label>Motivo</Label>
            <Textarea
              placeholder="Ex: Caminhão quebrou, produtos errados, cliente cancelou..."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={soltando} className="sm:mr-auto">
            Cancelar
          </Button>

          <Button
            onClick={() => executarSoltura(selecionados)}
            disabled={soltando || selecionados.length === 0}
            className="bg-amber-500 hover:bg-amber-600 text-white"
          >
            {soltando && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Soltar selecionados ({selecionados.length})
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={soltando || totalPedidos === 0}>
                Soltar carga toda
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Soltar a carga inteira?</AlertDialogTitle>
                <AlertDialogDescription>
                  Todos os <strong>{totalPedidos}</strong> pedido(s) da carga {carga.numero_carga} voltarão para a Montagem e a carga será zerada.
                  {jaFaturada && ' Esta carga está faturada — a NF não será cancelada automaticamente.'}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={soltando}>Voltar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => executarSoltura(null)}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {soltando && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Sim, soltar tudo
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}