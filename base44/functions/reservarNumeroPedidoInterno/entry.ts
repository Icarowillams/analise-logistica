import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const CHAVE = 'pedido_interno';
const LOCK_TTL_MS = 30_000;   // lock expira em 30s se o processo travar
const MAX_TENTATIVAS = 20;    // backoff total ~5s
const DELAY_BASE_MS = 150;
const DELAY_MAX_MS = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function formatarNumeroInterno(num, sufixo = 'D') {
  return String(num).padStart(5, '0') + sufixo;
}

// Paginação real de todos os pedidos usando filter+sort+limit+skip via SDK.
// De-duplica por id para evitar contagem de registros sobrepostos entre páginas.
async function bootstrapMaxNum(base44) {
  let maxNum = 0;
  const vistos = new Set();
  const LIMITE = 500;
  let skip = 0;

  while (true) {
    // O SDK suporta .list(sort, limit, skip) — pagina de verdade com skip real.
    const bloco = await base44.asServiceRole.entities.Pedido.list('-created_date', LIMITE, skip);
    if (!bloco || bloco.length === 0) break;

    for (const p of bloco) {
      if (vistos.has(p.id)) continue; // de-dup: ignora ecos entre páginas
      vistos.add(p.id);
      if (p.numero_pedido && /[DT]$/i.test(String(p.numero_pedido))) {
        const n = parseInt(String(p.numero_pedido).replace(/\D/g, ''), 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
    }

    if (bloco.length < LIMITE) break; // última página
    skip += LIMITE;
    if (skip > 20_000) break; // safety cap: 20k pedidos máximo
  }

  return maxNum;
}

Deno.serve(async (req) => {
  let contadorId = null; // para liberar lock no catch se necessário
  let base44Instance = null;

  try {
    const base44 = createClientFromRequest(req);
    base44Instance = base44;

    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const sufixo = 'D'; // todos os internos usam sufixo D por ora

    // ─── PASSO 1: garantir que existe EXATAMENTE 1 registro ─────────────────
    let registros = await base44.asServiceRole.entities.ContadorPedidoInterno
      .filter({ chave: CHAVE }, '-ultimo_numero', 50);

    if (registros.length === 0) {
      // Bootstrap: varre TODOS os pedidos paginando com skip real + de-dup por id.
      const maxNum = await bootstrapMaxNum(base44);

      await base44.asServiceRole.entities.ContadorPedidoInterno.create({
        chave: CHAVE,
        ultimo_numero: maxNum, // próximo reservado será maxNum + 1
        lock_ativo: false,
        lock_ate: null,
        lock_token: null
      });

      // Re-lê após criação para detectar race na criação simultânea
      registros = await base44.asServiceRole.entities.ContadorPedidoInterno
        .filter({ chave: CHAVE }, '-ultimo_numero', 50);
    }

    // ─── PASSO 2: consolidação anti-fragmentação ─────────────────────────────
    // Ordenado por -ultimo_numero → registros[0] é o de maior número (o sobrevivente).
    if (registros.length > 1) {
      const sobrevivente = registros[0];
      for (const dup of registros.slice(1)) {
        await base44.asServiceRole.entities.ContadorPedidoInterno.delete(dup.id).catch(() => {});
      }
      registros = [sobrevivente];
    }

    // ─── PASSO 3: adquirir o lock com retry + backoff + token UUID ───────────
    let lockAdquirido = false;
    let contadorFinal = null;

    for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
      // Re-lê estado atual a cada tentativa
      const atual = await base44.asServiceRole.entities.ContadorPedidoInterno
        .filter({ chave: CHAVE }, '-ultimo_numero', 1);
      if (!atual.length) {
        return Response.json({ sucesso: false, erro: 'Contador não encontrado após bootstrap.' }, { status: 500 });
      }
      const contador = atual[0];
      contadorId = contador.id;

      const lockExpirado = contador.lock_ativo &&
        contador.lock_ate &&
        new Date(contador.lock_ate).getTime() < Date.now();

      if (!contador.lock_ativo || lockExpirado) {
        // Gera token único para este processo
        const meuToken = crypto.randomUUID();

        // Grava lock_ativo=true + token atomicamente
        await base44.asServiceRole.entities.ContadorPedidoInterno.update(contador.id, {
          lock_ativo: true,
          lock_ate: new Date(Date.now() + LOCK_TTL_MS).toISOString(),
          lock_token: meuToken
        });

        // Pausa mínima para o banco propagar a escrita antes de confirmar
        await sleep(80);

        // Re-lê para confirmar que FOI ESTE PROCESSO que ganhou o lock
        const conf = await base44.asServiceRole.entities.ContadorPedidoInterno
          .filter({ chave: CHAVE }, '-ultimo_numero', 1);
        const confContador = conf[0];

        if (confContador?.lock_token === meuToken && confContador?.lock_ativo) {
          // Lock confirmado — somos os donos da seção crítica
          lockAdquirido = true;
          contadorFinal = confContador;
          break;
        }
        // Outro processo ganhou — volta ao retry
      }

      // Backoff progressivo: 150ms, 200ms, 250ms… cap 500ms
      const delay = Math.min(DELAY_BASE_MS + tentativa * 50, DELAY_MAX_MS);
      await sleep(delay);
    }

    if (!lockAdquirido || !contadorFinal) {
      return Response.json({
        sucesso: false,
        erro: 'Sistema ocupado — tente novamente em alguns segundos.'
      }, { status: 503 });
    }

    // ─── PASSO 4: seção crítica — incrementa e libera ────────────────────────
    const novoNumero = (contadorFinal.ultimo_numero || 0) + 1;
    const numeroFormatado = formatarNumeroInterno(novoNumero, sufixo);

    await base44.asServiceRole.entities.ContadorPedidoInterno.update(contadorFinal.id, {
      ultimo_numero: novoNumero,
      lock_ativo: false,
      lock_ate: null,
      lock_token: null
    });

    return Response.json({
      sucesso: true,
      numero: numeroFormatado, // ex: "01108D"
      numero_raw: novoNumero   // ex: 1108
    });

  } catch (error) {
    // Libera o lock mesmo em caso de erro não tratado
    if (base44Instance && contadorId) {
      base44Instance.asServiceRole.entities.ContadorPedidoInterno
        .update(contadorId, { lock_ativo: false, lock_ate: null, lock_token: null })
        .catch(() => {});
    }
    return Response.json({ sucesso: false, erro: error.message }, { status: 500 });
  }
});