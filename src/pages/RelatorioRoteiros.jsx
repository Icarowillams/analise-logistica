import React, { useState, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useClientesPermissao } from '@/components/hooks/useClientesPermissao';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Route, Users, MapPin, Download, CheckCircle, XCircle, Clock, AlertTriangle, 
  Eye, Image, ChevronDown, ChevronRight, Calendar, Filter, X
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const checkinIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [30, 50], iconAnchor: [15, 50], popupAnchor: [1, -40], shadowSize: [50, 50]
});

const checkoutIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

const diasSemanaConfig = [
  { valor: 'domingo', label: 'Domingo', abrev: 'Dom', ordem: 0 },
  { valor: 'segunda-feira', label: 'Segunda', abrev: 'Seg', ordem: 1 },
  { valor: 'terca-feira', label: 'Terça', abrev: 'Ter', ordem: 2 },
  { valor: 'quarta-feira', label: 'Quarta', abrev: 'Qua', ordem: 3 },
  { valor: 'quinta-feira', label: 'Quinta', abrev: 'Qui', ordem: 4 },
  { valor: 'sexta-feira', label: 'Sexta', abrev: 'Sex', ordem: 5 },
  { valor: 'sabado', label: 'Sábado', abrev: 'Sáb', ordem: 6 }
];

const clienteIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [20, 33], iconAnchor: [10, 33], popupAnchor: [1, -28], shadowSize: [33, 33]
});

// Função para adicionar pequeno offset aos marcadores para evitar sobreposição total
const addOffset = (lat, lng, offsetIndex) => {
  const offsets = [
    [0, 0],           // Cliente (centro)
    [0.00015, 0.00015], // Check-in (levemente nordeste)
    [-0.00015, 0.00015] // Check-out (levemente noroeste)
  ];
  const [latOffset, lngOffset] = offsets[offsetIndex] || [0, 0];
  return [lat + latOffset, lng + lngOffset];
};

