import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle2, XCircle, RotateCcw, MapPin } from 'lucide-react';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';

const STATUS_COLORS = {
  pendente: 'bg-slate-200 text-slate-700',
  entregue: 'bg-emerald-100 text-emerald-800',
  nao_entregue: 'bg-red-100 text-red-800'
};

const fmt = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

export default function CardNotaAcerto({ nota, onChange, onMarcarEntregue, onMarcarNaoEntregue, onRestaurar }) {
  const set = (patch) => {
    const novo = { ...nota, ...patch };
    if ('valor_recebido' in patch) {
      novo.diferenca = Number(novo.valor_recebido || 0) - Number(novo.valor_original || 0);
    }
    onChange(novo);
  };

  const isNaoEntregue = nota.status_entrega === 'nao_entregue';

  return (
    <Card className={`${isNaoEntregue ? 'border-red-200 bg-red-50/30' : nota.status_entrega === 'entregue' ? 'border-emerald-200 bg-emerald-50/30' : ''}`}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm truncate">
              {nota.numero_pedido && <span className="text-slate-500">Pedido </span>}
              {nota.numero_pedido ? formatarNumeroPedido(nota.numero_pedido, nota.tipo) : nota.codigo_pedido}
              {nota.numero_nfe && <span className="text-slate-500 text-xs ml-2">NF-e {nota.numero_nfe}</span>}
            </div>
            <div className="text-xs text-slate-600 truncate">{nota.nome_cliente || nota.razao_social}</div>
          </div>
          <Badge className={STATUS_COLORS[nota.status_entrega]}>
            {nota.status_entrega === 'nao_entregue' ? 'não entregue' : nota.status_entrega}
          </Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <Label className="text-xs">Forma Pgto</Label>
            <Select value={nota.forma_pagamento || 'boleto'} onValueChange={(v) => set({ forma_pagamento: v })} disabled={isNaoEntregue}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="dinheiro">Dinheiro</SelectItem>
                <SelectItem value="pix">PIX</SelectItem>
                <SelectItem value="boleto">Boleto</SelectItem>
                <SelectItem value="cartao">Cartão</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Original</Label>
            <Input value={fmt(nota.valor_original)} disabled className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs">Recebido</Label>
            <Input
              type="number" step="0.01"
              value={nota.valor_recebido ?? 0}
              onChange={(e) => set({ valor_recebido: parseFloat(e.target.value || 0) })}
              disabled={isNaoEntregue}
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">Diferença</Label>
            <Input
              value={fmt(nota.diferenca)}
              disabled
              className={`h-8 text-xs ${Number(nota.diferenca) < 0 ? 'text-red-600 font-semibold' : Number(nota.diferenca) > 0 ? 'text-emerald-600 font-semibold' : ''}`}
            />
          </div>
        </div>

        {nota.checkin_entrega?.latitude && (
          <a
            href={`https://www.google.com/maps?q=${nota.checkin_entrega.latitude},${nota.checkin_entrega.longitude}`}
            target="_blank" rel="noopener noreferrer"
            className="text-xs text-emerald-700 hover:underline inline-flex items-center gap-1"
          >
            <MapPin className="w-3 h-3" />
            Entregue em {nota.checkin_entrega.latitude.toFixed(5)}, {nota.checkin_entrega.longitude.toFixed(5)}
          </a>
        )}

        {nota.motivo_cancelamento && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
            <b>Motivo:</b> {nota.motivo_cancelamento}
          </div>
        )}

        <div className="flex flex-wrap gap-1 pt-1">
          {nota.status_entrega !== 'entregue' && (
            <Button size="sm" variant="outline" onClick={onMarcarEntregue} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Entregue
            </Button>
          )}
          {nota.status_entrega !== 'nao_entregue' && (
            <Button size="sm" variant="outline" onClick={onMarcarNaoEntregue} className="border-red-300 text-red-700 hover:bg-red-50">
              <XCircle className="w-3.5 h-3.5 mr-1" /> Não Entregue
            </Button>
          )}
          {nota.status_entrega !== 'pendente' && (
            <Button size="sm" variant="ghost" onClick={onRestaurar}>
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restaurar
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}