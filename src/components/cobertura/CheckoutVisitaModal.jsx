import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2, LogOut, Package } from 'lucide-react';
import { toast } from 'sonner';
import { capturarPosicao, distanciaMetros } from '@/lib/coberturaUtils';

// Modal de check-out de visita: registra a coleta de estoque (leitura para venda /
// reposição para promotor) e encerra a visita capturando GPS/hora de saída.
export default function CheckoutVisitaModal({ visita, open, onClose, onDone }) {
  const tipoRegistro = visita?.finalidade_visita === 'reposicao' ? 'reposicao' : 'leitura_estoque';
  const [itens, setItens] = useState([]); // { item_id, item_codigo, item_nome, quantidade, unidade }
  const [busca, setBusca] = useState('');
  const [obs, setObs] = useState('');
  const [salvando, setSalvando] = useState(false);

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos-checkout'],
    queryFn: () => base44.entities.Produto.list('', 5000),
    enabled: open,
    staleTime: 10 * 60 * 1000,
  });

  useEffect(() => {
    if (open) { setItens([]); setBusca(''); setObs(''); }
  }, [open, visita?.id]);

  const sugestoes = useMemo(() => {
    const s = busca.trim().toLowerCase();
    if (!s) return [];
    return produtos
      .filter((p) => (p.descricao || p.nome || '').toLowerCase().includes(s) || (p.codigo || '').toLowerCase().includes(s))
      .slice(0, 8);
  }, [busca, produtos]);

  const addItem = (p) => {
    if (itens.some((i) => i.item_id === p.id)) { setBusca(''); return; }
    setItens((prev) => [...prev, {
      item_id: p.id,
      item_codigo: p.codigo || '',
      item_nome: p.descricao || p.nome || '',
      quantidade: 0,
      unidade: p.unidade || 'un',
    }]);
    setBusca('');
  };

  const setQtd = (id, q) => setItens((prev) => prev.map((i) => (i.item_id === id ? { ...i, quantidade: Number(q) || 0 } : i)));
  const removeItem = (id) => setItens((prev) => prev.filter((i) => i.item_id !== id));

  const finalizar = async () => {
    setSalvando(true);
    try {
      const pos = await capturarPosicao();
      const cli = visita.cliente_id ? (await base44.entities.Cliente.filter({ id: visita.cliente_id }, '', 1))[0] : null;
      const dist = cli?.latitude ? distanciaMetros(pos.latitude, pos.longitude, cli.latitude, cli.longitude) : null;

      const inicio = visita.hora_checkin ? new Date(visita.hora_checkin) : null;
      const fim = new Date();
      const duracao = inicio ? Math.max(0, Math.round((fim - inicio) / 60000)) : null;

      if (itens.length) {
        await base44.entities.EstoqueVisitaItem.bulkCreate(itens.map((i) => ({
          visita_id: visita.id,
          cliente_id: visita.cliente_id,
          cliente_nome: visita.cliente_nome,
          item_id: i.item_id,
          item_codigo: i.item_codigo,
          item_nome: i.item_nome,
          tipo_registro: tipoRegistro,
          quantidade: i.quantidade,
          unidade: i.unidade,
          usuario_id: visita.vendedor_id,
          usuario_nome: visita.vendedor_nome,
          criado_em: fim.toISOString(),
        })));
      }

      await base44.entities.Visita.update(visita.id, {
        hora_checkout: fim.toISOString(),
        latitude_checkout: pos.latitude,
        longitude_checkout: pos.longitude,
        duracao_minutos: duracao,
        checkout_pendente: false,
        status: 'concluida',
        observacoes: obs || visita.observacoes,
      });

      toast.success(`Check-out feito${dist != null ? ` (${dist}m)` : ''}${duracao != null ? ` · ${duracao} min` : ''}`);
      onDone?.();
      onClose();
    } catch (e) {
      toast.error('Não foi possível concluir o check-out: ' + (e?.message || ''));
    } finally {
      setSalvando(false);
    }
  };

  if (!visita) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-cyan-600" />
            {tipoRegistro === 'reposicao' ? 'Reposição & Check-out' : 'Estoque & Check-out'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-slate-600">
            {visita.cliente_nome} · <Badge variant="outline">{tipoRegistro === 'reposicao' ? 'Reposição' : 'Leitura de estoque'}</Badge>
          </div>

          <div className="relative">
            <Input
              placeholder="Buscar produto por código ou nome..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            {sugestoes.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-56 overflow-y-auto">
                {sugestoes.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => addItem(p)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-cyan-50 flex items-center gap-2"
                  >
                    <Plus className="w-3 h-3 text-cyan-600" />
                    <span className="truncate">{p.codigo ? `${p.codigo} - ` : ''}{p.descricao || p.nome}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {itens.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-6 border border-dashed rounded-lg">
              Adicione os itens conferidos {tipoRegistro === 'reposicao' ? '(colocados na gôndola)' : '(estoque no cliente)'}.
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {itens.map((i) => (
                <div key={i.item_id} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{i.item_codigo ? `${i.item_codigo} - ` : ''}{i.item_nome}</div>
                  </div>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={i.quantidade}
                    onChange={(e) => setQtd(i.item_id, e.target.value)}
                    className="w-24 text-right"
                  />
                  <span className="text-xs text-slate-400 w-8">{i.unidade}</span>
                  <Button variant="ghost" size="icon" onClick={() => removeItem(i.item_id)} className="text-red-500 h-8 w-8">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <Textarea placeholder="Observações da visita (opcional)" value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
            <Button onClick={finalizar} disabled={salvando} className="gap-2">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
              Concluir check-out
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}