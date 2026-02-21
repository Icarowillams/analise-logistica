import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { MessageSquare, Save } from 'lucide-react';
import { toast } from 'sonner';

export default function ObservacoesVisita({ visitaRegistro }) {
  const [observacoes, setObservacoes] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    if (visitaRegistro?.observacoes) {
      setObservacoes(visitaRegistro.observacoes);
      setSalvo(true);
    }
  }, [visitaRegistro]);

  const handleSalvar = async () => {
    if (!visitaRegistro) return;
    setSalvando(true);
    await base44.entities.Visita.update(visitaRegistro.id, { observacoes });
    setSalvando(false);
    setSalvo(true);
    toast.success('Observações salvas!');
  };

  if (!visitaRegistro) return null;

  return (
    <div className="space-y-2 p-3 bg-slate-50 rounded-lg border border-slate-200">
      <Label className="text-sm font-semibold flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-slate-600" />
        Observações
      </Label>
      <Textarea
        placeholder="Digite observações sobre esta visita..."
        value={observacoes}
        onChange={(e) => { setObservacoes(e.target.value); setSalvo(false); }}
        className="min-h-[80px] text-sm"
      />
      <Button
        onClick={handleSalvar}
        disabled={salvando || salvo}
        size="sm"
        className="w-full bg-slate-700 hover:bg-slate-800"
      >
        <Save className="w-3 h-3 mr-1" />
        {salvando ? 'Salvando...' : salvo ? 'Salvo ✓' : 'Salvar Observações'}
      </Button>
    </div>
  );
}