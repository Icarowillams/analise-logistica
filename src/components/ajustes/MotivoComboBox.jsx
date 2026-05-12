import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { ChevronDown } from 'lucide-react';

/**
 * Combobox de Motivo de Corte: permite digitar livremente (busca nos cadastrados)
 * ou selecionar de uma lista suspensa filtrada conforme o texto.
 */
export default function MotivoComboBox({
  value = '',
  onChange,
  options = [],          // [{ id, descricao }]
  disabled = false,
  placeholder = 'Digite ou selecione o motivo...',
  required = false,
  className = '',
  size = 'normal'        // 'normal' | 'sm'
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const termo = (value || '').toLowerCase().trim();
  const filtrados = termo
    ? options.filter(o => (o.descricao || '').toLowerCase().includes(termo))
    : options;

  const hClass = size === 'sm' ? 'h-8 pr-7' : 'pr-8';
  const iconClass = size === 'sm' ? 'right-2 top-2 w-4 h-4' : 'right-2.5 top-2.5 w-4 h-4';

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => setOpen(true)}
        disabled={disabled}
        placeholder={placeholder}
        required={required}
        className={hClass}
      />
      <ChevronDown
        className={`absolute ${iconClass} text-slate-400 pointer-events-none`}
      />
      {open && !disabled && filtrados.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {filtrados.map(o => (
            <button
              key={o.id}
              type="button"
              onClick={() => { onChange(o.descricao); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 hover:text-indigo-700"
            >
              {o.descricao}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}