import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Route, MapPin, Loader2, Navigation, ExternalLink, AlertTriangle, Crosshair } from 'lucide-react';
import { toast } from 'sonner';
import { otimizarRota } from '@/lib/otimizarRota';
import MapaRotaOtimizada from '@/components/montarRota/MapaRotaOtimizada';

const coordValida = (lat, lng) =>
  typeof lat === 'number' && typeof lng === 'number' &&
  lat >= -34 && lat <= 6 && lng >= -75 && lng <= -32;

// Extrai a lista de clientes de uma carga (omie + internos + trocas), deduplicada por cliente
function clientesDaCarga(carga) {
  const mapa = new Map();
  const push = (id, nome, cidade) => {
    if (!id) return;
    if (!mapa.has(id)) mapa.set(id, { cliente_id: String(id), nome: nome || 'Cliente', cidade: cidade || '' });
  };
  (carga.pedidos_omie || []).forEach(p => push(p.codigo_cliente || p.cnpj_cpf_cliente, p.nome_fantasia || p.nome_cliente, p.cidade));
  (carga.pedidos_internos || []).forEach(p => push(p.cliente_id, p.nome_fantasia || p.nome_cliente, p.cidade));
  (carga.pedidos_troca || []).forEach(p => push(p.cliente_id, p.nome_fantasia || p.nome_cliente, p.cidade));
  return Array.from(mapa.values());
}

