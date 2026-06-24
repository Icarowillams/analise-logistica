// Utilitários compartilhados do módulo de Cobertura Inteligente

// Distância em metros entre duas coordenadas (fórmula de Haversine)
export function distanciaMetros(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Captura a posição atual do navegador como Promise
export function capturarPosicao() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocalização não suportada neste dispositivo.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        precisao: pos.coords.accuracy,
      }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

export const PAPEIS = ['gerencia', 'coordenador', 'supervisor', 'vendedor', 'promotor'];

export const PAPEL_LABEL = {
  gerencia: 'Gerência',
  coordenador: 'Coordenador',
  supervisor: 'Supervisor',
  vendedor: 'Vendedor',
  promotor: 'Promotor',
};

export const STATUS_COBERTURA = {
  em_dia: { label: 'Em dia', cor: 'green', falhas: '0 falhas' },
  atencao: { label: 'Atenção', cor: 'yellow', falhas: '1 falha' },
  atrasado: { label: 'Atrasado', cor: 'orange', falhas: '2 falhas' },
  critico: { label: 'Crítico', cor: 'red', falhas: '3+ falhas' },
};

// Converte nº de falhas consecutivas em status (regra seção 4.1)
export function statusPorFalhas(falhas) {
  if (falhas <= 0) return 'em_dia';
  if (falhas === 1) return 'atencao';
  if (falhas === 2) return 'atrasado';
  return 'critico';
}

// Nível de alerta + papel destinatário por nº de falhas
export function escalonamento(falhas) {
  if (falhas === 1) return { nivel: 'atencao', destino_papel: 'supervisor' };
  if (falhas === 2) return { nivel: 'alerta', destino_papel: 'coordenador' };
  if (falhas >= 3) return { nivel: 'critico', destino_papel: 'gerencia' };
  return null;
}

export const CANAL_LABEL = {
  presencial: 'Presencial',
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  app: 'Aplicativo',
};