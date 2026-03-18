import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FileX, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export default function CancelarNfSection({ numeroNf, onResult }) {
  const [motivo, setMotivo] = useState('');
  const [cancelando, setCancelando] = useState(false);

  const cancelarNf = async () => {
    if (!motivo.trim()) {
      toast.error('Informe o motivo do cancelamento');
      return;
    }

    if (!confirm(`Tem certeza que deseja cancelar a NF ${numeroNf}? Esta ação não pode ser desfeita.`)) {
      return;
    }

    setCancelando(true);

    const response = await base44.functions.invoke('cancelarNfOmie', {
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

    setCancelando(false);
  };

  return (
    <div className="mt-4 p-4 bg-red-50 rounded-lg border border-red-200">
      <h3 className="font-medium text-red-800 flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4" />
        Cancelar NF (anula a nota original na SEFAZ)
      </h3>
      <div className="space-y-3">
        <div>
          <Label>Motivo do cancelamento *</Label>
          <Textarea
            placeholder="Ex: Retorno de mercadoria - cliente ausente"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="bg-white"
          />
        </div>
        <Button
          onClick={cancelarNf}
          disabled={cancelando}
          className="bg-red-600 hover:bg-red-700 text-white"
        >
          {cancelando ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <FileX className="w-4 h-4 mr-2" />
          )}
          Cancelar NF no Omie
        </Button>
      </div>
    </div>
  );
}