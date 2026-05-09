import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MapPin, MessageSquare } from 'lucide-react';
import { visitaDoCliente, formatarStatus, statusVisitaClasses } from './roteirosUtils';

export default function DiaRoteiroCard({ dia, roteiro, visitas, onClienteClick, showFeedback = true }) {
  const clientes = [...(roteiro?.clientes_detalhes || [])].sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

  return (
    <Card className="min-h-[260px]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{dia.label}</CardTitle>
          {roteiro && <Badge variant="outline">{roteiro.status}</Badge>}
        </div>
        {roteiro?.vendedor_nome && <p className="text-xs text-slate-500">{roteiro.vendedor_nome}</p>}
      </CardHeader>
      <CardContent className="space-y-2">
        {!roteiro && <p className="text-sm text-slate-400">Sem roteiro planejado.</p>}
        {showFeedback && roteiro?.feedback_supervisor && (
          <div className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 p-2 flex gap-2">
            <MessageSquare className="w-4 h-4 shrink-0" />{roteiro.feedback_supervisor}
          </div>
        )}
        {clientes.map((cliente, index) => {
          const visita = visitaDoCliente(visitas, roteiro.id, cliente.cliente_id);
          return (
            <Button key={`${cliente.cliente_id}-${index}`} variant="outline" className="w-full h-auto justify-start p-3" onClick={() => onClienteClick(roteiro, cliente, visita)}>
              <div className="text-left w-full space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-sm">{index + 1}. {cliente.cliente_nome}</span>
                  <Badge className={statusVisitaClasses[visita?.status || 'planejada']}>{formatarStatus(visita?.status)}</Badge>
                </div>
                <span className="text-xs text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3" />{cliente.cliente_cidade || cliente.cliente_endereco || '-'}</span>
              </div>
            </Button>
          );
        })}
      </CardContent>
    </Card>
  );
}