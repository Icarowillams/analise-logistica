import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

// Sincroniza notas do AcertoCaixa com o status atual no Omie.
// Para cada nota, chama ConsultarPedido. Se etapa indicar cancelamento ou
// pedido em etapa de "não entregue", marca como nao_entregue com valor_recebido = 0.
// Também troca a etapa no Omie para "não entregue" quando apropriado.

async function getOmieCredentials(base44: any) {
  try {
    const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
    if (rows.length > 0) return { appKey: rows[0].omie_app_key, appSecret: rows[0].omie_app_secret };
  } catch (_) { /* ignore */ }
  const appKey = Deno.env.get('OMIE_APP_KEY') || '';
  const appSecret = Deno.env.get('OMIE_APP_SECRET') || '';
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  if (rows.length > 0 && rows[0].bloqueado) {
    const ate = new Date(rows[0].bloqueado_ate || 0);
    if (ate > new Date()) throw new Error(`Circuit breaker ativo até ${ate.toISOString()}`);
  }
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  await checkCircuitBreaker(base44);
  const { appKey, appSecret } = await getOmieCredentials(base44);
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas');
  const call = options.call || endpoint;
  const url = `https://app.omie.com.br/api/v1/${endpoint}`;
  const body = JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Omie ${call} HTTP ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function consultarPedidoComRetry(base44: any, codigoPedido: number, tentativa = 1): Promise<any> {
  try {
    return await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(codigoPedido) }, { call: 'ConsultarPedido' });
  } catch (e) {
    const msg = (e.message || '').toLowerCase();
    const transient = msg.includes('429') || msg.includes('cota') || msg.includes('aguarde') || msg.includes('limite');
    if (transient && tentativa < 4) {
      await new Promise(r => setTimeout(r, 3000 * tentativa));
      return consultarPedidoComRetry(base44, codigoPedido, tentativa + 1);
    }
    throw e;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { acerto_id } = await req.json().catch(() => ({}));
    if (!acerto_id) return Response.json({ error: 'acerto_id obrigatório' }, { status: 400 });

    const acerto = await base44.asServiceRole.entities.AcertoCaixa.get(acerto_id);
    if (!acerto) return Response.json({ error: 'Acerto não encontrado' }, { status: 404 });

    const notas = acerto.notas || [];
    let alteradas = 0;
    const etapasTrocadas = [];

    for (const nota of notas) {
      if (!nota.codigo_pedido) continue;
      // Pula notas já marcadas como não entregue pelo Omie
      if (nota.status_entrega === 'nao_entregue' && (nota.motivo_cancelamento || '').toLowerCase().includes('cancelada no omie')) continue;

      let data: any;
      try {
        data = await consultarPedidoComRetry(base44, nota.codigo_pedido);
      } catch (e) {
        const msg = (e.message || '').toLowerCase();
        // Pedido não encontrado/cancelado = tratar como cancelado
        if (msg.includes('cancelad') || msg.includes('exclu') || msg.includes('não encontrad') || msg.includes('nao encontrad')) {
          nota.status_entrega = 'nao_entregue';
          nota.valor_recebido = 0;
          nota.diferenca = -Number(nota.valor_original || 0);
          nota.motivo_cancelamento = 'Cancelada no Omie';
          alteradas++;
          continue;
        }
        console.warn(`[sincronizarAcertoOmie] Erro ao consultar pedido ${nota.codigo_pedido}: ${e.message}`);
        continue;
      }

      const fs = (data?.faultstring || '').toLowerCase();
      const ped = data?.pedido_venda_produto || {};
      const etapa = ped?.cabecalho?.etapa || '';
      const numeroNfRet = ped?.informacoes_adicionais?.numero_pedido_cliente || '';
      const isCancelado = fs.includes('cancelad') || fs.includes('excluíd') || fs.includes('excluid') || etapa === '99' || etapa === '80' || etapa === 'cancelado';

      if (isCancelado) {
        nota.status_entrega = 'nao_entregue';
        nota.valor_recebido = 0;
        nota.diferenca = -Number(nota.valor_original || 0);
        nota.motivo_cancelamento = 'Cancelada no Omie';
        if (!nota.numero_nfe && numeroNfRet) nota.numero_nfe = String(numeroNfRet);
        alteradas++;
      }

      // Delay entre consultas para não estourar rate limit
      await new Promise(r => setTimeout(r, 1200));
    }

    // Recalcula totais
    const valor_total_recebido = notas.reduce((s, n) => s + Number(n.valor_recebido || 0), 0);
    const valor_total_diferenca = notas.reduce((s, n) => s + Number(n.diferenca || 0), 0);

    const updates: any = {
      notas,
      valor_total_recebido,
      valor_total_diferenca
    };

    // Se a carga foi cancelada no Omie, finaliza o acerto automaticamente
    let autoFinalizado = false;
    if (acerto.status_acerto === 'em_andamento' && acerto.carga_id) {
      const carga = await base44.asServiceRole.entities.Carga.get(acerto.carga_id).catch(() => null);
      if (carga?.status_carga === 'cancelada') {
        updates.status_acerto = 'finalizado';
        updates.finalizado_em = new Date().toISOString();
        updates.finalizado_por = 'auto-sync (carga cancelada no Omie)';
        autoFinalizado = true;
      }
    }

    await base44.asServiceRole.entities.AcertoCaixa.update(acerto_id, updates);

    return Response.json({ sucesso: true, alteradas, total: notas.length, autoFinalizado, etapasTrocadas: etapasTrocadas.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
