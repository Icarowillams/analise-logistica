import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Undo2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function DevolverNfSection({ numeroNf, onResult }) {
  const [motivo, setMotivo] = useState('');
  const [devolvendo, setDevolvendo] = useState(false);

  const devolverNf = async () => {
    if (!motivo.trim()) {
      toast.error('Informe o motivo da devolução');
      return;
    }

    if (!confirm(`Gerar NF de Entrada (devolução) referente à NF ${numeroNf}?`)) {
      return;
    }

    setDevolvendo(true);

    const response = await base44.functions.invoke('devolverNfOmie', {
      numero_nf: numeroNf.trim(),
      motivo: motivo.trim()
    });

    const data = response.data;

    if (data.sucesso) {
      onResult({ tipo: 'sucesso', mensagem: data.mensagem });
      toast.success(data.mensagem);
    } else {
      onResult({ tipo: 'erro', mensagem: data.erro });
      toast.error(data.erro);
    }

    setDevolvendo(false);
  };

  return (
    <div className="mt-4 p-4 bg-amber-50 rounded-lg border border-amber-200">
      <h3 className="font-medium text-amber-800 flex items-center gap-2 mb-3">
        <Undo2 className="w-4 h-4" />
        Devolução — Gerar NF de Entrada referenciando a NF original
      </h3>
      <p className="text-xs text-amber-600 mb-3">
        Gera uma nota fiscal de entrada que referencia a NF original. Ideal para NFs fora do prazo de 24h.
      </p>
      <div className="space-y-3">
        <div>
          <Label>Motivo da devolução *</Label>
          <Textarea
            placeholder="Ex: Produto avariado, devolução pelo cliente"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="bg-white"
          />
        </div>
        <Button
          onClick={devolverNf}
          disabled={devolvendo}
          className="bg-amber-600 hover:bg-amber-700 text-white"
        >
          {devolvendo ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <Undo2 className="w-4 h-4 mr-2" />
          )}
          Gerar NF de Entrada (Devolução)
        </Button>
      </div>
    </div>
  );
}