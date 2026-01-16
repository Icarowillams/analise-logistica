import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Route, MapPin, Clock, CheckCircle, XCircle, Play, ChevronRight, 
  User, ShoppingCart, Package, ArrowLeftRight, AlertTriangle, ArrowLeft
} from 'lucide-react';
import EstoqueForm from '@/components/MeusRoteiros/EstoqueForm';
import TrocasForm from '@/components/MeusRoteiros/TrocasForm';

export default function MeusRoteiros() {
  const [clienteSelecionado, setClienteSelecionado] = useState(null);
  const [visitaAtual, setVisitaAtual] = useState(null);
  const [tabVisita, setTabVisita] = useState('pedido');
  const [pedidoSolicitado, setPedidoSolicitado] = useState(null);
  const [motivoNaoPedido, setMotivoNaoPedido] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [naoAtendido, setNaoAtendido] = useState(false);
  const [motivoNaoAtendimento, setMotivoNaoAtendimento] = useState('');

  const queryClient = useQueryClient();

  // Buscar usuário atual e seu registro de vendedor
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const vendedorAtual = useMemo(() => {
    if (!currentUser || !vendedores.length) return null;
    return vendedores.find(v => v.email?.toLowerCase() === currentUser.email?.toLowerCase());
  }, [currentUser, vendedores]);

  // Buscar roteiros do vendedor atual
  const { data: roteiros = [] } = useQuery({
    queryKey: ['roteiros'],
    queryFn: () => base44.entities.Roteiro.list()
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: visitasRoteiro = [] } = useQuery({
    queryKey: ['visitasRoteiro'],
    queryFn: () => base44.entities.VisitaRoteiro.list('-created_date', 1000)
  });

  const { data: motivosNaoPedido = [] } = useQuery({
    queryKey: ['motivosNaoSolicitacao'],
    queryFn: () => base44.entities.MotivoNaoSolicitacao.list()
  });

  const { data: motivosNaoAtend = [] } = useQuery({
    queryKey: ['motivosNaoAtendimento'],
    queryFn: () => base44.entities.MotivoNaoAtendimento.list()
  });

  // Mapear clientes
  const clientesMap = useMemo(() => {
    return clientes.reduce((acc, c) => {
      acc[c.id] = c;
      return acc;
    }, {});
  }, [clientes]);

  // Dias da semana
  const diasSemanaMap = {
    0: 'domingo',
    1: 'segunda-feira',
    2: 'terca-feira',
    3: 'quarta-feira',
    4: 'quinta-feira',
    5: 'sexta-feira',
    6: 'sabado'
  };

  const hoje = new Date();
  const diaSemanaHoje = diasSemanaMap[hoje.getDay()];
  const dataHoje = hoje.toISOString().split('T')[0];

  const [diaSelecionado, setDiaSelecionado] = useState(diaSemanaHoje);

  const diasSemanaLista = [
    { valor: 'segunda-feira', label: 'Segunda' },
    { valor: 'terca-feira', label: 'Terça' },
    { valor: 'quarta-feira', label: 'Quarta' },
    { valor: 'quinta-feira', label: 'Quinta' },
    { valor: 'sexta-feira', label: 'Sexta' },
    { valor: 'sabado', label: 'Sábado' },
    { valor: 'domingo', label: 'Domingo' }
  ];

  // Todos os roteiros do vendedor atual
  const meusRoteiros = useMemo(() => {
    if (!vendedorAtual) return [];
    return roteiros.filter(r => r.vendedor_id === vendedorAtual.id);
  }, [roteiros, vendedorAtual]);

  // Roteiros do dia selecionado
  const meusRoteirosHoje = useMemo(() => {
    return meusRoteiros.filter(r => r.dia_semana === diaSelecionado);
  }, [meusRoteiros, diaSelecionado]);

  // Clientes do roteiro do dia selecionado com status de visita
  const clientesDoRoteiro = useMemo(() => {
    const clientesIds = new Set();
    meusRoteirosHoje.forEach(r => {
      (r.clientes_ids || []).forEach(id => clientesIds.add(id));
    });

    return Array.from(clientesIds).map(id => {
      const cliente = clientesMap[id];
      if (!cliente) return null;

      // Verificar se já foi visitado hoje (apenas se for o dia atual)
      const visitaHoje = diaSelecionado === diaSemanaHoje 
        ? visitasRoteiro.find(v => 
            v.cliente_id === id && 
            v.data_visita === dataHoje &&
            v.vendedor_id === vendedorAtual?.id
          )
        : null;

      return {
        ...cliente,
        visitaHoje,
        status: visitaHoje?.status || 'pendente'
      };
    }).filter(Boolean);
  }, [meusRoteirosHoje, clientesMap, visitasRoteiro, dataHoje, vendedorAtual, diaSelecionado, diaSemanaHoje]);

  // Criar visita
  const createVisitaMutation = useMutation({
    mutationFn: (data) => base44.entities.VisitaRoteiro.create(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries(['visitasRoteiro']);
      setVisitaAtual(data);
    }
  });

  // Atualizar visita
  const updateVisitaMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.VisitaRoteiro.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['visitasRoteiro']);
    }
  });

  // Iniciar visita (check-in)
  const handleIniciarVisita = async (cliente) => {
    // Verificar se já existe visita em andamento
    const visitaExistente = visitasRoteiro.find(v => 
      v.cliente_id === cliente.id && 
      v.data_visita === dataHoje &&
      v.vendedor_id === vendedorAtual?.id
    );

    if (visitaExistente) {
      setVisitaAtual(visitaExistente);
      setClienteSelecionado(cliente);
      setPedidoSolicitado(visitaExistente.pedido_solicitado);
      setMotivoNaoPedido(visitaExistente.motivo_nao_pedido || '');
      setObservacoes(visitaExistente.observacoes || '');
      setNaoAtendido(visitaExistente.status === 'nao_atendido');
      setMotivoNaoAtendimento(visitaExistente.motivo_nao_atendimento || '');
      return;
    }

    // Obter localização
    let latitude = null;
    let longitude = null;
    
    if (navigator.geolocation) {
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000
          });
        });
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
      } catch (e) {
        console.log('Não foi possível obter localização');
      }
    }

    const roteiro = meusRoteirosHoje.find(r => r.clientes_ids?.includes(cliente.id));

    const visitaData = {
      roteiro_id: roteiro?.id || '',
      cliente_id: cliente.id,
      cliente_nome: cliente.razao_social || cliente.nome_fantasia,
      vendedor_id: vendedorAtual?.id || '',
      vendedor_nome: vendedorAtual?.nome || '',
      data_visita: dataHoje,
      checkin_time: new Date().toISOString(),
      latitude_checkin: latitude,
      longitude_checkin: longitude,
      status: 'em_andamento'
    };

    createVisitaMutation.mutate(visitaData);
    setClienteSelecionado(cliente);
    setPedidoSolicitado(null);
    setMotivoNaoPedido('');
    setObservacoes('');
    setNaoAtendido(false);
    setMotivoNaoAtendimento('');
  };

  // Finalizar visita (check-out)
  const handleFinalizarVisita = async () => {
    if (!visitaAtual) return;

    // Validar campos obrigatórios
    if (naoAtendido && !motivoNaoAtendimento) {
      alert('Informe o motivo do não atendimento');
      return;
    }

    if (!naoAtendido && pedidoSolicitado === null) {
      alert('Informe se o pedido foi solicitado');
      return;
    }

    if (!naoAtendido && pedidoSolicitado === false && !motivoNaoPedido) {
      alert('Informe o motivo de não solicitação do pedido');
      return;
    }

    const updateData = {
      checkout_time: new Date().toISOString(),
      status: naoAtendido ? 'nao_atendido' : 'concluida',
      pedido_solicitado: naoAtendido ? null : pedidoSolicitado,
      motivo_nao_pedido: pedidoSolicitado === false ? motivoNaoPedido : null,
      motivo_nao_atendimento: naoAtendido ? motivoNaoAtendimento : null,
      observacoes: observacoes
    };

    await updateVisitaMutation.mutateAsync({ id: visitaAtual.id, data: updateData });
    
    setClienteSelecionado(null);
    setVisitaAtual(null);
    setPedidoSolicitado(null);
    setMotivoNaoPedido('');
    setObservacoes('');
    setNaoAtendido(false);
    setMotivoNaoAtendimento('');
  };

  const handleFecharModal = () => {
    // Salvar dados antes de voltar se visita estiver em andamento
    if (visitaAtual && visitaAtual.status === 'em_andamento') {
      updateVisitaMutation.mutate({
        id: visitaAtual.id,
        data: {
          pedido_solicitado: pedidoSolicitado,
          motivo_nao_pedido: motivoNaoPedido || null,
          motivo_nao_atendimento: motivoNaoAtendimento || null,
          observacoes: observacoes || null
        }
      });
    }
    setClienteSelecionado(null);
    setVisitaAtual(null);
  };

  const getDiaLabel = (valor) => {
    const labels = {
      'domingo': 'Domingo',
      'segunda-feira': 'Segunda-feira',
      'terca-feira': 'Terça-feira',
      'quarta-feira': 'Quarta-feira',
      'quinta-feira': 'Quinta-feira',
      'sexta-feira': 'Sexta-feira',
      'sabado': 'Sábado'
    };
    return labels[valor] || valor;
  };

  // Estatísticas
  const stats = useMemo(() => {
    const total = clientesDoRoteiro.length;
    const visitados = clientesDoRoteiro.filter(c => c.status === 'concluida').length;
    const naoAtendidos = clientesDoRoteiro.filter(c => c.status === 'nao_atendido').length;
    const pendentes = total - visitados - naoAtendidos;
    
    return { total, visitados, naoAtendidos, pendentes };
  }, [clientesDoRoteiro]);

  if (!vendedorAtual) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Acesso Restrito</h2>
          <p className="text-slate-500">
            Seu usuário não está vinculado a um funcionário cadastrado no sistema.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg">
          <Route className="h-6 w-6 text-neutral-900" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Meus Roteiros</h1>
          <p className="text-slate-500">
            {getDiaLabel(diaSemanaHoje)} - {hoje.toLocaleDateString('pt-BR')}
          </p>
        </div>
      </div>

      {/* Informações do Vendedor */}
      <Card className="border-0 shadow-lg bg-gradient-to-r from-amber-50 to-yellow-50">
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-amber-500 flex items-center justify-center">
              <User className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-slate-900">{vendedorAtual.nome}</p>
              <p className="text-sm text-slate-500">{vendedorAtual.email}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Seletor de Dia da Semana */}
      <Card className="border-0 shadow-lg">
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-2">
            {diasSemanaLista.map(dia => (
              <Button
                key={dia.valor}
                variant={diaSelecionado === dia.valor ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDiaSelecionado(dia.valor)}
                className={diaSelecionado === dia.valor 
                  ? 'bg-gradient-to-r from-amber-500 to-orange-600' 
                  : dia.valor === diaSemanaHoje ? 'border-amber-400 text-amber-700' : ''
                }
              >
                {dia.label}
                {dia.valor === diaSemanaHoje && <span className="ml-1 text-xs">(Hoje)</span>}
              </Button>
            ))}
          </div>
          <p className="text-sm text-slate-500 mt-2">
            Total de roteiros cadastrados: {meusRoteiros.length} | 
            Roteiros para {diasSemanaLista.find(d => d.valor === diaSelecionado)?.label}: {meusRoteirosHoje.length}
          </p>
        </CardContent>
      </Card>

      {/* Estatísticas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-lg">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-slate-900">{stats.total}</div>
            <div className="text-sm text-slate-500">Total de Clientes</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-green-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-700">{stats.visitados}</div>
            <div className="text-sm text-green-600">Visitados</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-red-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-red-700">{stats.naoAtendidos}</div>
            <div className="text-sm text-red-600">Não Atendidos</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-lg bg-amber-50">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-amber-700">{stats.pendentes}</div>
            <div className="text-sm text-amber-600">Pendentes</div>
          </CardContent>
        </Card>
      </div>

      {/* Lista de Clientes ou Tela de Visita */}
      {!clienteSelecionado ? (
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="w-5 h-5 text-amber-500" />
              Clientes do Roteiro ({clientesDoRoteiro.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {clientesDoRoteiro.length === 0 ? (
              <div className="text-center py-12">
                <Route className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">Nenhum roteiro programado para este dia</p>
              </div>
            ) : (
              <div className="space-y-3">
                {clientesDoRoteiro.map((cliente) => (
                  <div
                    key={cliente.id}
                    className={`p-4 rounded-lg border transition-all ${
                      cliente.status === 'concluida' 
                        ? 'bg-green-50 border-green-200' 
                        : cliente.status === 'nao_atendido'
                        ? 'bg-red-50 border-red-200'
                        : cliente.status === 'em_andamento'
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-white border-slate-200 hover:border-amber-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-900">
                            {cliente.razao_social || cliente.nome_fantasia}
                          </p>
                          {cliente.status === 'concluida' && (
                            <Badge className="bg-green-500 text-white">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Visitado
                            </Badge>
                          )}
                          {cliente.status === 'nao_atendido' && (
                            <Badge className="bg-red-500 text-white">
                              <XCircle className="w-3 h-3 mr-1" />
                              Não Atendido
                            </Badge>
                          )}
                          {cliente.status === 'em_andamento' && (
                            <Badge className="bg-blue-500 text-white">
                              <Clock className="w-3 h-3 mr-1" />
                              Em Andamento
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-slate-500 mt-1">
                          {cliente.codigo} • {cliente.cidade} - {cliente.bairro}
                        </p>
                        {cliente.visitaHoje?.checkin_time && (
                          <p className="text-xs text-slate-400 mt-1">
                            Check-in: {new Date(cliente.visitaHoje.checkin_time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            {cliente.visitaHoje.checkout_time && (
                              <> • Check-out: {new Date(cliente.visitaHoje.checkout_time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</>
                            )}
                          </p>
                        )}
                      </div>
                      <Button
                        onClick={() => handleIniciarVisita(cliente)}
                        className={
                          cliente.status === 'concluida' || cliente.status === 'nao_atendido'
                            ? 'bg-slate-400'
                            : cliente.status === 'em_andamento'
                            ? 'bg-blue-500 hover:bg-blue-600'
                            : 'bg-gradient-to-r from-amber-500 to-orange-600'
                        }
                        size="sm"
                      >
                        {cliente.status === 'concluida' || cliente.status === 'nao_atendido' ? (
                          <>Ver</>
                        ) : cliente.status === 'em_andamento' ? (
                          <>Continuar</>
                        ) : (
                          <>
                            <Play className="w-4 h-4 mr-1" />
                            Iniciar
                          </>
                        )}
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        /* Tela de Check-in/Visita */
        <Card className="border-0 shadow-lg">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <Button 
                variant="ghost" 
                size="icon"
                onClick={handleFecharModal}
                className="shrink-0"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-amber-500" />
                  {clienteSelecionado.razao_social || clienteSelecionado.nome_fantasia}
                </CardTitle>
                <p className="text-sm text-slate-500">
                  {clienteSelecionado.codigo} • {clienteSelecionado.cidade}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Info do Cliente */}
            <div className="p-3 bg-slate-50 rounded-lg text-sm">
              <p><strong>Endereço:</strong> {clienteSelecionado.endereco}, {clienteSelecionado.numero} - {clienteSelecionado.bairro}</p>
              <p><strong>Cidade:</strong> {clienteSelecionado.cidade} - {clienteSelecionado.estado}</p>
            </div>

            {/* Status da visita */}
            {visitaAtual && (
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center gap-2 text-blue-700">
                  <Clock className="w-4 h-4" />
                  <span className="font-medium">
                    Visita iniciada às {new Date(visitaAtual.checkin_time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            )}

            {/* Tabs da Visita */}
            <Tabs value={tabVisita} onValueChange={setTabVisita} className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="pedido" className="flex items-center gap-1">
                  <ShoppingCart className="w-4 h-4" />
                  <span className="hidden sm:inline">Pedido</span>
                </TabsTrigger>
                <TabsTrigger value="estoque" className="flex items-center gap-1">
                  <Package className="w-4 h-4" />
                  <span className="hidden sm:inline">Estoque</span>
                </TabsTrigger>
                <TabsTrigger value="trocas" className="flex items-center gap-1">
                  <ArrowLeftRight className="w-4 h-4" />
                  <span className="hidden sm:inline">Trocas</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="pedido" className="space-y-4 mt-4">
                {/* Não Atendimento */}
                <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="nao-atendido"
                      checked={naoAtendido}
                      onCheckedChange={(checked) => {
                        setNaoAtendido(checked);
                        if (checked) {
                          setPedidoSolicitado(null);
                          setMotivoNaoPedido('');
                        }
                      }}
                      disabled={visitaAtual?.status === 'concluida' || visitaAtual?.status === 'nao_atendido'}
                    />
                    <label htmlFor="nao-atendido" className="text-sm font-medium text-red-900 cursor-pointer">
                      Cliente não foi atendido
                    </label>
                  </div>
                  
                  {naoAtendido && (
                    <div className="mt-3">
                      <Label className="text-xs text-red-700">Motivo do Não Atendimento *</Label>
                      <Select 
                        value={motivoNaoAtendimento} 
                        onValueChange={setMotivoNaoAtendimento}
                        disabled={visitaAtual?.status === 'concluida' || visitaAtual?.status === 'nao_atendido'}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Selecione o motivo" />
                        </SelectTrigger>
                        <SelectContent>
                          {motivosNaoAtend.filter(m => m.status === 'ativo').map(m => (
                            <SelectItem key={m.id} value={m.descricao}>{m.descricao}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {/* Pedido Solicitado */}
                {!naoAtendido && (
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm font-medium">O cliente solicitou pedido? *</Label>
                      <div className="flex gap-3 mt-2">
                        <Button
                          type="button"
                          variant={pedidoSolicitado === true ? 'default' : 'outline'}
                          className={pedidoSolicitado === true ? 'bg-green-500 hover:bg-green-600' : ''}
                          onClick={() => {
                            setPedidoSolicitado(true);
                            setMotivoNaoPedido('');
                          }}
                          disabled={visitaAtual?.status === 'concluida' || visitaAtual?.status === 'nao_atendido'}
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Sim
                        </Button>
                        <Button
                          type="button"
                          variant={pedidoSolicitado === false ? 'default' : 'outline'}
                          className={pedidoSolicitado === false ? 'bg-red-500 hover:bg-red-600' : ''}
                          onClick={() => setPedidoSolicitado(false)}
                          disabled={visitaAtual?.status === 'concluida' || visitaAtual?.status === 'nao_atendido'}
                        >
                          <XCircle className="w-4 h-4 mr-2" />
                          Não
                        </Button>
                      </div>
                    </div>

                    {pedidoSolicitado === false && (
                      <div>
                        <Label className="text-sm font-medium">Motivo de Não Solicitação *</Label>
                        <Select 
                          value={motivoNaoPedido} 
                          onValueChange={setMotivoNaoPedido}
                          disabled={visitaAtual?.status === 'concluida' || visitaAtual?.status === 'nao_atendido'}
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Selecione o motivo" />
                          </SelectTrigger>
                          <SelectContent>
                            {motivosNaoPedido.filter(m => m.status === 'ativo').map(m => (
                              <SelectItem key={m.id} value={m.descricao}>{m.descricao}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}

                {/* Observações */}
                <div>
                  <Label className="text-sm font-medium">Observações</Label>
                  <Textarea
                    value={observacoes}
                    onChange={(e) => setObservacoes(e.target.value)}
                    placeholder="Observações da visita..."
                    className="mt-1"
                    rows={3}
                    disabled={visitaAtual?.status === 'concluida' || visitaAtual?.status === 'nao_atendido'}
                  />
                </div>
              </TabsContent>

              <TabsContent value="estoque">
                {visitaAtual ? (
                  <EstoqueForm
                    visitaId={visitaAtual.id}
                    clienteId={clienteSelecionado.id}
                    clienteNome={clienteSelecionado.razao_social || clienteSelecionado.nome_fantasia}
                  />
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    Inicie a visita para registrar o estoque
                  </div>
                )}
              </TabsContent>

              <TabsContent value="trocas">
                {visitaAtual ? (
                  <TrocasForm
                    visitaId={visitaAtual.id}
                    clienteId={clienteSelecionado.id}
                    clienteNome={clienteSelecionado.razao_social || clienteSelecionado.nome_fantasia}
                  />
                ) : (
                  <div className="text-center py-8 text-slate-500">
                    Inicie a visita para registrar as trocas
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {/* Botão Finalizar */}
            {visitaAtual && visitaAtual.status !== 'concluida' && visitaAtual.status !== 'nao_atendido' && (
              <Button
                onClick={handleFinalizarVisita}
                disabled={updateVisitaMutation.isPending}
                className="w-full bg-gradient-to-r from-green-500 to-emerald-600 h-12 text-lg"
              >
                <CheckCircle className="w-5 h-5 mr-2" />
                {updateVisitaMutation.isPending ? 'Finalizando...' : 'Finalizar Visita'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}