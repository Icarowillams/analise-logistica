import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Workflow, FileText, CheckCircle2, FileBarChart, Receipt, Truck, Package
} from 'lucide-react';

import EmissaoPedidos from '@/pages/EmissaoPedidos';
import GerenciarPedidosPage from '@/pages/GerenciarPedidosPage';
import MontagemCarga from '@/pages/MontagemCarga';
import Cargas from '@/pages/Cargas';
import NotasOmie from '@/pages/NotasOmie';
import BoletosOmie from '@/pages/BoletosOmie';

const ETAPAS = [
  {
    id: 'pedido_venda',
    label: 'Pedido de Venda',
    icon: FileText,
    color: 'amber',
    descricao: 'Criação e emissão de pedidos',
    Component: EmissaoPedidos
  },
  {
    id: 'gerenciar',
    label: 'Gerenciar / Liberar',
    icon: CheckCircle2,
    color: 'cyan',
    descricao: 'Liberar pedidos para faturamento',
    Component: GerenciarPedidosPage
  },
  {
    id: 'faturar',
    label: 'Montagem de Carga',
    icon: FileBarChart,
    color: 'orange',
    descricao: 'Montar carga com pedidos liberados',
    Component: MontagemCarga
  },
  {
    id: 'faturado',
    label: 'Faturado',
    icon: Receipt,
    color: 'green',
    descricao: 'Cargas faturadas e NFs emitidas',
    Component: Cargas
  },
  {
    id: 'nfs',
    label: 'NFs Emitidas',
    icon: Package,
    color: 'purple',
    descricao: 'Consulta de notas fiscais no Omie',
    Component: NotasOmie
  },
  {
    id: 'entrega',
    label: 'Entrega',
    icon: Truck,
    color: 'indigo',
    descricao: 'Boletos e acompanhamento de entrega',
    Component: BoletosOmie
  }
];

const COLOR_CLASSES = {
  amber:   { bg: 'bg-amber-50',   border: 'border-amber-300',   text: 'text-amber-700',   active: 'bg-amber-500 text-white border-amber-600' },
  cyan:    { bg: 'bg-cyan-50',    border: 'border-cyan-300',    text: 'text-cyan-700',    active: 'bg-cyan-500 text-white border-cyan-600' },
  blue:    { bg: 'bg-blue-50',    border: 'border-blue-300',    text: 'text-blue-700',    active: 'bg-blue-500 text-white border-blue-600' },
  orange:  { bg: 'bg-orange-50',  border: 'border-orange-300',  text: 'text-orange-700',  active: 'bg-orange-500 text-white border-orange-600' },
  green:   { bg: 'bg-green-50',   border: 'border-green-300',   text: 'text-green-700',   active: 'bg-green-500 text-white border-green-600' },
  purple:  { bg: 'bg-purple-50',  border: 'border-purple-300',  text: 'text-purple-700',  active: 'bg-purple-500 text-white border-purple-600' },
  indigo:  { bg: 'bg-indigo-50',  border: 'border-indigo-300',  text: 'text-indigo-700',  active: 'bg-indigo-500 text-white border-indigo-600' }
};

export default function Operacao() {
  const [etapaAtiva, setEtapaAtiva] = useState('pedido_venda');

  const { data: pedidos = [] } = useQuery({
    queryKey: ['pedidosVenda'],
    queryFn: () => base44.entities.PedidoVenda.list('-data_pedido', 500),
    staleTime: 30000
  });

  const { data: cargas = [] } = useQuery({
    queryKey: ['cargas'],
    queryFn: () => base44.entities.Carga.list('-created_date', 200),
    staleTime: 30000
  });

  const contadores = useMemo(() => ({
    pedido_venda: pedidos.filter(p => p.status === 'rascunho' || p.status === 'confirmado').length,
    gerenciar: pedidos.filter(p => p.status === 'rascunho' || p.status === 'confirmado').length,
    faturar: cargas.filter(c => ['montagem', 'fechada', 'conferindo', 'pronta'].includes(c.status_carga)).length,
    faturado: cargas.filter(c => c.status_carga === 'faturada').length,
    nfs: cargas.filter(c => c.status_carga === 'faturada').length,
    entrega: cargas.filter(c => ['em_rota', 'entregue', 'finalizada'].includes(c.status_carga)).length
  }), [pedidos, cargas]);

  const ativa = ETAPAS.find(e => e.id === etapaAtiva);
  const ComponenteAtivo = ativa?.Component;

  return (
    <div className="space-y-4 max-w-[1800px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg">
          <Workflow className="h-6 w-6 text-neutral-900" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Operação Completa</h1>
          <p className="text-sm text-neutral-500">Fluxo unificado: pedido → faturamento → entrega</p>
        </div>
      </div>

      {/* Sub-abas estilo kanban Omie */}
      <div className="bg-white rounded-xl border shadow-sm p-2 overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {ETAPAS.map((etapa, idx) => {
            const isActive = etapaAtiva === etapa.id;
            const cls = COLOR_CLASSES[etapa.color];
            const Icon = etapa.icon;
            const count = contadores[etapa.id] || 0;
            return (
              <React.Fragment key={etapa.id}>
                <button
                  onClick={() => setEtapaAtiva(etapa.id)}
                  className={`flex-1 min-w-[170px] px-4 py-3 rounded-lg border-2 transition-all text-left ${
                    isActive
                      ? cls.active + ' shadow-md scale-[1.02]'
                      : `${cls.bg} ${cls.border} ${cls.text} hover:shadow-sm`
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-4 h-4" />
                    <span className="font-semibold text-sm">{etapa.label}</span>
                  </div>
                  <div className={`text-xs ${isActive ? 'text-white/90' : 'text-slate-500'}`}>
                    {count > 0 ? `${count} registro${count > 1 ? 's' : ''}` : 'Nenhum registro'}
                  </div>
                </button>
                {idx < ETAPAS.length - 1 && (
                  <div className="flex items-center text-slate-300 select-none">›</div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Conteúdo da aba ativa */}
      <div className="bg-white rounded-xl border shadow-sm p-4">
        <div className="mb-4 pb-3 border-b flex items-center gap-2">
          {ativa && <ativa.icon className={`w-5 h-5 ${COLOR_CLASSES[ativa.color].text}`} />}
          <div>
            <div className="font-semibold text-slate-800">{ativa?.label}</div>
            <div className="text-xs text-slate-500">{ativa?.descricao}</div>
          </div>
        </div>
        {ComponenteAtivo && <ComponenteAtivo />}
      </div>
    </div>
  );
}