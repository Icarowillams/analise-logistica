import React, { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MapPin, CheckCircle2, XCircle, Clock, Activity, Filter, Download } from 'lucide-react';
import KpiCard from './KpiCard';
import useVisitasAnalise from './useVisitasAnalise';
import { dentroPeriodo, exportarCSV, formatarNumero, duracaoMin } from './utilsAnalises';

// Fix Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Cores por status de visita
const STATUS_COR = {
  visitado: '#16a34a',
  nao_visitado: '#dc2626',
  em_andamento: '#f59e0b',
  planejada: '#0891b2',
  reagendado: '#7c3aed',
};

const STATUS_LABEL = {
  visitado: 'Visitado',
  nao_visitado: 'Não visitado',
  em_andamento: 'Em andamento',
  planejada: 'Planejada',
  reagendado: 'Reagendado',
};

// Ícone SVG colorido por status
const criarIcone = (status, comPedido = false) => {
  const cor = STATUS_COR[status] || '#64748b';
  const borda = comPedido ? '#1d4ed8' : 'white';
  const tamanho = comPedido ? 20 : 14;
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${tamanho}px;height:${tamanho}px;border-radius:50%;
      background:${cor};border:2.5px solid ${borda};
      box-shadow:0 2px 6px rgba(0,0,0,0.35);
      ${comPedido ? 'outline:2px solid #bfdbfe;outline-offset:1px;' : ''}
    "></div>`,
    iconSize: [tamanho, tamanho],
    iconAnchor: [tamanho / 2, tamanho / 2],
    popupAnchor: [0, -tamanho / 2],
  });
};

