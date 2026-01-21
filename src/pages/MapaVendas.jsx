import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { Map, Filter, TrendingUp, Users, MapPin, CheckCircle } from 'lucide-react';
import { useClientesPermissao } from '@/components/hooks/useClientesPermissao';
import 'leaflet/dist/leaflet.css';

// Componente para ajustar o zoom do mapa
function FitBounds({ bounds }) {
  const map = useMap();
  useEffect(() => {
    if (bounds && bounds.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [bounds, map]);
  return null;
}

export default function MapaVendas() {
  const [dataInicio, setDataInicio] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  });
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().split('T')[0]);
  const [filtroVendedor, setFiltroVendedor] = useState('todos');

  // Buscar visitas (têm coordenadas de check-in)
  const { data: visitasAll = [] } = useQuery({
    queryKey: ['visitas'],
    queryFn: () => base44.entities.Visita.list('-data_visita', 10000)
  });

  const { data: clientesAll = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  // Permissões
  const { filtrarClientes, filtrarPorCliente, vendedoresPermitidosIds } = useClientesPermissao();
  const clientes = useMemo(() => filtrarClientes(clientesAll), [clientesAll, filtrarClientes]);

  // Mapas auxiliares
  const clientesMap = useMemo(() => clientes.reduce((acc, c) => { acc[c.id] = c; return acc; }, {}), [clientes]);
  const vendedoresMap = useMemo(() => vendedores.reduce((acc, v) => { acc[v.id] = v; return acc; }, {}), [vendedores]);

  // Vendedores filtrados por permissão
  const vendedoresFiltrados = useMemo(() => {
    if (vendedoresPermitidosIds === null) return vendedores;
    return vendedores.filter(v => vendedoresPermitidosIds.has(v.id));
  }, [vendedores, vendedoresPermitidosIds]);

  // Filtrar visitas por permissão e filtros
  const visitasFiltradas = useMemo(() => {
    let resultado = filtrarPorCliente(visitasAll);
    
    resultado = resultado.filter(v => {
      if (dataInicio && v.data_visita < dataInicio) return false;
      if (dataFim && v.data_visita > dataFim) return false;
      if (filtroVendedor !== 'todos' && v.vendedor_id !== filtroVendedor) return false;
      // Só incluir visitas com coordenadas válidas
      if (!v.latitude_checkin || !v.longitude_checkin) return false;
      return true;
    });

    return resultado;
  }, [visitasAll, filtrarPorCliente, dataInicio, dataFim, filtroVendedor]);

  // Agrupar visitas por cliente com coordenadas do check-in
  const visitasPorCliente = useMemo(() => {
    const agrupado = {};
    
    visitasFiltradas.forEach(visita => {
      const clienteId = visita.cliente_id;
      const cliente = clientesMap[clienteId];
      
      if (!agrupado[clienteId]) {
        agrupado[clienteId] = {
          cliente: cliente || { razao_social: visita.cliente_nome, nome_fantasia: visita.cliente_nome },
          totalVisitas: 0,
          comPedido: 0,
          vendedores: new Set(),
          ultimaVisita: null,
          // Usar coordenadas da última visita
          lat: visita.latitude_checkin,
          lng: visita.longitude_checkin
        };
      }
      
      agrupado[clienteId].totalVisitas += 1;
      if (visita.pedido_solicitado) {
        agrupado[clienteId].comPedido += 1;
      }
      agrupado[clienteId].vendedores.add(visita.vendedor_nome || visita.vendedor_id);
      
      // Atualizar para a visita mais recente (com coordenadas mais atuais)
      if (!agrupado[clienteId].ultimaVisita || visita.data_visita > agrupado[clienteId].ultimaVisita) {
        agrupado[clienteId].ultimaVisita = visita.data_visita;
        agrupado[clienteId].lat = visita.latitude_checkin;
        agrupado[clienteId].lng = visita.longitude_checkin;
      }
    });

    return Object.values(agrupado).map(item => ({
      ...item,
      vendedores: Array.from(item.vendedores)
    }));
  }, [visitasFiltradas, clientesMap]);

  // Calcular intensidade máxima para escala de cores
  const maxVisitas = useMemo(() => {
    return Math.max(...visitasPorCliente.map(v => v.totalVisitas), 1);
  }, [visitasPorCliente]);

  // Função para cor baseada no número de visitas (heatmap) - Verde = Alto, Vermelho = Baixo
  const getColor = (totalVisitas) => {
    const intensidade = totalVisitas / maxVisitas;
    if (intensidade > 0.8) return '#22c55e'; // verde (alto)
    if (intensidade > 0.6) return '#facc15'; // amarelo (médio alto)
    if (intensidade > 0.4) return '#f97316'; // laranja claro (médio)
    if (intensidade > 0.2) return '#ea580c'; // laranja escuro (médio baixo)
    return '#dc2626'; // vermelho (baixo)
  };

  // Função para raio baseado no número de visitas
  const getRadius = (totalVisitas) => {
    const intensidade = totalVisitas / maxVisitas;
    return Math.max(8, Math.min(30, 8 + intensidade * 22));
  };

  // Bounds para ajustar o mapa
  const bounds = useMemo(() => {
    if (visitasPorCliente.length === 0) return null;
    return visitasPorCliente.map(v => [v.lat, v.lng]);
  }, [visitasPorCliente]);

  // KPIs
  const kpis = useMemo(() => {
    const totalVisitas = visitasFiltradas.length;
    const comPedido = visitasFiltradas.filter(v => v.pedido_solicitado).length;
    const clientesUnicos = new Set(visitasFiltradas.map(v => v.cliente_id)).size;
    const clientesNoMapa = visitasPorCliente.length;

    return { totalVisitas, comPedido, clientesUnicos, clientesNoMapa };
  }, [visitasFiltradas, visitasPorCliente]);

  // Centro padrão do mapa (Pernambuco)
  const defaultCenter = [-8.05, -34.9];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-xl">
          <Map className="h-7 w-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Mapa de Visitas</h1>
          <p className="text-slate-500 mt-1">Visualização geográfica das visitas realizadas</p>
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">Data Início</label>
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">Data Fim</label>
              <Input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">Vendedor</label>
              <Select value={filtroVendedor} onValueChange={setFiltroVendedor}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {vendedoresFiltrados.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-0 shadow-md bg-gradient-to-br from-emerald-50 to-teal-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/20">
                <MapPin className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500">Total Visitas</p>
                <p className="text-lg font-bold text-slate-900">{kpis.totalVisitas}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md bg-gradient-to-br from-blue-50 to-indigo-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <CheckCircle className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500">Com Pedido</p>
                <p className="text-lg font-bold text-slate-900">{kpis.comPedido}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md bg-gradient-to-br from-purple-50 to-pink-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/20">
                <Users className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500">Clientes Visitados</p>
                <p className="text-lg font-bold text-slate-900">{kpis.clientesUnicos}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md bg-gradient-to-br from-amber-50 to-orange-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20">
                <Map className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500">No Mapa</p>
                <p className="text-lg font-bold text-slate-900">{kpis.clientesNoMapa}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Legenda */}
      <Card className="border-0 shadow-md">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm font-medium text-slate-700">Intensidade de Visitas:</span>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-green-500"></div>
              <span className="text-xs text-slate-600">Baixo</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-yellow-400"></div>
              <span className="text-xs text-slate-600">Médio-Baixo</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-orange-500"></div>
              <span className="text-xs text-slate-600">Médio</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-orange-600"></div>
              <span className="text-xs text-slate-600">Médio-Alto</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-red-600"></div>
              <span className="text-xs text-slate-600">Alto</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mapa */}
      <Card className="border-0 shadow-lg overflow-hidden">
        <CardContent className="p-0">
          <div className="h-[600px] w-full">
            {visitasPorCliente.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500">
                <MapPin className="w-16 h-16 text-slate-300 mb-4" />
                <p className="text-lg font-medium">Nenhum dado para exibir no mapa</p>
                <p className="text-sm">Verifique se há visitas com check-in no período selecionado</p>
              </div>
            ) : (
              <MapContainer
                center={bounds && bounds.length > 0 ? bounds[0] : defaultCenter}
                zoom={10}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {bounds && <FitBounds bounds={bounds} />}
                {visitasPorCliente.map((item, idx) => (
                  <CircleMarker
                    key={idx}
                    center={[item.lat, item.lng]}
                    radius={getRadius(item.totalVisitas)}
                    fillColor={getColor(item.totalVisitas)}
                    color={getColor(item.totalVisitas)}
                    weight={2}
                    opacity={0.8}
                    fillOpacity={0.6}
                  >
                    <Popup>
                      <div className="p-2 min-w-[220px]">
                        <h3 className="font-bold text-slate-900 mb-2">
                          {item.cliente.nome_fantasia || item.cliente.razao_social}
                        </h3>
                        <div className="space-y-1 text-sm">
                          <p className="flex justify-between">
                            <span className="text-slate-500">Cidade:</span>
                            <span className="font-medium">{item.cliente.cidade || 'N/A'}</span>
                          </p>
                          <p className="flex justify-between">
                            <span className="text-slate-500">Total Visitas:</span>
                            <span className="font-medium text-emerald-600">{item.totalVisitas}</span>
                          </p>
                          <p className="flex justify-between">
                            <span className="text-slate-500">Com Pedido:</span>
                            <span className="font-medium text-blue-600">{item.comPedido}</span>
                          </p>
                          <p className="flex justify-between">
                            <span className="text-slate-500">Última Visita:</span>
                            <span className="font-medium">
                              {item.ultimaVisita ? new Date(item.ultimaVisita).toLocaleDateString('pt-BR') : 'N/A'}
                            </span>
                          </p>
                          <p className="flex justify-between">
                            <span className="text-slate-500">Promotores:</span>
                            <span className="font-medium">{item.vendedores.length}</span>
                          </p>
                        </div>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
              </MapContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Top Clientes */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-500" />
            Top 10 Clientes Mais Visitados
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {visitasPorCliente
              .sort((a, b) => b.totalVisitas - a.totalVisitas)
              .slice(0, 10)
              .map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Badge className="bg-slate-200 text-slate-700 w-8 h-8 flex items-center justify-center rounded-full">
                      {idx + 1}
                    </Badge>
                    <div>
                      <p className="font-medium text-slate-900">
                        {item.cliente.nome_fantasia || item.cliente.razao_social}
                      </p>
                      <p className="text-xs text-slate-500">{item.cliente.cidade || 'N/A'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-emerald-600">{item.totalVisitas} visitas</p>
                    <p className="text-xs text-slate-500">{item.comPedido} com pedido</p>
                  </div>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}