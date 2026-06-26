import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, RefreshCw, Printer, Layers, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import BoletosImpressaoDialog from '@/components/boletos/BoletosImpressaoDialog';
import { formatarNumeroBoleto } from '@/lib/formatarNumeroBoleto';

const STATUS_BADGE = {
  gerado: 'bg-green-100 text-green-800 border-green-300',
  erro: 'bg-red-100 text-red-800 border-red-300',
  ignorado: 'bg-gray-200 text-gray-800 border-gray-400'
};

const fmtData = (v) => {
  if (!v) return '—';
  const s = String(v);
  // já vem dd/mm/aaaa do Omie em alguns casos
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? s : d.toLocaleDateString('pt-BR');
};

export default function LogEmissaoBoletoTab() {
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [selecionados, setSelecionados] = useState([]);
  const [imprimirOpen, setImprimirOpen] = useState(false);
  const [modoImpressao, setModoImpressao] = useState('individual');

  const { data: logsBrutos = [], isLoading, refetch } = useQuery({
    queryKey: ['log-emissao-boleto'],
    queryFn: () => base44.entities.LogEmissaoBoleto.list('-created_date', 500),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  // FALLBACK de Cliente e Nº NF: muitos LogEmissaoBoleto vêm sem cliente_nome/numero_nf.
  // A fonte rica é a própria Carga — pedidos_omie traz nome_cliente + numero_nf por pedido.
  // Carrega só as cargas referenciadas nos logs e cruza por (numero_carga | numero_pedido).
  const cargasRef = useMemo(
    () => [...new Set(logsBrutos.map(l => String(l.numero_carga || '').trim()).filter(Boolean))],
    [logsBrutos]
  );

  const { data: cargas = [] } = useQuery({
    queryKey: ['cargasParaLogBoleto', cargasRef.join(',')],
    queryFn: () => base44.entities.Carga.filter(
      { numero_carga: { $in: cargasRef } }, '-created_date', 500,
      ['numero_carga', 'pedidos_omie']
    ),
    enabled: cargasRef.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  // Índice "numero_carga|numero_pedido(sem zeros)" → { nome, nf } a partir de pedidos_omie.
  const pedidoPorCargaNumero = useMemo(() => {
    const m = new Map();
    const limpo = (v) => String(v || '').trim().replace(/^0+/, '');
    cargas.forEach(c => {
      (c.pedidos_omie || []).forEach(p => {
        const chave = `${String(c.numero_carga || '').trim()}|${limpo(p.numero_pedido)}`;
        if (chave && !m.has(chave)) {
          m.set(chave, {
            nome: p.nome_cliente || p.nome_fantasia || '',
            nf: String(p.numero_nf || '').replace(/^0+/, '')
          });
        }
      });
    });
    return m;
  }, [cargas]);

  // Resolve Cliente e Nº NF na renderização, sem depender de releitura/write-through.
  const logs = useMemo(() => {
    const limpo = (v) => String(v || '').trim().replace(/^0+/, '');
    return logsBrutos.map(l => {
      const ref = pedidoPorCargaNumero.get(`${String(l.numero_carga || '').trim()}|${limpo(l.numero_pedido)}`);
      return {
        ...l,
        cliente_nome: l.cliente_nome || ref?.nome || '',
        numero_nf: l.numero_nf || ref?.nf || ''
      };
    });
  }, [logsBrutos, pedidoPorCargaNumero]);

  const filtrados = useMemo(() => {
    const termo = filtroTexto.trim().toLowerCase();
    return logs.filter(l => {
      if (filtroStatus !== 'todos' && l.status !== filtroStatus) return false;
      if (!termo) return true;
      return [l.cliente_nome, l.numero_carga, l.numero_pedido, l.numero_nf, l.numero_boleto, formatarNumeroBoleto(l.numero_bancario, l.numero_boleto)]
        .some(v => String(v || '').toLowerCase().includes(termo));
    });
  }, [logs, filtroTexto, filtroStatus]);

  const toggle = (cod) => {
    setSelecionados(prev => prev.includes(cod) ? prev.filter(c => c !== cod) : [...prev, cod]);
  };
  const toggleTodos = () => {
    const elegiveis = filtrados.filter(l => l.status === 'gerado' && l.codigo_lancamento).map(l => l.codigo_lancamento);
    setSelecionados(prev => prev.length === elegiveis.length ? [] : elegiveis);
  };

  const titulosSelecionados = useMemo(
    () => filtrados.filter(l => selecionados.includes(l.codigo_lancamento)),
    [filtrados, selecionados]
  );

  const abrirImpressao = (modo) => {
    if (titulosSelecionados.length === 0) { toast.error('Selecione ao menos um boleto'); return; }
    setModoImpressao(modo);
    setImprimirOpen(true);
  };

  return (
    <div className="space-y-4">
      <BoletosImpressaoDialog
        open={imprimirOpen}
        onOpenChange={setImprimirOpen}
        titulos={titulosSelecionados}
        modo={modoImpressao}
        numeroCarga={titulosSelecionados.find(t => t.numero_carga)?.numero_carga}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2"><Receipt className="w-5 h-5 text-amber-500" /> Histórico de boletos emitidos</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => abrirImpressao('individual')} disabled={titulosSelecionados.length === 0}>
                <Printer className="w-4 h-4 mr-2" /> Imprimir
              </Button>
              <Button variant="outline" size="sm" className="bg-cyan-50 border-cyan-200 text-cyan-700 hover:bg-cyan-100" onClick={() => abrirImpressao('agrupado')} disabled={titulosSelecionados.length === 0}>
                <Layers className="w-4 h-4 mr-2" /> Agrupado
              </Button>
              <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading}>
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[220px]">
              <Label>Buscar</Label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input className="pl-8" placeholder="Cliente, carga, pedido, NF ou boleto..." value={filtroTexto} onChange={(e) => setFiltroTexto(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-1">
              {['todos', 'gerado', 'erro', 'ignorado'].map(s => (
                <Button key={s} size="sm" variant={filtroStatus === s ? 'default' : 'outline'} onClick={() => setFiltroStatus(s)} className="capitalize">
                  {s}
                </Button>
              ))}
            </div>
            <Badge variant="outline">{filtrados.length} registro(s)</Badge>
          </div>

          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2 w-8"><Checkbox checked={selecionados.length > 0 && titulosSelecionados.length > 0} onCheckedChange={toggleTodos} /></th>
                  <th className="p-2 text-left">Cliente</th>
                  <th className="p-2 text-left">Carga</th>
                  <th className="p-2 text-left">Pedido</th>
                  <th className="p-2 text-left">NF</th>
                  <th className="p-2 text-left">Boleto</th>
                  <th className="p-2 text-right">Valor</th>
                  <th className="p-2 text-left">Vencimento</th>
                  <th className="p-2 text-left">Status</th>
                  <th className="p-2 text-left">Quando</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.length === 0 && (
                  <tr><td colSpan={10} className="p-6 text-center text-slate-400">{isLoading ? 'Carregando...' : 'Nenhum registro'}</td></tr>
                )}
                {filtrados.map(l => {
                  const podeSelecionar = l.status === 'gerado' && !!l.codigo_lancamento;
                  return (
                    <tr key={l.id} className="border-t hover:bg-slate-50">
                      <td className="p-2">
                        <Checkbox checked={selecionados.includes(l.codigo_lancamento)} disabled={!podeSelecionar} onCheckedChange={() => toggle(l.codigo_lancamento)} />
                      </td>
                      <td className="p-2">{l.cliente_nome || '—'}</td>
                      <td className="p-2">{l.numero_carga || '—'}</td>
                      <td className="p-2">{l.numero_pedido || '—'}</td>
                      <td className="p-2">{l.numero_nf || '—'}</td>
                      <td className="p-2 font-mono">{formatarNumeroBoleto(l.numero_bancario, l.numero_boleto)}</td>
                      <td className="p-2 text-right">{l.valor != null ? Number(l.valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}</td>
                      <td className="p-2">{fmtData(l.data_vencimento)}</td>
                      <td className="p-2"><Badge variant="outline" className={STATUS_BADGE[l.status] || ''}>{l.status}</Badge></td>
                      <td className="p-2 text-slate-500">{fmtData(l.created_date)}</td>
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