export default function MontarRota() {
  const [cargaId, setCargaId] = useState('');
  const [origem, setOrigem] = useState(null);
  const [capturandoGps, setCapturandoGps] = useState(false);
  const [fecharCiclo, setFecharCiclo] = useState(false);
  const [resultado, setResultado] = useState(null);

  const { data: cargas = [] } = useQuery({
    queryKey: ['cargas-montar-rota'],
    queryFn: () => base44.entities.Carga.list('-data_carga', 300)
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes-montar-rota'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 20000)
  });

  const clientesPorId = useMemo(() => {
    const m = new Map();
    clientes.forEach(c => {
      m.set(String(c.id), c);
      if (c.codigo_cliente_omie) m.set(String(c.codigo_cliente_omie), c);
      if (c.codigo_omie) m.set(String(c.codigo_omie), c);
      if (c.cnpj_cpf) m.set(String(c.cnpj_cpf), c);
    });
    return m;
  }, [clientes]);

  const cargaSelecionada = useMemo(() => cargas.find(c => c.id === cargaId), [cargas, cargaId]);

  // Paradas resolvidas com coordenadas
  const { paradas, semCoordenada } = useMemo(() => {
    if (!cargaSelecionada) return { paradas: [], semCoordenada: [] };
    const lista = clientesDaCarga(cargaSelecionada);
    const paradas = [];
    const semCoordenada = [];
    lista.forEach(item => {
      const c = clientesPorId.get(item.cliente_id);
      if (c && coordValida(c.latitude, c.longitude)) {
        paradas.push({
          cliente_id: item.cliente_id,
          nome: c.nome_fantasia || c.razao_social || item.nome,
          cidade: c.cidade || item.cidade,
          lat: c.latitude,
          lng: c.longitude
        });
      } else {
        semCoordenada.push(item.nome);
      }
    });
    return { paradas, semCoordenada };
  }, [cargaSelecionada, clientesPorId]);

  const capturarGps = () => {
    if (!navigator.geolocation) {
      toast.error('Seu navegador não suporta geolocalização.');
      return;
    }
    setCapturandoGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOrigem({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setResultado(null);
        setCapturandoGps(false);
        toast.success('Localização de saída capturada.');
      },
      (err) => {
        setCapturandoGps(false);
        toast.error(err.code === 1
          ? 'Permissão de localização negada. Habilite o GPS para este site.'
          : 'Não foi possível obter a localização. Tente novamente.');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const calcular = () => {
    if (!origem) { toast.error('Capture o ponto de saída primeiro.'); return; }
    if (paradas.length === 0) { toast.error('A carga não tem clientes com localização.'); return; }
    const res = otimizarRota(origem, paradas, fecharCiclo);
    setResultado(res);
  };

  // URL do Google Maps com a sequência otimizada
  const googleMapsUrl = useMemo(() => {
    if (!resultado || !origem) return '';
    const pts = [origem, ...resultado.ordem];
    if (fecharCiclo) pts.push(origem);
    const coords = pts.map(p => `${p.lat},${p.lng}`);
    const dest = coords[coords.length - 1];
    const orig = coords[0];
    const waypoints = coords.slice(1, -1).join('|');
    let url = `https://www.google.com/maps/dir/?api=1&origin=${orig}&destination=${dest}&travelmode=driving`;
    if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
    return url;
  }, [resultado, origem, fecharCiclo]);

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <Route className="w-8 h-8 text-cyan-500" />
        <div>
          <h1 className="text-2xl font-bold">Montar Rota</h1>
          <p className="text-sm text-slate-500">Calcula a melhor ordem de entrega a partir da sua localização e dos clientes da carga</p>
        </div>
      </div>

      {/* Configuração */}
      <Card>
        <CardContent className="pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <Label>Carga</Label>
              <Select value={cargaId} onValueChange={(v) => { setCargaId(v); setResultado(null); }}>
                <SelectTrigger><SelectValue placeholder="Selecione uma carga" /></SelectTrigger>
                <SelectContent>
                  {cargas.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      Carga {c.numero_carga} • {c.data_carga} • {c.motorista_nome || 'sem motorista'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Ponto de saída (GPS)</Label>
              <Button variant={origem ? 'outline' : 'default'} onClick={capturarGps} disabled={capturandoGps} className="w-full gap-2">
                {capturandoGps ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
                {origem ? `${origem.lat.toFixed(5)}, ${origem.lng.toFixed(5)}` : 'Usar minha localização'}
              </Button>
            </div>
            <div>
              <Label>Fim da rota</Label>
              <Select value={fecharCiclo ? 'ciclo' : 'aberta'} onValueChange={(v) => { setFecharCiclo(v === 'ciclo'); setResultado(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="aberta">Terminar no último cliente</SelectItem>
                  <SelectItem value="ciclo">Voltar ao ponto de saída</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {cargaSelecionada && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge className="bg-emerald-100 text-emerald-800">{paradas.length} clientes com localização</Badge>
              {semCoordenada.length > 0 && (
                <Badge className="bg-amber-100 text-amber-800 gap-1">
                  <AlertTriangle className="w-3 h-3" /> {semCoordenada.length} sem coordenada (ignorados)
                </Badge>
              )}
            </div>
          )}

          <Button onClick={calcular} disabled={!origem || paradas.length === 0} className="gap-2 bg-cyan-600 hover:bg-cyan-700">
            <Navigation className="w-4 h-4" /> Calcular melhor rota
          </Button>
        </CardContent>
      </Card>

      {/* Resultado */}
      {resultado && origem && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <MapPin className="w-4 h-4" /> Rota otimizada
                  <Badge className="bg-cyan-100 text-cyan-800">{resultado.distanciaTotalKm.toFixed(1)} km</Badge>
                </span>
                <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-700">
                  <a href={googleMapsUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-4 h-4 mr-1" /> Abrir no Google Maps
                  </a>
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <MapaRotaOtimizada origem={origem} ordem={resultado.ordem} fecharCiclo={fecharCiclo} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Sequência de entrega ({resultado.ordem.length} paradas)</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="flex items-center gap-3 p-2 rounded bg-cyan-50 border border-cyan-100">
                  <span className="w-7 h-7 rounded-full bg-cyan-600 text-white flex items-center justify-center text-xs font-bold">S</span>
                  <span className="text-sm font-medium">Ponto de saída</span>
                  <span className="text-xs text-slate-400 ml-auto">{origem.lat.toFixed(5)}, {origem.lng.toFixed(5)}</span>
                </div>
                {resultado.ordem.map((p, i) => (
                  <div key={p.cliente_id || i} className="flex items-center gap-3 p-2 rounded hover:bg-slate-50 border border-transparent">
                    <span className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold">{i + 1}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{p.nome}</div>
                      <div className="text-xs text-slate-500">{p.cidade}</div>
                    </div>
                    <span className="text-xs text-slate-400 ml-auto">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</span>
                  </div>
                ))}
                {fecharCiclo && (
                  <div className="flex items-center gap-3 p-2 rounded bg-cyan-50 border border-cyan-100">
                    <span className="w-7 h-7 rounded-full bg-cyan-600 text-white flex items-center justify-center text-xs font-bold">S</span>
                    <span className="text-sm font-medium">Retorno ao ponto de saída</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}