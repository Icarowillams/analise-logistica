import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in React Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

export default function MapaRoteiro({ roteiro }) {
  const [vendedorCoords, setVendedorCoords] = useState(null);
  const [clientesCoords, setClientesCoords] = useState([]);
  const [center, setCenter] = useState([-8.05, -34.9]); // Recife como padrão

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  useEffect(() => {
    if (!roteiro) return;

    // Buscar coordenadas do vendedor
    const vendedor = vendedores.find(v => v.id === roteiro.vendedor_id);
    if (vendedor && vendedor.latitude && vendedor.longitude) {
      setVendedorCoords({
        lat: parseFloat(vendedor.latitude),
        lng: parseFloat(vendedor.longitude),
        nome: vendedor.nome
      });
      setCenter([parseFloat(vendedor.latitude), parseFloat(vendedor.longitude)]);
    }

    // Buscar coordenadas dos clientes
    const coords = [];
    roteiro.clientes_detalhes?.forEach((clienteDetalhe, idx) => {
      const cliente = clientes.find(c => c.id === clienteDetalhe.cliente_id);
      if (cliente && cliente.latitude && cliente.longitude) {
        coords.push({
          lat: parseFloat(cliente.latitude),
          lng: parseFloat(cliente.longitude),
          nome: clienteDetalhe.cliente_nome,
          ordem: idx + 2, // +2 porque o vendedor é 1
          cidade: clienteDetalhe.cliente_cidade
        });
      }
    });
    setClientesCoords(coords);

    // Ajustar centro do mapa
    if (coords.length > 0 && !vendedorCoords) {
      setCenter([coords[0].lat, coords[0].lng]);
    }
  }, [roteiro, vendedores, clientes]);

  // Criar ícones personalizados com números
  const createNumberIcon = (number, isVendedor = false) => {
    const backgroundColor = isVendedor ? '#3b82f6' : '#f59e0b';
    const html = `
      <div style="
        background-color: ${backgroundColor};
        color: white;
        border: 3px solid white;
        border-radius: 50%;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: 16px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      ">
        ${number}
      </div>
    `;

    return L.divIcon({
      html: html,
      className: 'custom-marker',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -18]
    });
  };

  // Criar a linha da rota
  const routePoints = [];
  if (vendedorCoords) {
    routePoints.push([vendedorCoords.lat, vendedorCoords.lng]);
  }
  clientesCoords.forEach(c => {
    routePoints.push([c.lat, c.lng]);
  });

  if (clientesCoords.length === 0 && !vendedorCoords) {
    return (
      <div className="h-[500px] flex items-center justify-center bg-slate-50 rounded-lg border">
        <p className="text-slate-500">
          Nenhum cliente com localização cadastrada neste roteiro
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="font-semibold mb-4">Mapa do Roteiro:</h3>
      <div className="h-[500px] rounded-lg overflow-hidden border">
        <MapContainer
          center={center}
          zoom={12}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Linha da rota */}
          {routePoints.length > 1 && (
            <Polyline
              positions={routePoints}
              color="#f59e0b"
              weight={3}
              opacity={0.7}
              dashArray="10, 10"
            />
          )}

          {/* Marcador do vendedor (ponto inicial) */}
          {vendedorCoords && (
            <Marker
              position={[vendedorCoords.lat, vendedorCoords.lng]}
              icon={createNumberIcon(1, true)}
            >
              <Popup>
                <div className="text-center">
                  <strong className="text-blue-600">1. INÍCIO</strong>
                  <br />
                  <span className="text-sm">{vendedorCoords.nome}</span>
                  <br />
                  <span className="text-xs text-slate-500">(Vendedor)</span>
                </div>
              </Popup>
            </Marker>
          )}

          {/* Marcadores dos clientes */}
          {clientesCoords.map((cliente, idx) => (
            <Marker
              key={idx}
              position={[cliente.lat, cliente.lng]}
              icon={createNumberIcon(cliente.ordem)}
            >
              <Popup>
                <div className="text-center">
                  <strong className="text-amber-600">{cliente.ordem}. {cliente.nome}</strong>
                  <br />
                  <span className="text-sm text-slate-600">{cliente.cidade}</span>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <p className="text-xs text-slate-500 mt-2">
        💡 Clique nos marcadores para ver detalhes. O número 1 (azul) indica o ponto de partida (vendedor).
      </p>
    </div>
  );
}