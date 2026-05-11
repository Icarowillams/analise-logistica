import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Wallet, Play, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const fmt = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

export default function AcertoCaixa() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filtroIni, setFiltroIni] = useState('');
  const [filtroFim, setFiltroFim] = useState('');
  const [filtroData, setFiltroData] = useState('');
  const [busca, setBusca] = useState('');
  const [iniciando, setIniciando] = useState(null);

  const { data: cargas = [] } = useQuery({
    queryKey: ['cargas-acerto'],
    queryFn: () => base44.entities.Carga.filter(
      { status_carga: { $in: ['faturada', 'em_rota', 'entregue'] } }, '-data_carga', 500
    )
  });

  const { data: acertos = [] } = useQuery({
    queryKey: ['acertos'],
    queryFn: () => base44.entities.AcertoCaixa.list('-data_acerto', 500)
  });

  const acertosPorCarga = useMemo(() => {
    const m = new Map();
    acertos.forEach(a => m.set(a.carga_id, a));
    return m;
  }, [acertos]);

  // Cargas elegíveis (sem acerto finalizado e carga não cancelada)
  const cargasElegiveis = useMemo(() => {
    return cargas.filter(c => {
      if (c.status_carga === 'cancelada') return false;
      const a = acertosPorCarga.get(c.id);
      if (a?.status_acerto === 'finalizado') return false;
      if (filtroIni && c.data_carga < filtroIni) return false;
      if (filtroFim && c.data_carga > filtroFim) return false;
      if (filtroData && c.data_carga !== filtroData) return false;
      if (busca) {
        const blob = [c.numero_carga, c.motorista_nome, c.rota_nome].filter(Boolean).join(' ').toLowerCase();
        if (!blob.includes(busca.toLowerCase())) return false;
      }
      return true;
    });
  }, [cargas, acertosPorCarga, filtroIni, filtroFim, filtroData, busca]);

  const acertosFinalizados = useMemo(() => {
    return acertos.filter(a => a.status_acerto === 'finalizado').filter(a => {
      if (filtroIni && a.data_saida_carga && a.data_saida_carga < filtroIni) return false;
      if (filtroFim && a.data_saida_carga && a.data_saida_carga > filtroFim) return false;
      if (filtroData && a.data_saida_carga !== filtroData) return false;
      if (busca) {
        const blob = [a.numero_carga, a.motorista_nome].filter(Boolean).join(' ').toLowerCase();
        if (!blob.includes(busca.toLowerCase())) return false;
      }
      return true;
    });
  }, [acertos, filtroIni, filtroFim, filtroData, busca]);

  const iniciarAcerto = async (carga) => {
    setIniciando(carga.id);
    try {
      const existente = acertosPorCarga.get(carga.id);
      if (existente) {
        navigate(`/AcertoCaixaEditar?id=${existente.id}`);
        return;
      }
      // Cria snapshot — inclui pedidos Omie, Internos (D1) e Trocas
      const notasOmie = (carga.pedidos_omie || []).map(p => ({
        codigo_pedido: String(p.codigo_pedido || ''),
        numero_pedido: String(p.numero_pedido || ''),
        numero_nfe: String(p.numero_nf || ''),
        nome_cliente: p.nome_fantasia || p.nome_cliente || '',
        razao_social: p.nome_cliente || '',
        codigo_cliente: String(p.codigo_cliente || ''),
        codigo_cliente_cod: String(p.codigo_cliente_cod || ''),
        valor_original: Number(p.valor_total_pedido || 0),
        valor_recebido: Number(p.valor_total_pedido || 0),
        diferenca: 0,
        status_entrega: 'pendente',
        forma_pagamento: 'boleto',
        data_recebimento: '',
        motivo_cancelamento: '',
        observacao: ''
      }));
      const notasInternas = (carga.pedidos_internos || []).map(p => ({
        codigo_pedido: '',
        numero_pedido: String(p.numero_pedido || ''),
        numero_nfe: '',
        nome_cliente: p.nome_fantasia || p.nome_cliente || '',
        razao_social: p.nome_cliente || '',
        codigo_cliente: String(p.cliente_id || ''),
        codigo_cliente_cod: '',
        valor_original: Number(p.valor_total_pedido || 0),
        valor_recebido: Number(p.valor_total_pedido || 0),
        diferenca: 0,
        status_entrega: 'pendente',
        forma_pagamento: 'dinheiro',
        data_recebimento: '',
        motivo_cancelamento: '',
        observacao: 'D1 (interno)'
      }));
      const notasTroca = (carga.pedidos_troca || []).map(p => ({
        codigo_pedido: '',
        numero_pedido: String(p.numero_pedido || ''),
        numero_nfe: '',
        nome_cliente: p.nome_fantasia || p.nome_cliente || '',
        razao_social: p.nome_cliente || '',
        codigo_cliente: String(p.cliente_id || ''),
        codigo_cliente_cod: '',
        valor_original: Number(p.valor_total_pedido || 0),
        valor_recebido: 0,
        diferenca: 0,
        status_entrega: 'pendente',
        forma_pagamento: 'boleto',
        data_recebimento: '',
        motivo_cancelamento: '',
        observacao: 'Troca'
      }));
      const notas = [...notasOmie, ...notasInternas, ...notasTroca];
      const valor_total_original = notas.reduce((s, n) => s + n.valor_original, 0);
      const novo = await base44.entities.AcertoCaixa.create({
        carga_id: carga.id,
        numero_carga: carga.numero_carga,
        data_acerto: new Date().toISOString().slice(0, 10),
        data_saida_carga: carga.data_carga,
        motorista_nome: carga.motorista_nome || '',
        status_acerto: 'em_andamento',
        notas,
        valor_total_original,
        valor_total_recebido: valor_total_original,
        valor_total_diferenca: 0
      });
      queryClient.invalidateQueries({ queryKey: ['acertos'] });
      navigate(`/AcertoCaixaEditar?id=${novo.id}`);
    } catch (e) {
      toast.error(e.message);
    }
    setIniciando(null);
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <Wallet className="w-8 h-8 text-emerald-500" />
        <div>
          <h1 className="text-2xl font-bold">Acerto de Caixa</h1>
          <p className="text-sm text-slate-500">Acerto de notas e recebimentos por carga</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div><Label>Saída de</Label><Input type="date" value={filtroIni} onChange={(e) => setFiltroIni(e.target.value)} /></div>
          <div><Label>Saída até</Label><Input type="date" value={filtroFim} onChange={(e) => setFiltroFim(e.target.value)} /></div>
          <div><Label>Data específica</Label><Input type="date" value={filtroData} onChange={(e) => setFiltroData(e.target.value)} /></div>
          <div><Label>Buscar</Label><Input placeholder="Carga, motorista..." value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Cargas para acerto ({cargasElegiveis.length})</CardTitle></CardHeader>
        <CardContent>
          {cargasElegiveis.length === 0 ? (
            <div className="text-sm text-slate-400 py-4 text-center">Nenhuma carga elegível.</div>
          ) : (
            <div className="space-y-2">
              {cargasElegiveis.map(c => {
                const a = acertosPorCarga.get(c.id);
                return (
                  <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-slate-50">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">Carga {c.numero_carga} • {c.data_carga}</div>
                      <div className="text-xs text-slate-500">
                        {c.motorista_nome || '-'} • {c.rota_nome || '-'} • {c.quantidade_pedidos || 0} pedidos • {fmt(c.valor_total)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {a && <Badge className="bg-amber-100 text-amber-800">em andamento</Badge>}
                      <Button onClick={() => iniciarAcerto(c)} disabled={iniciando === c.id} className="bg-emerald-600 hover:bg-emerald-700">
                        {iniciando === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Play className="w-4 h-4 mr-1" /> {a ? 'Continuar' : 'Iniciar'}</>}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Acertos Finalizados ({acertosFinalizados.length})</CardTitle></CardHeader>
        <CardContent>
          {acertosFinalizados.length === 0 ? (
            <div className="text-sm text-slate-400 py-4 text-center">Nenhum acerto finalizado.</div>
          ) : (
            <div className="space-y-2">
              {acertosFinalizados.map(a => (
                <div key={a.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-slate-50">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">Carga {a.numero_carga} • {a.data_saida_carga}</div>
                    <div className="text-xs text-slate-500">
                      {a.motorista_nome || '-'} • {(a.notas || []).length} notas • Recebido {fmt(a.valor_total_recebido)} • Dif. <span className={Number(a.valor_total_diferenca) < 0 ? 'text-red-600 font-semibold' : ''}>{fmt(a.valor_total_diferenca)}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => navigate(`/AcertoCaixaEditar?id=${a.id}`)}>
                      Ver
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => window.open(`/AcertoResumoPDF?id=${a.id}`, '_blank')}>
                      <FileText className="w-4 h-4 mr-1" /> PDF
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}