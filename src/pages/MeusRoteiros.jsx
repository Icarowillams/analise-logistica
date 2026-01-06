import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Route, MapPin, Clock, CheckCircle, Package, ArrowLeftRight, Camera, Upload, Download } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function MeusRoteiros() {
  const [currentUser, setCurrentUser] = useState(null);
  const [vendedorAtual, setVendedorAtual] = useState(null);
  const [selectedDia, setSelectedDia] = useState('');

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

      <Tabs value={selectedDia || diasSemana[0].valor} onValueChange={setSelectedDia} className="w-full">
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

  const createVisitaMutation = useMutation({
    mutationFn: (data) => base44.entities.VisitaRoteiro.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['visitasRoteiro']);
      onSuccess();
    }
  });

  const handleCheckin = () => {
    setLoading(true);
    
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const data = {
            roteiro_id: roteiroId,
            vendedor_id: vendedor.id,
            vendedor_nome: vendedor.nome,
            cliente_id: cliente.cliente_id,
            cliente_nome: cliente.cliente_nome,
            cliente_codigo: cliente.cliente_codigo,
            cliente_cidade: cliente.cliente_cidade,
            data_visita: new Date().toISOString().split('T')[0],
            checkin_time: new Date().toISOString(),
            checkin_latitude: position.coords.latitude,
            checkin_longitude: position.coords.longitude,
            status: 'checkin_realizado'
          };
          
          createVisitaMutation.mutate(data);
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
      onClick={handleCheckin}
      disabled={loading || createVisitaMutation.isPending}
      className="w-full bg-gradient-to-r from-blue-500 to-blue-600"
    >
      <MapPin className="w-4 h-4 mr-2" />
      {loading || createVisitaMutation.isPending ? 'Obtendo localização...' : 'Fazer Check-in'}
    </Button>
  );
}

function VisitaDetalhes({ visita, cliente }) {
  const [activeTab, setActiveTab] = useState('estoque');

  if (visita.status === 'concluida') {
    return (
      <div className="space-y-3">
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <AlertDescription className="text-green-800">
            Visita concluída em {new Date(visita.checkout_time).toLocaleString('pt-BR')}
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
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Alert className="bg-blue-50 border-blue-200">
        <Clock className="w-4 h-4 text-blue-600" />
        <AlertDescription className="text-blue-800">
          Check-in realizado às {new Date(visita.checkin_time).toLocaleTimeString('pt-BR')}
        </AlertDescription>
      </Alert>

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
          <EstoqueForm visitaId={visita.id} clienteId={cliente.cliente_id} />
        </TabsContent>

        <TabsContent value="trocas">
          <TrocasForm visitaId={visita.id} clienteId={cliente.cliente_id} />
        </TabsContent>
      </Tabs>

      <CheckoutButton visitaId={visita.id} />
    </div>
  );
}

function EstoqueForm({ visitaId, clienteId }) {
  return <div>Formulário de Estoque (em desenvolvimento)</div>;
}

function TrocasForm({ visitaId, clienteId }) {
  return <div>Formulário de Trocas (em desenvolvimento)</div>;
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