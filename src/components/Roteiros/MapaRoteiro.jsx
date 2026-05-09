import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

export default function MapaRoteiro({ roteiro }) {
  const [vendedorCoords, setVendedorCoords] = useState(null);
  const [clientesCoords, setClientesCoords] = useState([]);
  const [center, setCenter] = useState([-8.05, -34.9]);

  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: () => base44.entities.Cliente.list() });

  useEffect(() => {
    if (!roteiro) return;
    const vendedor = vendedores.find(v => v.id === roteiro.vendedor_id);
    let novoCentro = null;
    if (vendedor && vendedor.latitude && vendedor.longitude) {
      const vc = { lat: parseFloat(vendedor.latitude), lng: parseFloat(vendedor.longitude), nome: vendedor.nome };
      setVendedorCoords(vc);
      novoCentro = [vc.lat, vc.lng];
    } else {
      setVendedorCoords(null);
    }

    const coords = [];
    roteiro.clientes_detalhes?.forEach((cd, idx) => {
      const cliente = clientes.find(c => c.id === cd.cliente_id);
      if (cliente && cliente.latitude && cliente.longitude) {
        coords.push({
          lat: parseFloat(cliente.latitude), lng: parseFloat(cliente.longitude),
          nome: cd.cliente_nome, ordem: idx + 2, cidade: cd.cliente_cidade
        });
      }
    });
    setClientesCoords(coords);
    if (novoCentro) setCenter(novoCentro);
    else if (coords.length > 0) setCenter([coords[0].lat, coords[0].lng]);
  }, [roteiro, vendedores, clientes]);

  const createNumberIcon = (number, isVendedor = false) => {
    const bg = isVendedor ? '#3b82f6' : '#f59e0b';
    const html = `<div style="background-color:${bg};color:white;border:3px solid white;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,0.3);">${number}</div>`;
    return L.divIcon({ html, className: 'custom-marker', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18] });
  };

  const routePoints = [];
  if (vendedorCoords) routePoints.push([vendedorCoords.lat, vendedorCoords.lng]);
  clientesCoords.forEach(c => routePoints.push([c.lat, c.lng]));

  if (clientesCoords.length === 0 && !vendedorCoords) {
    return (
      <div className="h-[500px] flex items-center justify-center bg-slate-50 rounded-lg border">
        <p className="text-slate-500">Nenhum cliente com localização cadastrada neste roteiro</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="font-semibold mb-4">Mapa do Roteiro:</h3>
      <div className="h-[500px] rounded-lg overflow-hidden border">
        <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
          <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {routePoints.length > 1 && <Polyline positions={routePoints} color="#f59e0b" weight={3} opacity={0.7} dashArray="10, 10" />}
          {vendedorCoords && (
            <Marker position={[vendedorCoords.lat, vendedorCoords.lng]} icon={createNumberIcon(1, true)}>
              <Popup><strong className="text-blue-600">1. INÍCIO</strong><br />{vendedorCoords.nome}<br /><span className="text-xs text-slate-500">(Vendedor)</span></Popup>
            </Marker>
          )}
          {clientesCoords.map((c, idx) => (
            <Marker key={idx} position={[c.lat, c.lng]} icon={createNumberIcon(c.ordem)}>
              <Popup><strong className="text-amber-600">{c.ordem}. {c.nome}</strong><br />{c.cidade}</Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}