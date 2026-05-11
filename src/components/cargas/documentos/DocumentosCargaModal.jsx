import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ListaCarregamentoPdf from './ListaCarregamentoPdf';
import RomaneioEntregaPdf from './RomaneioEntregaPdf';
import NotaD1Pdf from './NotaD1Pdf';

/**
 * Modal genérico: tipo = 'lista' | 'romaneio' | 'notad1'
 * Aceita carga (Cargas page) ou pedidosManuais (MontagemCarga).
 */
export default function DocumentosCargaModal({ open, onOpenChange, tipo, carga, pedidosManuais, meta }) {
  const titulo =
    tipo === 'romaneio' ? 'Romaneio de Entrega' :
    tipo === 'notad1' ? 'Notas D1 (Vendas Internas)' :
    'Lista de Carregamento';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titulo}{carga?.numero_carga ? ` — Carga ${carga.numero_carga}` : ''}</DialogTitle>
        </DialogHeader>
        {tipo === 'romaneio' ? (
          <RomaneioEntregaPdf carga={carga} />
        ) : tipo === 'notad1' ? (
          <NotaD1Pdf carga={carga} />
        ) : (
          <ListaCarregamentoPdf carga={carga} pedidosManuais={pedidosManuais} meta={meta} />
        )}
      </DialogContent>
    </Dialog>
  );
}