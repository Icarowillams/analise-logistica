import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Users, Calendar, Eye, Image, MapPin, CheckCircle, XCircle, 
  AlertTriangle, Clock, Filter
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default marker icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const checkinIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const checkoutIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

export default function PainelVisitas() {
  const [vendedorSelecionado, setVendedorSelecionado] = useState('');
  const [diaSelecionado, setDiaSelecionado] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  
  // Modal states
  const [showMapModal, setShowMapModal] = useState(false);
  const [showPhotosModal, setShowPhotosModal] = useState(false);
  const [selectedClienteVisita, setSelectedClienteVisita] = useState(null);

  const diasSemana = [
    { valor: 'segunda-feira', label: 'Segunda' },
    { valor: 'terca-feira', label: 'Terça' },
    { valor: 'quarta-feira', label: 'Quarta' },
    { valor: 'quinta-feira', label: 'Quinta' },
    { valor: 'sexta-feira', label: 'Sexta' },
    { valor: 'sabado', label: 'Sábado' },
    { valor: 'domingo', label: 'Domingo' }
  ];

  useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: roteiros = [] } = useQuery({
    queryKey: ['roteiros'],
    queryFn: () => base44.entities.Roteiro.list()
  });

  const { data: visitasRoteiro = [] } = useQuery({
    queryKey: ['visitasRoteiro'],
    queryFn: () => base44.entities.VisitaRoteiro.list('-data_visita', 5000)
  });

  const { data: visitas = [] } = useQuery({
    queryKey: ['visitas'],
    queryFn: () => base44.entities.Visita.list('-data_visita', 5000)
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: estoques = [] } = useQuery({
    queryKey: ['estoquesVisita'],
    queryFn: () => base44.entities.EstoqueVisita.list()
  });

  const { data: trocas = [] } = useQuery({
    queryKey: ['trocasVisita'],
    queryFn: () => base44.entities.TrocaVisita.list()
  });

  // Mapas auxiliares
  const clientesMap = useMemo(() => clientes.reduce((acc, c) => { acc[c.id] = c; return acc; }, {}), [clientes]);
  const vendedoresMap = useMemo(() => vendedores.reduce((acc, v) => { acc[v.id] = v; return acc; }, {}), [vendedores]);

  // Vendedores ativos
  const vendedoresAtivos = useMemo(() => 
    vendedores.filter(v => v.status === 'ativo'), 
  [vendedores]);

  // Roteiros filtrados por vendedor
  const roteirosDoVendedor = useMemo(() => {
    if (!vendedorSelecionado) return [];
    return roteiros.filter(r => r.vendedor_id === vendedorSelecionado);
  }, [roteiros, vendedorSelecionado]);

  // Dias disponíveis para o vendedor selecionado
  const diasDisponiveis = useMemo(() => {
    const dias = new Set(roteirosDoVendedor.map(r => r.dia_semana));
    return diasSemana.filter(d => dias.has(d.valor));
  }, [roteirosDoVendedor]);

  // Roteiro selecionado
  const roteiroSelecionado = useMemo(() => {
    if (!vendedorSelecionado || !diaSelecionado) return null;
    return roteirosDoVendedor.find(r => r.dia_semana === diaSelecionado);
  }, [roteirosDoVendedor, diaSelecionado]);

  // Data de hoje formatada
  const hoje = new Date().toISOString().split('T')[0];

  // Clientes do roteiro com status de visita
  const clientesDoRoteiroComStatus = useMemo(() => {
    if (!roteiroSelecionado) return { visitados: [], naoVisitados: [] };

    const clientesDoRoteiro = roteiroSelecionado.clientes_detalhes || [];
    const visitados = [];
    const naoVisitados = [];

    clientesDoRoteiro.forEach((clienteRoteiro, idx) => {
      const clienteCompleto = clientesMap[clienteRoteiro.cliente_id];
      
      // Buscar visita do cliente pelo vendedor (qualquer data recente)
      const visitaRoteiro = visitasRoteiro.find(v => 
        v.cliente_id === clienteRoteiro.cliente_id && 
        v.vendedor_id === vendedorSelecionado &&
        v.roteiro_id === roteiroSelecionado.id
      );

      const visitaRegistro = visitas.find(v =>
        v.cliente_id === clienteRoteiro.cliente_id &&
        v.vendedor_id === vendedorSelecionado
      );

      const clienteInfo = {
        ...clienteRoteiro,
        ordem: idx + 1,
        cliente: clienteCompleto,
        visitaRoteiro,
        visitaRegistro,
        status: visitaRoteiro?.status || 'pendente',
        motivoNaoAtendimento: visitaRoteiro?.motivo_nao_atendimento,
        pedidoSolicitado: visitaRegistro?.pedido_solicitado,
        motivoNaoSolicitacao: visitaRegistro?.motivo_nao_solicitacao_descricao
      };

      if (visitaRoteiro && (visitaRoteiro.status === 'checkin_realizado' || visitaRoteiro.status === 'concluida')) {
        visitados.push(clienteInfo);
      } else if (visitaRoteiro && visitaRoteiro.status === 'nao_atendido') {
        naoVisitados.push({ ...clienteInfo, tipoNaoVisita: 'nao_atendido' });
      } else {
        naoVisitados.push({ ...clienteInfo, tipoNaoVisita: 'sem_registro' });
      }
    });

    return { visitados, naoVisitados };
  }, [roteiroSelecionado, visitasRoteiro, visitas, clientesMap, vendedorSelecionado]);

  // Abrir modal de mapa
  const handleOpenMap = (clienteInfo) => {
    setSelectedClienteVisita(clienteInfo);
    setShowMapModal(true);
  };

  // Abrir modal de fotos
  const handleOpenPhotos = (clienteInfo) => {
    setSelectedClienteVisita(clienteInfo);
    setShowPhotosModal(true);
  };

  // Fotos do cliente selecionado
  const fotosDoCliente = useMemo(() => {
    if (!selectedClienteVisita?.visitaRoteiro?.id) return { estoque: [], trocas: [] };
    
    const visitaId = selectedClienteVisita.visitaRoteiro.id;
    const fotosEstoque = estoques.filter(e => e.visita_id === visitaId && e.foto_url);
    const fotosTrocas = trocas.filter(t => t.visita_id === visitaId && t.foto_url);
    
    return { estoque: fotosEstoque, trocas: fotosTrocas };
  }, [selectedClienteVisita, estoques, trocas]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-xl hexagon-shape">
          <Users className="h-7 w-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Painel de Visitas</h1>
          <p className="text-slate-500 mt-1">Acompanhamento detalhado das visitas por funcionário</p>
        </div>
      </div>

      {/* Filtros */}
      <Card className="border-0 shadow-lg">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Filter className="w-5 h-5 text-slate-500" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">Funcionário</label>
              <Select value={vendedorSelecionado} onValueChange={(v) => { setVendedorSelecionado(v); setDiaSelecionado(''); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o funcionário" />
                </SelectTrigger>
                <SelectContent>
                  {vendedoresAtivos.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">Dia da Semana</label>
              <Select value={diaSelecionado} onValueChange={setDiaSelecionado} disabled={!vendedorSelecionado}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o dia" />
                </SelectTrigger>
                <SelectContent>
                  {diasDisponiveis.map(d => (
                    <SelectItem key={d.valor} value={d.valor}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resultado */}
      {roteiroSelecionado ? (
        <div className="space-y-6">
          {/* Resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-0 shadow-md bg-gradient-to-br from-green-50 to-emerald-50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-500/20">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Visitados</p>
                    <p className="text-lg font-bold text-slate-900">{clientesDoRoteiroComStatus.visitados.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-md bg-gradient-to-br from-red-50 to-rose-50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-red-500/20">
                    <XCircle className="w-5 h-5 text-red-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Não Atendidos</p>
                    <p className="text-lg font-bold text-slate-900">
                      {clientesDoRoteiroComStatus.naoVisitados.filter(c => c.tipoNaoVisita === 'nao_atendido').length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-md bg-gradient-to-br from-amber-50 to-yellow-50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-500/20">
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Sem Registro</p>
                    <p className="text-lg font-bold text-slate-900">
                      {clientesDoRoteiroComStatus.naoVisitados.filter(c => c.tipoNaoVisita === 'sem_registro').length}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-md bg-gradient-to-br from-blue-50 to-indigo-50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/20">
                    <Calendar className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Total Roteiro</p>
                    <p className="text-lg font-bold text-slate-900">{roteiroSelecionado.clientes_detalhes?.length || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Clientes Visitados */}
          <Card className="border-0 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-t-xl">
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5" />
                Clientes Visitados ({clientesDoRoteiroComStatus.visitados.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {clientesDoRoteiroComStatus.visitados.length === 0 ? (
                <p className="text-slate-500 text-center py-4">Nenhum cliente visitado ainda</p>
              ) : (
                <div className="space-y-3">
                  {clientesDoRoteiroComStatus.visitados.map((clienteInfo) => (
                    <ClienteVisitadoCard 
                      key={clienteInfo.cliente_id}
                      clienteInfo={clienteInfo}
                      onOpenMap={() => handleOpenMap(clienteInfo)}
                      onOpenPhotos={() => handleOpenPhotos(clienteInfo)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Clientes Não Visitados */}
          <Card className="border-0 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-t-xl">
              <CardTitle className="flex items-center gap-2">
                <XCircle className="w-5 h-5" />
                Clientes Não Visitados ({clientesDoRoteiroComStatus.naoVisitados.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {clientesDoRoteiroComStatus.naoVisitados.length === 0 ? (
                <p className="text-slate-500 text-center py-4">Todos os clientes foram visitados!</p>
              ) : (
                <div className="space-y-3">
                  {clientesDoRoteiroComStatus.naoVisitados.map((clienteInfo) => (
                    <ClienteNaoVisitadoCard 
                      key={clienteInfo.cliente_id}
                      clienteInfo={clienteInfo}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="border-0 shadow-lg">
          <CardContent className="p-12 text-center">
            <Users className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-lg text-slate-500">Selecione um funcionário e dia da semana para visualizar as visitas</p>
          </CardContent>
        </Card>
      )}

      {/* Modal de Mapa */}
      <Dialog open={showMapModal} onOpenChange={setShowMapModal}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-blue-600" />
              Localização - {selectedClienteVisita?.cliente?.nome_fantasia || selectedClienteVisita?.cliente_nome}
            </DialogTitle>
          </DialogHeader>
          <div className="h-[400px] rounded-lg overflow-hidden">
            {selectedClienteVisita?.visitaRoteiro && (
              <MapContainer
                center={[
                  selectedClienteVisita.visitaRoteiro.checkin_latitude || -8.05,
                  selectedClienteVisita.visitaRoteiro.checkin_longitude || -34.9
                ]}
                zoom={15}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; OpenStreetMap'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {selectedClienteVisita.visitaRoteiro.checkin_latitude && (
                  <Marker
                    position={[
                      selectedClienteVisita.visitaRoteiro.checkin_latitude,
                      selectedClienteVisita.visitaRoteiro.checkin_longitude
                    ]}
                    icon={checkinIcon}
                  >
                    <Popup>
                      <strong>Check-in</strong><br />
                      {new Date(selectedClienteVisita.visitaRoteiro.checkin_time).toLocaleString('pt-BR')}
                    </Popup>
                  </Marker>
                )}
                {selectedClienteVisita.visitaRoteiro.checkout_latitude && (
                  <Marker
                    position={[
                      selectedClienteVisita.visitaRoteiro.checkout_latitude,
                      selectedClienteVisita.visitaRoteiro.checkout_longitude
                    ]}
                    icon={checkoutIcon}
                  >
                    <Popup>
                      <strong>Check-out</strong><br />
                      {new Date(selectedClienteVisita.visitaRoteiro.checkout_time).toLocaleString('pt-BR')}
                    </Popup>
                  </Marker>
                )}
              </MapContainer>
            )}
          </div>
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-green-500"></div>
              <span>Check-in</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-red-500"></div>
              <span>Check-out</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de Fotos */}
      <Dialog open={showPhotosModal} onOpenChange={setShowPhotosModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Image className="w-5 h-5 text-purple-600" />
              Fotos - {selectedClienteVisita?.cliente?.nome_fantasia || selectedClienteVisita?.cliente_nome}
            </DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="estoque" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="estoque">
                Fotos de Estoque ({fotosDoCliente.estoque.length})
              </TabsTrigger>
              <TabsTrigger value="trocas">
                Fotos de Trocas ({fotosDoCliente.trocas.length})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="estoque" className="mt-4">
              {fotosDoCliente.estoque.length === 0 ? (
                <p className="text-slate-500 text-center py-8">Nenhuma foto de estoque registrada</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {fotosDoCliente.estoque.map((foto, idx) => (
                    <div key={idx} className="relative group">
                      <img
                        src={foto.foto_url}
                        alt={`Estoque ${foto.produto_nome}`}
                        className="w-full h-48 object-cover rounded-lg shadow-md"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white p-2 rounded-b-lg">
                        <p className="text-xs font-medium truncate">{foto.produto_nome}</p>
                        <p className="text-xs text-slate-300">Qtd: {foto.quantidade}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
            <TabsContent value="trocas" className="mt-4">
              {fotosDoCliente.trocas.length === 0 ? (
                <p className="text-slate-500 text-center py-8">Nenhuma foto de troca registrada</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {fotosDoCliente.trocas.map((foto, idx) => (
                    <div key={idx} className="relative group">
                      <img
                        src={foto.foto_url}
                        alt={`Troca ${foto.produto_nome}`}
                        className="w-full h-48 object-cover rounded-lg shadow-md"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white p-2 rounded-b-lg">
                        <p className="text-xs font-medium truncate">{foto.produto_nome}</p>
                        <p className="text-xs text-slate-300">Motivo: {foto.motivo_troca}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <style>{`
        .hexagon-shape {
          clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
        }
      `}</style>
    </div>
  );
}

function ClienteVisitadoCard({ clienteInfo, onOpenMap, onOpenPhotos }) {
  const { cliente, visitaRoteiro, visitaRegistro } = clienteInfo;

  return (
    <div className="flex items-center justify-between p-4 bg-green-50 rounded-xl border border-green-200">
      <div className="flex items-center gap-3">
        <Badge className="bg-green-600 text-white w-8 h-8 flex items-center justify-center rounded-full">
          {clienteInfo.ordem}
        </Badge>
        <div>
          <p className="font-semibold text-slate-900">
            {cliente?.nome_fantasia || clienteInfo.cliente_nome}
          </p>
          <p className="text-xs text-slate-500">
            {cliente?.cidade}{cliente?.bairro ? `, ${cliente.bairro}` : ''}
          </p>
          <div className="flex gap-2 mt-1">
            {visitaRoteiro?.status === 'concluida' ? (
              <Badge className="bg-green-500 text-xs">Concluída</Badge>
            ) : (
              <Badge className="bg-blue-500 text-xs">Check-in</Badge>
            )}
            {visitaRegistro?.pedido_solicitado === true && (
              <Badge className="bg-emerald-500 text-xs">Pedido Solicitado</Badge>
            )}
            {visitaRegistro?.pedido_solicitado === false && (
              <Badge className="bg-amber-500 text-xs">Sem Pedido</Badge>
            )}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onOpenMap}
          className="border-blue-300 text-blue-700 hover:bg-blue-50"
        >
          <Eye className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onOpenPhotos}
          className="border-purple-300 text-purple-700 hover:bg-purple-50"
        >
          <Image className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function ClienteNaoVisitadoCard({ clienteInfo }) {
  const { cliente, tipoNaoVisita, motivoNaoAtendimento } = clienteInfo;

  return (
    <div className={`flex items-center justify-between p-4 rounded-xl border ${
      tipoNaoVisita === 'nao_atendido' 
        ? 'bg-red-50 border-red-200' 
        : 'bg-amber-50 border-amber-200'
    }`}>
      <div className="flex items-center gap-3">
        <Badge className={`${
          tipoNaoVisita === 'nao_atendido' ? 'bg-red-600' : 'bg-amber-600'
        } text-white w-8 h-8 flex items-center justify-center rounded-full`}>
          {clienteInfo.ordem}
        </Badge>
        <div>
          <p className="font-semibold text-slate-900">
            {cliente?.nome_fantasia || clienteInfo.cliente_nome}
          </p>
          <p className="text-xs text-slate-500">
            {cliente?.cidade}{cliente?.bairro ? `, ${cliente.bairro}` : ''}
          </p>
          <div className="mt-1">
            {tipoNaoVisita === 'nao_atendido' ? (
              <div>
                <Badge className="bg-red-500 text-xs">Não Atendido</Badge>
                {motivoNaoAtendimento && (
                  <p className="text-xs text-red-700 mt-1">
                    <strong>Motivo:</strong> {motivoNaoAtendimento}
                  </p>
                )}
              </div>
            ) : (
              <Badge className="bg-amber-600 text-xs flex items-center gap-1 w-fit">
                <AlertTriangle className="w-3 h-3" />
                Sem Registro - Não informado
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}