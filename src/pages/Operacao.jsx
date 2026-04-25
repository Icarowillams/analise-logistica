import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Workflow, RefreshCw, Search, ExternalLink, Plus, FileBarChart, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import KanbanColumn from '@/components/operacao/KanbanColumn';
import KanbanCard from '@/components/operacao/KanbanCard';

// Etapas Omie:
// 10 = Pedido de Venda (em digitação)
// 20 = Pedidos Liberados (aprovação)
// 50 = Faturar
// 60 = Faturado
function formatarData(d) {
  if (!d) return '';
  // Omie retorna dd/mm/aaaa. Mostra "dd/mm Dia"
  const partes = d.split('/');
  if (partes.length !== 3) return d;
  const data = new Date(`${partes[2]}-${partes[1]}-${partes[0]}T12:00:00`);
  const dia = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][data.getDay()];
  return `${partes[0]}/${partes[1]} ${dia}`;
}

export default function Operacao() {
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');

  // Busca pedidos do Omie por etapa
  const fetchEtapa = async (etapa) => {
    const { data } = await base44.functions.invoke('buscarPedidosOmie', { etapa, registros_por_pagina: 50 });
    return data?.pedidos || [];
  };

  const etapa10 = useQuery({ queryKey: ['operacaoOmie', '10'], queryFn: () => fetchEtapa('10'), staleTime: 30000, refetchOnWindowFocus: false });
  const etapa20 = useQuery({ queryKey: ['operacaoOmie', '20'], queryFn: () => fetchEtapa('20'), staleTime: 30000, refetchOnWindowFocus: false });
  const etapa50 = useQuery({ queryKey: ['operacaoOmie', '50'], queryFn: () => fetchEtapa('50'), staleTime: 30000, refetchOnWindowFocus: false });
  const etapa60 = useQuery({ queryKey: ['operacaoOmie', '60'], queryFn: () => fetchEtapa('60'), staleTime: 30000, refetchOnWindowFocus: false });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes-mini'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 3000),
    staleTime: 60000
  });

  const { data: cargas = [], isLoading: loadingCargas, refetch: refetchCargas } = useQuery({
    queryKey: ['cargasOperacao'],
    queryFn: () => base44.entities.Carga.list('-created_date', 100),
    staleTime: 30000
  });

  const clientePorCodigo = useMemo(() => {
    const map = {};
    clientes.forEach(c => { if (c.codigo_omie) map[String(c.codigo_omie)] = c; });
    return map;
  }, [clientes]);

  const filtrar = (lista) => {
    if (!busca.trim()) return lista;
    const t = busca.toLowerCase();
    return lista.filter(p => {
      const cli = clientePorCodigo[p.codigo_cliente];
      const nome = (cli?.nome_fantasia || cli?.razao_social || '').toLowerCase();
      return p.numero_pedido?.toString().includes(t) || nome.includes(t);
    });
  };

  const cardsOmie = (pedidos, borderColor) => filtrar(pedidos).map(p => {
    const cli = clientePorCodigo[p.codigo_cliente];
    const nome = cli?.nome_fantasia || cli?.razao_social || `Cliente ${p.codigo_cliente}`;
    return (
      <KanbanCard
        key={p.codigo_pedido}
        numero={p.numero_pedido}
        titulo={nome}
        valor={p.valor_total_pedido}
        data={formatarData(p.data_previsao)}
        borderColor={borderColor}
      />
    );
  });

  const cargasEmEntrega = filtrar(
    cargas.filter(c => ['em_rota', 'entregue', 'finalizada'].includes(c.status_carga))
      .map(c => ({ ...c, numero_pedido: c.numero_carga, valor_total_pedido: c.valor_total }))
  );

  const recarregarTudo = () => {
    etapa10.refetch();
    etapa20.refetch();
    etapa50.refetch();
    etapa60.refetch();
    refetchCargas();
  };

  return (
    <div className="space-y-3 max-w-[1800px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg">
            <Workflow className="h-6 w-6 text-neutral-900" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Operação Completa</h1>
            <p className="text-sm text-neutral-500">Pedido de Venda → Liberação → Faturamento → Entrega</p>
          </div>
        </div>
        <Button variant="outline" onClick={recarregarTudo}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Atualizar
        </Button>
      </div>

      {/* Busca */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
        <Input
          placeholder="Digite o que deseja pesquisar"
          className="pl-9"
          value={busca}
          onChange={e => setBusca(e.target.value)}
        />
        {busca && <span className="text-xs text-blue-600 ml-1">Filtrando: "{busca}"</span>}
      </div>

      {/* Kanban */}
      <div className="flex gap-3 overflow-x-auto pb-3">
        <KanbanColumn
          titulo="Pedido de Venda"
          count={filtrar(etapa10.data || []).length}
          loading={etapa10.isLoading}
          footer={
            <Button
              className="w-full bg-amber-500 hover:bg-amber-600 text-white"
              onClick={() => navigate('/EmissaoPedidos')}
            >
              <Plus className="w-4 h-4 mr-1" /> Novo Pedido de Venda
            </Button>
          }
        >
          {cardsOmie(etapa10.data || [], '#f59e0b')}
        </KanbanColumn>

        <KanbanColumn
          titulo="Pedidos Liberados"
          count={filtrar(etapa20.data || []).length}
          loading={etapa20.isLoading}
          footer={
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate('/AjustesPedidos')}
            >
              <ExternalLink className="w-4 h-4 mr-1" /> Ajustar pedidos
            </Button>
          }
        >
          {cardsOmie(etapa20.data || [], '#3b82f6')}
        </KanbanColumn>

        <KanbanColumn
          titulo="Faturar"
          count={filtrar(etapa50.data || []).length}
          loading={etapa50.isLoading}
          footer={
            <Button
              className="w-full bg-orange-500 hover:bg-orange-600 text-white"
              onClick={() => navigate('/MontagemCarga')}
            >
              <FileBarChart className="w-4 h-4 mr-1" /> Montar / Faturar Carga
            </Button>
          }
        >
          {cardsOmie(etapa50.data || [], '#f97316')}
        </KanbanColumn>

        <KanbanColumn
          titulo="Faturado"
          count={filtrar(etapa60.data || []).length}
          loading={etapa60.isLoading}
          footer={
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate('/NotasOmie')}
            >
              <ExternalLink className="w-4 h-4 mr-1" /> Ver NFs no Omie
            </Button>
          }
        >
          {cardsOmie(etapa60.data || [], '#22c55e')}
        </KanbanColumn>

        <KanbanColumn
          titulo="Entrega"
          count={cargasEmEntrega.length}
          loading={loadingCargas}
          footer={
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate('/Cargas')}
            >
              <Truck className="w-4 h-4 mr-1" /> Ver todas as cargas
            </Button>
          }
        >
          {cargasEmEntrega.map(c => (
            <KanbanCard
              key={c.id}
              numero={c.numero_carga}
              titulo={c.motorista_nome || 'Sem motorista'}
              subtitulo={c.veiculo_placa ? `Veículo ${c.veiculo_placa}` : ''}
              valor={c.valor_total}
              data={c.data_carga ? new Date(c.data_carga + 'T12:00:00').toLocaleDateString('pt-BR') : ''}
              borderColor="#6366f1"
              origem={`Status: ${c.status_carga}`}
            />
          ))}
        </KanbanColumn>
      </div>
    </div>
  );
}