import React, { useState, useRef, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function ObservacaoCell({ row, queryClient }) {
  const [valor, setValor] = useState(row.observacao || '');
  const [salvando, setSalvando] = useState(false);
  const valorRef = useRef(row.observacao || '');

  useEffect(() => {
    setValor(row.observacao || '');
    valorRef.current = row.observacao || '';
  }, [row.observacao, row.id]);

  const salvar = async () => {
    const v = valor.trim();
    if (v === valorRef.current) return;
    setSalvando(true);
    try {
      await base44.entities.Carga.update(row.id, { observacao: v });
      valorRef.current = v;
      queryClient.invalidateQueries({ queryKey: ['cargas'] });
    } catch (e) {
      toast.error('Erro ao salvar: ' + e.message);
      setValor(valorRef.current);
    }
    setSalvando(false);
  };

  return (
    <div className="relative">
      <Input
        value={valor}
        onChange={e => setValor(e.target.value)}
        onBlur={salvar}
        onKeyDown={e => { if (e.key === 'Enter') { e.target.blur(); } }}
        placeholder="Destino / rota..."
        className="h-7 text-xs px-2 py-0"
        disabled={salvando}
      />
      {salvando && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-slate-400" />}
    </div>
  );
}