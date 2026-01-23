import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, List as ListIcon } from 'lucide-react';
import MapaRoteiro from './MapaRoteiro';

export default function VisualizarRoteiroModal({ open, onOpenChange, roteiro }) {
  const [viewMode, setViewMode] = useState('lista');

  if (!roteiro) return null;

  const getDiaLabel = (dia) => {
    const labels = {
      'segunda-feira': 'Segunda-feira',
      'terca-feira': 'Terça-feira',
      'quarta-feira': 'Quarta-feira',
      'quinta-feira': 'Quinta-feira',
      'sexta-feira': 'Sexta-feira',
      'sabado': 'Sábado',
      'domingo': 'Domingo'
    };
    return labels[dia] || dia;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            Roteiro - {roteiro.vendedor_nome} ({getDiaLabel(roteiro.dia_semana)})
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 my-4">
          <Button
            variant={viewMode === 'lista' ? 'default' : 'outline'}
            onClick={() => setViewMode('lista')}
            className={viewMode === 'lista' ? 'bg-neutral-900 text-white' : ''}
          >
            <ListIcon className="w-4 h-4 mr-2" />
            Lista
          </Button>
          <Button
            variant={viewMode === 'mapa' ? 'default' : 'outline'}
            onClick={() => setViewMode('mapa')}
            className={viewMode === 'mapa' ? 'bg-neutral-900 text-white' : ''}
          >
            <MapPin className="w-4 h-4 mr-2" />
            Mapa
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {viewMode === 'lista' ? (
            <div>
              <h3 className="font-semibold mb-4">Sequência de Visitas:</h3>
              <div className="space-y-3">
                {roteiro.clientes_detalhes?.map((cliente, idx) => (
                  <div key={idx} className="flex items-start gap-4 p-4 border rounded-lg hover:bg-slate-50">
                    <Badge className="bg-amber-100 text-amber-700 text-lg px-3 py-1">
                      {idx + 1}
                    </Badge>
                    <div className="flex-1">
                      <h4 className="font-semibold text-lg">{cliente.cliente_nome_ || cliente.cliente_nome}</h4>
                      <p className="text-sm text-slate-600">{cliente.cliente_cidade}</p>
                      <p className="text-xs text-slate-400">Código: {cliente.cliente_codigo}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <MapaRoteiro roteiro={roteiro} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}