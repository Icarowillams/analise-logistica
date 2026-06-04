import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const CHAVE_PADRAO = 'global';
const MAX_TENTATIVAS = 20;

function extrairMaiorNumero(cargas = []) {
  const numeros = cargas
    .map((c) => parseInt(String(c?.numero_carga || '').replace(/\D/g, ''), 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 1000000);
  return numeros.length ? Math.max(...numeros) : 0;
}

async function garantirContadorInicial(base44, chave) {
  const existentes = await base44.asServiceRole.entities.ContadorCarga.filter({ chave }, '-updated_date', 5).catch(() => []);
  if (existentes?.[0]) return existentes[0];

  const cargas = await base44.asServiceRole.entities.Carga.list('-created_date', 2000).catch(() => []);
  const maiorNumero = extrairMaiorNumero(cargas);

  await base44.asServiceRole.entities.ContadorCarga.create({
    chave,
    ultimo_numero: maiorNumero,
    atualizado_em: new Date().toISOString()
  }).catch(() => null);

  const recarregado = await base44.asServiceRole.entities.ContadorCarga.filter({ chave }, '-updated_date', 1).catch(() => []);
  if (!recarregado?.[0]) throw new Error('Não foi possível inicializar ContadorCarga.');
  return recarregado[0];
}

/**
 * Gera número de carga de forma centralizada no backend.
 *
 * Estratégia:
 * 1) lê o contador persistente
 * 2) incrementa em servidor
 * 3) revalida o estado após update
 *
 * Observação: com múltiplas instâncias concorrentes, os retries garantem convergência sem depender
 * de read/update no cliente (eliminando a corrida do front-end).
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const chave = String(body?.chave || CHAVE_PADRAO);

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      const contadorAtual = await garantirContadorInicial(base44, chave);
      const ultimoAtual = Number(contadorAtual?.ultimo_numero || 0);
      const proximoNumero = ultimoAtual + 1;

      await base44.asServiceRole.entities.ContadorCarga.update(contadorAtual.id, {
        ultimo_numero: proximoNumero,
        atualizado_em: new Date().toISOString()
      }).catch(() => null);

      const conferidoRows = await base44.asServiceRole.entities.ContadorCarga.filter({ chave }, '-updated_date', 1).catch(() => []);
      const conferido = conferidoRows?.[0];
      const ultimoConferido = Number(conferido?.ultimo_numero || 0);

      if (ultimoConferido >= proximoNumero) {
        const numero = String(ultimoConferido).padStart(3, '0');
        return Response.json({
          sucesso: true,
          numero_carga: numero,
          ultimo_numero: ultimoConferido,
          tentativas: tentativa
        });
      }
    }

    return Response.json({
      sucesso: false,
      error: `Falha ao gerar número de carga após ${MAX_TENTATIVAS} tentativas.`
    }, { status: 409 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
