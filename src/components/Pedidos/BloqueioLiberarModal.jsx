import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, Lock, Unlock, DollarSign } from 'lucide-react';
import { toast } from 'sonner';

/**
 * P1 (16/05) — Modal de bloqueio financeiro disparado AO LIBERAR pedido.
 *
 * Comportamento:
 * - Consulta consolidada no Omie e exibe títulos em aberto/atrasados.
 * - Quando há pendência, o pedido NÃO segue por padrão.
 * - Usuários com permissão `desbloquear_financeiro` podem marcar títulos a "ignorar"
 *   nesta liberação E informar um motivo → registra LogGerencial e chama onConfirmar()
 *   para o fluxo prosseguir.
 * - O cliente PERMANECE bloqueado no cadastro — o desbloqueio é apenas para esta liberação.
 *
 * Props:
 *   open, onOpenChange
 *   clienteId, clienteNome
 *   pedidoDescricao  → ex: "Pedido 00012D - Cliente X" para log
 *   onConfirmar(titulosIgnoradosArr, motivo)  → callback quando usuário libera mesmo assim
 *   onCancelar() → callback quando usuário desiste
 */
export default function BloqueioLiberarModal({
  open,
  onOpenChange,
  clienteId,
  clienteNome,
  pedidoDescricao,
  onConfirmar,
  onCancelar
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [titulosMarcados, setTitulosMarcados] = useState(new Set());
  const [motivo, setMotivo] = useState('');
  const [confirmando, setConfirmando] = useState(false);

  // Permissão de desbloqueio (mesma do modal de Débitos)
  const { data: permInfo } = useQuery({
    queryKey: ['perm-desbloqueio-financeiro-liberar'],
    queryFn: async () => {
      const user = await base44.auth.me().catch(() => null);
      if (!user) return { isAdmin: false, podeDesbloquear: false, user: null };
      if (user.role === 'admin') return { isAdmin: true, podeDesbloquear: true, user };
      const vendedores = await base44.entities.Vendedor.list();
      const funcionario = vendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
      if (!funcionario) return { isAdmin: false, podeDesbloquear: false, user };
      const permissoes = await base44.entities.Permissao.filter({ vendedor_id: funcionario.id });
      const perm = permissoes[0];
      return { isAdmin: false, podeDesbloquear: !!perm?.permissoes_cadastros?.desbloquear_financeiro, user };
    },
    enabled: open
  });

  useEffect(() => {
    if (open && clienteId) {
      consultar();
    }
    if (!open) {
      setData(null);
      setError(null);
      setTitulosMarcados(new Set());
      setMotivo('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clienteId]);

  const consultar = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await base44.functions.invoke('consultarBloqueioFinanceiroOmie', { cliente_id: clienteId });
      const resultado = response.data;
      if (!resultado.sucesso) throw new Error(resultado.error || 'Falha na consulta');
      setData(resultado);

      // Aplica bloqueio no Cliente caso o Omie indique pendência
      if (resultado.deve_bloquear) {
        const cli = await base44.entities.Cliente.get(clienteId);
        const motivoAtual = cli?.motivo_bloqueio || '';
        const eraBloqueadoManualmente = cli?.bloquear_faturamento && !motivoAtual.toLowerCase().startsWith('débito em aberto');
        if (!eraBloqueadoManualmente) {
          const novoMotivo = resultado.titulos_atrasados > 0
            ? `Débito em aberto: ${resultado.titulos_atrasados} título(s) atrasado(s)`
            : `Débito em aberto: limite de crédito ultrapassado`;
          if (!cli?.bloquear_faturamento || cli?.motivo_bloqueio !== novoMotivo) {
            await base44.entities.Cliente.update(clienteId, {
              bloquear_faturamento: true,
              motivo_bloqueio: novoMotivo
            });
          }
        }
      }
    } catch (err) {
      setError(err.message || 'Erro ao consultar débitos');
    } finally {
      setLoading(false);
    }
  };

  const toggleTitulo = (idx) => {
    const novo = new Set(titulosMarcados);
    if (novo.has(idx)) novo.delete(idx); else novo.add(idx);
    setTitulosMarcados(novo);
  };

  const toggleTodos = () => {
    if (titulosMarcados.size === (data?.titulos?.length || 0)) {
      setTitulosMarcados(new Set());
    } else {
      setTitulosMarcados(new Set((data?.titulos || []).map((_, i) => i)));
    }
  };

  const confirmarLiberacao = async () => {
    if (!motivo.trim()) {
      toast.error('Informe o motivo da liberação');
      return;
    }
    if (titulosMarcados.size === 0) {
      toast.error('Selecione ao menos um título para ignorar nesta liberação');
      return;
    }
    setConfirmando(true);
    try {
      const titulosIgnorados = Array.from(titulosMarcados).map(i => data.titulos[i]);
      const totalIgnorado = titulosIgnorados.reduce((s, t) => s + (Number(t.valor) || 0), 0);

      // Registra log gerencial
      try {
        await base44.functions.invoke('registrarLogGerencial', {
          tipo_acao: 'liberacao',
          entidade_tipo: 'Pedido',
          entidade_descricao: pedidoDescricao || `Liberação ${clienteNome}`,
          descricao: `Liberou pedido com ${titulosIgnorados.length} título(s) em aberto ignorado(s), total R$ ${totalIgnorado.toFixed(2)}. Cliente: ${clienteNome}. Motivo: ${motivo.trim()}`,
          observacao: titulosIgnorados.map(t => `Título ${t.numero || t.documento_fiscal} venc.${t.vencimento} R$ ${Number(t.valor || 0).toFixed(2)}`).join(' | ')
        });
      } catch { /* best effort */ }

      onConfirmar?.(titulosIgnorados, motivo.trim());
    } finally {
      setConfirmando(false);
    }
  };

  const formatCurrency = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

  const podeDesbloquear = permInfo?.podeDesbloquear;
  const temPendencia = data?.deve_bloquear;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancelar?.(); onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-amber-500" />
            Verificação financeira — {clienteNome}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
            <span className="ml-2 text-sm text-slate-500">Consultando Omie...</span>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {data && !loading && !temPendencia && (
          <div className="p-6 bg-green-50 border border-green-200 rounded-lg text-center">
            <p className="text-sm text-green-700 font-medium">Cliente sem pendências financeiras — liberação pode prosseguir.</p>
          </div>
        )}

        {data && !loading && temPendencia && (
          <div className="space-y-4">
            <div className="p-3 bg-red-50 border border-red-300 rounded-lg flex items-start gap-3">
              <Lock className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800">
                  Cliente BLOQUEADO — {data.titulos_atrasados} título(s) atrasado(s), total {formatCurrency(data.total_debitos)}
                </p>
                <p className="text-xs text-red-700 mt-0.5">
                  Para prosseguir com a liberação, selecione os títulos a ignorar e informe o motivo.
                  O cliente continuará bloqueado para futuras liberações.
                </p>
              </div>
            </div>

            {!podeDesbloquear ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <AlertTriangle className="w-4 h-4 inline mr-1" />
                Você não tem permissão para liberar pedidos de clientes bloqueados. Solicite a um administrador.
              </div>
            ) : (
              <>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-700">
                      <tr>
                        <th className="p-2 w-10 text-center">
                          <Checkbox
                            checked={titulosMarcados.size === (data.titulos?.length || 0) && data.titulos?.length > 0}
                            onCheckedChange={toggleTodos}
                          />
                        </th>
                        <th className="p-2 text-left font-medium">Nº Título</th>
                        <th className="p-2 text-left font-medium">Parcela</th>
                        <th className="p-2 text-left font-medium">Vencimento</th>
                        <th className="p-2 text-right font-medium">Valor</th>
                        <th className="p-2 text-center font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.titulos || []).map((t, idx) => (
                        <tr key={idx} className={`border-t ${titulosMarcados.has(idx) ? 'bg-amber-50' : ''}`}>
                          <td className="p-2 text-center">
                            <Checkbox checked={titulosMarcados.has(idx)} onCheckedChange={() => toggleTitulo(idx)} />
                          </td>
                          <td className="p-2 font-medium">{t.numero || t.documento_fiscal || '-'}</td>
                          <td className="p-2">{t.parcela || '-'}</td>
                          <td className="p-2">{t.vencimento || '-'}</td>
                          <td className="p-2 text-right font-medium">{formatCurrency(t.valor)}</td>
                          <td className="p-2 text-center">
                            {t.status === 'ATRASADO' ? (
                              <Badge className="bg-red-500 text-xs">Atrasado</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">{t.status}</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Motivo da liberação <span className="text-red-500">*</span></Label>
                  <Input
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ex: cliente pagou via PIX, aguardando baixa no Omie"
                  />
                  <p className="text-xs text-slate-500">
                    {titulosMarcados.size} título(s) selecionado(s) — total ignorado:{' '}
                    <b>{formatCurrency(Array.from(titulosMarcados).reduce((s, i) => s + Number(data.titulos[i]?.valor || 0), 0))}</b>
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => { onCancelar?.(); onOpenChange(false); }}>
            Cancelar
          </Button>
          {data && !temPendencia && (
            <Button className="bg-green-600 hover:bg-green-700" onClick={() => { onConfirmar?.([], ''); onOpenChange(false); }}>
              Prosseguir com liberação
            </Button>
          )}
          {data && temPendencia && podeDesbloquear && (
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              onClick={confirmarLiberacao}
              disabled={confirmando || titulosMarcados.size === 0 || !motivo.trim()}
            >
              {confirmando ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Unlock className="w-4 h-4 mr-1" />}
              Liberar ignorando títulos selecionados
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}