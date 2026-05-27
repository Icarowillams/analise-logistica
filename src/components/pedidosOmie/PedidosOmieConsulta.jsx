import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ArrowLeftRight, Eye, Search, ShoppingCart, RefreshCw, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import DuplicarPedidosButton from './DuplicarPedidosButton';

// Mapa etapa Omie -> label/cor
const etapaInfo = {
  '10': { label: 'Pedido', color: 'bg-slate-100 text-slate-700' },
  '20': { label: 'Liberado', color: 'bg-blue-100 text-blue-800' },
  '50': { label: 'A Faturar', color: 'bg-amber-100 text-amber-800' },
  '60': { label: 'Faturado', color: 'bg-purple-100 text-purple-800' },
  'cancelado': { label: 'Cancelado', color: 'bg-red-100 text-red-800' },
};

const formatarData = (data) => {
  if (!data) return '-';
  // Omie costuma vir "dd/mm/yyyy"
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(data))) return data;
  try { return new Date(`${data}T12:00:00`).toLocaleDateString('pt-BR'); } catch { return data; }
};
const formatarMoeda = (valor) => (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function PedidosOmieConsulta() {
  const [busca, setBusca] = useState('');
  const [etapaFiltro, setEtapaFiltro] = useState('todos');
  const [statusFiltro, setStatusFiltro] = useState('ativos');
  const [detalhe, setDetalhe] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [selecionados, setSelecionados] = useState(new Set());
  const queryClient = useQueryClient();

  const toggleSelecionado = (codigoPedido) => {
    setSelecionados(prev => {
      const nova = new Set(prev);
      if (nova.has(codigoPedido)) nova.delete(codigoPedido);
      else nova.add(codigoPedido);
      return nova;
    });
  };
  const limparSelecao = () => setSelecionados(new Set());

  // Espelho local — alimentado por webhook + bootstrap. Sem chamadas Omie a cada render.
  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ['pedidos-liberados-omie-consulta'],
    queryFn: () => base44.entities.PedidoLiberadoOmie.list('-sincronizado_em', 5000),
    refetchOnWindowFocus: false,
  });

  const sincronizarAgora = async () => {
    setSincronizando(true);
    try {
      const { data } = await base44.functions.invoke('sincronizarLiberadosOmieRapido', {});
      if (data?.error) toast.error(data.error);
      else toast.success(`Sincronizado: ${data?.total ?? 0} pedido(s) atualizados.`);
      await queryClient.invalidateQueries({ queryKey: ['pedidos-liberados-omie-consulta'] });
    } catch (e) {
      toast.error(e.message);
    }
    setSincronizando(false);
  };

  const enriquecidos = useMemo(() => {
    return pedidos.map((p) => {
      const etapaKey = p.etapa || '';
      const info = etapaInfo[etapaKey] || { label: etapaKey || '-', color: 'bg-slate-100 text-slate-700' };
      return {
        ...p,
        numero: p.numero_pedido || p.codigo_pedido,
        data: p.data_previsao || p.data_faturamento || p.sincronizado_em,
        valor_total: p.valor_total_pedido || 0,
        cliente_label: p.nome_fantasia || p.nome_cliente || p.cnpj_cpf_cliente || '-',
        vendedor: p.vendedor_nome || '-',
        info_etapa: info,
        is_cancelado: etapaKey === 'cancelado' || (p.status_real || '') === 'cancelada',
      };
    });
  }, [pedidos]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return enriquecidos.filter((p) => {
      if (etapaFiltro !== 'todos' && String(p.etapa) !== etapaFiltro) return false;
      if (statusFiltro === 'ativos' && p.is_cancelado) return false;
      if (statusFiltro === 'cancelados' && !p.is_cancelado) return false;
      if (!termo) return true;
      return [p.numero, p.cliente_label, p.nome_cliente, p.vendedor, p.numero_nf, p.cidade, p.cnpj_cpf_cliente]
        .some((v) => String(v || '').toLowerCase().includes(termo));
    });
  }, [enriquecidos, busca, etapaFiltro, statusFiltro]);

  const contagem = useMemo(() => ({
    total: enriquecidos.length,
    etapa10: enriquecidos.filter(p => p.etapa === '10').length,
    etapa20: enriquecidos.filter(p => p.etapa === '20').length,
    etapa50: enriquecidos.filter(p => p.etapa === '50').length,
    etapa60: enriquecidos.filter(p => p.etapa === '60').length,
  }), [enriquecidos]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-xs text-slate-500">Total</p><p className="text-2xl font-bold">{contagem.total}</p></CardContent></Card>
        <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-xs text-slate-500">Pedido (10)</p><p className="text-2xl font-bold text-slate-700">{contagem.etapa10}</p></CardContent></Card>
        <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-xs text-slate-500">Liberado (20)</p><p className="text-2xl font-bold text-blue-700">{contagem.etapa20}</p></CardContent></Card>
        <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-xs text-slate-500">A Faturar (50)</p><p className="text-2xl font-bold text-amber-700">{contagem.etapa50}</p></CardContent></Card>
        <Card className="border-0 shadow-sm"><CardContent className="p-4"><p className="text-xs text-slate-500">Faturado (60)</p><p className="text-2xl font-bold text-purple-700">{contagem.etapa60}</p></CardContent></Card>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por pedido, cliente, vendedor, NF, CNPJ..." className="pl-8" />
        </div>
        <Select value={etapaFiltro} onValueChange={setEtapaFiltro}>
          <SelectTrigger className="sm:w-44"><SelectValue placeholder="Etapa" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as etapas</SelectItem>
            <SelectItem value="10">10 — Pedido</SelectItem>
            <SelectItem value="20">20 — Liberado</SelectItem>
            <SelectItem value="50">50 — A Faturar</SelectItem>
            <SelectItem value="60">60 — Faturado</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFiltro} onValueChange={setStatusFiltro}>
          <SelectTrigger className="sm:w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ativos">Ativos</SelectItem>
            <SelectItem value="cancelados">Cancelados</SelectItem>
            <SelectItem value="todos">Todos</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={sincronizarAgora} disabled={sincronizando}>
          {sincronizando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Sincronizar Omie
        </Button>
      </div>

      {/* Barra de seleção e ações em lote */}
      {filtrados.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={filtrados.length > 0 && filtrados.every(p => selecionados.has(p.codigo_pedido))}
              onCheckedChange={(checked) => {
                if (checked) setSelecionados(new Set(filtrados.map(p => p.codigo_pedido)));
                else limparSelecao();
              }}
            />
            <span className="text-sm text-slate-700">
              {selecionados.size > 0 ? `${selecionados.size} selecionado(s)` : 'Selecionar todos visíveis'}
            </span>
          </div>
          {selecionados.size > 0 && (
            <>
              <Button variant="ghost" size="sm" onClick={limparSelecao} className="h-7 text-xs">Limpar seleção</Button>
              <div className="ml-auto">
                <DuplicarPedidosButton
                  pedidosSelecionados={enriquecidos.filter(p => selecionados.has(p.codigo_pedido))}
                  onSucesso={async () => {
                    limparSelecao();
                    // Aguarda o webhook/sincronização e dá refresh
                    await new Promise(r => setTimeout(r, 1500));
                    await queryClient.invalidateQueries({ queryKey: ['pedidos-liberados-omie-consulta'] });
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-center py-10 text-slate-500">Carregando pedidos...</p>
      ) : filtrados.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-slate-500 space-y-3">
            <p>Nenhum pedido encontrado.</p>
            {enriquecidos.length === 0 && (
              <p className="text-xs">O espelho local está vazio — clique em <b>Sincronizar Omie</b> para popular pela primeira vez.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtrados.map((pedido) => {
            const Icone = ShoppingCart;
            return (
              <Card key={pedido.id || pedido.codigo_pedido} className={`border-0 shadow-sm hover:shadow-md transition-shadow ${selecionados.has(pedido.codigo_pedido) ? 'ring-2 ring-amber-400' : ''}`}>
                <CardContent className="p-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Checkbox
                        checked={selecionados.has(pedido.codigo_pedido)}
                        onCheckedChange={() => toggleSelecionado(pedido.codigo_pedido)}
                        disabled={pedido.is_cancelado}
                      />
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-amber-50">
                        <Icone className="w-5 h-5 text-amber-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-800 truncate">
                          {pedido.numero || '-'}
                          {pedido.numero_nf && <span className="font-normal text-slate-500"> · NF {pedido.numero_nf}</span>}
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {pedido.cliente_label} · {pedido.vendedor}
                        </div>
                        <div className="text-xs text-slate-400">
                          {formatarData(pedido.data)}
                          {pedido.cidade && ` · ${pedido.cidade}`}
                          {pedido.rota_nome && ` · ${pedido.rota_nome}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      <span className="text-sm font-semibold text-slate-700">{formatarMoeda(pedido.valor_total)}</span>
                      <Badge className={pedido.info_etapa.color}>{pedido.info_etapa.label}</Badge>
                      {pedido.is_cancelado && <Badge className="bg-red-100 text-red-800">Cancelado</Badge>}
                      <Button variant="outline" size="sm" className="h-8" onClick={() => setDetalhe(pedido)}>
                        <Eye className="w-4 h-4 mr-1" />Ver
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!detalhe} onOpenChange={() => setDetalhe(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Pedido {detalhe?.numero}</DialogTitle></DialogHeader>
          {detalhe && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><span className="text-slate-500">Cliente:</span> <b>{detalhe.nome_cliente || '-'}</b></div>
                <div><span className="text-slate-500">Fantasia:</span> <b>{detalhe.nome_fantasia || '-'}</b></div>
                <div><span className="text-slate-500">CNPJ/CPF:</span> <b>{detalhe.cnpj_cpf_cliente || '-'}</b></div>
                <div><span className="text-slate-500">Cidade:</span> <b>{detalhe.cidade || '-'}</b></div>
                <div><span className="text-slate-500">Vendedor:</span> <b>{detalhe.vendedor}</b></div>
                <div><span className="text-slate-500">Etapa:</span> <Badge className={detalhe.info_etapa.color}>{detalhe.info_etapa.label}</Badge></div>
                <div><span className="text-slate-500">Data:</span> <b>{formatarData(detalhe.data)}</b></div>
                <div><span className="text-slate-500">Valor:</span> <b>{formatarMoeda(detalhe.valor_total)}</b></div>
                {detalhe.numero_nf && <div><span className="text-slate-500">NF:</span> <b>{detalhe.numero_nf}</b></div>}
                {detalhe.rota_nome && <div><span className="text-slate-500">Rota:</span> <b>{detalhe.rota_nome}</b></div>}
              </div>
              {(detalhe.produtos || []).length > 0 && (
                <div>
                  <p className="font-semibold text-slate-700 mb-2">Itens ({detalhe.produtos.length})</p>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {detalhe.produtos.map((item, i) => (
                      <div key={i} className="flex justify-between gap-3 p-2 bg-slate-50 rounded text-xs">
                        <span className="flex-1 truncate">{item.descricao}</span>
                        <span className="text-slate-500 whitespace-nowrap">
                          {Number(item.quantidade || 0).toLocaleString('pt-BR')} {item.unidade || ''} · {formatarMoeda(item.valor_total)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}