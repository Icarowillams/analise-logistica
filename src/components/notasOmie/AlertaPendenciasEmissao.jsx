import React, { useEffect, useState, useCallback } from 'react';
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
import { AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';

/**
 * Banner de pendências de emissão (aba Emissão de NF).
 * - Ao montar (ou quando `ativa` vira true), detecta automaticamente pedidos faturados na carga
 *   que ficaram SEM NF (presos em etapa 50) — detecção barata, só dados locais, sem bater no Omie.
 * - Só aparece quando há pendência. Sem preso, fica invisível.
 * - Reaproveita a função reemitirNfPresasEtapa50 (resiliente: retry + delay) por ação HUMANA.
 */
export default function AlertaPendenciasEmissao({ ativa = true, onReemitido }) {
  const [presos, setPresos] = useState([]);
  const [total, setTotal] = useState(0);
  const [detectando, setDetectando] = useState(false);
  const [reemitindo, setReemitindo] = useState(false);

  const detectar = useCallback(async () => {
    setDetectando(true);
    try {
      const resp = await base44.functions.invoke('reemitirNfPresasEtapa50', { apenas_detectar: true });
      const data = resp?.data || {};
      setPresos(Array.isArray(data.presos) ? data.presos : []);
      setTotal(Number(data.detectados || 0));
    } catch {
      setPresos([]);
      setTotal(0);
    } finally {
      setDetectando(false);
    }
  }, []);

  useEffect(() => {
    if (ativa) detectar();
  }, [ativa, detectar]);

  const reemitir = async () => {
    setReemitindo(true);
    try {
      const resp = await base44.functions.invoke('reemitirNfPresasEtapa50', { limite: 25 });
      const data = resp?.data || {};
      if (data.sucesso) {
        toast.success(data.mensagem || `${data.reemitidos || 0} NF reemitida(s).`);
        onReemitido?.();
      } else if (data.omie_bloqueada) {
        toast.error('API Omie temporariamente bloqueada. Tente novamente em instantes.');
      } else {
        toast.error(data.error || data.mensagem || 'Falha ao reemitir NF presas.');
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message || 'Erro ao reemitir NF presas.');
    } finally {
      setReemitindo(false);
      detectar();
    }
  };

  // Sem pendência → invisível (mas mantém o componente montado para re-detectar depois).
  if (!detectando && total === 0) return null;
  if (detectando && total === 0) return null;

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3 sm:p-4 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold text-amber-900 text-sm sm:text-base">
              ⚠ {total} pedido{total > 1 ? 's' : ''} ficaram sem emitir NF
            </p>
            <p className="text-xs text-amber-800 mt-0.5">
              Faturados na carga mas presos em etapa 50 (sem nota). Clique para reemitir — emissão fiscal real, por ação humana.
            </p>

            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-amber-200 bg-white divide-y divide-amber-100">
              {presos.map((p) => (
                <div key={p.codigo_pedido} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2.5 py-1.5 text-xs">
                  <span className="font-medium text-slate-800">Pedido {formatarNumeroPedido(p.numero_pedido || p.codigo_pedido)}</span>
                  {p.numero_carga && <span className="text-slate-500">Carga {p.numero_carga}</span>}
                  {p.cliente_nome && <span className="text-slate-500 truncate max-w-[180px]">{p.cliente_nome}</span>}
                  <span className="text-amber-700 truncate max-w-[260px]">{p.motivo}</span>
                </div>
              ))}
              {total > presos.length && (
                <div className="px-2.5 py-1.5 text-xs text-slate-500">
                  + {total - presos.length} outro(s) pedido(s)...
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-shrink-0">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                disabled={reemitindo}
                className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white"
              >
                {reemitindo ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldAlert className="w-4 h-4 mr-2" />}
                Reemitir NF presas ({total})
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-500" />
                  Reemitir {total} NF presa{total > 1 ? 's' : ''} (etapa 50)
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <span className="block">
                    Reemite a NF-e dos pedidos faturados na carga que ficaram sem nota. A emissão é
                    resiliente: processa um a um, com espera e novas tentativas em caso de limite do Omie.
                    <strong> Emissão fiscal real</strong> — só prossiga se for intencional.
                  </span>
                  <span className="block text-sm text-slate-500">
                    Pedidos já faturados não são reemitidos. Pedidos soltos manualmente ou fora de carga são ignorados.
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={reemitir} className="bg-amber-600 hover:bg-amber-700">
                  Confirmar e reemitir
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}