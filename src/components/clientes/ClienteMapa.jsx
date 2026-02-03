import React, { useState, useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, MapPin, Users, Filter, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useClientesPermissao } from '@/components/hooks/useClientesPermissao';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix para ícones do Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Lista de estados brasileiros com siglas e nomes
const ESTADOS_BRASIL = [
  { sigla: 'AC', nome: 'Acre' },
  { sigla: 'AL', nome: 'Alagoas' },
  { sigla: 'AP', nome: 'Amapá' },
  { sigla: 'AM', nome: 'Amazonas' },
  { sigla: 'BA', nome: 'Bahia' },
  { sigla: 'CE', nome: 'Ceará' },
  { sigla: 'DF', nome: 'Distrito Federal' },
  { sigla: 'ES', nome: 'Espírito Santo' },
  { sigla: 'GO', nome: 'Goiás' },
  { sigla: 'MA', nome: 'Maranhão' },
  { sigla: 'MT', nome: 'Mato Grosso' },
  { sigla: 'MS', nome: 'Mato Grosso do Sul' },
  { sigla: 'MG', nome: 'Minas Gerais' },
  { sigla: 'PA', nome: 'Pará' },
  { sigla: 'PB', nome: 'Paraíba' },
  { sigla: 'PR', nome: 'Paraná' },
  { sigla: 'PE', nome: 'Pernambuco' },
  { sigla: 'PI', nome: 'Piauí' },
  { sigla: 'RJ', nome: 'Rio de Janeiro' },
  { sigla: 'RN', nome: 'Rio Grande do Norte' },
  { sigla: 'RS', nome: 'Rio Grande do Sul' },
  { sigla: 'RO', nome: 'Rondônia' },
  { sigla: 'RR', nome: 'Roraima' },
  { sigla: 'SC', nome: 'Santa Catarina' },
  { sigla: 'SP', nome: 'São Paulo' },
  { sigla: 'SE', nome: 'Sergipe' },
  { sigla: 'TO', nome: 'Tocantins' }
];

// Normaliza string removendo acentos e convertendo para maiúsculo
const normalizar = (str) => {
  if (!str) return '';
  return str.toUpperCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

// Função para verificar se estado do cliente pertence aos selecionados
const estadoPertence = (estadoCliente, estadosSelecionados) => {
  if (!estadoCliente || estadosSelecionados.length === 0) return false;
  
  const estadoNorm = normalizar(estadoCliente);
  
  for (const sigla of estadosSelecionados) {
    // Verifica sigla exata (ex: "PE")
    if (estadoNorm === sigla) return true;
    
    const estado = ESTADOS_BRASIL.find(e => e.sigla === sigla);
    if (!estado) continue;
    
    const nomeNorm = normalizar(estado.nome);
    
    // Verifica nome completo normalizado (ex: "PARAIBA" === "PARAIBA")
    if (estadoNorm === nomeNorm) return true;
  }
  
  return false;
};

// Ícone customizado
const createCustomIcon = (color, isOutsideRegion = false) => {
  const size = isOutsideRegion ? 22 : 16;
  const borderWidth = 2;

  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="
      background-color: ${color};
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      border: ${borderWidth}px solid ${isOutsideRegion ? '#000' : 'white'};
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
};

// Componente para atualizar a view do mapa
function ChangeView({ bounds }) {
  const map = useMap();
  
  useEffect(() => {
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
    }
  }, [bounds, map]);
  
  return null;
}

