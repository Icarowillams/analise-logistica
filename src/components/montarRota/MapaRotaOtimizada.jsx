import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const iconeOrigem = L.divIcon({
  className: '',
  html: `<div style="width:22px;height:22px;border-radius:50%;background:#0891b2;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold;">S</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  popupAnchor: [0, -11],
});

const iconeParada = (n) =>
  L.divIcon({
    className: '',
    html: `<div style="width:24px;height:24px;border-radius:50%;background:#059669;border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold;">${n}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });

function FitBounds({ pontos }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => {
      if (!map || !map._mapPane) return;
      map.invalidateSize();
      if (pontos.length > 0) {
        const bounds = L.latLngBounds(pontos.map((p) => [p.lat, p.lng]));
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }
    }, 200);
    return () => clearTimeout(t);
  }, [pontos, map]);
  return null;
}

export default function MapaRotaOtimizada({ origem, ordem, fecharCiclo }) {
  const linha = [origem, ...ordem];
  if (fecharCiclo) linha.push(origem);
  const pontos = [origem, ...ordem];

  return (
    <div style={{ height: '520px', width: '100%' }}>
      <MapContainer
        center={[origem.lat, origem.lng]}
        zoom={12}
        style={{ height: '100%', width: '100%', borderRadius: '0 0 8px 8px' }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds pontos={pontos} />

        <Polyline positions={linha.map((p) => [p.lat, p.lng])} pathOptions={{ color: '#0891b2', weight: 4, opacity: 0.7 }} />

        <Marker position={[origem.lat, origem.lng]} icon={iconeOrigem}>
          <Popup>
            <div className="text-sm font-semibold">Ponto de saída (GPS)</div>
            <div className="text-xs text-slate-500">{origem.lat.toFixed(5)}, {origem.lng.toFixed(5)}</div>
          </Popup>
        </Marker>

        {ordem.map((p, i) => (
          <Marker key={p.cliente_id || i} position={[p.lat, p.lng]} icon={iconeParada(i + 1)}>
            <Popup>
              <div className="min-w-[180px]">
                <div className="text-sm font-semibold">{i + 1}. {p.nome}</div>
                <div className="text-xs text-slate-500">{p.cidade || ''}</div>
                <div className="text-xs text-slate-400 mt-1">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}