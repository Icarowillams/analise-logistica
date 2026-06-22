// Otimização simples de rota (TSP aproximado) — nearest-neighbor + melhoria 2-opt.
// Tudo client-side, sem dependência externa. Distâncias em km via Haversine.

export function distanciaKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Comprimento total de uma sequência de pontos
function comprimento(seq) {
  let total = 0;
  for (let i = 0; i < seq.length - 1; i++) total += distanciaKm(seq[i], seq[i + 1]);
  return total;
}

// Heurística do vizinho mais próximo partindo de `origem`
function vizinhoMaisProximo(origem, pontos) {
  const restantes = [...pontos];
  const ordem = [];
  let atual = origem;
  while (restantes.length) {
    let melhorIdx = 0;
    let melhorDist = Infinity;
    restantes.forEach((p, i) => {
      const d = distanciaKm(atual, p);
      if (d < melhorDist) {
        melhorDist = d;
        melhorIdx = i;
      }
    });
    atual = restantes[melhorIdx];
    ordem.push(atual);
    restantes.splice(melhorIdx, 1);
  }
  return ordem;
}

// Melhoria 2-opt sobre a sequência completa (origem fixa no início)
function melhorar2opt(seqCompleta, fecharCiclo) {
  let melhor = [...seqCompleta];
  let melhorou = true;
  let guard = 0;
  while (melhorou && guard < 60) {
    melhorou = false;
    guard++;
    // i começa em 1 para manter a origem fixa
    for (let i = 1; i < melhor.length - 1; i++) {
      for (let k = i + 1; k < melhor.length; k++) {
        const nova = [
          ...melhor.slice(0, i),
          ...melhor.slice(i, k + 1).reverse(),
          ...melhor.slice(k + 1),
        ];
        const compAtual = fecharCiclo
          ? comprimento([...melhor, melhor[0]])
          : comprimento(melhor);
        const compNova = fecharCiclo
          ? comprimento([...nova, nova[0]])
          : comprimento(nova);
        if (compNova + 1e-9 < compAtual) {
          melhor = nova;
          melhorou = true;
        }
      }
    }
  }
  return melhor;
}

/**
 * Calcula a melhor ordem de visita.
 * @param {{lat:number,lng:number}} origem - ponto de saída (GPS do motorista)
 * @param {Array} paradas - lista de paradas com {lat,lng,...}
 * @param {boolean} fecharCiclo - true = volta ao ponto de saída
 * @returns {{ordem: Array, distanciaTotalKm: number}}
 */
export function otimizarRota(origem, paradas, fecharCiclo = false) {
  if (!paradas.length) return { ordem: [], distanciaTotalKm: 0 };
  const ordemNN = vizinhoMaisProximo(origem, paradas);
  const seqComOrigem = [origem, ...ordemNN];
  const melhorada = melhorar2opt(seqComOrigem, fecharCiclo);
  // remove a origem da lista de paradas retornada
  const ordem = melhorada.slice(1);
  const seqFinal = fecharCiclo ? [...melhorada, origem] : melhorada;
  return { ordem, distanciaTotalKm: comprimento(seqFinal) };
}