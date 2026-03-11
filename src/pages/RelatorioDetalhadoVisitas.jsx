import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  ArrowLeft, CheckCircle, XCircle, Clock, AlertTriangle, 
  FileText, ShoppingCart, RefreshCw, Users
} from 'lucide-react';
import { createPageUrl } from '@/utils';

export default function RelatorioDetalhadoVisitas() {
  const urlParams = new URLSearchParams(window.location.search);
  const vendedorId = urlParams.get('vendedor_id');
  const vendedorIds = urlParams.get('vendedor_ids'); // para relatório geral
  const dataInicio = urlParams.get('data_inicio');
  const dataFim = urlParams.get('data_fim');

  const isRelatorioGeral = !!vendedorIds;
  const idsArray = vendedorIds ? vendedorIds.split(',') : vendedorId ? [vendedorId] : [];

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: visitasRoteiro = [] } = useQuery({
    queryKey: ['visitasRoteiro'],
    queryFn: () => base44.entities.VisitaRoteiro.list('-data_visita', 5000)
  });

  const { data: visitas = [] } = useQuery({
    queryKey: ['visitas'],
    queryFn: () => base44.entities.Visita.list('-data_visita', 5000)
  });

  const { data: reagendamentos = [] } = useQuery({
    queryKey: ['reagendamentos'],
    queryFn: () => base44.entities.VisitaReagendada.list('-data_reagendamento', 5000)
  });

  const { data: clientesAll = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const vendedoresMap = useMemo(() => 
    vendedores.reduce((acc, v) => { acc[v.id] = v; return acc; }, {}), [vendedores]);

  const clientesMap = useMemo(() => 
    clientesAll.reduce((acc, c) => { acc[c.id] = c; return acc; }, {}), [clientesAll]);

  // Mapa pedido_solicitado da entidade Visita
  const visitaPedidoMap = useMemo(() => {
    const m = {};
    visitas.forEach(v => {
      const key = `${v.vendedor_id}_${v.cliente_id}_${v.data_visita}`;
      m[key] = { pedido_solicitado: v.pedido_solicitado, motivo: v.motivo_nao_solicitacao_descricao };
    });
    return m;
  }, [visitas]);

  // Reagendamentos por vendedor+data
  const reagendamentoMap = useMemo(() => {
    const m = {};
    reagendamentos.forEach(r => {
      const key = `${r.vendedor_id}_${r.cliente_id}_${r.data_reagendamento}`;
      m[key] = r;
    });
    return m;
  }, [reagendamentos]);

  // Filtrar visitas por período e vendedores
  const visitasFiltradas = useMemo(() => {
    return visitasRoteiro.filter(v => {
      if (!v.data_visita || !v.vendedor_id) return false;
      if (v.data_visita < dataInicio || v.data_visita > dataFim) return false;
      if (!idsArray.includes(v.vendedor_id)) return false;
      return true;
    });
  }, [visitasRoteiro, dataInicio, dataFim, idsArray]);

  // Organizar dados por vendedor > dia > status
  const dadosPorVendedor = useMemo(() => {
    const resultado = {};

    idsArray.forEach(vid => {
      const visitasVendedor = visitasFiltradas.filter(v => v.vendedor_id === vid);
      
      // Agrupar por data
      const porDia = {};
      visitasVendedor.forEach(v => {
        if (!porDia[v.data_visita]) porDia[v.data_visita] = [];
        porDia[v.data_visita].push(v);
      });

      // Ordenar dias cronologicamente
      const diasOrdenados = Object.keys(porDia).sort((a, b) => a.localeCompare(b));

      const diasProcessados = diasOrdenados.map(dia => {
        const visitasDoDia = porDia[dia];
        
        const realizadas = [];
        const naoRealizadas = [];
        const emAndamento = [];
        const pendentes = [];

        visitasDoDia.forEach(v => {
          const clienteNome = clientesMap[v.cliente_id]?.nome_fantasia 
            || clientesMap[v.cliente_id]?.razao_social 
            || v.cliente_nome || 'Cliente';
          const clienteCodigo = clientesMap[v.cliente_id]?.codigo || v.cliente_codigo || '';
          
          // Buscar pedido
          const pedidoKey = `${v.vendedor_id}_${v.cliente_id}_${v.data_visita}`;
          const pedidoInfo = v.pedido_solicitado != null 
            ? { pedido_solicitado: v.pedido_solicitado, motivo: v.motivo_nao_pedido }
            : visitaPedidoMap[pedidoKey] || {};

          // Verificar reagendamento
          const reagKey = `${v.vendedor_id}_${v.cliente_id}_${v.data_visita}`;
          const isReagendado = !!reagendamentoMap[reagKey];

          const item = {
            cliente_id: v.cliente_id,
            cliente_nome: clienteNome,
            cliente_codigo: clienteCodigo,
            pedido_solicitado: pedidoInfo.pedido_solicitado,
            motivo_nao_pedido: pedidoInfo.motivo || v.motivo_nao_pedido,
            reagendado: isReagendado,
            motivo_nao_atendimento: v.motivo_nao_atendimento,
            checkin_time: v.checkin_time,
            checkout_time: v.checkout_time,
            observacoes: v.observacoes
          };

          if (v.status === 'concluida') {
            realizadas.push(item);
          } else if (v.status === 'nao_atendido') {
            naoRealizadas.push(item);
          } else if (v.status === 'checkin_realizado' || v.status === 'em_andamento') {
            emAndamento.push(item);
          } else if (v.status === 'pendente') {
            pendentes.push(item);
          }
        });

        return { dia, realizadas, naoRealizadas, emAndamento, pendentes };
      });

      resultado[vid] = diasProcessados;
    });

    return resultado;
  }, [visitasFiltradas, idsArray, clientesMap, visitaPedidoMap, reagendamentoMap]);

  const formatarData = (dateStr) => {
    const [ano, mes, dia] = dateStr.split('-').map(Number);
    const d = new Date(ano, mes - 1, dia);
    return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
        </Button>
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-xl">
            <FileText className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {isRelatorioGeral ? 'Relatório Geral de Visitas' : `Relatório de Visitas`}
            </h1>
            <p className="text-sm text-slate-500">
              {!isRelatorioGeral && vendedoresMap[vendedorId]?.nome ? `${vendedoresMap[vendedorId].nome} — ` : ''}
              Período: {new Date(dataInicio + 'T12:00:00').toLocaleDateString('pt-BR')} a {new Date(dataFim + 'T12:00:00').toLocaleDateString('pt-BR')}
            </p>
          </div>
        </div>
      </div>

      {/* Relatório por vendedor */}
      {idsArray.map(vid => {
        const dias = dadosPorVendedor[vid] || [];
        const vendedor = vendedoresMap[vid];
        if (dias.length === 0) return null;

        return (
          <div key={vid} className="space-y-4">
            {isRelatorioGeral && (
              <Card className="border-0 shadow-md bg-gradient-to-r from-slate-700 to-slate-800">
                <CardHeader className="py-3">
                  <div className="flex items-center gap-3">
                    <Users className="w-5 h-5 text-white" />
                    <CardTitle className="text-white text-lg">{vendedor?.nome || 'Vendedor'}</CardTitle>
                  </div>
                </CardHeader>
              </Card>
            )}

            {/* Seções por status, dentro de cada status organizado por dia */}
            <StatusSection 
              titulo="Realizadas" 
              icon={<CheckCircle className="w-5 h-5" />}
              cor="green"
              dias={dias}
              campo="realizadas"
              formatarData={formatarData}
              mostrarPedido={true}
            />
            <StatusSection 
              titulo="Não Realizadas" 
              icon={<XCircle className="w-5 h-5" />}
              cor="red"
              dias={dias}
              campo="naoRealizadas"
              formatarData={formatarData}
            />
            <StatusSection 
              titulo="Em Andamento" 
              icon={<Clock className="w-5 h-5" />}
              cor="blue"
              dias={dias}
              campo="emAndamento"
              formatarData={formatarData}
              mostrarPedido={true}
            />
            <StatusSection 
              titulo="Pendentes" 
              icon={<AlertTriangle className="w-5 h-5" />}
              cor="amber"
              dias={dias}
              campo="pendentes"
              formatarData={formatarData}
            />
          </div>
        );
      })}

      {idsArray.length === 0 && (
        <Card className="border-0 shadow-lg">
          <CardContent className="p-12 text-center">
            <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-lg text-slate-500">Nenhum dado encontrado para o período selecionado</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusSection({ titulo, icon, cor, dias, campo, formatarData, mostrarPedido }) {
  const totalItens = dias.reduce((sum, d) => sum + d[campo].length, 0);
  if (totalItens === 0) return null;

  const corConfig = {
    green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', headerBg: 'bg-green-100', badge: 'bg-green-600' },
    red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', headerBg: 'bg-red-100', badge: 'bg-red-600' },
    blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', headerBg: 'bg-blue-100', badge: 'bg-blue-600' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', headerBg: 'bg-amber-100', badge: 'bg-amber-600' },
  };

  const c = corConfig[cor];

  return (
    <Card className={`border-0 shadow-lg overflow-hidden`}>
      <CardHeader className={`${c.headerBg} py-3`}>
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-2 ${c.text} font-bold text-lg`}>
            {icon}
            {titulo}
          </div>
          <Badge className={`${c.badge} text-white`}>{totalItens}</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {dias.map(diaInfo => {
          const itens = diaInfo[campo];
          if (itens.length === 0) return null;

          return (
            <div key={diaInfo.dia} className="space-y-2">
              <div className={`text-sm font-semibold ${c.text} capitalize border-b ${c.border} pb-1`}>
                📅 {formatarData(diaInfo.dia)}
              </div>
              <div className="space-y-1.5 ml-2">
                {itens.map((item, idx) => (
                  <VisitaItem key={idx} item={item} mostrarPedido={mostrarPedido} cor={cor} />
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function VisitaItem({ item, mostrarPedido, cor }) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 p-2 rounded-lg border bg-white`}>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {item.cliente_codigo && (
          <Badge variant="outline" className="text-[10px] shrink-0">{item.cliente_codigo}</Badge>
        )}
        <span className="font-medium text-slate-800 text-sm truncate">{item.cliente_nome}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap ml-6 sm:ml-0">
        {item.reagendado && (
          <Badge className="bg-purple-100 text-purple-700 text-[10px] gap-0.5">
            <RefreshCw className="w-2.5 h-2.5" /> Reagendado
          </Badge>
        )}
        {mostrarPedido && item.pedido_solicitado === true && (
          <Badge className="bg-green-100 text-green-700 text-[10px] gap-0.5">
            <ShoppingCart className="w-2.5 h-2.5" /> Pedido Sim
          </Badge>
        )}
        {mostrarPedido && item.pedido_solicitado === false && (
          <Badge className="bg-orange-100 text-orange-700 text-[10px] gap-0.5">
            <ShoppingCart className="w-2.5 h-2.5" /> Pedido Não
          </Badge>
        )}
        {item.motivo_nao_atendimento && (
          <Badge className="bg-red-100 text-red-700 text-[10px]">
            {item.motivo_nao_atendimento}
          </Badge>
        )}
      </div>
    </div>
  );
}