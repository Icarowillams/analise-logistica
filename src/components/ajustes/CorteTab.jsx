import React, { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Scissors, Package } from 'lucide-react';
import { toast } from 'sonner';
import SeletorCargaBusca from './SeletorCargaBusca';

/**
 * Corte por Carga + Produto.
 * Fluxo:
 * 1) Usuário seleciona a CARGA em que vai cortar.
 * 2) Seleciona o PRODUTO (apenas produtos existentes nos pedidos da carga).
 * 3) Lista os PEDIDOS da carga que contêm esse produto, com:
 *    - quantidade pedida
 *    - campo "Quantidade Separada" (quanto vai ficar no pedido — o restante é cortado)
 * 4) Ao confirmar, dispara cortarPedidoOmie para cada pedido selecionado.
 *    O backend já cuida de alterar o pedido no Omie e registrar LogCorte.
 */
export default function CorteTab() {
  const [cargaId, setCargaId] = useState('');
  const [produtoCod, setProdutoCod] = useState('');
  const [selecao, setSelecao] = useState({}); // { pedidoKey: { selecionado, qtde_separada, motivo } }
  const [motivoGeral, setMotivoGeral] = useState('');
  const [salvando, setSalvando] = useState(false);

  // REGRA: só permite ajuste em cargas onde TODOS os pedidos ainda estão em etapa Omie 10/20/50.
  // Cargas com pedidos já faturados (etapa 60) ou cargas finalizadas/canceladas/em_rota/entregue NÃO aparecem.
  // Status_carga aceitos: montagem, fechada, conferindo, pronta — mas só se pedidos_omie todos estão em 10/20/50.
  const { data: cargas = [], isLoading: loadingCargas } = useQuery({
    queryKey: ['cargas-corte'],
    queryFn: async () => {
      const todas = await base44.entities.Carga.filter(
        { status_carga: { $in: ['montagem', 'fechada', 'conferindo', 'pronta'] } },
        '-data_carga',
        200
      );
      // Filtra: só cargas onde pedidos_omie estão TODOS em 10/20/50 (ou carga sem pedidos_omie/só internos)
      return todas.filter(c => {
        const pedidos = c.pedidos_omie || [];
        if (pedidos.length === 0) return true; // só internos/trocas — pode cortar
        return pedidos.every(p => ['10', '20', '50'].includes(String(p.etapa || '').trim()));
      });
    }
  });

  const cargaSelecionada = useMemo(
    () => cargas.find(c => c.id === cargaId),
    [cargas, cargaId]
  );

  // Lista plana de pedidos da carga (apenas omie/internos — trocas não fazem corte)
  const pedidosCarga = useMemo(() => {
    if (!cargaSelecionada) return [];
    const omie = (cargaSelecionada.pedidos_omie || []).map(p => ({ ...p, _origem: 'omie' }));
    const internos = (cargaSelecionada.pedidos_internos || []).map(p => ({ ...p, _origem: 'interno' }));
    return [...omie, ...internos];
  }, [cargaSelecionada]);

  // Mapa de produtos disponíveis nessa carga (codigo -> descricao)
  const produtosCarga = useMemo(() => {
    const m = new Map();
    pedidosCarga.forEach(ped => {
      (ped.produtos || []).forEach(pr => {
        const cod = String(pr.codigo_produto || pr.codigo_produto_integracao || '').trim();
        if (!cod) return;
        if (!m.has(cod)) m.set(cod, pr.descricao || cod);
      });
    });
    return Array.from(m.entries()).map(([codigo, descricao]) => ({ codigo, descricao }));
  }, [pedidosCarga]);

  // Pedidos da carga que contêm o produto escolhido
  const pedidosComProduto = useMemo(() => {
    if (!produtoCod) return [];
    return pedidosCarga
      .map(ped => {
        const item = (ped.produtos || []).find(pr => {
          const cod = String(pr.codigo_produto || pr.codigo_produto_integracao || '').trim();
          return cod === produtoCod;
        });
        if (!item) return null;
        return { ped, item };
      })
      .filter(Boolean);
  }, [pedidosCarga, produtoCod]);

  // Reseta seleção sempre que muda carga/produto
  useEffect(() => { setSelecao({}); }, [cargaId, produtoCod]);

  const totalPedido = pedidosComProduto.length;
  const totalQtdOriginal = pedidosComProduto.reduce((s, x) => s + Number(x.item.quantidade || 0), 0);
  const totalQtdSeparada = pedidosComProduto.reduce((s, x) => {
    const key = x.ped._origem === 'omie' ? x.ped.codigo_pedido : x.ped.pedido_id;
    const sel = selecao[key];
    const qSep = sel?.selecionado ? Number(sel.qtde_separada ?? x.item.quantidade) : Number(x.item.quantidade);
    return s + (isNaN(qSep) ? 0 : qSep);
  }, 0);
  const totalCortado = totalQtdOriginal - totalQtdSeparada;

  const atualizarSel = (key, patch) => {
    setSelecao(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const aplicarCorte = async () => {
    const aplicar = pedidosComProduto
      .map(x => {
        const key = x.ped._origem === 'omie' ? x.ped.codigo_pedido : x.ped.pedido_id;
        const sel = selecao[key];
        if (!sel?.selecionado) return null;
        const qOrig = Number(x.item.quantidade || 0);
        const qSep = Number(sel.qtde_separada ?? qOrig);
        if (isNaN(qSep) || qSep < 0) return null;
        if (qSep >= qOrig) return null; // nada a cortar
        return { ...x, qOrig, qSep, motivo: sel.motivo || '' };
      })
      .filter(Boolean);

    if (aplicar.length === 0) {
      toast.warning('Selecione ao menos um pedido com quantidade separada menor que a quantidade do pedido.');
      return;
    }

    setSalvando(true);
    let ok = 0; let fail = 0;
    for (const it of aplicar) {
      try {
        const payload = it.ped._origem === 'omie'
          ? {
              codigo_pedido: it.ped.codigo_pedido,
              cortes: [{ codigo_produto: produtoCod, nova_quantidade: it.qSep, motivo: it.motivo || motivoGeral }],
              motivo_geral: motivoGeral
            }
          : {
              pedido_id_interno: it.ped.pedido_id,
              cortes: [{ codigo_produto: produtoCod, nova_quantidade: it.qSep, motivo: it.motivo || motivoGeral }],
              motivo_geral: motivoGeral
            };
        const { data } = await base44.functions.invoke('cortarPedidoOmie', payload);
        if (data?.sucesso) ok++; else { fail++; toast.error(`Pedido ${it.ped.numero_pedido}: ${data?.error || 'erro'}`); }
      } catch (e) {
        fail++;
        toast.error(`Pedido ${it.ped.numero_pedido}: ${e.message}`);
      }
    }
    setSalvando(false);
    if (ok > 0) toast.success(`${ok} pedido(s) cortado(s) no Omie.`);
    setSelecao({});
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Scissors className="w-5 h-5 text-amber-500" />
            Corte por Carga e Produto
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SeletorCargaBusca
              cargas={cargas}
              cargaSelecionadaId={cargaId}
              onChange={(c) => setCargaId(c?.id || '')}
              label="Carga (em Montagem)"
              placeholder={loadingCargas ? 'Carregando cargas...' : 'Digite nº carga, motorista, rota ou pedido...'}
            />
            <div>
              <Label className="flex items-center gap-1.5"><Package className="w-4 h-4" /> Produto</Label>
              <Select value={produtoCod} onValueChange={setProdutoCod} disabled={!cargaSelecionada}>
                <SelectTrigger>
                  <SelectValue placeholder={cargaSelecionada ? 'Selecione o produto' : 'Selecione a carga primeiro'} />
                </SelectTrigger>
                <SelectContent>
                  {produtosCarga.map(p => (
                    <SelectItem key={p.codigo} value={p.codigo}>
                      {p.codigo} — {p.descricao}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {cargaSelecionada && produtoCod && (
            <>
              <div className="rounded-lg border bg-slate-50 px-3 py-2 text-xs text-slate-600 flex flex-wrap gap-x-6 gap-y-1">
                <span>Pedidos com o produto: <b>{totalPedido}</b></span>
                <span>Qtd original total: <b>{totalQtdOriginal}</b></span>
                <span>Qtd separada total: <b className="text-emerald-700">{totalQtdSeparada}</b></span>
                <span>Qtd cortada: <b className="text-red-600">{totalCortado}</b></span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="p-2 w-10"></th>
                      <th className="p-2 text-left">Pedido</th>
                      <th className="p-2 text-left">Cliente</th>
                      <th className="p-2 text-left">Tipo</th>
                      <th className="p-2 text-right w-24">Qtd pedida</th>
                      <th className="p-2 text-right w-32">Qtd Separada</th>
                      <th className="p-2 text-right w-24">Qtd Cortada</th>
                      <th className="p-2 text-left">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidosComProduto.length === 0 ? (
                      <tr><td colSpan="8" className="p-6 text-center text-slate-400">Nenhum pedido na carga contém esse produto.</td></tr>
                    ) : pedidosComProduto.map(({ ped, item }) => {
                      const key = ped._origem === 'omie' ? ped.codigo_pedido : ped.pedido_id;
                      const sel = selecao[key] || {};
                      const qOrig = Number(item.quantidade || 0);
                      const qSep = sel.selecionado ? Number(sel.qtde_separada ?? qOrig) : qOrig;
                      const qCort = qOrig - (isNaN(qSep) ? 0 : qSep);
                      return (
                        <tr key={key} className="border-t">
                          <td className="p-2">
                            <Checkbox
                              checked={!!sel.selecionado}
                              onCheckedChange={(v) => atualizarSel(key, { selecionado: !!v, qtde_separada: sel.qtde_separada ?? qOrig })}
                            />
                          </td>
                          <td className="p-2">{ped.numero_pedido || '-'} {ped._origem === 'interno' && <span className="text-amber-600 text-xs">(D1)</span>}</td>
                          <td className="p-2">{ped.nome_fantasia || ped.nome_cliente || '-'}</td>
                          <td className="p-2 uppercase text-xs text-slate-600">{ped.tipo_nota || ped.modelo_nota || '-'}</td>
                          <td className="p-2 text-right">{qOrig}</td>
                          <td className="p-2">
                            <Input
                              type="number"
                              min="0"
                              max={qOrig}
                              disabled={!sel.selecionado}
                              value={sel.qtde_separada ?? qOrig}
                              onChange={(e) => atualizarSel(key, { qtde_separada: e.target.value })}
                              className="h-8 text-right"
                            />
                          </td>
                          <td className={`p-2 text-right font-medium ${qCort > 0 ? 'text-red-600' : 'text-slate-400'}`}>{qCort}</td>
                          <td className="p-2">
                            <Input
                              disabled={!sel.selecionado}
                              value={sel.motivo || ''}
                              onChange={(e) => atualizarSel(key, { motivo: e.target.value })}
                              placeholder="Motivo específico"
                              className="h-8"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Textarea
                placeholder="Motivo geral do corte (aplicado a todos os pedidos sem motivo específico)"
                value={motivoGeral}
                onChange={(e) => setMotivoGeral(e.target.value)}
              />

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => { setSelecao({}); setMotivoGeral(''); }}>Limpar</Button>
                <Button onClick={aplicarCorte} disabled={salvando}>
                  {salvando && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  <Scissors className="w-4 h-4 mr-2" />
                  Aplicar Corte
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}