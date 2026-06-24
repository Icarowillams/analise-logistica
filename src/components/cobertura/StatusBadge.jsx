import React from 'react';
import { Badge } from '@/components/ui/badge';
import { STATUS_COBERTURA } from '@/lib/coberturaUtils';

const CLASSES = {
  green: 'bg-green-100 text-green-800 border-green-300',
  yellow: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  orange: 'bg-orange-100 text-orange-800 border-orange-300',
  red: 'bg-red-100 text-red-800 border-red-300',
};

export default function StatusBadge({ status }) {
  const cfg = STATUS_COBERTURA[status] || STATUS_COBERTURA.em_dia;
  return (
    <Badge variant="outline" className={CLASSES[cfg.cor]}>
      {cfg.label}
    </Badge>
  );
}