// Componente de marcadores - mostra apenas clientes FORA dos estados selecionados
function MapMarkers({ clientes, getStatusColor, createIcon }) {
  return (
    <>
      {clientes.map((cliente) => (
        <Marker
          key={cliente.id}
          position={[parseFloat(cliente.latitude), parseFloat(cliente.longitude)]}
          icon={createIcon(getStatusColor(cliente.status))}
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
  const [estadosSelecionados, setEstadosSelecionados] = useState(['PE']);
  const [showEstadosFilter, setShowEstadosFilter] = useState(false);

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

  const toggleEstado = (sigla) => {
    setEstadosSelecionados(prev => {
      if (prev.includes(sigla)) {
        return prev.filter(e => e !== sigla);
      } else {
        return [...prev, sigla];
      }
    });
  };

  const selecionarTodos = () => {
    setEstadosSelecionados(ESTADOS_BRASIL.map(e => e.sigla));
  };

  const limparSelecao = () => {
    setEstadosSelecionados([]);
  };

  // Filtrar clientes com permissão e aplicar filtros
  const clientesFiltrados = useMemo(() => {
    let clientes = filtrarClientes(clientesPermitidos);

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      clientes = clientes.filter(c =>
        c.codigo?.toLowerCase().includes(term) ||
        c.razao_social?.toLowerCase().includes(term) ||
        c.nome_fantasia?.toLowerCase().includes(term) ||
        c.cidade?.toLowerCase().includes(term)
      );
    }

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

  // Clientes com coordenadas válidas (para mostrar no mapa)
  const clientesComCoordenadasValidas = useMemo(() => {
    return clientesFiltrados.filter(c => {
      const lat = parseFloat(c.latitude);
      const lng = parseFloat(c.longitude);
      return !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0 && 
             lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    });
  }, [clientesFiltrados]);

  // Clientes com algum valor nos campos de coordenadas (mesmo inválidos)
  const clientesComAlgumaCoordenada = useMemo(() => {
    return clientesFiltrados.filter(c => {
      return (c.latitude !== null && c.latitude !== undefined && c.latitude !== '') ||
             (c.longitude !== null && c.longitude !== undefined && c.longitude !== '');
    });
  }, [clientesFiltrados]);

  // Clientes fora dos estados selecionados (para lista - inclui coordenadas inválidas)
  const clientesForaRegiaoLista = useMemo(() => {
    if (estadosSelecionados.length === 0) return clientesComAlgumaCoordenada;
    
    return clientesComAlgumaCoordenada.filter(c => !estadoPertence(c.estado, estadosSelecionados));
  }, [clientesComAlgumaCoordenada, estadosSelecionados]);

  // Clientes fora dos estados selecionados COM coordenadas válidas (para mapa)
  const clientesForaRegiaoMapa = useMemo(() => {
    return clientesForaRegiaoLista.filter(c => {
      const lat = parseFloat(c.latitude);
      const lng = parseFloat(c.longitude);
      return !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0 && 
             lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    });
  }, [clientesForaRegiaoLista]);

  // Lista de cidades únicas
  const cidades = useMemo(() => {
    const cidadesSet = new Set(clientesPermitidos.map(c => c.cidade).filter(Boolean));
    return Array.from(cidadesSet).sort();
  }, [clientesPermitidos]);

  // Calcular bounds do mapa baseado nos clientes fora da região com coordenadas válidas
  const mapBounds = useMemo(() => {
    if (clientesForaRegiaoMapa.length === 0) {
      return L.latLngBounds([[-33, -74], [5, -34]]); // Brasil inteiro
    }
    
    return L.latLngBounds(
      clientesForaRegiaoMapa.map(c => [parseFloat(c.latitude), parseFloat(c.longitude)])
    );
  }, [clientesForaRegiaoMapa]);

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
          <div className="relative lg:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Buscar código, nome, cidade..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

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

        <div className="mt-3 flex flex-wrap gap-3">
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

        {/* Filtro de Estados */}
        <Collapsible open={showEstadosFilter} onOpenChange={setShowEstadosFilter} className="mt-4">
          <CollapsibleTrigger asChild>
            <Button variant="outline" className="w-full md:w-auto gap-2">
              <MapPin className="w-4 h-4" />
              Filtrar por Estados ({estadosSelecionados.length} selecionados)
              {showEstadosFilter ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <div className="bg-slate-50 rounded-lg p-4 border">
              <div className="flex gap-2 mb-3">
                <Button size="sm" variant="outline" onClick={selecionarTodos}>
                  Selecionar Todos
                </Button>
                <Button size="sm" variant="outline" onClick={limparSelecao}>
                  Limpar
                </Button>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-7 gap-2">
                {ESTADOS_BRASIL.map(estado => (
                  <label key={estado.sigla} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white p-1.5 rounded">
                    <Checkbox
                      checked={estadosSelecionados.includes(estado.sigla)}
                      onCheckedChange={() => toggleEstado(estado.sigla)}
                    />
                    <span className="font-medium">{estado.sigla}</span>
                    <span className="text-xs text-slate-500 hidden md:inline">({estado.nome})</span>
                  </label>
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Estatísticas */}
      <div className="flex flex-wrap gap-3">
        <Badge variant="outline" className="px-3 py-1.5 bg-white">
          <Users className="w-4 h-4 mr-2 text-amber-600" />
          {clientesFiltrados.length} clientes filtrados
        </Badge>
        <Badge variant="outline" className="px-3 py-1.5 bg-white">
          <MapPin className="w-4 h-4 mr-2 text-emerald-600" />
          {clientesComCoordenadasValidas.length} com localização válida
        </Badge>
        <Badge variant="outline" className="px-3 py-1.5 bg-white text-red-600">
          {clientesFiltrados.length - clientesComCoordenadasValidas.length} sem localização válida
        </Badge>
        <Badge variant="outline" className="px-3 py-1.5 bg-purple-50 text-purple-700 border-purple-200">
          <AlertTriangle className="w-4 h-4 mr-2" />
          {clientesForaRegiaoLista.length} fora da região ({clientesForaRegiaoMapa.length} no mapa)
        </Badge>
      </div>

      {/* Mapa e Lista lateral */}
      <div className="flex gap-4 flex-col lg:flex-row">
        {/* Mapa */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden flex-1">
          <div style={{ height: '500px' }} className="w-full">
            <MapContainer
              center={[-8.05, -34.9]}
              zoom={8}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom={true}
              minZoom={3}
              maxZoom={18}
            >
              <ChangeView bounds={mapBounds} />
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapMarkers 
                clientes={clientesForaRegiaoMapa} 
                getStatusColor={getStatusColor}
                createIcon={createCustomIcon}
              />
            </MapContainer>
          </div>
        </div>

        {/* Lista de clientes fora da região */}
        <div className="bg-white rounded-xl shadow-sm border w-full lg:w-80 flex-shrink-0">
          <div className="p-3 border-b bg-purple-50">
            <h3 className="font-semibold text-purple-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Clientes Fora da Região ({clientesForaRegiaoLista.length})
            </h3>
            <p className="text-xs text-purple-600 mt-1">
              Clientes fora dos estados de atendimento selecionados
            </p>
          </div>
          <ScrollArea className="h-[440px]">
            {clientesForaRegiaoLista.length === 0 ? (
              <div className="p-4 text-center text-slate-500 text-sm">
                Nenhum cliente fora da região de atendimento
              </div>
            ) : (
              <div className="p-2 space-y-2">
                {clientesForaRegiaoLista.map(cliente => {
                  const lat = parseFloat(cliente.latitude);
                  const lng = parseFloat(cliente.longitude);
                  const coordenadaValida = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0 && 
                                           lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
                  
                  return (
                    <div 
                      key={cliente.id} 
                      className={`p-3 rounded-lg border transition-colors ${
                        coordenadaValida 
                          ? 'bg-purple-50/50 border-purple-100 hover:bg-purple-50' 
                          : 'bg-red-50/50 border-red-200 hover:bg-red-50'
                      }`}
                    >
                      <div className="font-medium text-sm text-slate-800">
                        {cliente.nome_fantasia || cliente.razao_social}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Código: {cliente.codigo}
                      </div>
                      <div className="text-xs text-purple-700 mt-1 font-medium">
                        {cliente.cidade || 'Sem cidade'} - {cliente.estado || 'Sem estado'}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        Lat: {cliente.latitude ?? 'N/A'}, Lng: {cliente.longitude ?? 'N/A'}
                      </div>
                      {!coordenadaValida && (
                        <div className="text-xs text-red-600 mt-1 font-medium flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          Coordenada inválida - não aparece no mapa
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      {/* Legenda */}
      <div className="flex justify-center gap-6 text-sm flex-wrap">
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