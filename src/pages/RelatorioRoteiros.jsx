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

const addOffset = (lat, lng, offsetIndex) => {
  const offsets = [[0, 0], [0.00015, 0.00015], [-0.00015, 0.00015]];
  const [latOffset, lngOffset] = offsets[offsetIndex] || [0, 0];
  return [lat + latOffset, lng + lngOffset];
};

// Função para obter início da semana (domingo)
function getInicioSemana(data) {
  const d = new Date(data);
  const diaSemana = d.getDay();
  d.setDate(d.getDate() - diaSemana);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Função para obter todas as datas de um dia da semana no período
function getDatasNoPeriodo(dataInicio, dataFim, diaSemanaValor) {
  const diaNumero = diasSemanaConfig.find(d => d.valor === diaSemanaValor)?.ordem;
  if (diaNumero === undefined) return [];
  
  const datas = [];
  
  // Usar parse manual para evitar problemas de timezone
  const [anoI, mesI, diaI] = dataInicio.split('-').map(Number);
  const [anoF, mesF, diaF] = dataFim.split('-').map(Number);
  const inicio = new Date(anoI, mesI - 1, diaI);
  const fim = new Date(anoF, mesF - 1, diaF);
  
  // Encontrar primeiro dia da semana correto no período
  const diaAtualSemana = inicio.getDay();
  let diff = diaNumero - diaAtualSemana;
  if (diff < 0) diff += 7;
  
  const primeiroDia = new Date(inicio);
  primeiroDia.setDate(inicio.getDate() + diff);
  
  // Coletar todas as datas
  const atual = new Date(primeiroDia);
  while (atual <= fim) {
    const ano = atual.getFullYear();
    const mes = String(atual.getMonth() + 1).padStart(2, '0');
    const dia = String(atual.getDate()).padStart(2, '0');
    datas.push(`${ano}-${mes}-${dia}`);
    atual.setDate(atual.getDate() + 7);
  }
  
  return datas;
}

export default function RelatorioRoteiros() {
  const [expandedVendedores, setExpandedVendedores] = useState({});
  const [expandedDias, setExpandedDias] = useState({});
  const [selectedDates, setSelectedDates] = useState({}); // {vendedorId-dia: 'YYYY-MM-DD'}
  const [showMapModal, setShowMapModal] = useState(false);
  const [showPhotosModal, setShowPhotosModal] = useState(false);
  const [selectedVisita, setSelectedVisita] = useState(null);
  const [markerZIndex, setMarkerZIndex] = useState({ cliente: 100, checkin: 200, checkout: 300 });
  const markerRefs = useRef({ cliente: null, checkin: null, checkout: null });
  
  // Filtros de período
  const hoje = new Date();
  const inicioSemanaAtual = getInicioSemana(hoje);
  const [dataInicio, setDataInicio] = useState(inicioSemanaAtual.toISOString().split('T')[0]);
  const [dataFim, setDataFim] = useState(hoje.toISOString().split('T')[0]);
  
  // Filtros adicionais
  const [filtros, setFiltros] = useState({
    vendedores_ids: [],
    funcoes_ids: [],
    cliente_busca: ''
  });
  const [showFiltros, setShowFiltros] = useState(true);
  const [buscaVendedor, setBuscaVendedor] = useState('');
  const [buscaFuncao, setBuscaFuncao] = useState('');

  const bringToFront = (tipo) => {
    const newZIndex = { cliente: 100, checkin: 100, checkout: 100 };
    newZIndex[tipo] = 400;
    setMarkerZIndex(newZIndex);
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

  const { filtrarClientes, filtrarRoteiros } = useClientesPermissao();
  const clientes = useMemo(() => filtrarClientes(clientesAll), [clientesAll, filtrarClientes]);
  const roteirosPermitidos = useMemo(() => filtrarRoteiros(roteiros), [roteiros, filtrarRoteiros]);

  const clientesMap = useMemo(() => clientes.reduce((acc, c) => { acc[c.id] = c; return acc; }, {}), [clientes]);
  const clientesMapByCodigo = useMemo(() => clientes.reduce((acc, c) => { if (c.codigo) acc[c.codigo] = c; return acc; }, {}), [clientes]);
  const vendedoresMap = useMemo(() => vendedores.reduce((acc, v) => { acc[v.id] = v; return acc; }, {}), [vendedores]);
  
  // Helper para buscar cliente por ID ou fallback por código
  const findCliente = (clienteId, clienteCodigo) => clientesMap[clienteId] || (clienteCodigo ? clientesMapByCodigo[clienteCodigo] : undefined);

  // Filtrar visitas pelo período
  const visitasNoPeriodo = useMemo(() => {
    return visitasRoteiro.filter(v => {
      if (!v.data_visita) return false;
      return v.data_visita >= dataInicio && v.data_visita <= dataFim;
    });
  }, [visitasRoteiro, dataInicio, dataFim]);

  const visitasRegistroNoPeriodo = useMemo(() => {
    return visitas.filter(v => {
      if (!v.data_visita) return false;
      return v.data_visita >= dataInicio && v.data_visita <= dataFim;
    });
  }, [visitas, dataInicio, dataFim]);

  // Aplicar filtros nos roteiros
  const roteirosFiltrados = useMemo(() => {
    let resultado = roteirosPermitidos;
    
    if (filtros.vendedores_ids.length > 0) {
      resultado = resultado.filter(r => filtros.vendedores_ids.includes(r.vendedor_id));
    }
    
    if (filtros.funcoes_ids.length > 0) {
      const nomesFuncoesSelecionadas = funcoes
        .filter(f => filtros.funcoes_ids.includes(f.id))
        .map(f => f.nome?.toLowerCase());
      
      const vendedoresDasFuncoes = vendedores.filter(v => 
        filtros.funcoes_ids.includes(v.funcao_id) || 
        nomesFuncoesSelecionadas.includes(v.funcao?.toLowerCase())
      ).map(v => v.id);
      resultado = resultado.filter(r => vendedoresDasFuncoes.includes(r.vendedor_id));
    }
    
    if (filtros.cliente_busca) {
      const busca = filtros.cliente_busca.toLowerCase();
      resultado = resultado.filter(r => 
        r.clientes_detalhes?.some(c => {
          const clienteCompleto = findCliente(c.cliente_id, c.cliente_codigo);
          const nomeFantasia = clienteCompleto?.nome_fantasia?.toLowerCase() || '';
          const razaoSocial = clienteCompleto?.razao_social?.toLowerCase() || c.cliente_nome?.toLowerCase() || '';
          const codigo = clienteCompleto?.codigo?.toLowerCase() || c.cliente_codigo?.toLowerCase() || '';
          return nomeFantasia.includes(busca) || razaoSocial.includes(busca) || codigo.includes(busca);
        })
      );
    }
    
    return resultado;
  }, [roteirosPermitidos, filtros, vendedores, clientesMap, funcoes]);

  // Incluir vendedores que têm roteiros OU que tiveram visitas no período
  const vendedoresComRoteiros = useMemo(() => {
    const vendedorIds = new Set(roteirosFiltrados.map(r => r.vendedor_id));
    // Também incluir vendedores que tiveram visitas no período (roteiro pode ter sido excluído)
    visitasNoPeriodo.forEach(v => {
      if (v.vendedor_id) vendedorIds.add(v.vendedor_id);
    });
    let resultado = vendedores.filter(v => vendedorIds.has(v.id) && v.status === 'ativo');
    
    // Filtrar pela seleção de funcionários
    if (filtros.vendedores_ids.length > 0) {
      resultado = resultado.filter(v => filtros.vendedores_ids.includes(v.id));
    }
    
    // Filtrar pela seleção de funções
    if (filtros.funcoes_ids.length > 0) {
      const nomesFuncoesSelecionadas = funcoes
        .filter(f => filtros.funcoes_ids.includes(f.id))
        .map(f => f.nome?.toLowerCase());
      resultado = resultado.filter(v => 
        filtros.funcoes_ids.includes(v.funcao_id) || 
        nomesFuncoesSelecionadas.includes(v.funcao?.toLowerCase())
      );
    }
    
    return resultado;
  }, [vendedores, roteirosFiltrados, visitasNoPeriodo, filtros, funcoes]);

  const roteirosPorVendedor = useMemo(() => {
    const agrupado = {};
    vendedoresComRoteiros.forEach(v => {
      agrupado[v.id] = roteirosFiltrados.filter(r => r.vendedor_id === v.id);
    });
    return agrupado;
  }, [vendedoresComRoteiros, roteirosFiltrados]);

  // Agrupar visitas por data real ao invés de dia do roteiro
  const visitasPorVendedorEData = useMemo(() => {
    const agrupado = {};
    
    vendedoresComRoteiros.forEach(vendedor => {
      agrupado[vendedor.id] = {};
      
      // Pegar todas as visitas deste vendedor no período
      const visitasVendedor = visitasNoPeriodo.filter(v => v.vendedor_id === vendedor.id);
      
      // Agrupar por data
      visitasVendedor.forEach(visita => {
        if (!visita.data_visita) return;
        if (!agrupado[vendedor.id][visita.data_visita]) {
          agrupado[vendedor.id][visita.data_visita] = [];
        }
        agrupado[vendedor.id][visita.data_visita].push(visita);
      });
    });
    
    return agrupado;
  }, [vendedoresComRoteiros, visitasNoPeriodo]);

  // Obter todas as datas únicas com visitas para um vendedor
  const getDatasComVisitas = (vendedorId) => {
    const datas = Object.keys(visitasPorVendedorEData[vendedorId] || {});
    return datas.sort((a, b) => new Date(b) - new Date(a)); // Mais recente primeiro
  };

  // Obter o dia da semana real de uma data
  const getDiaSemanaReal = (dataStr) => {
    const [ano, mes, dia] = dataStr.split('-').map(Number);
    const data = new Date(ano, mes - 1, dia);
    const diaSemana = data.getDay();
    return diasSemanaConfig.find(d => d.ordem === diaSemana);
  };

  // Obter todas as datas com visitas realizadas para um vendedor em um dia da semana,
  // mesmo que o roteiro tenha sido alterado/excluído
  const datasComVisitasRealizadas = useMemo(() => {
    const resultado = {}; // {vendedorId: {diaSemana: Set<data>}}
    
    visitasNoPeriodo.forEach(v => {
      if (!v.data_visita || !v.vendedor_id) return;
      const diaConfig = getDiaSemanaReal(v.data_visita);
      if (!diaConfig) return;
      
      if (!resultado[v.vendedor_id]) resultado[v.vendedor_id] = {};
      if (!resultado[v.vendedor_id][diaConfig.valor]) resultado[v.vendedor_id][diaConfig.valor] = new Set();
      resultado[v.vendedor_id][diaConfig.valor].add(v.data_visita);
    });
    
    return resultado;
  }, [visitasNoPeriodo]);

  const limparFiltros = () => {
    setFiltros({ vendedores_ids: [], funcoes_ids: [], cliente_busca: '' });
    setBuscaVendedor('');
    setBuscaFuncao('');
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

  const temFiltrosAtivos = filtros.vendedores_ids.length > 0 || filtros.funcoes_ids.length > 0 || filtros.cliente_busca;

  // Função para obter clientes visitados em uma data específica
  // Se há roteiro fixo atual: mostra clientes do roteiro + visitas realizadas (incluindo clientes que saíram do roteiro)
  // Se roteiro foi excluído/alterado: mostra apenas visitas realizadas nessa data
  const getClientesVisitadosNaData = (vendedorId, dataEspecifica) => {
    const concluidos = [];
    const emAtendimento = [];
    const semAtendimento = [];
    const semCheckin = [];

    // Obter o dia da semana real da data
    const diaConfig = getDiaSemanaReal(dataEspecifica);
    
    // Buscar o roteiro fixo ATUAL para este vendedor neste dia da semana
    const roteiroFixo = roteirosFiltrados.find(r => 
      r.vendedor_id === vendedorId && r.dia_semana === diaConfig?.valor
    );

    // Buscar TODAS as visitas deste vendedor nesta data específica
    const visitasDaData = visitasNoPeriodo.filter(v => 
      v.vendedor_id === vendedorId && 
      v.data_visita === dataEspecifica
    );

    // Criar mapa de visitas por cliente_id
    const visitasPorCliente = {};
    visitasDaData.forEach(v => {
      if (!visitasPorCliente[v.cliente_id] || 
          (v.checkout_time && !visitasPorCliente[v.cliente_id].checkout_time)) {
        visitasPorCliente[v.cliente_id] = v;
      }
    });

    // Set de clientes já processados
    const clientesProcessados = new Set();

    // Se existe roteiro fixo atual, processar seus clientes
    // IMPORTANTE: Buscar visita por cliente_id independente do roteiro_id,
    // pois se o roteiro foi recriado, o roteiro_id mudou mas as visitas já registradas
    // apontam para o ID antigo. O que importa é: mesmo vendedor + mesmo cliente + mesma data.
    if (roteiroFixo?.clientes_detalhes) {
      roteiroFixo.clientes_detalhes.forEach((clienteDetalhe, idx) => {
        const clienteCompleto = findCliente(clienteDetalhe.cliente_id, clienteDetalhe.cliente_codigo);
        const visitaRot = visitasPorCliente[clienteDetalhe.cliente_id];
        clientesProcessados.add(clienteDetalhe.cliente_id);
        
        const visitaReg = visitaRot ? visitasRegistroNoPeriodo.find(v =>
          v.cliente_id === clienteDetalhe.cliente_id &&
          v.vendedor_id === vendedorId &&
          v.data_visita === dataEspecifica
        ) : null;

        const clienteInfo = {
          cliente_id: clienteDetalhe.cliente_id,
          cliente_nome: clienteCompleto?.nome_fantasia || clienteCompleto?.razao_social || clienteDetalhe.nome_fantasia || clienteDetalhe.razao_social || clienteDetalhe.cliente_nome,
          cliente_codigo: clienteDetalhe.cliente_codigo || clienteCompleto?.codigo,
          ordem: idx + 1,
          cliente: clienteCompleto,
          visitaRoteiro: visitaRot || null,
          visitaRegistro: visitaReg,
          dataVisita: visitaRot?.data_visita || dataEspecifica
        };

        if (visitaRot) {
          if (visitaRot.status === 'nao_atendido') {
            semAtendimento.push(clienteInfo);
          } else if (visitaRot.status === 'concluida' && visitaRot.checkout_time) {
            concluidos.push(clienteInfo);
          } else if (visitaRot.checkin_time && !visitaRot.checkout_time) {
            emAtendimento.push(clienteInfo);
          } else {
            semCheckin.push(clienteInfo);
          }
        } else {
          semCheckin.push(clienteInfo);
        }
      });
    }

    // Agora processar visitas realizadas de clientes que NÃO estão no roteiro atual
    // (clientes que foram removidos do roteiro ou que o roteiro foi excluído)
    Object.entries(visitasPorCliente).forEach(([clienteId, visitaRot]) => {
      if (clientesProcessados.has(clienteId)) return;
      
      const clienteCompleto = findCliente(clienteId, visitaRot.cliente_codigo);
      const visitaReg = visitasRegistroNoPeriodo.find(v =>
        v.cliente_id === clienteId &&
        v.vendedor_id === vendedorId &&
        v.data_visita === dataEspecifica
      );

      const clienteInfo = {
        cliente_id: clienteId,
        cliente_nome: clienteCompleto?.nome_fantasia || clienteCompleto?.razao_social || visitaRot.cliente_nome || 'Cliente removido',
        cliente_codigo: visitaRot.cliente_codigo || clienteCompleto?.codigo || '-',
        ordem: 999,
        cliente: clienteCompleto,
        visitaRoteiro: visitaRot,
        visitaRegistro: visitaReg,
        dataVisita: visitaRot.data_visita || dataEspecifica,
        roteiroAlterado: true // Cliente não está no roteiro fixo atual
      };

      if (visitaRot.status === 'nao_atendido') {
        semAtendimento.push(clienteInfo);
      } else if (visitaRot.status === 'concluida' && visitaRot.checkout_time) {
        concluidos.push(clienteInfo);
      } else if (visitaRot.checkin_time && !visitaRot.checkout_time) {
        emAtendimento.push(clienteInfo);
      }
      // Não adicionar a semCheckin pois não faz mais parte do roteiro
    });

    // Ordenar por horário de check-in
    const sortByCheckin = (a, b) => {
      const checkinA = a.visitaRoteiro?.checkin_time ? new Date(a.visitaRoteiro.checkin_time).getTime() : 0;
      const checkinB = b.visitaRoteiro?.checkin_time ? new Date(b.visitaRoteiro.checkin_time).getTime() : 0;
      return checkinA - checkinB;
    };

    concluidos.sort(sortByCheckin);
    emAtendimento.sort(sortByCheckin);
    semAtendimento.sort(sortByCheckin);

    return { concluidos, emAtendimento, semAtendimento, semCheckin };
  };

  const toggleVendedor = (vendedorId) => {
    setExpandedVendedores(prev => ({ ...prev, [vendedorId]: !prev[vendedorId] }));
  };

  const toggleDia = (vendedorId, dia) => {
    const key = `${vendedorId}-${dia}`;
    setExpandedDias(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSelectDate = (vendedorId, dia, date) => {
    const key = `${vendedorId}-${dia}`;
    setSelectedDates(prev => ({ ...prev, [key]: date }));
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
    const linhas = ['Vendedor;Dia;Data;Cliente;Status;Check-in;Check-out'];
    vendedoresComRoteiros.forEach(vendedor => {
      const roteirosVend = roteirosPorVendedor[vendedor.id] || [];
      roteirosVend.forEach(roteiro => {
        const diaLabel = diasSemanaConfig.find(d => d.valor === roteiro.dia_semana)?.label || roteiro.dia_semana;
        const datasNoPeriodo = getDatasNoPeriodo(dataInicio, dataFim, roteiro.dia_semana);
        
        datasNoPeriodo.forEach(data => {
          const { concluidos, emAtendimento, semAtendimento, semCheckin } = getClientesVisitadosNaData(roteiro, data);
          [...concluidos, ...emAtendimento, ...semAtendimento].forEach(c => {
            const status = concluidos.includes(c) ? 'Concluído' : emAtendimento.includes(c) ? 'Em Atendimento' : 'Sem Atendimento';
            const checkin = c.visitaRoteiro?.checkin_time ? new Date(c.visitaRoteiro.checkin_time).toLocaleString('pt-BR') : '-';
            const checkout = c.visitaRoteiro?.checkout_time ? new Date(c.visitaRoteiro.checkout_time).toLocaleString('pt-BR') : '-';
            linhas.push(`${vendedor.nome};${diaLabel};${new Date(data).toLocaleDateString('pt-BR')};${c.cliente?.nome_fantasia || c.cliente_nome};${status};${checkin};${checkout}`);
          });
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 sm:h-14 sm:w-14 rounded-xl sm:rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-xl shrink-0">
            <Route className="h-5 w-5 sm:h-7 sm:w-7 text-white" />
          </div>
          <div>
            <h1 className="text-xl sm:text-3xl font-bold text-slate-900">Relatório de Roteiros</h1>
            <p className="text-xs sm:text-sm text-slate-500">Por período e data específica</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowFiltros(!showFiltros)} variant="outline" size="sm" className="gap-1 sm:gap-2 text-xs sm:text-sm">
            <Filter className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Filtros</span>
            {temFiltrosAtivos && <Badge className="bg-amber-500 text-white text-[10px] px-1">{filtros.vendedores_ids.length + filtros.funcoes_ids.length + (filtros.cliente_busca ? 1 : 0)}</Badge>}
          </Button>
          <Button onClick={exportarCSV} variant="outline" size="sm" className="gap-1 sm:gap-2 text-xs sm:text-sm">
            <Download className="w-3 h-3 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Exportar CSV</span>
            <span className="sm:hidden">CSV</span>
          </Button>
        </div>
      </div>

      {/* Painel de Filtros */}
      {showFiltros && (
        <Card className="border-0 shadow-lg">
          <CardContent className="p-3 sm:p-4">
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-4">
              {/* Filtro de Período - Data Início */}
              <div>
                <Label className="text-xs mb-1 block">Data Início</Label>
                <Input
                  type="date"
                  value={dataInicio}
                  onChange={(e) => setDataInicio(e.target.value)}
                  className="h-9"
                />
              </div>
              
              {/* Filtro de Período - Data Fim */}
              <div>
                <Label className="text-xs mb-1 block">Data Fim</Label>
                <Input
                  type="date"
                  value={dataFim}
                  onChange={(e) => setDataFim(e.target.value)}
                  className="h-9"
                />
              </div>
              
              {/* Filtro Funcionário */}
              <div>
                <Label className="text-xs mb-1 block">Funcionário</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full h-9 justify-between text-left font-normal">
                      <span className="truncate">
                        {filtros.vendedores_ids.length === 0 
                          ? 'Todos' 
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
                          ? 'Todas' 
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
                    <CardHeader className="bg-gradient-to-r from-slate-700 to-slate-800 text-white cursor-pointer hover:from-slate-600 hover:to-slate-700 transition-all p-3 sm:p-6">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2 sm:gap-3">
                          {isExpanded ? <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5" /> : <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />}
                          <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                            <Users className="w-4 h-4 sm:w-5 sm:h-5" />
                          </div>
                          <div className="text-left min-w-0">
                            <CardTitle className="text-sm sm:text-lg truncate">{vendedor.nome}</CardTitle>
                            <p className="text-xs sm:text-sm text-slate-300 truncate">{vendedor.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-10 sm:ml-0 shrink-0">
                          <Badge className="bg-white/20 text-white text-[10px] sm:text-xs">
                            {roteirosVend.length} rot.
                          </Badge>
                          <Badge className="bg-amber-500 text-white text-[10px] sm:text-xs">
                            {totalClientes} cli.
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <CardContent className="p-4 space-y-3">
                      {/* Agrupar por dias da semana dos roteiros fixos */}
                      {(() => {
                        // Obter os dias da semana que este vendedor tem roteiro
                        const diasComRoteiro = roteirosVend.map(r => r.dia_semana);
                        
                        if (diasComRoteiro.length === 0) {
                          return (
                            <div className="p-4 bg-slate-50 rounded-lg text-center text-slate-500">
                              <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                              <p>Nenhum roteiro cadastrado para este funcionário</p>
                            </div>
                          );
                        }

                        // Para cada dia da semana com roteiro, calcular todas as datas no período
                        const datasPorDiaSemana = {};
                        diasComRoteiro.forEach(diaSemana => {
                          const datasNoPeriodo = getDatasNoPeriodo(dataInicio, dataFim, diaSemana);
                          if (datasNoPeriodo.length > 0) {
                            datasPorDiaSemana[diaSemana] = new Set(datasNoPeriodo);
                          }
                        });
                        
                        // Também incluir datas com visitas realizadas (roteiro pode ter sido alterado/excluído)
                        const visitasDoVendedor = datasComVisitasRealizadas[vendedor.id] || {};
                        Object.entries(visitasDoVendedor).forEach(([diaSemana, datasSet]) => {
                          if (!datasPorDiaSemana[diaSemana]) {
                            datasPorDiaSemana[diaSemana] = new Set();
                          }
                          datasSet.forEach(d => datasPorDiaSemana[diaSemana].add(d));
                        });
                        
                        // Converter Sets para arrays
                        Object.keys(datasPorDiaSemana).forEach(dia => {
                          datasPorDiaSemana[dia] = Array.from(datasPorDiaSemana[dia]);
                        });
                        
                        // Remover dias sem datas
                        Object.keys(datasPorDiaSemana).forEach(dia => {
                          if (datasPorDiaSemana[dia].length === 0) delete datasPorDiaSemana[dia];
                        });

                        // Ordenar dias da semana
                        const diasOrdenados = Object.keys(datasPorDiaSemana).sort((a, b) => {
                          const ordemA = diasSemanaConfig.find(d => d.valor === a)?.ordem ?? 99;
                          const ordemB = diasSemanaConfig.find(d => d.valor === b)?.ordem ?? 99;
                          return ordemA - ordemB;
                        });
                        
                        if (diasOrdenados.length === 0) {
                          return (
                            <div className="p-4 bg-slate-50 rounded-lg text-center text-slate-500">
                              <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                              <p>Nenhuma data no período corresponde aos dias dos roteiros</p>
                            </div>
                          );
                        }

                        return diasOrdenados.map(diaSemana => {
                          const diaConfig = diasSemanaConfig.find(d => d.valor === diaSemana);
                          const datasDesteDia = datasPorDiaSemana[diaSemana].sort((a, b) => new Date(b) - new Date(a)); // Mais recente primeiro
                          const keyDia = `${vendedor.id}-${diaSemana}`;
                          const isDiaExpanded = expandedDias[keyDia];
                          const dataSelecionada = selectedDates[keyDia] || datasDesteDia[0]; // Mais recente por padrão
                          
                          // Buscar o roteiro fixo para contar visitas corretamente
                          const roteiroFixoDoDia = roteirosVend.find(r => r.dia_semana === diaSemana);
                          
                          // Contar visitas realizadas neste dia (visitas com check-in do roteiro específico)
                          const visitasRealizadasNoDia = datasDesteDia.reduce((acc, data) => {
                            const visitasDaData = visitasNoPeriodo.filter(v => 
                              v.vendedor_id === vendedor.id && 
                              v.roteiro_id === roteiroFixoDoDia?.id &&
                              v.data_visita === data
                            );
                            return acc + visitasDaData.length;
                          }, 0);

                          return (
                            <Collapsible key={diaSemana} open={isDiaExpanded} onOpenChange={() => toggleDia(vendedor.id, diaSemana)}>
                              <CollapsibleTrigger className="w-full">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between p-2 sm:p-3 bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 transition-all gap-2">
                              <div className="flex items-center gap-2 sm:gap-3">
                                {isDiaExpanded ? <ChevronDown className="w-4 h-4 text-slate-600" /> : <ChevronRight className="w-4 h-4 text-slate-600" />}
                                <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                                <span className="font-semibold text-slate-800 text-sm sm:text-base">{diaConfig?.label || diaSemana}</span>
                              </div>
                              <div className="flex items-center gap-1 sm:gap-2 flex-wrap ml-6 sm:ml-0">
                                <Badge className="bg-blue-100 text-blue-700 text-[10px] sm:text-xs">{datasDesteDia.length} datas</Badge>
                                <Badge className="bg-green-100 text-green-700 text-[10px] sm:text-xs">{visitasRealizadasNoDia} visitas</Badge>
                              </div>
                              </div>
                              </CollapsibleTrigger>

                              <CollapsibleContent>
                                <div className="ml-8 mt-3 space-y-4">
                                  {/* Seletor de Data */}
                                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-2 sm:p-3 bg-blue-50 rounded-lg">
                                    <Label className="text-xs sm:text-sm font-medium text-blue-700">Data:</Label>
                                    <Select 
                                      value={dataSelecionada || ''} 
                                      onValueChange={(value) => handleSelectDate(vendedor.id, diaSemana, value)}
                                    >
                                      <SelectTrigger className="w-full sm:w-52">
                                        <SelectValue placeholder="Selecione" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {datasDesteDia.map(data => {
                                          const visitasDaData = visitasNoPeriodo.filter(v => 
                                            v.vendedor_id === vendedor.id && 
                                            v.roteiro_id === roteiroFixoDoDia?.id &&
                                            v.data_visita === data
                                          );
                                          const hoje = new Date().toISOString().split('T')[0];
                                          const isFuturo = data > hoje;
                                          const [ano, mes, dia] = data.split('-').map(Number);
                                          const dataFormatada = `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
                                          return (
                                            <SelectItem key={data} value={data}>
                                              {dataFormatada}
                                              {visitasDaData.length > 0 ? ` (${visitasDaData.length} visitas)` : isFuturo ? ' (futuro)' : ' (sem visitas)'}
                                            </SelectItem>
                                          );
                                        })}
                                      </SelectContent>
                                    </Select>
                                  </div>

                                  {/* Clientes da data selecionada */}
                                  {dataSelecionada && (() => {
                                    const { concluidos, emAtendimento, semAtendimento, semCheckin } = getClientesVisitadosNaData(vendedor.id, dataSelecionada);

                                    return (
                                      <div className="space-y-4">
                                        <div className="text-sm text-slate-600 font-medium">
                                          Visitas em {new Date(dataSelecionada + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                                        </div>

                                      <>
                                        {/* Concluídos */}
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

                                        {/* Em Atendimento */}
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

                                        {/* Sem Atendimento (Não Atendido) */}
                                        {semAtendimento.length > 0 && (
                                          <div>
                                            <h4 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1">
                                              <XCircle className="w-4 h-4" /> Não Atendido ({semAtendimento.length})
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

                                        {/* Pendentes (Sem Check-in) */}
                                        {semCheckin.length > 0 && (
                                          <div>
                                            <h4 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-1">
                                              <AlertTriangle className="w-4 h-4" /> Pendentes ({semCheckin.length})
                                            </h4>
                                            <div className="space-y-2">
                                              {semCheckin.map((c, idx) => (
                                                <ClienteCard 
                                                  key={idx} 
                                                  clienteInfo={c} 
                                                  tipo="pendente"
                                                  onOpenMap={() => handleOpenMap(c)}
                                                  onOpenPhotos={() => handleOpenPhotos(c)}
                                                />
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </>
                                    </div>
                                  );
                                })()}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      });
                      })()}
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
              Localização - {selectedVisita?.cliente_nome || selectedVisita?.cliente?.nome_fantasia || selectedVisita?.cliente?.razao_social}
            </DialogTitle>
          </DialogHeader>
          {(() => {
            const checkinLat = selectedVisita?.visitaRoteiro?.checkin_latitude || selectedVisita?.visitaRoteiro?.latitude_checkin;
            const checkinLng = selectedVisita?.visitaRoteiro?.checkin_longitude || selectedVisita?.visitaRoteiro?.longitude_checkin;
            const checkoutLat = selectedVisita?.visitaRoteiro?.checkout_latitude;
            const checkoutLng = selectedVisita?.visitaRoteiro?.checkout_longitude;
            const clienteLat = selectedVisita?.cliente?.latitude;
            const clienteLng = selectedVisita?.cliente?.longitude;

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
        </DialogContent>
      </Dialog>

      {/* Modal de Fotos */}
      <Dialog open={showPhotosModal} onOpenChange={setShowPhotosModal}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Image className="w-5 h-5 text-purple-600" />
              Fotos - {selectedVisita?.cliente_nome || selectedVisita?.cliente?.nome_fantasia || selectedVisita?.cliente?.razao_social}
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
                  tipo === 'pendente' ? 'bg-amber-50 border-amber-200' :
                  'bg-slate-50 border-slate-200';

  const tempoEmLoja = calcularTempoEmLoja(visitaRoteiro?.checkin_time, visitaRoteiro?.checkout_time);

  return (
    <div className={`p-2 sm:p-3 rounded-lg border ${bgColor}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
            {clienteInfo.ordem !== 999 && (
              <Badge className="bg-slate-600 text-white text-[10px] sm:text-xs px-1.5">{clienteInfo.ordem}</Badge>
            )}
            {clienteInfo.roteiroAlterado && (
              <Badge className="bg-orange-500 text-white text-[10px] sm:text-xs px-1.5">Rot. Anterior</Badge>
            )}
            {(cliente?.codigo || clienteInfo.cliente_codigo) && (
              <Badge variant="outline" className="text-[10px] sm:text-xs px-1">{cliente?.codigo || clienteInfo.cliente_codigo}</Badge>
            )}
            <span className="font-semibold text-slate-900 text-xs sm:text-sm truncate">{clienteInfo.cliente_nome || cliente?.nome_fantasia || cliente?.razao_social}</span>
          </div>
          <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5 truncate">
            {cliente?.cidade}{cliente?.bairro ? `, ${cliente.bairro}` : ''}
          </p>
          
          {visitaRoteiro && (
            <div className="mt-1.5 sm:mt-2 text-[10px] sm:text-xs space-y-0.5 sm:space-y-1">
              {visitaRoteiro.checkin_time && (
                <div className="flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-green-600 shrink-0" />
                  <span className="text-green-700 truncate">
                    In: {new Date(visitaRoteiro.checkin_time).toLocaleString('pt-BR')}
                  </span>
                </div>
              )}
              {visitaRoteiro.checkout_time && (
                <div className="flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-blue-600 shrink-0" />
                  <span className="text-blue-700 truncate">
                    Out: {new Date(visitaRoteiro.checkout_time).toLocaleString('pt-BR')}
                  </span>
                </div>
              )}
              {tempoEmLoja && (
                <Badge className="bg-purple-600 text-white text-[10px] px-1">
                  ⏱️ {tempoEmLoja}
                </Badge>
              )}
              {tipo === 'semAtendimento' && visitaRoteiro.motivo_nao_atendimento && (
                <div className="text-red-600 font-medium text-[10px] truncate">
                  {visitaRoteiro.motivo_nao_atendimento}
                </div>
              )}
              {visitaRegistro?.pedido_solicitado === true && (
                <Badge className="bg-green-500 text-white text-[10px] px-1">Pedido ✓</Badge>
              )}
              {visitaRegistro?.pedido_solicitado === false && (
                <Badge className="bg-amber-500 text-white text-[10px] px-1">S/Ped: {visitaRegistro.motivo_nao_solicitacao_descricao?.substring(0, 15)}...</Badge>
              )}
            </div>
          )}

          {tipo === 'emAtendimento' && (
            <Badge className="mt-1 bg-blue-600 text-white text-[10px] px-1">
              <Clock className="w-2.5 h-2.5 mr-0.5" />
              Aguard. Check-out
            </Badge>
          )}

          {tipo === 'pendente' && (
            <Badge className="mt-1 bg-amber-500 text-white text-[10px] px-1">
              <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
              Aguard. Check-in
            </Badge>
          )}
        </div>

        {tipo !== 'pendente' && visitaRoteiro && (
          <div className="flex gap-1 sm:gap-2 self-end sm:self-center shrink-0">
            <Button size="sm" variant="outline" onClick={onOpenMap} className="h-7 w-7 sm:h-8 sm:w-8 p-0 border-blue-300 text-blue-700 hover:bg-blue-50">
              <Eye className="w-3 h-3 sm:w-4 sm:h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={onOpenPhotos} className="h-7 w-7 sm:h-8 sm:w-8 p-0 border-purple-300 text-purple-700 hover:bg-purple-50">
              <Image className="w-3 h-3 sm:w-4 sm:h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}