export default function RelatorioRoteiros() {
  const [expandedVendedores, setExpandedVendedores] = useState({});
  const [expandedDias, setExpandedDias] = useState({});
  const [showMapModal, setShowMapModal] = useState(false);
  const [showPhotosModal, setShowPhotosModal] = useState(false);
  const [selectedVisita, setSelectedVisita] = useState(null);
  const [markerZIndex, setMarkerZIndex] = useState({ cliente: 100, checkin: 200, checkout: 300 });
  const markerRefs = useRef({ cliente: null, checkin: null, checkout: null });
  
  // Filtros
  const [filtros, setFiltros] = useState({
    dias_semana: [],
    vendedores_ids: [],
    funcoes_ids: [],
    cliente_busca: ''
  });
  const [showFiltros, setShowFiltros] = useState(true);
  const [buscaVendedor, setBuscaVendedor] = useState('');
  const [buscaFuncao, setBuscaFuncao] = useState('');

  // Função para trazer marcador à frente
  const bringToFront = (tipo) => {
    const newZIndex = { cliente: 100, checkin: 100, checkout: 100 };
    newZIndex[tipo] = 400;
    setMarkerZIndex(newZIndex);
    // Abrir popup do marcador
    if (markerRefs.current[tipo]) {
      markerRefs.current[tipo].openPopup();
    }
  };

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
    queryFn: () => base44.entities.VisitaRoteiro.list('-data_visita', 10000)
  });

  const { data: visitas = [] } = useQuery({
    queryKey: ['visitas'],
    queryFn: () => base44.entities.Visita.list('-data_visita', 10000)
  });

  const { data: clientesAll = [] } = useQuery({
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

  const { data: funcoes = [] } = useQuery({
    queryKey: ['funcoes'],
    queryFn: () => base44.entities.Funcao.list()
  });

  const { filtrarClientes, filtrarRoteiros, vendedoresPermitidosIds } = useClientesPermissao();
  const clientes = useMemo(() => filtrarClientes(clientesAll), [clientesAll, filtrarClientes]);
  const roteirosPermitidos = useMemo(() => filtrarRoteiros(roteiros), [roteiros, filtrarRoteiros]);

  const clientesMap = useMemo(() => clientes.reduce((acc, c) => { acc[c.id] = c; return acc; }, {}), [clientes]);
  const vendedoresMap = useMemo(() => vendedores.reduce((acc, v) => { acc[v.id] = v; return acc; }, {}), [vendedores]);

  // Aplicar filtros nos roteiros
  const roteirosFiltrados = useMemo(() => {
    let resultado = roteirosPermitidos;
    
    // Filtro por dias da semana (múltiplos)
    if (filtros.dias_semana.length > 0) {
      resultado = resultado.filter(r => filtros.dias_semana.includes(r.dia_semana));
    }
    
    // Filtro por vendedores (múltiplos)
    if (filtros.vendedores_ids.length > 0) {
      resultado = resultado.filter(r => filtros.vendedores_ids.includes(r.vendedor_id));
    }
    
    // Filtro por funções (múltiplas via vendedor)
    if (filtros.funcoes_ids.length > 0) {
      const vendedoresDasFuncoes = vendedores.filter(v => filtros.funcoes_ids.includes(v.funcao_id)).map(v => v.id);
      resultado = resultado.filter(r => vendedoresDasFuncoes.includes(r.vendedor_id));
    }
    
    // Filtro por cliente (busca no nome)
    if (filtros.cliente_busca) {
      const busca = filtros.cliente_busca.toLowerCase();
      resultado = resultado.filter(r => 
        r.clientes_detalhes?.some(c => {
          const clienteCompleto = clientesMap[c.cliente_id];
          const nomeFantasia = clienteCompleto?.nome_fantasia?.toLowerCase() || '';
          const razaoSocial = clienteCompleto?.razao_social?.toLowerCase() || c.cliente_nome?.toLowerCase() || '';
          const codigo = clienteCompleto?.codigo?.toLowerCase() || c.cliente_codigo?.toLowerCase() || '';
          return nomeFantasia.includes(busca) || razaoSocial.includes(busca) || codigo.includes(busca);
        })
      );
    }
    
    return resultado;
  }, [roteirosPermitidos, filtros, vendedores, clientesMap]);

  // Vendedores com roteiros (filtrados)
  const vendedoresComRoteiros = useMemo(() => {
    const vendedorIds = new Set(roteirosFiltrados.map(r => r.vendedor_id));
    return vendedores.filter(v => vendedorIds.has(v.id) && v.status === 'ativo');
  }, [vendedores, roteirosFiltrados]);

  // Roteiros agrupados por vendedor
  const roteirosPorVendedor = useMemo(() => {
    const agrupado = {};
    vendedoresComRoteiros.forEach(v => {
      agrupado[v.id] = roteirosFiltrados.filter(r => r.vendedor_id === v.id);
    });
    return agrupado;
  }, [vendedoresComRoteiros, roteirosFiltrados]);

  const limparFiltros = () => {
    setFiltros({ dias_semana: [], vendedores_ids: [], funcoes_ids: [], cliente_busca: '' });
    setBuscaVendedor('');
    setBuscaFuncao('');
  };

  const toggleDiaSemana = (dia) => {
    setFiltros(prev => ({
      ...prev,
      dias_semana: prev.dias_semana.includes(dia) 
        ? prev.dias_semana.filter(d => d !== dia)
        : [...prev.dias_semana, dia]
    }));
  };

  const toggleVendedorFiltro = (vendedorId) => {
    setFiltros(prev => ({
      ...prev,
      vendedores_ids: prev.vendedores_ids.includes(vendedorId)
        ? prev.vendedores_ids.filter(v => v !== vendedorId)
        : [...prev.vendedores_ids, vendedorId]
    }));
  };

  const toggleFuncaoFiltro = (funcaoId) => {
    setFiltros(prev => ({
      ...prev,
      funcoes_ids: prev.funcoes_ids.includes(funcaoId)
        ? prev.funcoes_ids.filter(f => f !== funcaoId)
        : [...prev.funcoes_ids, funcaoId]
    }));
  };

  const vendedoresFiltradosLista = useMemo(() => {
    if (!buscaVendedor) return vendedores.filter(v => v.status === 'ativo');
    return vendedores.filter(v => v.status === 'ativo' && v.nome?.toLowerCase().includes(buscaVendedor.toLowerCase()));
  }, [vendedores, buscaVendedor]);

  const funcoesFiltradosLista = useMemo(() => {
    if (!buscaFuncao) return funcoes.filter(f => f.status === 'ativo');
    return funcoes.filter(f => f.status === 'ativo' && f.nome?.toLowerCase().includes(buscaFuncao.toLowerCase()));
  }, [funcoes, buscaFuncao]);

  const temFiltrosAtivos = filtros.dias_semana.length > 0 || filtros.vendedores_ids.length > 0 || filtros.funcoes_ids.length > 0 || filtros.cliente_busca;

  // Função para obter clientes do roteiro com status de visita
  const getClientesDoRoteiroComStatus = (roteiro) => {
    const clientesDoRoteiro = roteiro.clientes_detalhes || [];
    const concluidos = [];      // Check-in E Check-out realizados
    const emAtendimento = [];   // Apenas Check-in (sem check-out)
    const semAtendimento = [];  // Não atendido (com motivo)
    const semCheckin = [];      // Sem nenhum registro

    clientesDoRoteiro.forEach((clienteRoteiro, idx) => {
      const clienteCompleto = clientesMap[clienteRoteiro.cliente_id];
      
      // Buscar visita do cliente
      const visitaRot = visitasRoteiro.find(v => 
        v.cliente_id === clienteRoteiro.cliente_id && 
        v.vendedor_id === roteiro.vendedor_id &&
        v.roteiro_id === roteiro.id
      );

      const visitaReg = visitas.find(v =>
        v.cliente_id === clienteRoteiro.cliente_id &&
        v.vendedor_id === roteiro.vendedor_id
      );

      const clienteInfo = {
        ...clienteRoteiro,
        ordem: idx + 1,
        cliente: clienteCompleto,
        visitaRoteiro: visitaRot,
        visitaRegistro: visitaReg
      };

      if (visitaRot && visitaRot.status === 'nao_atendido') {
        // Sem Atendimento: não atendido com motivo
        semAtendimento.push(clienteInfo);
      } else if (visitaRot && visitaRot.status === 'concluida' && visitaRot.checkout_time) {
        // Concluído: tem check-in E check-out
        concluidos.push(clienteInfo);
      } else if (visitaRot && visitaRot.checkin_time && !visitaRot.checkout_time) {
        // Em Atendimento: tem check-in mas não tem check-out
        emAtendimento.push(clienteInfo);
      } else {
        // Sem Check-in: nenhum registro
        semCheckin.push(clienteInfo);
      }
    });

    return { concluidos, emAtendimento, semAtendimento, semCheckin };
  };

  const toggleVendedor = (vendedorId) => {
    setExpandedVendedores(prev => ({ ...prev, [vendedorId]: !prev[vendedorId] }));
  };

  const toggleDia = (vendedorId, dia) => {
    const key = `${vendedorId}-${dia}`;
    setExpandedDias(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleOpenMap = (clienteInfo) => {
    setSelectedVisita(clienteInfo);
    setShowMapModal(true);
  };

  const handleOpenPhotos = (clienteInfo) => {
    setSelectedVisita(clienteInfo);
    setShowPhotosModal(true);
  };

  const fotosDoCliente = useMemo(() => {
    if (!selectedVisita?.visitaRoteiro?.id) return { estoque: [], trocas: [] };
    const visitaId = selectedVisita.visitaRoteiro.id;
    return {
      estoque: estoques.filter(e => e.visita_id === visitaId && e.foto_url),
      trocas: trocas.filter(t => t.visita_id === visitaId && t.foto_url)
    };
  }, [selectedVisita, estoques, trocas]);

  const exportarCSV = () => {
    const linhas = ['Vendedor;Dia;Cliente;Status;Check-in;Check-out'];
    vendedoresComRoteiros.forEach(vendedor => {
      const roteirosVend = roteirosPorVendedor[vendedor.id] || [];
      roteirosVend.forEach(roteiro => {
        const diaLabel = diasSemanaConfig.find(d => d.valor === roteiro.dia_semana)?.label || roteiro.dia_semana;
        
        const { concluidos, emAtendimento, semAtendimento, semCheckin } = getClientesDoRoteiroComStatus(roteiro);
        [...concluidos, ...emAtendimento, ...semAtendimento, ...semCheckin].forEach(c => {
          const status = concluidos.includes(c) ? 'Concluído' : emAtendimento.includes(c) ? 'Em Atendimento' : semAtendimento.includes(c) ? 'Sem Atendimento' : 'Sem Check-in';
          const checkin = c.visitaRoteiro?.checkin_time ? new Date(c.visitaRoteiro.checkin_time).toLocaleString('pt-BR') : '-';
          const checkout = c.visitaRoteiro?.checkout_time ? new Date(c.visitaRoteiro.checkout_time).toLocaleString('pt-BR') : '-';
          linhas.push(`${vendedor.nome};${diaLabel};${c.cliente?.nome_fantasia || c.cliente_nome};${status};${checkin};${checkout}`);
        });
      });
    });
    const csv = linhas.join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio_roteiros_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-xl hexagon-icon">
            <Route className="h-7 w-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Relatório de Roteiros/Visitas</h1>
            <p className="text-slate-500 mt-1">Visualização detalhada por funcionário e dia</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowFiltros(!showFiltros)} variant="outline" className="gap-2">
            <Filter className="w-4 h-4" />
            Filtros
            {temFiltrosAtivos && <Badge className="bg-amber-500 text-white ml-1">{filtros.dias_semana.length + filtros.vendedores_ids.length + filtros.funcoes_ids.length + (filtros.cliente_busca ? 1 : 0)}</Badge>}
          </Button>
          <Button onClick={exportarCSV} variant="outline" className="gap-2">
            <Download className="w-4 h-4" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Painel de Filtros */}
      {showFiltros && (
        <Card className="border-0 shadow-lg">
          <CardContent className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Filtro Dia da Semana */}
              <div>
                <Label className="text-xs mb-1 block">Dia da Semana</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full h-9 justify-between text-left font-normal">
                      <span className="truncate">
                        {filtros.dias_semana.length === 0 
                          ? 'Todos os dias' 
                          : filtros.dias_semana.length === 1 
                            ? diasSemanaConfig.find(d => d.valor === filtros.dias_semana[0])?.label
                            : `${filtros.dias_semana.length} selecionados`}
                      </span>
                      <ChevronDown className="w-4 h-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2" align="start">
                    <div className="space-y-2">
                      {diasSemanaConfig.map(d => (
                        <div key={d.valor} className="flex items-center gap-2">
                          <Checkbox 
                            id={`dia-${d.valor}`}
                            checked={filtros.dias_semana.includes(d.valor)}
                            onCheckedChange={() => toggleDiaSemana(d.valor)}
                          />
                          <label htmlFor={`dia-${d.valor}`} className="text-sm cursor-pointer flex-1">{d.label}</label>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              
              {/* Filtro Funcionário */}
              <div>
                <Label className="text-xs mb-1 block">Funcionário</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full h-9 justify-between text-left font-normal">
                      <span className="truncate">
                        {filtros.vendedores_ids.length === 0 
                          ? 'Todos os funcionários' 
                          : filtros.vendedores_ids.length === 1 
                            ? vendedores.find(v => v.id === filtros.vendedores_ids[0])?.nome
                            : `${filtros.vendedores_ids.length} selecionados`}
                      </span>
                      <ChevronDown className="w-4 h-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2" align="start">
                    <Input
                      placeholder="Buscar funcionário..."
                      value={buscaVendedor}
                      onChange={(e) => setBuscaVendedor(e.target.value)}
                      className="h-8 mb-2"
                    />
                    <ScrollArea className="h-48">
                      <div className="space-y-2">
                        {vendedoresFiltradosLista.map(v => (
                          <div key={v.id} className="flex items-center gap-2">
                            <Checkbox 
                              id={`vend-${v.id}`}
                              checked={filtros.vendedores_ids.includes(v.id)}
                              onCheckedChange={() => toggleVendedorFiltro(v.id)}
                            />
                            <label htmlFor={`vend-${v.id}`} className="text-sm cursor-pointer flex-1 truncate">{v.nome}</label>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
              
              {/* Filtro Função */}
              <div>
                <Label className="text-xs mb-1 block">Função</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full h-9 justify-between text-left font-normal">
                      <span className="truncate">
                        {filtros.funcoes_ids.length === 0 
                          ? 'Todas as funções' 
                          : filtros.funcoes_ids.length === 1 
                            ? funcoes.find(f => f.id === filtros.funcoes_ids[0])?.nome
                            : `${filtros.funcoes_ids.length} selecionadas`}
                      </span>
                      <ChevronDown className="w-4 h-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2" align="start">
                    <Input
                      placeholder="Buscar função..."
                      value={buscaFuncao}
                      onChange={(e) => setBuscaFuncao(e.target.value)}
                      className="h-8 mb-2"
                    />
                    <ScrollArea className="h-48">
                      <div className="space-y-2">
                        {funcoesFiltradosLista.map(f => (
                          <div key={f.id} className="flex items-center gap-2">
                            <Checkbox 
                              id={`func-${f.id}`}
                              checked={filtros.funcoes_ids.includes(f.id)}
                              onCheckedChange={() => toggleFuncaoFiltro(f.id)}
                            />
                            <label htmlFor={`func-${f.id}`} className="text-sm cursor-pointer flex-1 truncate">{f.nome}</label>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>
              
              {/* Buscar Cliente */}
              <div>
                <Label className="text-xs mb-1 block">Buscar Cliente</Label>
                <Input
                  placeholder="Nome ou código..."
                  value={filtros.cliente_busca}
                  onChange={(e) => setFiltros({ ...filtros, cliente_busca: e.target.value })}
                  className="h-9"
                />
              </div>
            </div>
            
            {temFiltrosAtivos && (
              <div className="flex justify-end mt-3">
                <Button variant="ghost" size="sm" onClick={limparFiltros} className="text-slate-600 gap-1">
                  <X className="w-4 h-4" />
                  Limpar filtros
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Lista de Vendedores */}
      <div className="space-y-4">
        {vendedoresComRoteiros.length === 0 ? (
          <Card className="border-0 shadow-lg">
            <CardContent className="p-12 text-center">
              <Users className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <p className="text-lg text-slate-500">Nenhum funcionário com roteiros cadastrados</p>
            </CardContent>
          </Card>
        ) : (
          vendedoresComRoteiros.map(vendedor => {
            const roteirosVend = roteirosPorVendedor[vendedor.id] || [];
            const isExpanded = expandedVendedores[vendedor.id];
            const totalClientes = roteirosVend.reduce((sum, r) => sum + (r.clientes_detalhes?.length || 0), 0);

            return (
              <Card key={vendedor.id} className="border-0 shadow-lg overflow-hidden">
                <Collapsible open={isExpanded} onOpenChange={() => toggleVendedor(vendedor.id)}>
                  <CollapsibleTrigger className="w-full">
                    <CardHeader className="bg-gradient-to-r from-slate-700 to-slate-800 text-white cursor-pointer hover:from-slate-600 hover:to-slate-700 transition-all">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                          <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center">
                            <Users className="w-5 h-5" />
                          </div>
                          <div className="text-left">
                            <CardTitle className="text-lg">{vendedor.nome}</CardTitle>
                            <p className="text-sm text-slate-300">{vendedor.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge className="bg-white/20 text-white">
                            {roteirosVend.length} roteiros
                          </Badge>
                          <Badge className="bg-amber-500 text-white">
                            {totalClientes} clientes
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <CardContent className="p-4 space-y-3">
                      {roteirosVend
                        .sort((a, b) => {
                          const ordemA = diasSemanaConfig.find(d => d.valor === a.dia_semana)?.ordem ?? 99;
                          const ordemB = diasSemanaConfig.find(d => d.valor === b.dia_semana)?.ordem ?? 99;
                          return ordemA - ordemB;
                        })
                        .map(roteiro => {
                        const diaConfig = diasSemanaConfig.find(d => d.valor === roteiro.dia_semana);
                        const keyDia = `${vendedor.id}-${roteiro.dia_semana}`;
                        const isDiaExpanded = expandedDias[keyDia];
                        const { concluidos, emAtendimento, semAtendimento, semCheckin } = getClientesDoRoteiroComStatus(roteiro);

                        return (
                          <Collapsible key={roteiro.id} open={isDiaExpanded} onOpenChange={() => toggleDia(vendedor.id, roteiro.dia_semana)}>
                            <CollapsibleTrigger className="w-full">
                              <div className="flex items-center justify-between p-3 bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 transition-all">
                                <div className="flex items-center gap-3">
                                  {isDiaExpanded ? <ChevronDown className="w-4 h-4 text-slate-600" /> : <ChevronRight className="w-4 h-4 text-slate-600" />}
                                  <Calendar className="w-5 h-5 text-blue-600" />
                                  <span className="font-semibold text-slate-800">{diaConfig?.label || roteiro.dia_semana}</span>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge className="bg-green-100 text-green-700">{concluidos.length} concluídos</Badge>
                                  <Badge className="bg-blue-100 text-blue-700">{emAtendimento.length} em atendimento</Badge>
                                  <Badge className="bg-red-100 text-red-700">{semAtendimento.length} sem atendimento</Badge>
                                  <Badge className="bg-slate-200 text-slate-700">{semCheckin.length} sem check-in</Badge>
                                </div>
                              </div>
                            </CollapsibleTrigger>

                            <CollapsibleContent>
                              <div className="ml-8 mt-3 space-y-4">
                                {/* Concluídos - Check-in e Check-out */}
                                {concluidos.length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-1">
                                      <CheckCircle className="w-4 h-4" /> Concluídos ({concluidos.length})
                                    </h4>
                                    <div className="space-y-2">
                                      {concluidos.map((c, idx) => (
                                        <ClienteCard 
                                          key={idx} 
                                          clienteInfo={c} 
                                          tipo="concluido"
                                          onOpenMap={() => handleOpenMap(c)}
                                          onOpenPhotos={() => handleOpenPhotos(c)}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Em Atendimento - Apenas Check-in */}
                                {emAtendimento.length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-semibold text-blue-700 mb-2 flex items-center gap-1">
                                      <Clock className="w-4 h-4" /> Em Atendimento ({emAtendimento.length})
                                    </h4>
                                    <div className="space-y-2">
                                      {emAtendimento.map((c, idx) => (
                                        <ClienteCard 
                                          key={idx} 
                                          clienteInfo={c} 
                                          tipo="emAtendimento"
                                          onOpenMap={() => handleOpenMap(c)}
                                          onOpenPhotos={() => handleOpenPhotos(c)}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Sem Atendimento - Não atendido com motivo */}
                                {semAtendimento.length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1">
                                      <XCircle className="w-4 h-4" /> Sem Atendimento ({semAtendimento.length})
                                    </h4>
                                    <div className="space-y-2">
                                      {semAtendimento.map((c, idx) => (
                                        <ClienteCard 
                                          key={idx} 
                                          clienteInfo={c} 
                                          tipo="semAtendimento"
                                          onOpenMap={() => handleOpenMap(c)}
                                          onOpenPhotos={() => handleOpenPhotos(c)}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Sem Check-in - Pendentes */}
                                {semCheckin.length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-semibold text-slate-600 mb-2 flex items-center gap-1">
                                      <AlertTriangle className="w-4 h-4" /> Sem Check-in ({semCheckin.length})
                                    </h4>
                                    <div className="space-y-2">
                                      {semCheckin.map((c, idx) => (
                                        <ClienteCard 
                                          key={idx} 
                                          clienteInfo={c} 
                                          tipo="semCheckin"
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {concluidos.length === 0 && emAtendimento.length === 0 && semAtendimento.length === 0 && semCheckin.length === 0 && (
                                  <p className="text-slate-500 text-sm">Nenhum cliente neste roteiro</p>
                                )}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })
        )}
      </div>

      {/* Modal de Mapa */}
      <Dialog open={showMapModal} onOpenChange={setShowMapModal}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-blue-600" />
              Localização - {selectedVisita?.cliente?.nome_fantasia || selectedVisita?.cliente_nome}
            </DialogTitle>
          </DialogHeader>
          {(() => {
            // Buscar latitude/longitude de check-in (pode estar em diferentes campos)
            const checkinLat = selectedVisita?.visitaRoteiro?.checkin_latitude || selectedVisita?.visitaRoteiro?.latitude_checkin;
            const checkinLng = selectedVisita?.visitaRoteiro?.checkin_longitude || selectedVisita?.visitaRoteiro?.longitude_checkin;
            const checkoutLat = selectedVisita?.visitaRoteiro?.checkout_latitude;
            const checkoutLng = selectedVisita?.visitaRoteiro?.checkout_longitude;
            const clienteLat = selectedVisita?.cliente?.latitude;
            const clienteLng = selectedVisita?.cliente?.longitude;

            // Centro do mapa: priorizar check-in, depois cliente
            const centerLat = checkinLat || clienteLat || -8.05;
            const centerLng = checkinLng || clienteLng || -34.9;

            const hasAnyLocation = checkinLat || checkoutLat || clienteLat;

            return (
              <div className="h-[400px] rounded-lg overflow-hidden">
                {selectedVisita && hasAnyLocation ? (
                  <>
                  {!clienteLat && !clienteLng && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-1.5 rounded mb-2 flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      Cliente sem localização cadastrada
                    </div>
                  )}
                  <MapContainer
                    center={[centerLat, centerLng]}
                    zoom={15}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    
                    {/* Marcador do Cliente (azul) - menor e no centro */}
                    {clienteLat && clienteLng && (
                      <Marker 
                        position={addOffset(clienteLat, clienteLng, 0)} 
                        icon={clienteIcon} 
                        zIndexOffset={markerZIndex.cliente}
                        ref={(ref) => { markerRefs.current.cliente = ref; }}
                      >
                        <Popup>
                          <strong>📍 Localização do Cliente</strong><br />
                          {selectedVisita.cliente.nome_fantasia || selectedVisita.cliente.razao_social}<br />
                          {selectedVisita.cliente.endereco}, {selectedVisita.cliente.bairro}
                        </Popup>
                      </Marker>
                    )}
                    
                    {/* Marcador Check-in (verde) - maior e levemente deslocado */}
                    {checkinLat && checkinLng && (
                      <Marker 
                        position={addOffset(checkinLat, checkinLng, 1)} 
                        icon={checkinIcon} 
                        zIndexOffset={markerZIndex.checkin}
                        ref={(ref) => { markerRefs.current.checkin = ref; }}
                      >
                        <Popup>
                          <strong>✅ Check-in</strong><br />
                          {selectedVisita.visitaRoteiro.checkin_time ? new Date(selectedVisita.visitaRoteiro.checkin_time).toLocaleString('pt-BR') : '-'}
                        </Popup>
                      </Marker>
                    )}
                    
                    {/* Marcador Check-out (vermelho) - médio e deslocado oposto */}
                    {checkoutLat && checkoutLng && (
                      <Marker 
                        position={addOffset(checkoutLat, checkoutLng, 2)} 
                        icon={checkoutIcon} 
                        zIndexOffset={markerZIndex.checkout}
                        ref={(ref) => { markerRefs.current.checkout = ref; }}
                      >
                        <Popup>
                          <strong>🚪 Check-out</strong><br />
                          {selectedVisita.visitaRoteiro.checkout_time ? new Date(selectedVisita.visitaRoteiro.checkout_time).toLocaleString('pt-BR') : '-'}
                        </Popup>
                      </Marker>
                    )}
                  </MapContainer>
                  </>
                ) : (
                  <div className="h-full flex items-center justify-center bg-slate-100 rounded-lg">
                    <div className="text-center text-slate-500">
                      <MapPin className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>Nenhuma localização registrada para esta visita</p>
                      <p className="text-sm">O check-in foi realizado sem captura de GPS</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          <div className="flex gap-4 text-sm mt-2">
            <button 
              onClick={() => bringToFront('cliente')}
              className={`flex items-center gap-2 px-2 py-1 rounded hover:bg-blue-100 transition-colors cursor-pointer ${markerZIndex.cliente === 400 ? 'bg-blue-100 ring-2 ring-blue-400' : ''}`}
            >
              <div className="w-4 h-4 rounded-full bg-blue-500"></div>
              <span>Cliente</span>
            </button>
            <button 
              onClick={() => bringToFront('checkin')}
              className={`flex items-center gap-2 px-2 py-1 rounded hover:bg-green-100 transition-colors cursor-pointer ${markerZIndex.checkin === 400 ? 'bg-green-100 ring-2 ring-green-400' : ''}`}
            >
              <div className="w-4 h-4 rounded-full bg-green-500"></div>
              <span>Check-in</span>
            </button>
            <button 
              onClick={() => bringToFront('checkout')}
              className={`flex items-center gap-2 px-2 py-1 rounded hover:bg-red-100 transition-colors cursor-pointer ${markerZIndex.checkout === 400 ? 'bg-red-100 ring-2 ring-red-400' : ''}`}
            >
              <div className="w-4 h-4 rounded-full bg-red-500"></div>
              <span>Check-out</span>
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">Clique na legenda para destacar o marcador no mapa</p>
        </DialogContent>
      </Dialog>

      {/* Modal de Fotos */}
      <Dialog open={showPhotosModal} onOpenChange={setShowPhotosModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Image className="w-5 h-5 text-purple-600" />
              Fotos - {selectedVisita?.cliente?.nome_fantasia || selectedVisita?.cliente_nome}
            </DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="estoque" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="estoque">Fotos de Estoque ({fotosDoCliente.estoque.length})</TabsTrigger>
              <TabsTrigger value="trocas">Fotos de Trocas ({fotosDoCliente.trocas.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="estoque" className="mt-4">
              {fotosDoCliente.estoque.length === 0 ? (
                <p className="text-slate-500 text-center py-8">Nenhuma foto de estoque registrada</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {fotosDoCliente.estoque.map((foto, idx) => (
                    <div key={idx} className="relative group">
                      <img src={foto.foto_url} alt={`Estoque ${foto.produto_nome}`} className="w-full h-48 object-cover rounded-lg shadow-md" />
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
                      <img src={foto.foto_url} alt={`Troca ${foto.produto_nome}`} className="w-full h-48 object-cover rounded-lg shadow-md" />
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
        .hexagon-icon {
          clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
        }
      `}</style>
    </div>
  );
}

// Função para calcular tempo em loja
function calcularTempoEmLoja(checkinTime, checkoutTime) {
  if (!checkinTime || !checkoutTime) return null;
  const checkin = new Date(checkinTime);
  const checkout = new Date(checkoutTime);
  const diffMs = checkout - checkin;
  if (diffMs < 0) return null;
  
  const diffMinutos = Math.floor(diffMs / 60000);
  const horas = Math.floor(diffMinutos / 60);
  const minutos = diffMinutos % 60;
  
  if (horas > 0) {
    return `${horas}h ${minutos}min`;
  }
  return `${minutos} min`;
}

function ClienteCard({ clienteInfo, tipo, onOpenMap, onOpenPhotos }) {
  const { cliente, visitaRoteiro, visitaRegistro } = clienteInfo;

  const bgColor = tipo === 'concluido' ? 'bg-green-50 border-green-200' : 
                  tipo === 'emAtendimento' ? 'bg-blue-50 border-blue-200' :
                  tipo === 'semAtendimento' ? 'bg-red-50 border-red-200' : 
                  'bg-slate-50 border-slate-200';

  const tempoEmLoja = calcularTempoEmLoja(visitaRoteiro?.checkin_time, visitaRoteiro?.checkout_time);

  return (
    <div className={`p-3 rounded-lg border ${bgColor}`}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Badge className="bg-slate-600 text-white text-xs">{clienteInfo.ordem}</Badge>
            <span className="font-semibold text-slate-900">{cliente?.nome_fantasia || cliente?.razao_social || clienteInfo.cliente_nome}</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {cliente?.cidade}{cliente?.bairro ? `, ${cliente.bairro}` : ''}
          </p>
          
          {/* Info de visita */}
          {visitaRoteiro && (
            <div className="mt-2 text-xs space-y-1">
              {visitaRoteiro.checkin_time && (
                <div className="flex items-center gap-2">
                  <Clock className="w-3 h-3 text-green-600" />
                  <span className="text-green-700">
                    Check-in: {new Date(visitaRoteiro.checkin_time).toLocaleString('pt-BR')}
                  </span>
                </div>
              )}
              {visitaRoteiro.checkout_time && (
                <div className="flex items-center gap-2">
                  <Clock className="w-3 h-3 text-blue-600" />
                  <span className="text-blue-700">
                    Check-out: {new Date(visitaRoteiro.checkout_time).toLocaleString('pt-BR')}
                  </span>
                </div>
              )}
              {tempoEmLoja && (
                <div className="flex items-center gap-2">
                  <Badge className="bg-purple-600 text-white text-xs">
                    ⏱️ Tempo em loja: {tempoEmLoja}
                  </Badge>
                </div>
              )}
              {tipo === 'semAtendimento' && visitaRoteiro.motivo_nao_atendimento && (
                <div className="text-red-600 font-medium">
                  Motivo: {visitaRoteiro.motivo_nao_atendimento}
                </div>
              )}
              {visitaRegistro?.pedido_solicitado === true && (
                <Badge className="bg-green-500 text-white text-xs">Pedido Solicitado</Badge>
              )}
              {visitaRegistro?.pedido_solicitado === false && (
                <Badge className="bg-amber-500 text-white text-xs">Sem Pedido: {visitaRegistro.motivo_nao_solicitacao_descricao}</Badge>
              )}
            </div>
          )}

          {tipo === 'emAtendimento' && (
            <Badge className="mt-2 bg-blue-600 text-white text-xs">
              <Clock className="w-3 h-3 mr-1" />
              Aguardando Check-out
            </Badge>
          )}

          {tipo === 'semCheckin' && (
            <Badge className="mt-2 bg-slate-500 text-white text-xs">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Sem nenhum registro
            </Badge>
          )}
        </div>

        {/* Botões de ação */}
        {tipo !== 'semCheckin' && visitaRoteiro && (
          <div className="flex gap-2 ml-4">
            <Button size="sm" variant="outline" onClick={onOpenMap} className="border-blue-300 text-blue-700 hover:bg-blue-50">
              <Eye className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={onOpenPhotos} className="border-purple-300 text-purple-700 hover:bg-purple-50">
              <Image className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}