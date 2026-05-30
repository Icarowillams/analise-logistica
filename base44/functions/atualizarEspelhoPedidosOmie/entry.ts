import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function deveCancelar(dados) {
  return dados?.status === 'nao_encontrado' || dados?.etapa === '70' || dados?.etapa === '80';
}

function deveFaturar(dados) {
  return dados?.etapa === '60' || dados?.status === 'faturado' || Boolean(dados?.numero_nf);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const resultados = body.resultados || {};
    const codigos = Object.keys(resultados).filter(Boolean);

    if (codigos.length === 0) {
      return Response.json({ sucesso: true, atualizados: 0 });
    }

    let atualizados = 0;

    const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: { $in: codigos } }, '-updated_date', 500).catch(() => []);
    for (const espelho of espelhos) {
      const dados = resultados[String(espelho.codigo_pedido)];
      if (!dados) continue;

      const payload = {
        etapa: dados.etapa || espelho.etapa,
        status_real: dados.status || espelho.status_real,
        status_label: dados.status || espelho.status_label,
        numero_nf: dados.numero_nf || '',
        sincronizado_em: new Date().toISOString(),
        origem_sync: 'reconciliacao'
      };

      if (espelho.etapa !== payload.etapa || espelho.status_real !== payload.status_real || String(espelho.numero_nf || '') !== String(payload.numero_nf || '')) {
        await base44.asServiceRole.entities.PedidoLiberadoOmie.update(espelho.id, payload).catch(() => {});
        atualizados++;
      }
    }

    const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: { $in: codigos } }, '-updated_date', 500).catch(() => []);
    for (const pedido of pedidos) {
      const dados = resultados[String(pedido.omie_codigo_pedido)];
      if (!dados) continue;

      if (deveCancelar(dados)) {
        await base44.asServiceRole.entities.Pedido.update(pedido.id, {
          status: 'cancelado',
          status_faturamento: 'pendente',
          motivo_cancelamento: `Atualizado por sincronização Omie: ${dados.status}`,
          data_cancelamento: new Date().toISOString(),
          cancelado_por: 'sistema',
          cancelado_por_nome: 'Sincronização Omie'
        }).catch(() => {});
        atualizados++;
      } else if (deveFaturar(dados)) {
        await base44.asServiceRole.entities.Pedido.update(pedido.id, {
          status: 'faturado',
          status_faturamento: 'faturado',
          faturado: true,
          numero_nota_fiscal: dados.numero_nf || pedido.numero_nota_fiscal || '',
          data_faturamento: pedido.data_faturamento || new Date().toISOString()
        }).catch(() => {});
        atualizados++;
      }
    }

    const codigosCancelar = new Set(codigos.filter(codigo => deveCancelar(resultados[codigo])));
    if (codigosCancelar.size > 0) {
      const cargas = await base44.asServiceRole.entities.Carga.filter({ status_carga: 'faturada' }, '-updated_date', 200).catch(() => []);
      for (const carga of cargas) {
        const pedidosOmie = Array.isArray(carga.pedidos_omie) ? carga.pedidos_omie : [];
        let alterou = false;
        const pedidosAtualizados = pedidosOmie.map(p => {
          if (!codigosCancelar.has(String(p.codigo_pedido))) return p;
          alterou = true;
          return { ...p, numero_nf: '' };
        });

        if (alterou) {
          await base44.asServiceRole.entities.Carga.update(carga.id, {
            pedidos_omie: pedidosAtualizados,
            status_carga: 'faturada_com_rejeicao'
          }).catch(() => {});
          atualizados++;
        }
      }
    }

    return Response.json({ sucesso: true, atualizados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});