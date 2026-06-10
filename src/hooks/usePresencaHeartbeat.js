import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

const INTERVALO_MS = 2 * 60 * 1000; // 2 minutos

/**
 * Hook que envia heartbeat de presença a cada 2 minutos.
 * Deve ser colocado no Layout para funcionar em todas as páginas.
 */
export function usePresencaHeartbeat(paginaAtual) {
  const registroIdRef = useRef(null);
  const userRef = useRef(null);

  useEffect(() => {
    let intervalo;

    const enviar = async () => {
      try {
        if (!userRef.current) {
          userRef.current = await base44.auth.me();
        }
        const user = userRef.current;
        if (!user) return;

        const agora = new Date().toISOString();
        const payload = {
          usuario_id: user.id,
          usuario_email: user.email,
          usuario_nome: user.full_name || user.email,
          pagina_atual: paginaAtual || window.location.pathname,
          ultimo_heartbeat: agora,
        };

        if (registroIdRef.current) {
          // Atualiza registro existente
          await base44.entities.PresencaUsuario.update(registroIdRef.current, payload);
        } else {
          // Busca registro existente ou cria novo
          const existentes = await base44.entities.PresencaUsuario.filter({ usuario_id: user.id });
          if (existentes[0]) {
            registroIdRef.current = existentes[0].id;
            await base44.entities.PresencaUsuario.update(registroIdRef.current, payload);
          } else {
            const novo = await base44.entities.PresencaUsuario.create(payload);
            registroIdRef.current = novo.id;
          }
        }
      } catch (_) {
        // silencioso — heartbeat não pode quebrar a UI
      }
    };

    enviar(); // dispara imediatamente
    intervalo = setInterval(enviar, INTERVALO_MS);

    return () => clearInterval(intervalo);
  }, [paginaAtual]);
}