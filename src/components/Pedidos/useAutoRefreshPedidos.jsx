import { useEffect, useRef, useState, useCallback } from 'react';

// Auto-refresh APENAS da releitura local (espelho PedidoLiberadoOmie / entidade Pedido).
// NÃO chama a API do Omie — apenas invalida as queries locais para refletir as etapas
// que já foram sincronizadas pelos webhooks em segundo plano.
const REFRESH_INTERVAL_MS = 30000;

export default function useAutoRefreshPedidos(recarregarLocal) {
  const [enabled, setEnabled] = useState(true);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState(Date.now());
  const [, forceTick] = useState(0);
  const recarregarRef = useRef(recarregarLocal);
  recarregarRef.current = recarregarLocal;

  const refreshAgora = useCallback(async () => {
    await recarregarRef.current?.();
    setUltimaAtualizacao(Date.now());
  }, []);

  // Intervalo de auto-refresh — pausa quando a aba está em background.
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === 'visible') {
        refreshAgora();
      }
    };
    const id = setInterval(tick, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, refreshAgora]);

  // Atualiza o texto "atualizado há X" a cada 5s, sem refazer a query.
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const segundos = Math.floor((Date.now() - ultimaAtualizacao) / 1000);
  const textoUltima =
    segundos < 5 ? 'agora mesmo'
    : segundos < 60 ? `há ${segundos}s`
    : `há ${Math.floor(segundos / 60)}min`;

  return { enabled, setEnabled, textoUltima, refreshAgora };
}