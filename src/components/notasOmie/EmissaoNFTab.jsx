import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, Loader2, FileSignature, Send, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Aba "Emissão de NF-e".
 * Lista pedidos Omie em etapa 50 (Faturar) e permite gerar a NF-e — individual ou em lote.
 * Quando o cliente tem modalidade "BOLETO BANCARIO" no cadastro, o boleto é gerado
 * automaticamente após a emissão da NF.
 */
export default function EmissaoNFTab({ cargaFiltro, ativa = true }) {
  const [filtroCarga, setFiltroCarga] = useState('');
  const [busca, setBusca] = useState('');
  const [selecionados, setSelecionados] = useState(new Set());
  const [emitindo, setEmitindo] = useState(false);

  // Buscar cargas FATURADAS — pedidos só aparecem aqui se a carga já foi faturada (etapa 50 no Omie)
  const { data: cargas = [] } = useQuery({
    queryKey: ['cargasFaturadasEmissao'],
    queryFn: () => base44.entities.Carga.filter({ status_carga: 'faturada' }, '-created_date', 200),
    enabled: ativa,
    staleTime: 60000
  });

  // Map: codigo_pedido (string) → numero_carga (somente cargas faturadas)
  const cargaPorPedido = useMemo(() => {
    const map = new Map();
    cargas.forEach(c => {
      (c.pedidos_omie || []).forEach(p => {
        if (p.codigo_pedido) map.set(String(p.codigo_pedido), c.numero_carga || '');
      });
    });
    return map;
  }, [cargas]);

  // Busca pedidos em etapa 50 DIRETO do Omie e filtra apenas os que estão em cargas faturadas e ainda sem NF
  const { data: espelho = [], isLoading, refetch } = useQuery({
    queryKey: ['pedidosOmieEmissaoEtapa50', cargas.length],
    queryFn: async () => {
      if (cargas.length === 0) return [];

      const { data } = await base44.functions.invoke('buscarPedidosOmie', {
        etapa: '50',
        registros_por_pagina: 100,
        buscar_todas_paginas: true,
        max_paginas: 10,
        incluir_cancelados: false
      });
      if (!data?.sucesso) throw new Error(data?.error || 'Erro ao buscar pedidos Omie');

      // Só aceita pedidos que pertencem a uma carga FATURADA E que ainda não tenham NF emitida
      const pedidosOmie = (data.pedidos || []).filter(p => {
        const numCarga = cargaPorPedido.get(String(p.codigo_pedido));
        if (!numCarga) return false; // pedido sem carga faturada — não exibe
        // Localiza o pedido dentro da carga para checar se já tem NF
        for (const c of cargas) {
          const item = (c.pedidos_omie || []).find(x => String(x.codigo_pedido) === String(p.codigo_pedido));
          if (item && item.numero_nf) return false; // já emitiu NF
        }
        return true;
      });

      const codigos = pedidosOmie.map(p => String(p.codigo_pedido));
      const espelhoLocal = codigos.length > 0
        ? await base44.entities.PedidoLiberadoOmie.filter({ codigo_pedido: { $in: codigos } }, '-sincronizado_em', 500)
        : [];
      const mapaEspelho = new Map(espelhoLocal.map(e => [String(e.codigo_pedido), e]));

      return pedidosOmie.map(p => {
        const e = mapaEspelho.get(String(p.codigo_pedido)) || {};
        return {
          codigo_pedido: String(p.codigo_pedido),
          numero_pedido: p.numero_pedido,
          valor_total_pedido: p.valor_total_pedido || e.valor_total_pedido || 0,
          quantidade_itens: p.quantidade_itens || e.quantidade_itens || 0,
          nome_cliente: e.nome_cliente || '',
          nome_fantasia: e.nome_fantasia || '',
          cidade: e.cidade || '',
          cliente_id: e.cliente_id || ''
        };
      });
    },
    enabled: ativa && cargas.length > 0,
    staleTime: 30000
  });

  // Se veio cargaFiltro pela URL, pré-popula o filtro de carga
  useEffect(() => {
    if (cargaFiltro?.numero_carga) {
      setFiltroCarga(cargaFiltro.numero_carga);
    }
  }, [cargaFiltro]);

  const pedidosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const cargaTermo = filtroCarga.trim();
    return espelho.filter(p => {
      const numCarga = cargaPorPedido.get(String(p.codigo_pedido)) || '';
      if (cargaTermo && !String(numCarga).includes(cargaTermo)) return false;
      if (!termo) return true;
      return (
        String(p.numero_pedido || '').toLowerCase().includes(termo) ||
        String(p.nome_cliente || '').toLowerCase().includes(termo) ||
        String(p.nome_fantasia || '').toLowerCase().includes(termo) ||
        String(p.codigo_pedido || '').toLowerCase().includes(termo)
      );
    });
  }, [espelho, busca, filtroCarga, cargaPorPedido]);

  const todasMarcadas = pedidosFiltrados.length > 0 && pedidosFiltrados.every(p => selecionados.has(p.codigo_pedido));
  const algumaMarcada = selecionados.size > 0;

  const toggleTodas = () => {
    const novo = new Set(selecionados);
    if (todasMarcadas) {
      pedidosFiltrados.forEach(p => novo.delete(p.codigo_pedido));
    } else {
      pedidosFiltrados.forEach(p => novo.add(p.codigo_pedido));
    }
    setSelecionados(novo);
  };

  const toggleLinha = (codigo) => {
    const novo = new Set(selecionados);
    if (novo.has(codigo)) novo.delete(codigo); else novo.add(codigo);
    setSelecionados(novo);
  };

  const emitirSelecionados = async (codigos) => {
    if (!codigos || codigos.length === 0) {
      toast.warning('Selecione ao menos um pedido para emitir.');
      return;
    }
    setEmitindo(true);
    try {
      const { data } = await base44.functions.invoke('emitirNfsLoteOmie', {
        codigos_pedido: codigos
      });

      // Apenas mostra toast quando há resultado final (autorizada ou rejeitada).
      // Pendentes/processamento → silencioso, usuário acompanha pelo Log de Emissão.
      const autorizadas = data?.sucessos || 0;
      const rejeitadas = data?.rejeitadas || 0;

      if (autorizadas > 0) {
        toast.success(
          `${autorizadas} NF(s) autorizada(s)${data?.clientes_boleto > 0 ? ` — ${data.clientes_boleto} boleto(s) gerado(s)` : ''}. Veja o Log de Emissão.`
        );
      }
      if (rejeitadas > 0) {
        toast.error(`${rejeitadas} NF(s) rejeitada(s). Veja o motivo no Log de Emissão.`);
      }
      if (autorizadas === 0 && rejeitadas === 0) {
        // Tudo em processamento — sem popup, só uma nota discreta
        toast.message('Emissão enviada. Acompanhe o resultado no Log de Emissão.');
      }

      setSelecionados(new Set());
      // Atualiza a lista após alguns segundos (etapa pode ter mudado)
      setTimeout(() => refetch(), 5000);
    } catch (e) {
      toast.error('Erro ao emitir NFs: ' + e.message);
    }
    setEmitindo(false);
  };

  const emitirIndividual = (codigo) => emitirSelecionados([codigo]);
  const emitirLote = () => emitirSelecionados(Array.from(selecionados));

  const formatarValor = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <b>Como funciona:</b> Lista apenas pedidos vinculados a <b>cargas faturadas</b> que ainda não tiveram NF emitida.
            Pedidos de cargas em montagem ou cancelados <b>não aparecem</b>.
            Selecione um ou vários e clique em "Emitir NF-e".
            Se o cliente tiver modalidade <b>BOLETO BANCÁRIO</b> no cadastro, o boleto será gerado automaticamente após a emissão.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pedidos prontos para faturamento</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div>
              <Label>Buscar (pedido, cliente, código)</Label>
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex: 12345 ou Cliente X" />
            </div>
            <div>
              <Label>Nº Carga</Label>
              <Input value={filtroCarga} onChange={(e) => setFiltroCarga(e.target.value)} placeholder="Ex: 009" />
            </div>
            <div className="flex items-end">
              <Button onClick={() => refetch()} variant="outline" disabled={isLoading} className="w-full">
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                Atualizar lista
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-slate-600">
              {pedidosFiltrados.length} pedido(s) prontos para emissão
              {algumaMarcada && (
                <span className="ml-2 text-cyan-700 font-medium">({selecionados.size} selecionado{selecionados.size > 1 ? 's' : ''})</span>
              )}
            </div>
            <Button
              onClick={emitirLote}
              disabled={!algumaMarcada || emitindo}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {emitindo ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
              Emitir NF-e em lote ({selecionados.size})
            </Button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/80 text-slate-700">
                <tr>
                  <th className="p-2 w-10 text-center">
                    <Checkbox checked={todasMarcadas} onCheckedChange={toggleTodas} aria-label="Selecionar todos" />
                  </th>
                  <th className="p-2 text-left font-semibold">Pedido</th>
                  <th className="p-2 text-left font-semibold">Cliente</th>
                  <th className="p-2 text-left font-semibold">Cidade</th>
                  <th className="p-2 text-left font-semibold">Carga</th>
                  <th className="p-2 text-right font-semibold">Valor</th>
                  <th className="p-2 text-center font-semibold">Itens</th>
                  <th className="p-2 text-center font-semibold">Ação</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan="8" className="text-center py-12 text-slate-500">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Carregando pedidos...
                  </td></tr>
                ) : pedidosFiltrados.length === 0 ? (
                  <tr><td colSpan="8" className="text-center py-12 text-slate-500">
                    Nenhum pedido em etapa 50 encontrado
                  </td></tr>
                ) : pedidosFiltrados.map((p) => {
                  const marcado = selecionados.has(p.codigo_pedido);
                  const numCarga = cargaPorPedido.get(String(p.codigo_pedido)) || '-';
                  return (
                    <tr key={p.codigo_pedido} className={`border-t hover:bg-slate-50/50 transition-colors ${marcado ? 'bg-amber-50/40' : ''}`}>
                      <td className="p-2 text-center">
                        <Checkbox checked={marcado} onCheckedChange={() => toggleLinha(p.codigo_pedido)} />
                      </td>
                      <td className="p-2 font-medium">{p.numero_pedido}</td>
                      <td className="p-2">
                        <div>{p.nome_fantasia || p.nome_cliente}</div>
                        {p.nome_fantasia && p.nome_cliente && (
                          <div className="text-xs text-slate-500">{p.nome_cliente}</div>
                        )}
                      </td>
                      <td className="p-2">{p.cidade || '-'}</td>
                      <td className="p-2">
                        {numCarga !== '-' ? <Badge variant="outline">{numCarga}</Badge> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="p-2 text-right">{formatarValor(p.valor_total_pedido)}</td>
                      <td className="p-2 text-center">{p.quantidade_itens || 0}</td>
                      <td className="p-2 text-center">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => emitirIndividual(p.codigo_pedido)}
                          disabled={emitindo}
                        >
                          <FileSignature className="w-4 h-4 mr-1" /> Emitir
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}