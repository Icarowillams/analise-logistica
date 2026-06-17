import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

// Botão MANUAL (substitui a antiga automação agendada que reemitia NF de madrugada).
// Detecta pedidos faturados localmente presos em etapa 50 no Omie (sem NF) e reemite —
// SOMENTE quando uma pessoa clica e confirma. Pedidos soltos manualmente ou sem carga são ignorados pela função.
export default function ReemitirNfPresasButton() {
  const [loading, setLoading] = useState(false);

  const executar = async () => {
    setLoading(true);
    try {
      const resp = await base44.functions.invoke('reemitirNfPresasEtapa50', { limite: 25 });
      const data = resp?.data || {};
      if (data.sucesso) {
        toast.success(data.mensagem || `${data.reemitidos || 0} NF reemitida(s).`);
      } else if (data.omie_bloqueada) {
        toast.error('API Omie temporariamente bloqueada. Tente novamente mais tarde.');
      } else {
        toast.error(data.error || data.mensagem || 'Falha ao reemitir NF presas.');
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message || 'Erro ao reemitir NF presas.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={loading} className="border-amber-300 text-amber-700 hover:bg-amber-50">
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldAlert className="w-4 h-4 mr-2" />}
          Reemitir NF presas (etapa 50)
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-500" />
            Reemitir NF presas em etapa 50
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">
              Esta ação verifica no Omie os pedidos faturados localmente que ficaram presos em etapa 50 (sem NF emitida)
              e emite a NF-e para eles. <strong>Emissão fiscal real</strong> — só prossiga se for intencional.
            </span>
            <span className="block text-sm text-slate-500">
              Pedidos soltos manualmente ou que não estão em uma carga ativa são automaticamente ignorados.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={executar} className="bg-amber-600 hover:bg-amber-700">
            Confirmar e reemitir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}