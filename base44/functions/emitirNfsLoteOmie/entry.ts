import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function formatDatePt(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
}

async function verificarJaFaturado(base44, codigoPedido) {
  const codigo = String(codigoPedido);

  // 1. Verificar se já existe NF emitida no espelho PedidoLiberadoOmie (fonte mais confiável)
  const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: codigo }, '-updated_date', 1).catch(() => []);
  const espelho = espelhos?.[0];
  if (espelho?.etapa === '60' && espelho?.numero_nf) {
    return {
      bloqueado: true,
      mensagem: `Pedido #${espelho.numero_pedido || codigo} já possui NF emitida: ${espelho.numero_nf}. Etapa 60 no Omie.`
    };
  }

  // 2. Verificar se o Pedido local tem NF real preenchida (não apenas flags de status)
  const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigo }, '-updated_date', 1).catch(() => []);
  const pedido = pedidos?.[0];
  if (pedido?.numero_nota_fiscal) {
    return {
      bloqueado: true,
      mensagem: `Pedido #${pedido.numero_pedido || codigo} já foi faturado em ${formatDatePt(pedido.data_faturamento || pedido.updated_date)}. NF: ${pedido.numero_nota_fiscal}`
    };
  }

  // 3. Verificar log de emissão autorizada pela SEFAZ
  const logsNF = await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: codigo, status: 'autorizada' }, '-created_date', 1).catch(() => []);
  if (logsNF?.[0]) {
    return {
      bloqueado: true,
      mensagem: `Pedido #${logsNF[0].numero_pedido || codigo} já foi faturado em ${formatDatePt(logsNF[0].created_date)}. NF: ${logsNF[0].numero_nf || '-'}`
    };
  }

  // NÃO bloquear baseado apenas em flags locais (faturado, status_faturamento) nem em logs genéricos de FaturarPedidoVenda,
  // pois esses são setados pelo fechamento de carga antes da emissão real da NF.
  return { bloqueado: false };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const codigosPedido = Array.isArray(body.codigos_pedido)
      ? body.codigos_pedido.map(c => String(c)).filter(Boolean)
      : [];

    if (codigosPedido.length === 0) {
      return Response.json({ error: 'codigos_pedido vazio' }, { status: 400 });
    }

    // Circuit breaker: não enfileira emissão se a API Omie estiver bloqueada por consumo indevido (425).
    const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
    const controle = cb?.[0];
    if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
      return Response.json({
        sucesso: false,
        error: `API Omie temporariamente bloqueada por consumo indevido. Desbloqueio previsto: ${new Date(controle.bloqueado_ate).toLocaleString('pt-BR')}.`,
        omie_bloqueada: true,
        bloqueado_ate: controle.bloqueado_ate
      }, { status: 425 });
    }

    const errosDuplicidade = [];
    const codigosValidos = [];
    for (const codigo of codigosPedido) {
      const check = await verificarJaFaturado(base44, codigo);
      if (check.bloqueado) errosDuplicidade.push({ codigo_pedido: codigo, mensagem: check.mensagem });
      else codigosValidos.push(codigo);
    }

    if (errosDuplicidade.length > 0 && codigosValidos.length === 0) {
      return Response.json({ sucesso: false, error: errosDuplicidade[0].mensagem, erros: errosDuplicidade }, { status: 409 });
    }

    const loteId = `LOTE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fila = await base44.asServiceRole.entities.FilaEmissaoNF.create({
      tipo: 'emissao_nf_lote',
      lote_id: loteId,
      carga_id: body.carga_id || '',
      numero_carga: body.numero_carga || '',
      total_pedidos: codigosValidos.length,
      processados: 0,
      status: 'processando',
      pedidos: codigosValidos,
      resultados: [],
      erros: errosDuplicidade,
      mensagem: 'Faturamento iniciado em background. Acompanhe o progresso na tela.',
      usuario_email: user.email,
      iniciado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString()
    });

    const LOTE = 5;
    for (let i = 0; i < codigosValidos.length; i += LOTE) {
      const lote = codigosValidos.slice(i, i + LOTE);
      await Promise.all(lote.map(async (codigo) => {
        const pedidos = await base44.asServiceRole.entities.Pedido
          .filter({ omie_codigo_pedido: codigo }, '-updated_date', 1)
          .catch(() => []);
        if (pedidos?.[0]?.id) {
          await base44.asServiceRole.entities.Pedido
            .update(pedidos[0].id, { status_faturamento: 'processando' })
            .catch(() => {});
        }
      }));
      if (i + LOTE < codigosValidos.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    return Response.json({
      sucesso: true,
      assincrono: true,
      fila_id: fila.id,
      lote_id: loteId,
      status: 'processando',
      total: codigosValidos.length,
      ignorados: errosDuplicidade.length,
      erros: errosDuplicidade,
      mensagem: 'Faturamento iniciado em background. Acompanhe o progresso na tela.'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});