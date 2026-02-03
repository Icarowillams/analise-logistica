import React, { useState, useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Search, MapPin, Users, Filter } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useClientesPermissao } from '@/components/hooks/useClientesPermissao';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix para ícones do Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Ícone customizado - tamanho ajusta com o zoom
const createCustomIcon = (color, currentZoom = 12) => {
  const baseSize = 20;
  // Quanto menor o zoom (mais afastado), maior o marcador
  const zoomFactor = Math.max(1, (15 - currentZoom) * 0.3);
  const size = Math.min(50, Math.max(16, baseSize * zoomFactor));
  const borderWidth = Math.max(2, size / 8);

  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="
      background-color: ${color};
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      border: ${borderWidth}px solid white;
      box-shadow: 0 0 0 ${Math.max(1, size / 12)}px ${color}, 0 4px 12px rgba(0,0,0,0.5);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
};

// Componente para atualizar a view do mapa
function ChangeView({ center, zoom, bounds }) {
  const map = useMap();
  
  useEffect(() => {
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    } else if (center) {
      map.setView(center, zoom);
    }
  }, [center, zoom, bounds, map]);
  
  return null;
}

// Componente de marcadores com zoom dinâmico
function MarkerCluster({ clientes, getStatusColor, createIcon }) {
  const map = useMap();
  const [currentZoom, setCurrentZoom] = useState(map.getZoom());

  useMapEvents({
    zoomend: () => {
      setCurrentZoom(map.getZoom());
    },
  });

  return (
    <>
      {clientes.map((cliente) => (
        <Marker
          key={cliente.id}
          position={[parseFloat(cliente.latitude), parseFloat(cliente.longitude)]}
          icon={createIcon(getStatusColor(cliente.status), currentZoom)}
        >
          <Popup>
            <div className="min-w-[200px] p-1">
              <div className="font-bold text-amber-700 text-sm mb-1">
                {cliente.codigo}
              </div>
              <div className="font-semibold text-slate-800 text-base">
                {cliente.nome_fantasia || cliente.razao_social}
              </div>
              {cliente.endereco && (
                <div className="text-xs text-slate-500 mt-1">
                  {cliente.endereco}, {cliente.numero} - {cliente.bairro}
                </div>
              )}
              {cliente.cidade && (
                <div className="text-xs text-slate-500">
                  {cliente.cidade} - {cliente.estado}
                </div>
              )}
              <div className="mt-2">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                  cliente.status === 'ativo' ? 'bg-emerald-100 text-emerald-700' :
                  cliente.status === 'inativo' ? 'bg-red-100 text-red-700' :
                  'bg-amber-100 text-amber-700'
                }`}>
                  {cliente.status}
                </span>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}

export default function ClienteMapa() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filtroVendedor, setFiltroVendedor] = useState('all');
  const [filtroSegmento, setFiltroSegmento] = useState('all');
  const [filtroRede, setFiltroRede] = useState('all');
  const [filtroStatus, setFiltroStatus] = useState('all');
  const [filtroCidade, setFiltroCidade] = useState('all');

  const { filtrarClientes, clientes: clientesPermitidos, loading: permLoading } = useClientesPermissao();

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: segmentos = [] } = useQuery({
    queryKey: ['segmentos'],
    queryFn: () => base44.entities.Segmento.list()
  });

  const { data: redes = [] } = useQuery({
    queryKey: ['redes'],
    queryFn: () => base44.entities.Rede.list()
  });

  // Filtrar clientes com permissão e aplicar filtros
  const clientesFiltrados = useMemo(() => {
    let clientes = filtrarClientes(clientesPermitidos);

    // Filtro de busca
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      clientes = clientes.filter(c =>
        c.codigo?.toLowerCase().includes(term) ||
        c.razao_social?.toLowerCase().includes(term) ||
        c.nome_fantasia?.toLowerCase().includes(term) ||
        c.cidade?.toLowerCase().includes(term)
      );
    }

    // Filtros específicos
    if (filtroVendedor !== 'all') {
      clientes = clientes.filter(c => c.vendedor_id === filtroVendedor);
    }
    if (filtroSegmento !== 'all') {
      clientes = clientes.filter(c => c.segmento_id === filtroSegmento);
    }
    if (filtroRede !== 'all') {
      clientes = clientes.filter(c => c.rede_id === filtroRede);
    }
    if (filtroStatus !== 'all') {
      clientes = clientes.filter(c => c.status === filtroStatus);
    }
    if (filtroCidade !== 'all') {
      clientes = clientes.filter(c => c.cidade === filtroCidade);
    }

    return clientes;
  }, [clientesPermitidos, searchTerm, filtroVendedor, filtroSegmento, filtroRede, filtroStatus, filtroCidade, filtrarClientes]);

  // Clientes com coordenadas válidas
  const clientesComCoordenadas = useMemo(() => {
    return clientesFiltrados.filter(c => {
      const lat = parseFloat(c.latitude);
      const lng = parseFloat(c.longitude);
      return !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
    });
  }, [clientesFiltrados]);

  // Lista de cidades únicas
  const cidades = useMemo(() => {
    const cidadesSet = new Set(clientesPermitidos.map(c => c.cidade).filter(Boolean));
    return Array.from(cidadesSet).sort();
  }, [clientesPermitidos]);

  // Calcular centro e bounds do mapa
  const { mapCenter, mapBounds } = useMemo(() => {
    if (clientesComCoordenadas.length === 0) {
      return { 
        mapCenter: [-5.08, -42.8], // Teresina como padrão
        mapBounds: null 
      };
    }
    
    const lats = clientesComCoordenadas.map(c => parseFloat(c.latitude));
    const lngs = clientesComCoordenadas.map(c => parseFloat(c.longitude));
    
    const latSum = lats.reduce((sum, lat) => sum + lat, 0);
    const lngSum = lngs.reduce((sum, lng) => sum + lng, 0);
    
    const center = [latSum / lats.length, lngSum / lngs.length];
    
    // Criar bounds para ajustar o zoom automaticamente
    const bounds = L.latLngBounds(
      clientesComCoordenadas.map(c => [parseFloat(c.latitude), parseFloat(c.longitude)])
    );
    
    return { mapCenter: center, mapBounds: bounds };
  }, [clientesComCoordenadas]);

  // Cores por status
  const getStatusColor = (status) => {
    switch (status) {
      case 'ativo': return '#10b981';
      case 'inativo': return '#ef4444';
      case 'prospecto': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  if (permLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="bg-white rounded-xl p-4 shadow-sm border">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-amber-600" />
          <span className="font-semibold text-slate-700">Filtros</span>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Busca */}
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Buscar código, nome, cidade..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Vendedor */}
          <Select value={filtroVendedor} onValueChange={setFiltroVendedor}>
            <SelectTrigger>
              <SelectValue placeholder="Vendedor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Vendedores</SelectItem>
              {vendedores.filter(v => v.status === 'ativo').map(v => (
                <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Segmento */}
          <Select value={filtroSegmento} onValueChange={setFiltroSegmento}>
            <SelectTrigger>
              <SelectValue placeholder="Segmento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Segmentos</SelectItem>
              {segmentos.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Rede */}
          <Select value={filtroRede} onValueChange={setFiltroRede}>
            <SelectTrigger>
              <SelectValue placeholder="Rede" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas Redes</SelectItem>
              {redes.map(r => (
                <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status */}
          <Select value={filtroStatus} onValueChange={setFiltroStatus}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Status</SelectItem>
              <SelectItem value="ativo">Ativo</SelectItem>
              <SelectItem value="inativo">Inativo</SelectItem>
              <SelectItem value="prospecto">Prospecto</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Cidade em linha separada */}
        <div className="mt-3">
          <Select value={filtroCidade} onValueChange={setFiltroCidade}>
            <SelectTrigger className="w-full md:w-64">
              <SelectValue placeholder="Cidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas Cidades</SelectItem>
              {cidades.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Estatísticas */}
      <div className="flex flex-wrap gap-3">
        <Badge variant="outline" className="px-3 py-1.5 bg-white">
          <Users className="w-4 h-4 mr-2 text-amber-600" />
          {clientesFiltrados.length} clientes filtrados
        </Badge>
        <Badge variant="outline" className="px-3 py-1.5 bg-white">
          <MapPin className="w-4 h-4 mr-2 text-emerald-600" />
          {clientesComCoordenadas.length} com localização
        </Badge>
        <Badge variant="outline" className="px-3 py-1.5 bg-white text-red-600">
          {clientesFiltrados.length - clientesComCoordenadas.length} sem localização
        </Badge>
      </div>

      {/* Mapa quadrado sem repetição */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden flex justify-center">
        <div className="aspect-square w-full max-w-[700px]">
          <MapContainer
            center={mapCenter}
            zoom={12}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={true}
            maxBounds={[[-85, -180], [85, 180]]}
            maxBoundsViscosity={1.0}
            minZoom={1}
            worldCopyJump={false}
          >
            <ChangeView center={mapCenter} zoom={12} bounds={mapBounds} />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              noWrap={true}
            />
            <MarkerCluster 
              clientes={clientesComCoordenadas} 
              getStatusColor={getStatusColor}
              createIcon={createCustomIcon}
            />
          </MapContainer>
        </div>
      </div>

      {/* Legenda */}
      <div className="flex justify-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-emerald-500"></div>
          <span className="text-slate-600">Ativo</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-red-500"></div>
          <span className="text-slate-600">Inativo</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-amber-500"></div>
          <span className="text-slate-600">Prospecto</span>
        </div>
      </div>
    </div>
  );
}