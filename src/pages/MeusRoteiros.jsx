import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Route, MapPin, Clock, CheckCircle, Package, ArrowLeftRight, Camera, Upload, Download, Calendar, ChevronLeft, ChevronRight, AlertTriangle, XCircle, Users } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import EstoqueForm from '@/components/MeusRoteiros/EstoqueForm';
import TrocasForm from '@/components/MeusRoteiros/TrocasForm';

export default function MeusRoteiros() {
  const [currentUser, setCurrentUser] = useState(null);
  const [vendedorAtual, setVendedorAtual] = useState(null);
  const [activeMainTab, setActiveMainTab] = useState('roteiros');
  
  // Detectar dia atual
  const diaAtualMap = {
    0: 'domingo',
    1: 'segunda-feira',
    2: 'terca-feira',
    3: 'quarta-feira',
    4: 'quinta-feira',
    5: 'sexta-feira',
    6: 'sabado'
  };
  const diaAtual = diaAtualMap[new Date().getDay()];
  const [selectedDia, setSelectedDia] = useState(diaAtual);

  const queryClient = useQueryClient();

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  useEffect(() => {
    base44.auth.me().then(user => {
      setCurrentUser(user);
      const vendedor = vendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
      setVendedorAtual(vendedor);
    }).catch(() => {});
  }, [vendedores]);

  const { data: roteiros = [] } = useQuery({
    queryKey: ['roteiros', vendedorAtual?.id],
    queryFn: () => base44.entities.Roteiro.filter({ vendedor_id: vendedorAtual?.id }),
    enabled: !!vendedorAtual
  });

  const { data: visitas = [] } = useQuery({
    queryKey: ['visitasRoteiro', vendedorAtual?.id],
    queryFn: () => base44.entities.VisitaRoteiro.filter({ vendedor_id: vendedorAtual?.id }),
    enabled: !!vendedorAtual
  });

  const { data: visitasRegistros = [] } = useQuery({
    queryKey: ['visitas', vendedorAtual?.id],
    queryFn: () => base44.entities.Visita.filter({ vendedor_id: vendedorAtual?.id }),
    enabled: !!vendedorAtual
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const clientesMap = useMemo(() => {
    return clientes.reduce((acc, c) => {
      acc[c.id] = c;
      return acc;
    }, {});
  }, [clientes]);

  const diasSemana = [
    { valor: 'segunda-feira', label: 'Segunda-feira' },
    { valor: 'terca-feira', label: 'Terça-feira' },
    { valor: 'quarta-feira', label: 'Quarta-feira' },
    { valor: 'quinta-feira', label: 'Quinta-feira' },
    { valor: 'sexta-feira', label: 'Sexta-feira' },
    { valor: 'sabado', label: 'Sábado' },
    { valor: 'domingo', label: 'Domingo' }
  ];

  if (!vendedorAtual) {
    return (
      <div>
        <PageHeader title="Meus Roteiros" icon={Route} />
        <Alert>
          <AlertDescription>
            Você não está cadastrado como funcionário no sistema. Entre em contato com o administrador.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const roteirosVendedor = roteiros.filter(r => r.vendedor_id === vendedorAtual.id);

  return (
    <div>
      <PageHeader 
        title="Meus Roteiros" 
        subtitle={`Olá, ${vendedorAtual.nome}`}
        icon={Route}
      />

      <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="w-full mb-6">
        <TabsList>
          <TabsTrigger value="roteiros">
            <Route className="w-4 h-4 mr-2" />
            Roteiros do Dia
          </TabsTrigger>
          <TabsTrigger value="calendario">
            <Calendar className="w-4 h-4 mr-2" />
            Meu Calendário
          </TabsTrigger>
        </TabsList>

        <TabsContent value="roteiros">
          <Tabs value={selectedDia} onValueChange={setSelectedDia} className="w-full">
            <TabsList className="grid w-full grid-cols-7 mb-6">
              {diasSemana.map(dia => {
                const roteirosDia = roteirosVendedor.filter(r => r.dia_semana === dia.valor);
                return (
                  <TabsTrigger key={dia.valor} value={dia.valor} className="text-xs">
                    {dia.label.substring(0, 3)}
                    {roteirosDia.length > 0 && (
                      <Badge className="ml-1 bg-amber-500 text-white" variant="secondary">
                        {roteirosDia[0]?.clientes_ids?.length || 0}
                      </Badge>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>

            {diasSemana.map(dia => (
              <TabsContent key={dia.valor} value={dia.valor}>
                <RoteirosDia 
                  dia={dia.valor} 
                  roteiros={roteirosVendedor.filter(r => r.dia_semana === dia.valor)}
                  visitas={visitas}
                  vendedor={vendedorAtual}
                />
              </TabsContent>
            ))}
          </Tabs>
        </TabsContent>

        <TabsContent value="calendario">
          <MeuCalendario 
            roteiros={roteirosVendedor} 
            visitas={visitasRegistros}
            vendedor={vendedorAtual}
            clientesMap={clientesMap}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MeuCalendario({ roteiros, visitas, vendedor, clientesMap }) {
  const [mesAtual, setMesAtual] = useState(new Date());
  const [diaSelecionado, setDiaSelecionado] = useState(null);

  const diasSemanaMap = {
    0: 'domingo',
    1: 'segunda-feira',
    2: 'terca-feira',
    3: 'quarta-feira',
    4: 'quinta-feira',
    5: 'sexta-feira',
    6: 'sabado'
  };

  const diasSemanaNomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const mesesNomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  const diasDoMes = useMemo(() => {
    const ano = mesAtual.getFullYear();
    const mes = mesAtual.getMonth();
    const primeiroDia = new Date(ano, mes, 1);
    const ultimoDia = new Date(ano, mes + 1, 0);
    const dias = [];

    const primeiroDiaSemana = primeiroDia.getDay();
    for (let i = primeiroDiaSemana - 1; i >= 0; i--) {
      const dia = new Date(ano, mes, -i);
      dias.push({ data: dia, outroMes: true });
    }

    for (let d = 1; d <= ultimoDia.getDate(); d++) {
      dias.push({ data: new Date(ano, mes, d), outroMes: false });
    }

    const diasRestantes = 42 - dias.length;
    for (let i = 1; i <= diasRestantes; i++) {
      dias.push({ data: new Date(ano, mes + 1, i), outroMes: true });
    }

    return dias;
  }, [mesAtual]);

  const visitasPorDia = useMemo(() => {
    const resultado = {};
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    diasDoMes.forEach(({ data, outroMes }) => {
      if (outroMes) return;
      
      const dataStr = data.toISOString().split('T')[0];
      const diaSemana = diasSemanaMap[data.getDay()];
      
      const roteirosDoDia = roteiros.filter(r => r.dia_semana === diaSemana);
      const visitasFeitas = visitas.filter(v => v.data_visita === dataStr);
      const clientesVisitados = new Set(visitasFeitas.map(v => v.cliente_id));

      const pendentes = [];
      roteirosDoDia.forEach(roteiro => {
        (roteiro.clientes_ids || []).forEach(clienteId => {
          if (!clientesVisitados.has(clienteId)) {
            pendentes.push({
              cliente_id: clienteId,
              cliente: clientesMap[clienteId]
            });
          }
        });
      });

      const dataComparacao = new Date(data);
      dataComparacao.setHours(0, 0, 0, 0);
      const isPast = dataComparacao < hoje;
      const isToday = dataComparacao.getTime() === hoje.getTime();
      
      resultado[dataStr] = {
        total: roteirosDoDia.reduce((sum, r) => sum + (r.clientes_ids?.length || 0), 0),
        realizadas: visitasFeitas.length,
        pendentes: pendentes,
        isPast,
        isToday,
        isFuture: !isPast && !isToday
      };
    });

    return resultado;
  }, [diasDoMes, roteiros, visitas, clientesMap]);

  const infoDiaSelecionado = useMemo(() => {
    if (!diaSelecionado) return null;
    const dataStr = diaSelecionado.toISOString().split('T')[0];
    return visitasPorDia[dataStr];
  }, [diaSelecionado, visitasPorDia]);

  const clientesDoDia = useMemo(() => {
    if (!diaSelecionado) return [];
    const dataStr = diaSelecionado.toISOString().split('T')[0];
    return visitasPorDia[dataStr]?.pendentes || [];
  }, [diaSelecionado, visitasPorDia]);

  const navegarMes = (direcao) => {
    setMesAtual(prev => new Date(prev.getFullYear(), prev.getMonth() + direcao, 1));
    setDiaSelecionado(null);
  };

  const getCorDia = (data) => {
    const dataStr = data.toISOString().split('T')[0];
    const info = visitasPorDia[dataStr];
    if (!info || info.total === 0) return 'bg-slate-50';
    if (info.isFuture) return 'bg-blue-50 border-blue-200';
    if (info.pendentes.length === 0) return 'bg-green-100 border-green-300';
    if (info.pendentes.length < info.total / 2) return 'bg-yellow-100 border-yellow-300';
    return 'bg-red-100 border-red-300';
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="border-0 shadow-lg lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-5 h-5 text-amber-500" />
              Meu Calendário de Visitas
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => navegarMes(-1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="font-semibold text-slate-700 min-w-[150px] text-center">
                {mesesNomes[mesAtual.getMonth()]} {mesAtual.getFullYear()}
              </span>
              <Button variant="outline" size="sm" onClick={() => navegarMes(1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 mb-4 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded bg-green-100 border border-green-300"></div>
              <span>100% realizadas</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded bg-yellow-100 border border-yellow-300"></div>
              <span>Parcialmente</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded bg-red-100 border border-red-300"></div>
              <span>Pendentes</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-4 h-4 rounded bg-blue-50 border border-blue-200"></div>
              <span>Programadas</span>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-2">
            {diasSemanaNomes.map(dia => (
              <div key={dia} className="text-center text-xs font-semibold text-slate-500 py-2">
                {dia}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {diasDoMes.map(({ data, outroMes }, idx) => {
              const dataStr = data.toISOString().split('T')[0];
              const info = visitasPorDia[dataStr];
              const isSelected = diaSelecionado?.toISOString().split('T')[0] === dataStr;
              const isHoje = new Date().toISOString().split('T')[0] === dataStr;

              return (
                <button
                  key={idx}
                  onClick={() => !outroMes && setDiaSelecionado(data)}
                  disabled={outroMes}
                  className={`
                    p-2 rounded-lg text-center transition-all min-h-[60px] border
                    ${outroMes ? 'opacity-30 cursor-not-allowed bg-slate-50' : 'cursor-pointer hover:shadow-md'}
                    ${!outroMes && getCorDia(data)}
                    ${isSelected ? 'ring-2 ring-amber-500 ring-offset-2' : ''}
                    ${isHoje ? 'ring-2 ring-blue-500' : ''}
                  `}
                >
                  <div className={`text-sm font-medium ${outroMes ? 'text-slate-400' : 'text-slate-700'}`}>
                    {data.getDate()}
                  </div>
                  {!outroMes && info && info.total > 0 && (
                    <div className="mt-1 space-y-0.5">
                      <div className="text-[10px] text-slate-500">{info.realizadas}/{info.total}</div>
                      {info.pendentes.length > 0 && (
                        <Badge className={`text-[10px] px-1 py-0 ${info.isFuture ? 'bg-blue-500' : 'bg-red-500'} text-white`}>
                          {info.pendentes.length}
                        </Badge>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="text-base">
            {diaSelecionado 
              ? infoDiaSelecionado?.isFuture 
                ? `Programadas - ${diaSelecionado.toLocaleDateString('pt-BR')}`
                : `Pendentes - ${diaSelecionado.toLocaleDateString('pt-BR')}`
              : 'Selecione um dia'
            }
          </CardTitle>
          {diaSelecionado && infoDiaSelecionado && (
            <p className="text-sm text-slate-500">
              {infoDiaSelecionado.realizadas} de {infoDiaSelecionado.total} visitas realizadas
            </p>
          )}
        </CardHeader>
        <CardContent>
          {!diaSelecionado ? (
            <div className="text-center text-slate-400 py-8">
              <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Clique em um dia para ver os detalhes</p>
            </div>
          ) : clientesDoDia.length === 0 ? (
            <div className="text-center py-8">
              {infoDiaSelecionado?.total === 0 ? (
                <div className="text-slate-400">
                  <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">Nenhum roteiro para este dia</p>
                </div>
              ) : (
                <div className="text-green-600">
                  <CheckCircle className="w-12 h-12 mx-auto mb-3" />
                  <p className="font-medium">Todas as visitas realizadas!</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {clientesDoDia.map((item, idx) => (
                <div key={idx} className={`p-3 rounded-lg border ${infoDiaSelecionado?.isFuture ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-sm text-slate-800">
                        {item.cliente?.razao_social || item.cliente?.nome_fantasia || 'Cliente'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {item.cliente?.codigo} • {item.cliente?.cidade}
                      </p>
                    </div>
                    <Badge className={`text-xs ${infoDiaSelecionado?.isFuture ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                      {infoDiaSelecionado?.isFuture ? 'Programada' : 'Pendente'}
                    </Badge>
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

function RoteirosDia({ dia, roteiros, visitas, vendedor }) {
  if (roteiros.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-slate-500">
          Nenhum roteiro programado para este dia
        </CardContent>
      </Card>
    );
  }

  const roteiro = roteiros[0];

  return (
    <div className="space-y-4">
      {roteiro.clientes_detalhes?.map((cliente, idx) => {
        const visitaExistente = visitas.find(v => 
          v.cliente_id === cliente.cliente_id && 
          v.roteiro_id === roteiro.id
        );

        return (
          <ClienteCard 
            key={cliente.cliente_id}
            cliente={cliente}
            ordem={idx + 1}
            visitaExistente={visitaExistente}
            roteiroId={roteiro.id}
            vendedor={vendedor}
          />
        );
      })}
    </div>
  );
}

function ClienteCard({ cliente, ordem, visitaExistente, roteiroId, vendedor }) {
  const [showVisita, setShowVisita] = useState(false);

  const getStatusBadge = () => {
    if (!visitaExistente) {
      return <Badge variant="outline" className="bg-slate-100">Pendente</Badge>;
    }
    if (visitaExistente.status === 'checkin_realizado') {
      return <Badge className="bg-blue-500">Check-in Realizado</Badge>;
    }
    if (visitaExistente.status === 'concluida') {
      return <Badge className="bg-green-500">Concluída</Badge>;
    }
    return <Badge variant="outline">Pendente</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge className="bg-amber-500 text-white text-lg px-3">{ordem}</Badge>
            <div>
              <CardTitle className="text-lg">{cliente.cliente_nome}</CardTitle>
              <p className="text-sm text-slate-500">{cliente.cliente_codigo} • {cliente.cliente_cidade}</p>
            </div>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent>
        {!visitaExistente || visitaExistente.status === 'pendente' ? (
          <CheckinButton 
            cliente={cliente} 
            roteiroId={roteiroId} 
            vendedor={vendedor}
            onSuccess={() => setShowVisita(true)}
          />
        ) : showVisita || visitaExistente ? (
          <VisitaDetalhes visita={visitaExistente} cliente={cliente} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function CheckinButton({ cliente, roteiroId, vendedor, onSuccess }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [showPedidoDialog, setShowPedidoDialog] = useState(false);
  const [pedidoSolicitado, setPedidoSolicitado] = useState(null);
  const [motivoSearch, setMotivoSearch] = useState('');
  const [motivoSelecionado, setMotivoSelecionado] = useState('');
  const [locationData, setLocationData] = useState(null);

  const { data: motivos = [] } = useQuery({
    queryKey: ['motivosNaoSolicitacao'],
    queryFn: () => base44.entities.MotivoNaoSolicitacao.list()
  });

  const motivosFiltrados = motivos.filter(m => 
    m.descricao?.toLowerCase().includes(motivoSearch.toLowerCase())
  );

  const createVisitaMutation = useMutation({
    mutationFn: (data) => base44.entities.VisitaRoteiro.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['visitasRoteiro']);
    }
  });

  const createVisitaRegistroMutation = useMutation({
    mutationFn: (data) => base44.entities.Visita.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['visitas']);
    }
  });

  const handleCheckin = () => {
    setLoading(true);
    
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          setLocationData({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
          
          // Verificar se o cargo é especificamente vendedor
          const funcoes = await base44.entities.Funcao.list();
          const funcaoVendedor = funcoes.find(f => f.id === vendedor.funcao_id);
          const isVendedor = funcaoVendedor?.nome?.toLowerCase().includes('vendedor');
          
          if (isVendedor) {
            setLoading(false);
            setShowPedidoDialog(true);
          } else {
            // Admin ou outro tipo de usuário - registrar direto sem perguntar
            await finalizarCheckinDireto(position.coords.latitude, position.coords.longitude);
          }
        },
        (error) => {
          toast.error('Erro ao obter localização. Verifique as permissões do navegador.');
          setLoading(false);
        }
      );
    } else {
      toast.error('Geolocalização não suportada pelo navegador');
      setLoading(false);
    }
  };

  const finalizarCheckinDireto = async (latitude, longitude) => {
    const agora = new Date();
    const numeroVisita = `V${agora.getTime()}-${vendedor.id.substring(0, 8)}`;

    const dataVisitaRoteiro = {
      roteiro_id: roteiroId,
      vendedor_id: vendedor.id,
      vendedor_nome: vendedor.nome,
      cliente_id: cliente.cliente_id,
      cliente_nome: cliente.cliente_nome,
      cliente_codigo: cliente.cliente_codigo,
      cliente_cidade: cliente.cliente_cidade,
      data_visita: agora.toISOString().split('T')[0],
      checkin_time: agora.toISOString(),
      checkin_latitude: latitude,
      checkin_longitude: longitude,
      status: 'checkin_realizado'
    };

    const dataVisita = {
      numero_visita: numeroVisita,
      roteiro_id: roteiroId,
      cliente_id: cliente.cliente_id,
      cliente_nome: cliente.cliente_nome,
      vendedor_id: vendedor.id,
      vendedor_nome: vendedor.nome,
      data_visita: agora.toISOString().split('T')[0],
      hora_checkin: agora.toTimeString().split(' ')[0],
      latitude_checkin: latitude,
      longitude_checkin: longitude,
      pedido_solicitado: null
    };

    await createVisitaMutation.mutateAsync(dataVisitaRoteiro);
    await createVisitaRegistroMutation.mutateAsync(dataVisita);

    toast.success(`✅ Check-in realizado! Visita #${numeroVisita}`);
    setLoading(false);
    onSuccess();
  };

  const finalizarCheckin = async () => {
    if (pedidoSolicitado === false && !motivoSelecionado) {
      toast.error('Por favor, selecione o motivo da não solicitação');
      return;
    }

    const agora = new Date();
    const numeroVisita = `V${agora.getTime()}-${vendedor.id.substring(0, 8)}`;

    const motivoObj = motivos.find(m => m.id === motivoSelecionado);

    // Criar registro na VisitaRoteiro (entidade antiga)
    const dataVisitaRoteiro = {
      roteiro_id: roteiroId,
      vendedor_id: vendedor.id,
      vendedor_nome: vendedor.nome,
      cliente_id: cliente.cliente_id,
      cliente_nome: cliente.cliente_nome,
      cliente_codigo: cliente.cliente_codigo,
      cliente_cidade: cliente.cliente_cidade,
      data_visita: agora.toISOString().split('T')[0],
      checkin_time: agora.toISOString(),
      checkin_latitude: locationData.latitude,
      checkin_longitude: locationData.longitude,
      status: 'checkin_realizado'
    };

    // Criar registro na Visita (nova entidade para contabilização)
    const dataVisita = {
      numero_visita: numeroVisita,
      roteiro_id: roteiroId,
      cliente_id: cliente.cliente_id,
      cliente_nome: cliente.cliente_nome,
      vendedor_id: vendedor.id,
      vendedor_nome: vendedor.nome,
      data_visita: agora.toISOString().split('T')[0],
      hora_checkin: agora.toTimeString().split(' ')[0],
      latitude_checkin: locationData.latitude,
      longitude_checkin: locationData.longitude,
      pedido_solicitado: pedidoSolicitado,
      motivo_nao_solicitacao_id: motivoSelecionado || null,
      motivo_nao_solicitacao_descricao: motivoObj?.descricao || null
    };

    await createVisitaMutation.mutateAsync(dataVisitaRoteiro);
    await createVisitaRegistroMutation.mutateAsync(dataVisita);

    toast.success(`✅ Check-in realizado! Visita #${numeroVisita}`);
    setShowPedidoDialog(false);
    setPedidoSolicitado(null);
    setMotivoSelecionado('');
    setMotivoSearch('');
    onSuccess();
  };

  if (showPedidoDialog) {
    return (
      <div className="space-y-4 p-4 bg-blue-50 rounded-lg border-2 border-blue-200">
        <div>
          <Label className="text-base font-semibold mb-3 block">O pedido foi solicitado?</Label>
          <div className="flex gap-3">
            <Button
              onClick={() => setPedidoSolicitado(true)}
              variant={pedidoSolicitado === true ? 'default' : 'outline'}
              className={pedidoSolicitado === true ? 'bg-green-600 hover:bg-green-700' : ''}
            >
              Sim
            </Button>
            <Button
              onClick={() => setPedidoSolicitado(false)}
              variant={pedidoSolicitado === false ? 'default' : 'outline'}
              className={pedidoSolicitado === false ? 'bg-red-600 hover:bg-red-700' : ''}
            >
              Não
            </Button>
          </div>
        </div>

        {pedidoSolicitado === false && (
          <div className="space-y-2 animate-in fade-in-50">
            <Label>Motivo da não solicitação *</Label>
            <Input
              placeholder="Buscar motivo..."
              value={motivoSearch}
              onChange={(e) => setMotivoSearch(e.target.value)}
              className="mb-2"
            />
            <Select value={motivoSelecionado} onValueChange={setMotivoSelecionado}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o motivo..." />
              </SelectTrigger>
              <SelectContent>
                {motivosFiltrados.map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.descricao}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {pedidoSolicitado !== null && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowPedidoDialog(false);
                setPedidoSolicitado(null);
                setMotivoSelecionado('');
                setMotivoSearch('');
              }}
              className="flex-1"
            >
              Cancelar
            </Button>
            <Button
              onClick={finalizarCheckin}
              disabled={createVisitaMutation.isPending || createVisitaRegistroMutation.isPending}
              className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600"
            >
              Confirmar Check-in
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <Button 
      onClick={handleCheckin}
      disabled={loading}
      className="w-full bg-gradient-to-r from-blue-500 to-blue-600"
    >
      <MapPin className="w-4 h-4 mr-2" />
      {loading ? 'Obtendo localização...' : 'Fazer Check-in'}
    </Button>
  );
}

function VisitaDetalhes({ visita, cliente }) {
  const [activeTab, setActiveTab] = useState('estoque');
  const { data: visitaRegistro } = useQuery({
    queryKey: ['visitaRegistro', visita.id],
    queryFn: async () => {
      const visitas = await base44.entities.Visita.filter({ 
        cliente_id: cliente.cliente_id,
        data_visita: visita.data_visita 
      });
      return visitas[0];
    }
  });

  if (visita.status === 'concluida') {
    return (
      <div className="space-y-3">
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Visita concluída em {new Date(visita.checkout_time).toLocaleString('pt-BR')}
            {visitaRegistro && (
              <div className="mt-1 text-xs">
                <strong>Nº Visita:</strong> {visitaRegistro.numero_visita}
              </div>
            )}
          </AlertDescription>
        </Alert>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-slate-500">Check-in:</span>
            <p className="font-medium">{new Date(visita.checkin_time).toLocaleTimeString('pt-BR')}</p>
          </div>
          <div>
            <span className="text-slate-500">Check-out:</span>
            <p className="font-medium">{new Date(visita.checkout_time).toLocaleTimeString('pt-BR')}</p>
          </div>
        </div>
        {visitaRegistro && visitaRegistro.pedido_solicitado === false && (
          <Alert className="bg-amber-50 border-amber-200">
            <AlertDescription className="text-amber-800 text-xs">
              <strong>Pedido não solicitado:</strong> {visitaRegistro.motivo_nao_solicitacao_descricao}
            </AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Alert className="bg-blue-50 border-blue-200">
        <Clock className="w-4 h-4 text-blue-600" />
        <AlertDescription className="text-blue-800">
          Check-in realizado às {new Date(visita.checkin_time).toLocaleTimeString('pt-BR')}
          {visitaRegistro && (
            <div className="mt-1 text-xs">
              <strong>Nº Visita:</strong> {visitaRegistro.numero_visita}
            </div>
          )}
        </AlertDescription>
      </Alert>

      {visitaRegistro && visitaRegistro.pedido_solicitado === false && (
        <Alert className="bg-amber-50 border-amber-200">
          <AlertDescription className="text-amber-800 text-sm">
            <strong>Pedido não solicitado:</strong> {visitaRegistro.motivo_nao_solicitacao_descricao}
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="estoque">
            <Package className="w-4 h-4 mr-2" />
            Estoque
          </TabsTrigger>
          <TabsTrigger value="trocas">
            <ArrowLeftRight className="w-4 h-4 mr-2" />
            Trocas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="estoque">
          <EstoqueForm visitaId={visita.id} clienteId={cliente.cliente_id} clienteNome={cliente.cliente_nome} />
        </TabsContent>

        <TabsContent value="trocas">
          <TrocasForm visitaId={visita.id} clienteId={cliente.cliente_id} clienteNome={cliente.cliente_nome} />
        </TabsContent>
      </Tabs>

      <CheckoutButton visitaId={visita.id} />
    </div>
  );
}

function CheckoutButton({ visitaId }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  const updateVisitaMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.VisitaRoteiro.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['visitasRoteiro']);
    }
  });

  const handleCheckout = () => {
    setLoading(true);
    
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const data = {
            checkout_time: new Date().toISOString(),
            checkout_latitude: position.coords.latitude,
            checkout_longitude: position.coords.longitude,
            status: 'concluida'
          };
          
          updateVisitaMutation.mutate({ id: visitaId, data });
          setLoading(false);
        },
        (error) => {
          alert('Erro ao obter localização. Verifique as permissões do navegador.');
          setLoading(false);
        }
      );
    } else {
      alert('Geolocalização não suportada pelo navegador');
      setLoading(false);
    }
  };

  return (
    <Button 
      onClick={handleCheckout}
      disabled={loading || updateVisitaMutation.isPending}
      className="w-full bg-gradient-to-r from-green-500 to-green-600"
    >
      <CheckCircle className="w-4 h-4 mr-2" />
      {loading || updateVisitaMutation.isPending ? 'Obtendo localização...' : 'Finalizar Visita (Check-out)'}
    </Button>
  );
}