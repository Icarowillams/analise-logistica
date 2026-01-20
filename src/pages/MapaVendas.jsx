import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { Map, Filter, TrendingUp, Package, Users, DollarSign, MapPin } from 'lucide-react';
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
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().split('T')[0];
  });
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().split('T')[0]);
  const [filtroVendedor, setFiltroVendedor] = useState('todos');
  const [filtroCategoria, setFiltroCategoria] = useState('todos');

  const { data: vendas = [] } = useQuery({
    queryKey: ['vendas'],
    queryFn: () => base44.entities.Venda.list('-data', 10000)
  });

  const { data: clientesAll = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => base44.entities.Categoria.list()
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });

  // Permissões
  const { filtrarClientes, filtrarPorCliente, vendedoresPermitidosIds } = useClientesPermissao();
  const clientes = useMemo(() => filtrarClientes(clientesAll), [clientesAll, filtrarClientes]);

  // Mapas auxiliares
  const clientesMap = useMemo(() => clientes.reduce((acc, c) => { acc[c.id] = c; return acc; }, {}), [clientes]);
  const produtosMap = useMemo(() => produtos.reduce((acc, p) => { acc[p.id] = p; return acc; }, {}), [produtos]);

  // Vendedores filtrados por permissão
  const vendedoresFiltrados = useMemo(() => {
    if (vendedoresPermitidosIds === null) return vendedores;
    return vendedores.filter(v => vendedoresPermitidosIds.has(v.id));
  }, [vendedores, vendedoresPermitidosIds]);

  // Filtrar vendas
  const vendasFiltradas = useMemo(() => {
    let resultado = filtrarPorCliente(vendas);
    
    resultado = resultado.filter(v => {
      if (dataInicio && v.data < dataInicio) return false;
      if (dataFim && v.data > dataFim) return false;
      if (filtroVendedor !== 'todos' && v.vendedor_id !== filtroVendedor) return false;
      if (filtroCategoria !== 'todos') {
        const produto = produtosMap[v.produto_id];
        if (!produto || produto.categoria_id !== filtroCategoria) return false;
      }
      return true;
    });

    return resultado;
  }, [vendas, filtrarPorCliente, dataInicio, dataFim, filtroVendedor, filtroCategoria, produtosMap]);

  // Agrupar vendas por cliente com coordenadas
  const vendasPorCliente = useMemo(() => {
    const agrupado = {};
    
    vendasFiltradas.forEach(venda => {
      const cliente = clientesMap[venda.cliente_id];
      if (!cliente || !cliente.latitude || !cliente.longitude) return;
      
      if (!agrupado[venda.cliente_id]) {
        agrupado[venda.cliente_id] = {
          cliente,
          totalVendas: 0,
          totalValor: 0,
          qtdPedidos: 0,
          lat: cliente.latitude,
          lng: cliente.longitude
        };
      }
      
      agrupado[venda.cliente_id].totalVendas += venda.quantidade || 0;
      agrupado[venda.cliente_id].totalValor += venda.valor_total || 0;
      agrupado[venda.cliente_id].qtdPedidos += 1;
    });

    return Object.values(agrupado);
  }, [vendasFiltradas, clientesMap]);

  // Calcular intensidade máxima para escala de cores
  const maxValor = useMemo(() => {
    return Math.max(...vendasPorCliente.map(v => v.totalValor), 1);
  }, [vendasPorCliente]);

  // Função para cor baseada no valor (heatmap)
  const getColor = (valor) => {
    const intensidade = valor / maxValor;
    if (intensidade > 0.8) return '#dc2626'; // vermelho
    if (intensidade > 0.6) return '#ea580c'; // laranja escuro
    if (intensidade > 0.4) return '#f97316'; // laranja
    if (intensidade > 0.2) return '#facc15'; // amarelo
    return '#22c55e'; // verde
  };

  // Função para raio baseado no valor
  const getRadius = (valor) => {
    const intensidade = valor / maxValor;
    return Math.max(8, Math.min(30, 8 + intensidade * 22));
  };

  // Bounds para ajustar o mapa
  const bounds = useMemo(() => {
    if (vendasPorCliente.length === 0) return null;
    return vendasPorCliente.map(v => [v.lat, v.lng]);
  }, [vendasPorCliente]);

  // KPIs
  const kpis = useMemo(() => {
    const totalValor = vendasFiltradas.reduce((acc, v) => acc + (v.valor_total || 0), 0);
    const totalQtd = vendasFiltradas.reduce((acc, v) => acc + (v.quantidade || 0), 0);
    const clientesUnicos = new Set(vendasFiltradas.map(v => v.cliente_id)).size;
    const clientesComCoordenadas = vendasPorCliente.length;

    return { totalValor, totalQtd, clientesUnicos, clientesComCoordenadas };
  }, [vendasFiltradas, vendasPorCliente]);

  // Centro padrão do mapa (Brasil)
  const defaultCenter = [-14.235, -51.9253];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-xl">
          <Map className="h-7 w-7 text-white" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Mapa de Vendas</h1>
          <p className="text-slate-500 mt-1">Visualização geográfica das vendas por região</p>
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
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1 block">Categoria</label>
              <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas</SelectItem>
                  {categorias.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
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
                <DollarSign className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500">Total Vendido</p>
                <p className="text-lg font-bold text-slate-900">
                  {kpis.totalValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md bg-gradient-to-br from-blue-50 to-indigo-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <Package className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500">Qtd. Vendida</p>
                <p className="text-lg font-bold text-slate-900">{kpis.totalQtd.toLocaleString('pt-BR')}</p>
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
                <p className="text-xs text-slate-500">Clientes Atendidos</p>
                <p className="text-lg font-bold text-slate-900">{kpis.clientesUnicos}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md bg-gradient-to-br from-amber-50 to-orange-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20">
                <MapPin className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500">No Mapa</p>
                <p className="text-lg font-bold text-slate-900">{kpis.clientesComCoordenadas}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Legenda */}
      <Card className="border-0 shadow-md">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm font-medium text-slate-700">Intensidade de Vendas:</span>
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
            {vendasPorCliente.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500">
                <MapPin className="w-16 h-16 text-slate-300 mb-4" />
                <p className="text-lg font-medium">Nenhum dado para exibir no mapa</p>
                <p className="text-sm">Verifique se os clientes possuem coordenadas cadastradas</p>
              </div>
            ) : (
              <MapContainer
                center={bounds && bounds.length > 0 ? bounds[0] : defaultCenter}
                zoom={6}
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {bounds && <FitBounds bounds={bounds} />}
                {vendasPorCliente.map((item, idx) => (
                  <CircleMarker
                    key={idx}
                    center={[item.lat, item.lng]}
                    radius={getRadius(item.totalValor)}
                    fillColor={getColor(item.totalValor)}
                    color={getColor(item.totalValor)}
                    weight={2}
                    opacity={0.8}
                    fillOpacity={0.6}
                  >
                    <Popup>
                      <div className="p-2 min-w-[200px]">
                        <h3 className="font-bold text-slate-900 mb-2">
                          {item.cliente.nome_fantasia || item.cliente.razao_social}
                        </h3>
                        <div className="space-y-1 text-sm">
                          <p className="flex justify-between">
                            <span className="text-slate-500">Cidade:</span>
                            <span className="font-medium">{item.cliente.cidade || 'N/A'}</span>
                          </p>
                          <p className="flex justify-between">
                            <span className="text-slate-500">Total Vendido:</span>
                            <span className="font-medium text-emerald-600">
                              {item.totalValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </span>
                          </p>
                          <p className="flex justify-between">
                            <span className="text-slate-500">Qtd. Itens:</span>
                            <span className="font-medium">{item.totalVendas.toLocaleString('pt-BR')}</span>
                          </p>
                          <p className="flex justify-between">
                            <span className="text-slate-500">Nº Pedidos:</span>
                            <span className="font-medium">{item.qtdPedidos}</span>
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
            Top 10 Clientes por Valor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {vendasPorCliente
              .sort((a, b) => b.totalValor - a.totalValor)
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
                    <p className="font-bold text-emerald-600">
                      {item.totalValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </p>
                    <p className="text-xs text-slate-500">{item.qtdPedidos} pedidos</p>
                  </div>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}