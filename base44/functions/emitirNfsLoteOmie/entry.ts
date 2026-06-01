import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

function formatDatePt(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
}

async function verificarJaFaturado(base44, codigoPedido) {
  const codigo = String(codigoPedido);
  const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigo }, '-updated_date', 1);
  const pedido = pedidos?.[0];
  if (pedido?.numero_nota_fiscal || pedido?.status_faturamento === 'faturado' || pedido?.faturado === true) {
    return {
      bloqueado: true,
      mensagem: `Pedido #${pedido.numero_pedido || codigo} já foi faturado em ${formatDatePt(pedido.data_faturamento || pedido.updated_date)}. NF: ${pedido.numero_nota_fiscal || '-'}`
    };
  }

  const logsNF = await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: codigo, status: 'autorizada' }, '-created_date', 1).catch(() => []);
  if (logsNF?.[0]) {
    return {
      bloqueado: true,
      mensagem: `Pedido #${logsNF[0].numero_pedido || codigo} já foi faturado em ${formatDatePt(logsNF[0].created_date)}. NF: ${logsNF[0].numero_nf || '-'}`
    };
  }

  const logs = await base44.asServiceRole.entities.LogIntegracaoOmie.filter({ call: 'FaturarPedidoVenda', status: 'sucesso' }, '-created_date', 50).catch(() => []);
  const log = logs.find(l => String(l.payload_enviado || '').includes(codigo));
  if (log) {
    return {
      bloqueado: true,
      mensagem: `Pedido #${pedido?.numero_pedido || codigo} já possui emissão registrada em ${formatDatePt(log.created_date)}. NF: ${pedido?.numero_nota_fiscal || '-'}`
    };
  }

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

    await Promise.all(codigosValidos.map(async (codigo) => {
      const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigo }, '-updated_date', 1).catch(() => []);
      if (pedidos?.[0]?.id) await base44.asServiceRole.entities.Pedido.update(pedidos[0].id, { status_faturamento: 'processando' }).catch(() => {});
    }));

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