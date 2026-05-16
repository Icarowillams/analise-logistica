import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, CheckCircle2, DollarSign, Lock, Unlock } from 'lucide-react';
import { toast } from 'sonner';

export default function DebitosClienteModal({ open, onOpenChange, clienteId, clienteNome }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [clienteAtual, setClienteAtual] = useState(null);
  const [mostrandoUnlock, setMostrandoUnlock] = useState(false);
  const [motivoDesbloqueio, setMotivoDesbloqueio] = useState('');
  const [salvandoUnlock, setSalvandoUnlock] = useState(false);

  // Carrega permissão do usuário corrente para mostrar/esconder o botão "Desbloquear"
  const { data: permInfo } = useQuery({
    queryKey: ['perm-desbloqueio-financeiro'],
    queryFn: async () => {
      const user = await base44.auth.me().catch(() => null);
      if (!user) return { isAdmin: false, podeDesbloquear: false };
      if (user.role === 'admin') return { isAdmin: true, podeDesbloquear: true };
      const vendedores = await base44.entities.Vendedor.list();
      const funcionario = vendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
      if (!funcionario) return { isAdmin: false, podeDesbloquear: false };
      const permissoes = await base44.entities.Permissao.filter({ vendedor_id: funcionario.id });
      const perm = permissoes[0];
      return { isAdmin: false, podeDesbloquear: !!perm?.permissoes_cadastros?.desbloquear_financeiro };
    }
  });

  useEffect(() => {
    if (open && clienteId) {
      consultarBloqueio();
    }
    if (!open) {
      setData(null);
      setError(null);
      setMostrandoUnlock(false);
      setMotivoDesbloqueio('');
      setClienteAtual(null);
    }
  }, [open, clienteId]);

  const consultarBloqueio = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1) Consulta consolidada no Omie (já calcula deve_bloquear por cliente)
      const response = await base44.functions.invoke('consultarBloqueioFinanceiroOmie', { cliente_id: clienteId });
      const resultado = response.data;
      if (!resultado.sucesso) throw new Error(resultado.error || 'Falha na consulta');
      setData(resultado);

      // 2) Aplica/limpa bloqueio automaticamente no Cliente Base44 conforme resultado
      const cli = await base44.entities.Cliente.get(clienteId);
      setClienteAtual(cli);

      const motivoAtual = cli?.motivo_bloqueio || '';
      const eraBloqueadoManualmente = cli?.bloquear_faturamento && !motivoAtual.toLowerCase().startsWith('débito em aberto');

      // Não mexe em bloqueios manuais (com motivo livre cadastrado pelo usuário)
      if (eraBloqueadoManualmente) return;

      if (resultado.deve_bloquear) {
        const novoMotivo = resultado.titulos_atrasados > 0
          ? `Débito em aberto: ${resultado.titulos_atrasados} título(s) atrasado(s), total ${formatCurrency(resultado.total_debitos)}`
          : `Débito em aberto: limite de crédito ultrapassado (saldo ${formatCurrency(resultado.saldo_disponivel)})`;
        if (!cli?.bloquear_faturamento || cli?.motivo_bloqueio !== novoMotivo) {
          await base44.entities.Cliente.update(clienteId, {
            bloquear_faturamento: true,
            motivo_bloqueio: novoMotivo
          });
          setClienteAtual({ ...cli, bloquear_faturamento: true, motivo_bloqueio: novoMotivo });
        }
      } else if (cli?.bloquear_faturamento && motivoAtual.toLowerCase().startsWith('débito em aberto')) {
        // Sem pendência atual → limpa bloqueio automático antigo
        await base44.entities.Cliente.update(clienteId, {
          bloquear_faturamento: false,
          motivo_bloqueio: ''
        });
        setClienteAtual({ ...cli, bloquear_faturamento: false, motivo_bloqueio: '' });
      }
    } catch (err) {
      setError(err.message || 'Erro ao consultar débitos');
    } finally {
      setLoading(false);
    }
  };

  const desbloquearManual = async () => {
    if (!motivoDesbloqueio.trim()) {
      toast.error('Informe o motivo do desbloqueio');
      return;
    }
    setSalvandoUnlock(true);
    try {
      await base44.entities.Cliente.update(clienteId, {
        bloquear_faturamento: false,
        motivo_bloqueio: `Desbloqueio manual: ${motivoDesbloqueio.trim()}`
      });
      // Registra no log gerencial
      try {
        await base44.functions.invoke('registrarLogGerencial', {
          tipo_acao: 'liberacao',
          entidade_tipo: 'Cliente',
          entidade_id: clienteId,
          entidade_descricao: clienteNome,
          descricao: `Desbloqueou financeiramente o cliente ${clienteNome}. Motivo: ${motivoDesbloqueio.trim()}`
        });
      } catch { /* log é best-effort */ }
      toast.success('Cliente desbloqueado com sucesso');
      setClienteAtual(prev => prev ? { ...prev, bloquear_faturamento: false, motivo_bloqueio: `Desbloqueio manual: ${motivoDesbloqueio.trim()}` } : null);
      setMostrandoUnlock(false);
      setMotivoDesbloqueio('');
    } catch (err) {
      toast.error('Falha ao desbloquear: ' + (err.message || ''));
    } finally {
      setSalvandoUnlock(false);
    }
  };

  const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  };

  const podeDesbloquear = permInfo?.podeDesbloquear;
  const clienteBloqueado = clienteAtual?.bloquear_faturamento;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-amber-500" />
            Situação Financeira - {clienteNome}
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
            {/* Banner de bloqueio */}
            {clienteBloqueado && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-lg flex items-start gap-3">
                <Lock className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-red-800">Cliente BLOQUEADO para faturamento</p>
                  <p className="text-xs text-red-700 mt-0.5">{clienteAtual?.motivo_bloqueio || 'Sem motivo informado'}</p>
                </div>
                {podeDesbloquear && !mostrandoUnlock && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-green-400 text-green-700 hover:bg-green-50"
                    onClick={() => setMostrandoUnlock(true)}
                  >
                    <Unlock className="w-3.5 h-3.5 mr-1" /> Desbloquear
                  </Button>
                )}
              </div>
            )}

            {/* Caixa de motivo do desbloqueio */}
            {mostrandoUnlock && podeDesbloquear && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg space-y-2">
                <Label className="text-sm text-green-800 font-medium">Motivo do desbloqueio manual</Label>
                <Input
                  value={motivoDesbloqueio}
                  onChange={(e) => setMotivoDesbloqueio(e.target.value)}
                  placeholder="Ex: cliente quitou via PIX em 16/05, aguardando baixa Omie"
                  autoFocus
                />
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" onClick={() => { setMostrandoUnlock(false); setMotivoDesbloqueio(''); }} disabled={salvandoUnlock}>
                    Cancelar
                  </Button>
                  <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={desbloquearManual} disabled={salvandoUnlock}>
                    {salvandoUnlock ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Unlock className="w-3.5 h-3.5 mr-1" /> Confirmar desbloqueio</>}
                  </Button>
                </div>
              </div>
            )}

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

            {/* Status financeiro */}
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