import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Route, MapPin, Clock, CheckCircle, Package, ArrowLeftRight, XCircle, CalendarPlus, Navigation } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import EstoqueForm from '@/components/MeusRoteiros/EstoqueForm';
import TrocasForm from '@/components/MeusRoteiros/TrocasForm';

export default function MeusRoteiros() {
  const [currentUser, setCurrentUser] = useState(null);
  const [vendedorAtual, setVendedorAtual] = useState(null);
  
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
    enabled: !!vendedorAtual,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: visitasRegistros = [] } = useQuery({
    queryKey: ['visitas', vendedorAtual?.id],
    queryFn: () => base44.entities.Visita.filter({ vendedor_id: vendedorAtual?.id }),
    enabled: !!vendedorAtual,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: visitasReagendadas = [] } = useQuery({
    queryKey: ['visitasReagendadas', vendedorAtual?.id],
    queryFn: () => base44.entities.VisitaReagendada.filter({ vendedor_id: vendedorAtual?.id, status: 'pendente' }),
    enabled: !!vendedorAtual
  });

  const { data: permissoes = [] } = useQuery({
    queryKey: ['permissoes'],
    queryFn: () => base44.entities.Permissao.list()
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const permissaoUsuario = useMemo(() => {
    if (!vendedorAtual) return null;
    return permissoes.find(p => p.vendedor_id === vendedorAtual.id);
  }, [permissoes, vendedorAtual]);

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

      <Tabs value={selectedDia} onValueChange={setSelectedDia} className="w-full">
        <TabsList className="flex flex-wrap w-full gap-1 h-auto p-1 mb-6">
          {diasSemana.map(dia => {
            const roteirosDia = roteirosVendedor.filter(r => r.dia_semana === dia.valor);
            return (
              <TabsTrigger key={dia.valor} value={dia.valor} className="text-xs flex-1 min-w-[40px] px-1 py-1.5">
                <span className="hidden sm:inline">{dia.label.substring(0, 3)}</span>
                <span className="sm:hidden">{dia.label.substring(0, 1)}</span>
                {roteirosDia.length > 0 && (
                  <Badge className="ml-1 bg-amber-500 text-white text-[10px] px-1" variant="secondary">
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
              visitasReagendadas={visitasReagendadas}
              permissaoUsuario={permissaoUsuario}
              clientes={clientes}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

// Função auxiliar para formatar data local como YYYY-MM-DD (sem conversão UTC)
function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Função auxiliar para calcular início da semana (domingo)
function getInicioSemana(data) {
  const d = new Date(data);
  const diaSemana = d.getDay(); // 0 = domingo
  d.setDate(d.getDate() - diaSemana);
  d.setHours(0, 0, 0, 0);
  return d;
}

function RoteirosDia({ dia, roteiros, visitas, vendedor, visitasReagendadas, permissaoUsuario, clientes }) {
  // Calcular data correspondente ao dia selecionado DENTRO da semana atual (dom-sáb)
  const hoje = new Date();
  const diaAtualMap = {
    'domingo': 0,
    'segunda-feira': 1,
    'terca-feira': 2,
    'quarta-feira': 3,
    'quinta-feira': 4,
    'sexta-feira': 5,
    'sabado': 6
  };
  
  // Calcular início da semana atual (domingo)
  const inicioSemana = getInicioSemana(hoje);
  const diaSelecionadoNumero = diaAtualMap[dia];
  
  // A data selecionada é sempre DENTRO da semana atual
  const dataSelecionada = new Date(inicioSemana);
  dataSelecionada.setDate(inicioSemana.getDate() + diaSelecionadoNumero);
  const dataSelecionadaStr = dataSelecionada.toISOString().split('T')[0];

  // Calcular fim da semana atual (sábado)
  const fimSemana = new Date(inicioSemana);
  fimSemana.setDate(inicioSemana.getDate() + 6);
  fimSemana.setHours(23, 59, 59, 999);

  // Filtrar visitas apenas da semana atual (comparar apenas strings de data YYYY-MM-DD)
  const inicioSemanaStr = inicioSemana.toISOString().split('T')[0];
  const fimSemanaStr = fimSemana.toISOString().split('T')[0];
  const visitasDaSemana = visitas.filter(v => {
    const dv = v.data_visita; // já é string YYYY-MM-DD
    return dv >= inicioSemanaStr && dv <= fimSemanaStr;
  });

  // Filtrar visitas reagendadas para este dia
  const reagendadasParaHoje = visitasReagendadas.filter(vr => 
    vr.data_reagendamento === dataSelecionadaStr && vr.status === 'pendente'
  );

  const roteiro = roteiros[0];
  const clientesDoRoteiro = roteiro?.clientes_detalhes || [];

  if (roteiros.length === 0 && reagendadasParaHoje.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-slate-500">
          Nenhum roteiro programado para este dia
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Visitas Reagendadas (Exceções) */}
      {reagendadasParaHoje.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-orange-600 flex items-center gap-2">
            <CalendarPlus className="w-4 h-4" />
            Reagendamentos ({reagendadasParaHoje.length})
          </h3>
          {reagendadasParaHoje.map((reagendada) => {
            const visitaExistente = visitas.find(v => 
              v.cliente_id === reagendada.cliente_id && 
              v.data_visita === dataSelecionadaStr
            );

            // Buscar dados completos do cliente
            const clienteCompleto = clientes.find(c => c.id === reagendada.cliente_id);

            return (
              <ClienteCard 
                key={`reagendada-${reagendada.id}`}
                cliente={{
                  cliente_id: reagendada.cliente_id,
                  cliente_nome: clienteCompleto?.nome_fantasia || clienteCompleto?.razao_social || reagendada.cliente_nome,
                  cliente_nome_fantasia: clienteCompleto?.nome_fantasia,
                  cliente_codigo: clienteCompleto?.codigo || reagendada.cliente_codigo,
                  cliente_cidade: clienteCompleto?.cidade || reagendada.cliente_cidade,
                  cliente_bairro: clienteCompleto?.bairro
                }}
                ordem="R"
                visitaExistente={visitaExistente}
                roteiroId={null}
                vendedor={vendedor}
                isReagendamento={true}
                reagendamentoId={reagendada.id}
                permissaoUsuario={permissaoUsuario}
                clienteCompleto={clienteCompleto}
              />
            );
          })}
        </div>
      )}

      {/* Clientes do Roteiro Fixo */}
      {clientesDoRoteiro.map((cliente, idx) => {
        // Buscar visita mais recente da semana para este cliente/roteiro
        // Filtrar APENAS pela data selecionada (dia específico da semana)
        // Ordenar por created_date desc para pegar a mais recente em caso de duplicatas
        const visitasCliente = visitasDaSemana
          .filter(v => v.cliente_id === cliente.cliente_id && v.roteiro_id === roteiro.id && v.data_visita === dataSelecionadaStr)
          .sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
        const visitaExistente = visitasCliente[0] || null;

        // Buscar dados completos do cliente (por ID ou por código como fallback)
        const clienteCompleto = clientes.find(c => c.id === cliente.cliente_id) 
          || clientes.find(c => c.codigo === cliente.cliente_codigo);

        const nomeFantasia = clienteCompleto?.nome_fantasia || cliente.nome_fantasia || cliente.cliente_nome_fantasia;
        const clienteAtualizado = {
          ...cliente,
          cliente_id: clienteCompleto?.id || cliente.cliente_id,
          cliente_nome: clienteCompleto?.razao_social || cliente.cliente_nome,
          cliente_nome_fantasia: nomeFantasia,
          cliente_codigo: clienteCompleto?.codigo || cliente.cliente_codigo,
          cliente_cidade: clienteCompleto?.cidade || cliente.cliente_cidade,
          cliente_bairro: clienteCompleto?.bairro || cliente.cliente_bairro
        };

        return (
          <ClienteCard 
            key={cliente.cliente_id}
            cliente={clienteAtualizado}
            ordem={idx + 1}
            visitaExistente={visitaExistente}
            roteiroId={roteiro.id}
            vendedor={vendedor}
            permissaoUsuario={permissaoUsuario}
            clienteCompleto={clienteCompleto}
          />
        );
      })}
    </div>
  );
}

function ClienteCard({ cliente, ordem, visitaExistente, roteiroId, vendedor, isReagendamento, reagendamentoId, permissaoUsuario, clienteCompleto }) {
  const [checkinFeito, setCheckinFeito] = useState(false);
  const queryClient = useQueryClient();

  // A visita efetiva vem direto da prop (já filtrada por data no RoteirosDia)
  const visitaEfetiva = visitaExistente;
  
  // O check-in é considerado realizado se:
  // 1. O usuário acabou de fazer o check-in (estado local)
  // 2. Já existe uma visita com status diferente de 'pendente'
  const checkinRealizado = checkinFeito || (visitaEfetiva && visitaEfetiva.status !== 'pendente');

  const getStatusBadge = () => {
    if (checkinRealizado && !visitaEfetiva) {
      return <Badge className="bg-blue-500">Check-in Realizado</Badge>;
    }
    if (!visitaEfetiva) {
      return <Badge variant="outline" className="bg-slate-100">Pendente</Badge>;
    }
    if (visitaEfetiva.status === 'checkin_realizado') {
      return <Badge className="bg-blue-500">Check-in Realizado</Badge>;
    }
    if (visitaEfetiva.status === 'concluida') {
      return <Badge className="bg-green-500">Concluída</Badge>;
    }
    if (visitaEfetiva.status === 'nao_atendido') {
      return <Badge className="bg-red-500">Não Atendido</Badge>;
    }
    return <Badge variant="outline">Pendente</Badge>;
  };

  const handleOpenMaps = (app) => {
    const lat = clienteCompleto?.latitude;
    const lng = clienteCompleto?.longitude;
    
    if (lat && lng) {
      if (app === 'google') {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
      } else if (app === 'waze') {
        window.open(`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`, '_blank');
      }
    } else {
      // Fallback para endereço se não tiver coordenadas
      const endereco = [
        clienteCompleto?.endereco,
        clienteCompleto?.numero,
        clienteCompleto?.bairro,
        clienteCompleto?.cidade,
        clienteCompleto?.estado
      ].filter(Boolean).join(', ');
      
      if (endereco) {
        if (app === 'google') {
          window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(endereco)}`, '_blank');
        } else if (app === 'waze') {
          window.open(`https://waze.com/ul?q=${encodeURIComponent(endereco)}&navigate=yes`, '_blank');
        }
      } else {
        alert('Endereço ou coordenadas não disponíveis para este cliente.');
      }
    }
  };

  return (
    <Card className={isReagendamento ? 'border-orange-300 bg-orange-50/50' : ''}>
      <CardHeader className="p-3 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <Badge className={`${isReagendamento ? 'bg-orange-500' : 'bg-amber-500'} text-white text-sm px-2 shrink-0`}>
              {ordem}
            </Badge>
            <div className="min-w-0 flex-1">
              <CardTitle className="text-sm sm:text-base leading-tight break-words">
                {cliente.cliente_codigo && <span className="font-bold">{cliente.cliente_codigo}</span>}
                {cliente.cliente_codigo && ' - '}
                {cliente.cliente_nome_fantasia || cliente.nome_fantasia || cliente.cliente_nome}
                {isReagendamento && <span className="ml-1 text-orange-600 font-medium text-xs">(Reag.)</span>}
              </CardTitle>
              <p className="text-xs text-slate-500 truncate">
                {cliente.cliente_cidade}{cliente.cliente_bairro ? `, ${cliente.cliente_bairro}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-7 w-7 sm:h-8 sm:w-8">
                  <Navigation className="w-3 h-3 sm:w-4 sm:h-4 text-blue-600" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleOpenMaps('google')}>
                  <img src="https://upload.wikimedia.org/wikipedia/commons/a/aa/Google_Maps_icon_%282020%29.svg" className="w-4 h-4 mr-2" alt="Google Maps" />
                  Google Maps
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleOpenMaps('waze')}>
                  <img src="https://upload.wikimedia.org/wikipedia/commons/d/d7/Waze_logo.svg" className="w-4 h-4 mr-2" alt="Waze" />
                  Waze
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {getStatusBadge()}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {checkinRealizado ? (
          visitaEfetiva ? (
            <VisitaDetalhes 
              visita={visitaEfetiva} 
              cliente={cliente} 
              permissaoUsuario={permissaoUsuario}
              vendedor={vendedor}
            />
          ) : (
            <RefetchingVisitaLoader
              clienteId={cliente.cliente_id}
              vendedorId={vendedor.id}
              roteiroId={roteiroId}
              cliente={cliente}
              permissaoUsuario={permissaoUsuario}
              vendedor={vendedor}
            />
          )
        ) : (
          <CheckinButton 
            cliente={cliente} 
            roteiroId={roteiroId} 
            vendedor={vendedor}
            onSuccess={() => setCheckinFeito(true)}
            reagendamentoId={reagendamentoId}
            permissaoUsuario={permissaoUsuario}
          />
        )}
      </CardContent>
    </Card>
  );
}

function RefetchingVisitaLoader({ clienteId, vendedorId, roteiroId, cliente, permissaoUsuario, vendedor }) {
  const queryClient = useQueryClient();
  
  const { data: visitaDireta } = useQuery({
    queryKey: ['visitaRoteiroDireta', clienteId, roteiroId],
    queryFn: async () => {
      const results = await base44.entities.VisitaRoteiro.filter({
        cliente_id: clienteId,
        vendedor_id: vendedorId,
        data_visita: new Date().toISOString().split('T')[0]
      });
      // Pegar a mais recente
      const sorted = results.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      return sorted[0] || null;
    },
    refetchInterval: (query) => query.state.data ? false : 2000,
  });

  if (visitaDireta) {
    return (
      <VisitaDetalhes 
        visita={visitaDireta} 
        cliente={cliente} 
        permissaoUsuario={permissaoUsuario}
        vendedor={vendedor}
      />
    );
  }

  return (
    <Alert className="bg-blue-50 border-blue-200">
      <CheckCircle className="w-4 h-4 text-blue-600" />
      <AlertDescription className="text-blue-800">
        Check-in realizado! Carregando detalhes da visita...
      </AlertDescription>
    </Alert>
  );
}

function CheckinButton({ cliente, roteiroId, vendedor, onSuccess, reagendamentoId, permissaoUsuario }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [showPedidoDialog, setShowPedidoDialog] = useState(false);
  const [showNaoAtendidoDialog, setShowNaoAtendidoDialog] = useState(false);
  const [pedidoSolicitado, setPedidoSolicitado] = useState(null);
  const [motivoSearch, setMotivoSearch] = useState('');
  const [motivoNaoAtendSearch, setMotivoNaoAtendSearch] = useState('');
  const [motivoSelecionado, setMotivoSelecionado] = useState('');
  const [locationData, setLocationData] = useState(null);
  const [checkinRealizado, setCheckinRealizado] = useState(false);
  const [visitaNumero, setVisitaNumero] = useState('');
  
  // Estados para Não Atendido
  const [motivoNaoAtendimento, setMotivoNaoAtendimento] = useState('');
  const [reagendarDiaSeguinte, setReagendarDiaSeguinte] = useState(false);
  
  // Estado para reagendar quando não solicitar pedido
  const [reagendarNaoSolicitou, setReagendarNaoSolicitou] = useState(false);

  // Verificar permissão de marcar solicitou pedido
  const podeMarcarSolicitouPedido = permissaoUsuario?.permissoes_visitas?.marcar_solicitou_pedido !== false;

  const { data: motivos = [] } = useQuery({
    queryKey: ['motivosNaoSolicitacao'],
    queryFn: () => base44.entities.MotivoNaoSolicitacao.list()
  });

  const { data: motivosNaoAtend = [] } = useQuery({
    queryKey: ['motivosNaoAtendimento'],
    queryFn: () => base44.entities.MotivoNaoAtendimento.list()
  });

  const motivosFiltrados = motivos.filter(m => 
    m.descricao?.toLowerCase().includes(motivoSearch.toLowerCase()) && m.status === 'ativo'
  );

  const motivosNaoAtendFiltrados = motivosNaoAtend.filter(m => 
    m.descricao?.toLowerCase().includes(motivoNaoAtendSearch.toLowerCase()) && m.status === 'ativo'
  );

  const createVisitaMutation = useMutation({
    mutationFn: (data) => base44.entities.VisitaRoteiro.create(data)
    // NÃO invalidar queries aqui - vai ser feito manualmente depois
  });

  const createVisitaRegistroMutation = useMutation({
    mutationFn: (data) => base44.entities.Visita.create(data)
    // NÃO invalidar queries aqui - vai ser feito manualmente depois
  });

  const createReagendamentoMutation = useMutation({
    mutationFn: (data) => base44.entities.VisitaReagendada.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['visitasReagendadas']);
    }
  });

  const updateReagendamentoMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.VisitaReagendada.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['visitasReagendadas']);
    }
  });

  const handleCheckin = () => {
    setLoading(true);
    
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          // Registrar check-in IMEDIATAMENTE ao clicar no botão
          const agora = new Date();
          const numeroVisita = `V${agora.getTime()}-${vendedor.id.substring(0, 8)}`;

          const dataVisitaRoteiro = {
            roteiro_id: roteiroId || '',
            vendedor_id: vendedor.id,
            vendedor_nome: vendedor.nome,
            cliente_id: cliente.cliente_id,
            cliente_nome: cliente.cliente_nome,
            cliente_codigo: cliente.cliente_codigo,
            cliente_cidade: cliente.cliente_cidade,
            data_visita: agora.toISOString().split('T')[0],
            checkin_time: agora.toISOString(),
            checkin_latitude: position.coords.latitude,
            checkin_longitude: position.coords.longitude,
            status: 'checkin_realizado'
          };

          const dataVisita = {
            numero_visita: numeroVisita,
            roteiro_id: roteiroId || '',
            cliente_id: cliente.cliente_id,
            cliente_nome: cliente.cliente_nome,
            vendedor_id: vendedor.id,
            vendedor_nome: vendedor.nome,
            data_visita: agora.toISOString().split('T')[0],
            hora_checkin: agora.toTimeString().split(' ')[0],
            latitude_checkin: position.coords.latitude,
            longitude_checkin: position.coords.longitude,
            pedido_solicitado: null // Será atualizado depois
          };

          await createVisitaMutation.mutateAsync(dataVisitaRoteiro);
          await createVisitaRegistroMutation.mutateAsync(dataVisita);

          toast.success(`✅ Check-in realizado! Visita #${numeroVisita}`);
          
          // Salvar dados da localização para uso posterior
          setLocationData({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
          
          setVisitaNumero(numeroVisita);
          setCheckinRealizado(true);
          setLoading(false);
          
          // Marcar reagendamento como realizado se aplicável
          if (reagendamentoId) {
            await updateReagendamentoMutation.mutateAsync({
              id: reagendamentoId,
              data: { status: 'realizada' }
            });
          }
          
          // Invalidar queries e AGUARDAR para que VisitaDetalhes carregue com a visita criada
          await queryClient.invalidateQueries({ queryKey: ['visitasRoteiro'] });
          await queryClient.invalidateQueries({ queryKey: ['visitas'] });
          // A pergunta do pedido agora fica persistente dentro de VisitaDetalhes
          onSuccess();
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

  const handleNaoAtendimento = () => {
    setLoading(true);
    
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          setLocationData({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
          setLoading(false);
          setShowNaoAtendidoDialog(true);
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

  const finalizarPedidoInfo = async () => {
    // Validações
    if (pedidoSolicitado === false && !motivoSelecionado) {
      toast.error('Por favor, selecione o motivo da não solicitação');
      return;
    }

    const motivoObj = motivos.find(m => m.id === motivoSelecionado);

    // Buscar a visita que acabou de ser criada para atualizar com info do pedido
    const visitasRecentes = await base44.entities.Visita.filter({
      cliente_id: cliente.cliente_id,
      vendedor_id: vendedor.id,
      data_visita: new Date().toISOString().split('T')[0]
    });
    
    const visitaRecente = visitasRecentes[0];
    
    if (visitaRecente) {
      // Atualizar a visita com a informação do pedido
      await base44.entities.Visita.update(visitaRecente.id, {
        pedido_solicitado: pedidoSolicitado,
        motivo_nao_solicitacao_id: pedidoSolicitado === false ? motivoSelecionado : null,
        motivo_nao_solicitacao_descricao: pedidoSolicitado === false ? motivoObj?.descricao : null
      });
    }

    // Se era um reagendamento, marcar como realizado
    if (reagendamentoId) {
      await updateReagendamentoMutation.mutateAsync({
        id: reagendamentoId,
        data: { status: 'realizada' }
      });
    }

    // Se marcou reagendar quando não solicitou pedido
    if (pedidoSolicitado === false && reagendarNaoSolicitou) {
      const agora = new Date();
      const amanha = new Date(agora);
      amanha.setDate(amanha.getDate() + 1);
      
      await createReagendamentoMutation.mutateAsync({
        cliente_id: cliente.cliente_id,
        cliente_nome: cliente.cliente_nome,
        cliente_codigo: cliente.cliente_codigo,
        cliente_cidade: cliente.cliente_cidade,
        vendedor_id: vendedor.id,
        vendedor_nome: vendedor.nome,
        data_reagendamento: amanha.toISOString().split('T')[0],
        motivo_nao_atendimento: `Não solicitou pedido: ${motivoObj?.descricao}`,
        visita_original_id: visitaRecente?.numero_visita,
        status: 'pendente'
      });
      
      toast.success(`Informação do pedido salva e reagendado para amanhã!`);
    } else {
      toast.success(`Informação do pedido salva!`);
    }

    queryClient.invalidateQueries(['visitasRoteiro']);
    queryClient.invalidateQueries(['visitas']);
    setShowPedidoDialog(false);
    setCheckinRealizado(false);
    setPedidoSolicitado(null);
    setMotivoSelecionado('');
    setMotivoSearch('');
    setReagendarNaoSolicitou(false);
    onSuccess();
  };

  const finalizarNaoAtendimento = async () => {
    if (!motivoNaoAtendimento) {
      toast.error('Por favor, selecione o motivo do não atendimento');
      return;
    }

    const agora = new Date();
    const numeroVisita = `V${agora.getTime()}-${vendedor.id.substring(0, 8)}`;

    const motivoNaoAtendObj = motivosNaoAtend.find(m => m.id === motivoNaoAtendimento);

    // Criar registro na VisitaRoteiro
    const dataVisitaRoteiro = {
      roteiro_id: roteiroId || '',
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
      status: 'nao_atendido',
      motivo_nao_atendimento: motivoNaoAtendObj?.descricao
    };

    // Criar registro na Visita
    const dataVisita = {
      numero_visita: numeroVisita,
      roteiro_id: roteiroId || '',
      cliente_id: cliente.cliente_id,
      cliente_nome: cliente.cliente_nome,
      vendedor_id: vendedor.id,
      vendedor_nome: vendedor.nome,
      data_visita: agora.toISOString().split('T')[0],
      hora_checkin: agora.toTimeString().split(' ')[0],
      latitude_checkin: locationData.latitude,
      longitude_checkin: locationData.longitude,
      pedido_solicitado: null
    };

    await createVisitaMutation.mutateAsync(dataVisitaRoteiro);
    await createVisitaRegistroMutation.mutateAsync(dataVisita);

    // Se marcou reagendar para o dia seguinte
    if (reagendarDiaSeguinte) {
      const amanha = new Date(agora);
      amanha.setDate(amanha.getDate() + 1);
      
      await createReagendamentoMutation.mutateAsync({
        cliente_id: cliente.cliente_id,
        cliente_nome: cliente.cliente_nome,
        cliente_codigo: cliente.cliente_codigo,
        cliente_cidade: cliente.cliente_cidade,
        vendedor_id: vendedor.id,
        vendedor_nome: vendedor.nome,
        data_reagendamento: amanha.toISOString().split('T')[0],
        motivo_nao_atendimento: motivoNaoAtendObj?.descricao,
        visita_original_id: numeroVisita,
        status: 'pendente'
      });
      
      toast.success(`✅ Não atendimento registrado e reagendado para amanhã!`);
    } else {
      toast.success(`✅ Não atendimento registrado!`);
    }

    // Se era um reagendamento, marcar como realizado
    if (reagendamentoId) {
      await updateReagendamentoMutation.mutateAsync({
        id: reagendamentoId,
        data: { status: 'realizada' }
      });
    }

    // Invalidar queries e aguardar ANTES de chamar onSuccess
    await queryClient.invalidateQueries({ queryKey: ['visitasRoteiro'] });
    await queryClient.invalidateQueries({ queryKey: ['visitas'] });

    setShowNaoAtendidoDialog(false);
    setMotivoNaoAtendimento('');
    setMotivoNaoAtendSearch('');
    setReagendarDiaSeguinte(false);
    onSuccess();
  };

  // Dialog de Não Atendimento
  if (showNaoAtendidoDialog) {
    return (
      <div className="space-y-4 p-4 bg-red-50 rounded-lg border-2 border-red-200">
        <h3 className="text-base font-semibold text-red-800 flex items-center gap-2">
          <XCircle className="w-5 h-5" />
          Registrar Não Atendimento
        </h3>

        <div className="space-y-2">
          <Label className="text-sm text-red-700">Buscar motivo</Label>
          <Input
            placeholder="Digite para buscar..."
            value={motivoNaoAtendSearch}
            onChange={(e) => setMotivoNaoAtendSearch(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm text-red-700">Motivo do Não Atendimento *</Label>
          <Select value={motivoNaoAtendimento} onValueChange={setMotivoNaoAtendimento}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione o motivo..." />
            </SelectTrigger>
            <SelectContent>
              {motivosNaoAtendFiltrados.map(m => (
                <SelectItem key={m.id} value={m.id}>{m.descricao}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {motivoNaoAtendimento && (
          <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="reagendar-nao-atend"
                checked={reagendarDiaSeguinte}
                onCheckedChange={setReagendarDiaSeguinte}
              />
              <label htmlFor="reagendar-nao-atend" className="text-sm font-medium text-orange-900 cursor-pointer flex items-center gap-2">
                <CalendarPlus className="w-4 h-4" />
                Reagendar para o dia seguinte?
              </label>
            </div>
            {reagendarDiaSeguinte && (
              <p className="text-xs text-orange-600 mt-2">
                O cliente será adicionado ao roteiro de amanhã como uma exceção pontual.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setShowNaoAtendidoDialog(false);
              setMotivoNaoAtendimento('');
              setMotivoNaoAtendSearch('');
              setReagendarDiaSeguinte(false);
            }}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button
            onClick={finalizarNaoAtendimento}
            disabled={!motivoNaoAtendimento || createVisitaMutation.isPending || createVisitaRegistroMutation.isPending}
            className="flex-1 bg-gradient-to-r from-red-500 to-red-600"
          >
            Registrar Não Atendimento
          </Button>
        </div>
      </div>
    );
  }

  // Após check-in, a pergunta do pedido agora fica no VisitaDetalhes (persistente)
  // Não renderizar mais aqui - apenas redirecionar para VisitaDetalhes

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <Button 
        onClick={handleCheckin}
        disabled={loading}
        className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 text-sm"
      >
        <MapPin className="w-4 h-4 mr-1 sm:mr-2" />
        {loading ? 'Localizando...' : 'Check-in'}
      </Button>
      <Button 
        onClick={handleNaoAtendimento}
        disabled={loading}
        variant="outline"
        className="border-red-300 text-red-700 hover:bg-red-50 text-sm"
      >
        <XCircle className="w-4 h-4 mr-1 sm:mr-2" />
        <span className="hidden sm:inline">Não Atendimento</span>
        <span className="sm:hidden">N/A</span>
      </Button>
    </div>
  );
}

function PedidoInfoSection({ visitaRegistro, cliente, vendedor, permissaoUsuario }) {
  const queryClient = useQueryClient();
  const [pedidoSolicitado, setPedidoSolicitado] = useState(null);
  const [motivoSelecionado, setMotivoSelecionado] = useState('');
  const [motivoSearch, setMotivoSearch] = useState('');
  const [reagendarNaoSolicitou, setReagendarNaoSolicitou] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const { data: motivos = [] } = useQuery({
    queryKey: ['motivosNaoSolicitacao'],
    queryFn: () => base44.entities.MotivoNaoSolicitacao.list()
  });

  const motivosFiltrados = motivos.filter(m => 
    m.descricao?.toLowerCase().includes(motivoSearch.toLowerCase()) && m.status === 'ativo'
  );

  const salvarPedidoInfo = async () => {
    if (pedidoSolicitado === false && !motivoSelecionado) {
      toast.error('Por favor, selecione o motivo da não solicitação');
      return;
    }

    setSalvando(true);
    const motivoObj = motivos.find(m => m.id === motivoSelecionado);

    await base44.entities.Visita.update(visitaRegistro.id, {
      pedido_solicitado: pedidoSolicitado,
      motivo_nao_solicitacao_id: pedidoSolicitado === false ? motivoSelecionado : null,
      motivo_nao_solicitacao_descricao: pedidoSolicitado === false ? motivoObj?.descricao : null
    });

    if (pedidoSolicitado === false && reagendarNaoSolicitou) {
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      
      await base44.entities.VisitaReagendada.create({
        cliente_id: cliente.cliente_id,
        cliente_nome: cliente.cliente_nome,
        cliente_codigo: cliente.cliente_codigo,
        cliente_cidade: cliente.cliente_cidade,
        vendedor_id: vendedor.id,
        vendedor_nome: vendedor.nome,
        data_reagendamento: amanha.toISOString().split('T')[0],
        motivo_nao_atendimento: `Não solicitou pedido: ${motivoObj?.descricao}`,
        visita_original_id: visitaRegistro.numero_visita,
        status: 'pendente'
      });
      toast.success('Informação do pedido salva e reagendado para amanhã!');
    } else {
      toast.success('Informação do pedido salva!');
    }

    queryClient.invalidateQueries(['visitas']);
    queryClient.invalidateQueries(['visitasRoteiro']);
    queryClient.invalidateQueries(['visitasReagendadas']);
    setSalvando(false);
  };

  return (
    <div className="space-y-4 p-4 bg-blue-50 rounded-lg border-2 border-blue-200">
      <h3 className="text-base font-semibold text-blue-800 flex items-center gap-2">
        <CheckCircle className="w-5 h-5" />
        Informação do Pedido
      </h3>

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
        <div className="space-y-3 animate-in fade-in-50">
          <div className="space-y-2">
            <Label>Buscar motivo</Label>
            <Input
              placeholder="Digite para buscar..."
              value={motivoSearch}
              onChange={(e) => setMotivoSearch(e.target.value)}
            />
            <Label>Motivo da não solicitação *</Label>
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

          {motivoSelecionado && (
            <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="reagendar-nao-solicitou-det"
                  checked={reagendarNaoSolicitou}
                  onCheckedChange={setReagendarNaoSolicitou}
                />
                <label htmlFor="reagendar-nao-solicitou-det" className="text-sm font-medium text-orange-900 cursor-pointer flex items-center gap-2">
                  <CalendarPlus className="w-4 h-4" />
                  Reagendar para o dia seguinte?
                </label>
              </div>
              {reagendarNaoSolicitou && (
                <p className="text-xs text-orange-600 mt-2">
                  O cliente será adicionado ao roteiro de amanhã como uma exceção pontual.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {pedidoSolicitado !== null && (
        <Button
          onClick={salvarPedidoInfo}
          disabled={salvando || (pedidoSolicitado === false && !motivoSelecionado)}
          className="w-full bg-gradient-to-r from-blue-500 to-blue-600"
        >
          {salvando ? 'Salvando...' : 'Confirmar'}
        </Button>
      )}
    </div>
  );
}

function VisitaDetalhes({ visita, cliente, permissaoUsuario, vendedor }) {
  const [activeTab, setActiveTab] = useState('estoque');
  const queryClient = useQueryClient();
  const { data: visitaRegistro } = useQuery({
    queryKey: ['visitaRegistro', visita.id, cliente.cliente_id, visita.data_visita],
    queryFn: async () => {
      const resultados = await base44.entities.Visita.filter({ 
        cliente_id: cliente.cliente_id,
        data_visita: visita.data_visita 
      });
      // Pegar a mais recente
      const sorted = resultados.sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      return sorted[0] || null;
    },
    refetchInterval: (query) => query.state.data ? false : 3000,
    staleTime: 0,
  });

  // Verificar permissões
  const podeInformarEstoque = permissaoUsuario?.permissoes_visitas?.informar_estoque !== false;
  const podeInformarTrocas = permissaoUsuario?.permissoes_visitas?.informar_trocas !== false;
  const podeMarcarSolicitouPedido = permissaoUsuario?.permissoes_visitas?.marcar_solicitou_pedido !== false;

  // Pedido ainda não foi respondido se pedido_solicitado é null/undefined
  const pedidoPendente = visitaRegistro && (visitaRegistro.pedido_solicitado === null || visitaRegistro.pedido_solicitado === undefined);

  // Se não atendido, mostrar apenas o status
  if (visita.status === 'nao_atendido') {
    return (
      <div className="space-y-3">
        <Alert className="bg-red-50 border-red-200">
          <XCircle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-800">
            Cliente não atendido
            {visita.motivo_nao_atendimento && (
              <div className="mt-1 text-xs">
                <strong>Motivo:</strong> {visita.motivo_nao_atendimento}
              </div>
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (visita.status === 'concluida') {
    return (
      <div className="space-y-3">
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
          <AlertDescription className="text-green-800 text-xs sm:text-sm">
            Visita concluída em {new Date(visita.checkout_time).toLocaleString('pt-BR')}
            {visitaRegistro && (
              <div className="mt-1 text-xs">
                <strong>Nº:</strong> {visitaRegistro.numero_visita}
              </div>
            )}
          </AlertDescription>
        </Alert>
        <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm">
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
      <Alert className="bg-green-50 border-green-200">
        <CheckCircle className="w-4 h-4 text-green-600" />
        <AlertDescription className="text-green-800">
          Check-in realizado! Nº Visita: {visitaRegistro?.numero_visita || '...'}
        </AlertDescription>
      </Alert>

      {/* Seção de Pedido - fixa e persistente */}
      {podeMarcarSolicitouPedido && pedidoPendente && (
        <PedidoInfoSection 
          visitaRegistro={visitaRegistro} 
          cliente={cliente} 
          vendedor={vendedor}
          permissaoUsuario={permissaoUsuario} 
        />
      )}

      {/* Mostrar resultado do pedido se já respondido */}
      {visitaRegistro && visitaRegistro.pedido_solicitado === true && (
        <Alert className="bg-green-50 border-green-200">
          <AlertDescription className="text-green-800 text-sm">
            <strong>✅ Pedido solicitado</strong>
          </AlertDescription>
        </Alert>
      )}
      {visitaRegistro && visitaRegistro.pedido_solicitado === false && (
        <Alert className="bg-amber-50 border-amber-200">
          <AlertDescription className="text-amber-800 text-sm">
            <strong>Pedido não solicitado:</strong> {visitaRegistro.motivo_nao_solicitacao_descricao}
          </AlertDescription>
        </Alert>
      )}

      {(podeInformarEstoque || podeInformarTrocas) && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className={`grid w-full ${podeInformarEstoque && podeInformarTrocas ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {podeInformarEstoque && (
              <TabsTrigger value="estoque">
                <Package className="w-4 h-4 mr-2" />
                Estoque
              </TabsTrigger>
            )}
            {podeInformarTrocas && (
              <TabsTrigger value="trocas">
                <ArrowLeftRight className="w-4 h-4 mr-2" />
                Trocas
              </TabsTrigger>
            )}
          </TabsList>

          {podeInformarEstoque && (
            <TabsContent value="estoque">
              <EstoqueForm visitaId={visita.id} clienteId={cliente.cliente_id} clienteNome={cliente.cliente_nome} />
            </TabsContent>
          )}

          {podeInformarTrocas && (
            <TabsContent value="trocas">
              <TrocasForm visitaId={visita.id} clienteId={cliente.cliente_id} clienteNome={cliente.cliente_nome} />
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* Botão de finalizar - só habilitado se pedido já foi respondido ou não tem permissão de marcar pedido */}
      {(!podeMarcarSolicitouPedido || !pedidoPendente) ? (
        <CheckoutButton visitaId={visita.id} />
      ) : (
        <Button disabled className="w-full opacity-50">
          <CheckCircle className="w-4 h-4 mr-2" />
          Responda sobre o pedido para finalizar
        </Button>
      )}
    </div>
  );
}

function CheckoutButton({ visitaId }) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);
    
    if (!navigator.geolocation) {
      alert('Geolocalização não suportada pelo navegador');
      setLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const checkoutData = {
          checkout_time: new Date().toISOString(),
          checkout_latitude: position.coords.latitude,
          checkout_longitude: position.coords.longitude,
          status: 'concluida'
        };
        
        // AGUARDAR a atualização completar antes de invalidar
        await base44.entities.VisitaRoteiro.update(visitaId, checkoutData);
        
        // Pequeno delay para garantir que o banco persistiu
        await new Promise(r => setTimeout(r, 500));
        
        // Forçar refetch de TODAS as queries relacionadas e aguardar
        await queryClient.invalidateQueries({ queryKey: ['visitasRoteiro'] });
        await queryClient.refetchQueries({ queryKey: ['visitasRoteiro'] });
        await queryClient.invalidateQueries({ queryKey: ['visitaRoteiroDireta'] });
        await queryClient.invalidateQueries({ queryKey: ['visitas'] });
        await queryClient.invalidateQueries({ queryKey: ['visitaRegistro'] });
        
        toast.success('✅ Visita finalizada com sucesso!');
        setLoading(false);
      },
      (error) => {
        alert('Erro ao obter localização. Verifique as permissões do navegador.');
        setLoading(false);
      }
    );
  };

  return (
    <Button 
      onClick={handleCheckout}
      disabled={loading}
      className="w-full bg-gradient-to-r from-green-500 to-green-600"
    >
      <CheckCircle className="w-4 h-4 mr-2" />
      {loading ? 'Finalizando...' : 'Finalizar Visita (Check-out)'}
    </Button>
  );
}