// Ícone para cliente sem visita
const iconeClienteSemVisita = L.divIcon({
  className: '',
  html: `<div style="width:10px;height:10px;border-radius:50%;background:#94a3b8;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
  iconSize: [10, 10],
  iconAnchor: [5, 5],
  popupAnchor: [0, -5],
});

// Coordenada válida dentro do Brasil (descarta lat/lng trocados ou lixo)
const coordValida = (lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' &&
  lat >= -34 && lat <= 6 && lng >= -75 && lng <= -32;

function FitBounds({ pontos }) {
  const map = useMap();
  useEffect(() => {
    // Corrige render cinza quando o mapa monta dentro de aba
    setTimeout(() => map.invalidateSize(), 100);
    if (pontos.length > 0) {
      const bounds = L.latLngBounds(pontos.map(p => [p.lat, p.lng]));
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [pontos, map]);
  return null;
}

export default function MapaVisitas() {
  const [filtros, setFiltros] = useState({
    inicio: '', fim: '', vendedor_id: '', status: '', dia_semana: '', mostrar_clientes: true
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores_analise'],
    queryFn: () => base44.entities.Vendedor.list()
  });
  const { visitas, isLoading } = useVisitasAnalise();
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes_analise'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 20000)
  });

  // Visitas com checkin_lat/lng (realizaram check-in no campo)
  const visitasFiltradas = useMemo(() => visitas.filter(v => {
    if (filtros.vendedor_id && v.vendedor_id !== filtros.vendedor_id) return false;
    if (filtros.status && v.status !== filtros.status) return false;
    if (filtros.dia_semana && v.dia_semana !== filtros.dia_semana) return false;
    if ((filtros.inicio || filtros.fim) && !dentroPeriodo(v.data_visita || v.created_date, filtros.inicio, filtros.fim)) return false;
    return true;
  }), [visitas, filtros]);

  // Com coordenadas do checkin
  const visitasComCheckin = useMemo(() =>
    visitasFiltradas.filter(v => coordValida(v.checkin_lat, v.checkin_lng)),
    [visitasFiltradas]
  );

  // Clientes com lat/lng que NÃO tiveram visita no período filtrado
  const visitasClienteIds = useMemo(() => new Set(visitasFiltradas.map(v => v.cliente_id)), [visitasFiltradas]);
  const clientesSemVisita = useMemo(() => {
    if (!filtros.mostrar_clientes) return [];
    return clientes.filter(c =>
      coordValida(c.latitude, c.longitude) &&
      c.status === 'ativo' &&
      !visitasClienteIds.has(c.id)
    ).slice(0, 500); // limite para performance
  }, [clientes, visitasClienteIds, filtros.mostrar_clientes]);

  // Pontos para o fitBounds
  const todosPontos = useMemo(() => {
    const pts = visitasComCheckin.map(v => ({ lat: v.checkin_lat, lng: v.checkin_lng }));
    if (filtros.mostrar_clientes) {
      clientesSemVisita.forEach(c => pts.push({ lat: c.latitude, lng: c.longitude }));
    }
    return pts;
  }, [visitasComCheckin, clientesSemVisita, filtros.mostrar_clientes]);

  // KPIs
  const kpis = useMemo(() => {
    const realizadas = visitasFiltradas.filter(v => v.status === 'visitado').length;
    const comCheckin = visitasComCheckin.length;
    const comPedido = visitasFiltradas.filter(v => v.gerou_pedido).length;
    const naoVisitadas = visitasFiltradas.filter(v => v.status === 'nao_visitado').length;
    return { total: visitasFiltradas.length, realizadas, comCheckin, comPedido, naoVisitadas };
  }, [visitasFiltradas, visitasComCheckin]);

  const exportar = () => exportarCSV('mapa_visitas',
    ['Data', 'Vendedor', 'Cliente', 'Status', 'Lat', 'Lng', 'Gerou pedido'],
    visitasComCheckin.map(v => [v.data_visita, v.vendedor_nome, v.cliente_nome, v.status, v.checkin_lat, v.checkin_lng, v.gerou_pedido ? 'Sim' : 'Não'])
  );

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card className="border-slate-200">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
            <div>
              <Label className="text-xs">De</Label>
              <Input type="date" value={filtros.inicio} onChange={e => setFiltros({ ...filtros, inicio: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Até</Label>
              <Input type="date" value={filtros.fim} onChange={e => setFiltros({ ...filtros, fim: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Vendedor</Label>
              <Select value={filtros.vendedor_id || '_todos_'} onValueChange={v => setFiltros({ ...filtros, vendedor_id: v === '_todos_' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_todos_">Todos</SelectItem>
                  {vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={filtros.status || '_todos_'} onValueChange={v => setFiltros({ ...filtros, status: v === '_todos_' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_todos_">Todos</SelectItem>
                  <SelectItem value="visitado">Visitado</SelectItem>
                  <SelectItem value="nao_visitado">Não visitado</SelectItem>
                  <SelectItem value="planejada">Planejada</SelectItem>
                  <SelectItem value="reagendado">Reagendado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Dia da semana</Label>
              <Select value={filtros.dia_semana || '_todos_'} onValueChange={v => setFiltros({ ...filtros, dia_semana: v === '_todos_' ? '' : v })}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_todos_">Todos</SelectItem>
                  {['segunda-feira','terca-feira','quarta-feira','quinta-feira','sexta-feira','sabado'].map(d => (
                    <SelectItem key={d} value={d}>{d.replace('-feira','').replace('sabado','sábado')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Clientes sem visita</Label>
              <div className="flex items-center gap-2 h-9">
                <input type="checkbox" id="mostrar_clientes" checked={filtros.mostrar_clientes}
                  onChange={e => setFiltros({ ...filtros, mostrar_clientes: e.target.checked })}
                  className="w-4 h-4 rounded" />
                <label htmlFor="mostrar_clientes" className="text-xs text-slate-600">Mostrar</label>
                <button onClick={() => setFiltros({ inicio: '', fim: '', vendedor_id: '', status: '', dia_semana: '', mostrar_clientes: true })}
                  className="ml-auto px-2 py-1 text-xs border rounded hover:bg-slate-50">Limpar</button>
                <button onClick={exportar} className="px-2 py-1 text-xs text-white bg-indigo-600 rounded hover:bg-indigo-700">CSV</button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard titulo="Total visitas" valor={formatarNumero(kpis.total)} icon={Activity} cor="slate" />
        <KpiCard titulo="Realizadas" valor={formatarNumero(kpis.realizadas)} icon={CheckCircle2} cor="emerald" />
        <KpiCard titulo="Com check-in" valor={formatarNumero(kpis.comCheckin)} sub="plotadas no mapa" icon={MapPin} cor="cyan" />
        <KpiCard titulo="Geraram pedido" valor={formatarNumero(kpis.comPedido)} icon={CheckCircle2} cor="indigo" />
        <KpiCard titulo="Não realizadas" valor={formatarNumero(kpis.naoVisitadas)} icon={XCircle} cor="red" />
      </div>

      {/* Legenda + Mapa */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-1"><MapPin className="w-4 h-4" />Mapa de visitas</span>
            <div className="flex flex-wrap gap-3 text-xs font-normal">
              {Object.entries(STATUS_LABEL).map(([k, l]) => (
                <span key={k} className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full inline-block" style={{ background: STATUS_COR[k] }} />
                  {l}
                </span>
              ))}
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full inline-block bg-slate-400" />
                Cliente sem visita
              </span>
              <span className="flex items-center gap-1 text-blue-700 font-semibold">
                <span className="w-3 h-3 rounded-full inline-block bg-emerald-600 border-2 border-blue-600" />
                Gerou pedido
              </span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading
            ? <div className="flex items-center justify-center h-[500px] text-slate-400">Carregando visitas...</div>
            : visitasComCheckin.length === 0 && clientesSemVisita.length === 0
              ? (
                <div className="flex flex-col items-center justify-center h-[500px] text-slate-400 gap-2">
                  <MapPin className="w-10 h-10 opacity-30" />
                  <p className="text-sm">Nenhuma visita com check-in encontrada.</p>
                  <p className="text-xs">Selecione um período ou verifique se os vendedores fizeram check-in pelo app.</p>
                </div>
              )
              : (
              <div style={{ height: '500px', width: '100%' }}>
                <MapContainer
                  center={[-8.05, -34.9]}
                  zoom={10}
                  style={{ height: '100%', width: '100%', borderRadius: '0 0 8px 8px' }}
                  scrollWheelZoom
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <FitBounds pontos={todosPontos} />

                  {/* Clientes sem visita no período */}
                  {filtros.mostrar_clientes && clientesSemVisita.map(c => (
                    <Marker key={`cli-${c.id}`} position={[c.latitude, c.longitude]} icon={iconeClienteSemVisita}>
                      <Popup>
                        <div className="min-w-[180px]">
                          <p className="font-semibold text-sm">{c.razao_social || c.nome_fantasia || '-'}</p>
                          <p className="text-xs text-slate-500">{c.cidade}/{c.estado}</p>
                          <p className="text-xs text-orange-600 mt-1">⚠ Sem visita no período</p>
                          {c.vendedor_id && <p className="text-xs text-slate-500">
                            {vendedores.find(v => v.id === c.vendedor_id)?.nome || 'Vendedor não vinculado'}
                          </p>}
                        </div>
                      </Popup>
                    </Marker>
                  ))}

                  {/* Visitas com check-in */}
                  {visitasComCheckin.map(v => (
                    <Marker
                      key={v.id}
                      position={[v.checkin_lat, v.checkin_lng]}
                      icon={criarIcone(v.status, v.gerou_pedido)}
                    >
                      <Popup>
                        <div className="min-w-[200px] space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-sm">{v.cliente_nome || '-'}</span>
                            <Badge className="text-xs" style={{ background: STATUS_COR[v.status], color: 'white' }}>
                              {STATUS_LABEL[v.status] || v.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-500">{v.cliente_cidade} · {v.cliente_rota || 'Sem rota'}</p>
                          <p className="text-xs"><strong>Vendedor:</strong> {v.vendedor_nome || '-'}</p>
                          <p className="text-xs"><strong>Data:</strong> {v.data_visita || '-'} · {v.dia_semana?.replace('-feira','') || ''}</p>
                          {v.checkin_em && <p className="text-xs"><strong>Check-in:</strong> {new Date(v.checkin_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>}
                          {v.checkout_em && <p className="text-xs"><strong>Duração:</strong> {v.duracao_min || duracaoMin(v.checkin_em, v.checkout_em)} min</p>}
                          {v.gerou_pedido && <p className="text-xs font-semibold text-blue-700">🛒 Gerou pedido</p>}
                          {v.motivo_nao_atendimento && <p className="text-xs text-red-600">Motivo: {v.motivo_nao_atendimento}</p>}
                          {v.observacoes && <p className="text-xs text-slate-500 italic">{v.observacoes}</p>}
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
            )
          }
        </CardContent>
      </Card>

      {/* Tabela das visitas sem check-in (para diagnóstico) */}
      {visitasFiltradas.length > visitasComCheckin.length && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-sm text-amber-800 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {visitasFiltradas.length - visitasComCheckin.length} visitas sem localização de check-in
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-auto max-h-48">
            <table className="w-full text-xs">
              <thead className="bg-amber-100 sticky top-0">
                <tr>
                  <th className="p-1.5 text-left">Data</th>
                  <th className="p-1.5 text-left">Vendedor</th>
                  <th className="p-1.5 text-left">Cliente</th>
                  <th className="p-1.5 text-left">Status</th>
                  <th className="p-1.5 text-left">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {visitasFiltradas.filter(v => !v.checkin_lat || Math.abs(v.checkin_lat) < 0.01).slice(0, 30).map(v => (
                  <tr key={v.id} className="border-t hover:bg-amber-100">
                    <td className="p-1.5">{v.data_visita || '-'}</td>
                    <td className="p-1.5">{v.vendedor_nome || '-'}</td>
                    <td className="p-1.5 max-w-[160px] truncate">{v.cliente_nome || '-'}</td>
                    <td className="p-1.5"><Badge variant="outline" className="text-xs">{v.status}</Badge></td>
                    <td className="p-1.5 text-slate-600">{v.motivo_nao_atendimento || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}