import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, AlertTriangle, CheckCircle2, DollarSign, CreditCard } from 'lucide-react';

export default function DebitosClienteModal({ open, onOpenChange, clienteId, clienteNome }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  React.useEffect(() => {
    if (open && clienteId) {
      consultarDebitos();
    }
    if (!open) {
      setData(null);
      setError(null);
    }
  }, [open, clienteId]);

  const consultarDebitos = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await base44.functions.invoke('consultarDebitosOmie', { cliente_id: clienteId });
      setData(response.data);
    } catch (err) {
      setError(err.message || 'Erro ao consultar débitos');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-amber-500" />
            Débitos - {clienteNome}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            <span className="ml-3 text-slate-500">Consultando Omie...</span>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {data && !loading && (
          <div className="space-y-4">
            {/* Resumo */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-500">Total Débitos</p>
                <p className="text-lg font-bold text-slate-900">{formatCurrency(data.total_debitos)}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-500">Títulos Atrasados</p>
                <p className="text-lg font-bold text-red-600">{data.titulos_atrasados || 0}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-500">Limite Crédito</p>
                <p className="text-lg font-bold text-blue-600">
                  {data.limite_credito !== null ? formatCurrency(data.limite_credito) : 'N/D'}
                </p>
              </div>
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-xs text-slate-500">Saldo Disponível</p>
                <p className={`text-lg font-bold ${data.saldo_disponivel < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {data.saldo_disponivel !== null ? formatCurrency(data.saldo_disponivel) : 'N/D'}
                </p>
              </div>
            </div>

            {/* Status */}
            {data.tem_pendencia ? (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                <span className="text-sm text-red-700 font-medium">
                  Cliente com pendência financeira ({data.titulos_atrasados} título(s) atrasado(s))
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                <span className="text-sm text-green-700 font-medium">Cliente sem pendências financeiras</span>
              </div>
            )}

            {/* Lista de títulos */}
            {data.titulos && data.titulos.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700">Títulos em Aberto</h3>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="text-left p-2 font-medium text-slate-600">Nº Título</th>
                        <th className="text-left p-2 font-medium text-slate-600">Parcela</th>
                        <th className="text-left p-2 font-medium text-slate-600">Vencimento</th>
                        <th className="text-right p-2 font-medium text-slate-600">Valor</th>
                        <th className="text-center p-2 font-medium text-slate-600">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.titulos.map((titulo, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2">{titulo.numero || titulo.documento_fiscal || '-'}</td>
                          <td className="p-2">{titulo.parcela || '-'}</td>
                          <td className="p-2">{titulo.vencimento || '-'}</td>
                          <td className="p-2 text-right font-medium">{formatCurrency(titulo.valor)}</td>
                          <td className="p-2 text-center">
                            {titulo.status === 'ATRASADO' ? (
                              <Badge className="bg-red-500 text-xs">Atrasado</Badge>
                            ) : titulo.status === 'VENCEHOJE' ? (
                              <Badge className="bg-amber-500 text-xs">Vence Hoje</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">{titulo.status}</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500 text-center py-4">Nenhum título em aberto encontrado.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}