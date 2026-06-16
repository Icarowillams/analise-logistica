import React from 'react';
import { Button } from '@/components/ui/button';

const DIAS = [
  { value: 'segunda', label: 'Seg' },
  { value: 'terca', label: 'Ter' },
  { value: 'quarta', label: 'Qua' },
  { value: 'quinta', label: 'Qui' },
  { value: 'sexta', label: 'Sex' },
  { value: 'sabado', label: 'Sáb' },
  { value: 'domingo', label: 'Dom' },
];

export const DIA_LABELS = DIAS.reduce((acc, d) => ({ ...acc, [d.value]: d.label }), {});

export function formatarDiasSelecionados(dias) {
  if (!Array.isArray(dias) || dias.length === 0) return '';
  const ordem = DIAS.map(d => d.value);
  return [...dias]
    .sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b))
    .map(d => DIA_LABELS[d] || d)
    .join(' • ');
}

export default function SeletorDiasSemana({ value = [], onChange, disabled = false }) {
  const selecionados = Array.isArray(value) ? value : [];

  const toggle = (dia) => {
    if (disabled) return;
    const next = selecionados.includes(dia)
      ? selecionados.filter(d => d !== dia)
      : [...selecionados, dia];
    onChange?.(next);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {DIAS.map(({ value: dia, label }) => {
        const ativo = selecionados.includes(dia);
        return (
          <Button
            key={dia}
            type="button"
            variant={ativo ? 'default' : 'outline'}
            size="sm"
            disabled={disabled}
            onClick={() => toggle(dia)}
            className={ativo ? 'bg-amber-500 hover:bg-amber-600 text-white' : ''}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}