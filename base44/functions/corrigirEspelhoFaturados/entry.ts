import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Corrige pedidos do espelho que estão em etapa 50 mas o Pedido local já foi marcado como faturado.
// Não chama a API Omie — usa apenas dados locais para a correção.
// Ideal para resolver divergências em massa sem risco de rate limit.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Acesso negado — admin apenas' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const { dry_run = false, data_envio_inicio, data_envio_fim } = body;

    // Buscar pedidos locais faturados
    const pedidosFaturados = await base44.asServiceRole.entities.Pedido.filter(
      { status: 'faturado', omie_enviado: true },
      '-created_date',
      3000
    );

    // Filtrar por data de envio se informado
    const pedidosFiltrados = pedidosFaturados.filter(p => {
      if (!p.omie_codigo_pedido) return false;
      if (!data_envio_inicio && !data_envio_fim) return true;
      const dataEnvio = p.data_envio ? p.data_envio.split('T')[0] : null;
      if (!dataEnvio) return false;
      if (data_envio_inicio && dataEnvio < data_envio_inicio) return false;
      if (data_envio_fim && dataEnvio > data_envio_fim) return false;
      return true;
    });

    const codigosFaturados = new Set(pedidosFiltrados.map(p => String(p.omie_codigo_pedido)));

    // Buscar espelho com etapa != 60 para esses pedidos
    const espelho = await base44.asServiceRole.entities.PedidoLiberadoOmie.list('-sincronizado_em', 5000);
    
    const divergentes = espelho.filter(e => {
      const cod = String(e.codigo_pedido || '');
      return codigosFaturados.has(cod) && e.etapa !== '60';
    });

    const detalhes = divergentes.map(e => ({
      numero_pedido: e.numero_pedido,
      codigo_pedido: e.codigo_pedido,
      etapa_atual: e.etapa,
      pedido_id: e.pedido_id
    }));

    if (!dry_run) {
      const LOTE = 10;
      for (let i = 0; i < divergentes.length; i += LOTE) {
        const lote = divergentes.slice(i, i + LOTE);
        await Promise.all(lote.map(async (e) => {
          // Busca dados do pedido local para pegar NF e data
          const pedidoLocal = pedidosFiltrados.find(p => String(p.omie_codigo_pedido) === String(e.codigo_pedido));
          const update = {
            etapa: '60',
            status_real: 'emitida',
            status_label: 'Faturado',
            sincronizado_em: new Date().toISOString(),
            origem_sync: 'reconciliacao'
          };
          if (pedidoLocal?.numero_nota_fiscal) update.numero_nf = pedidoLocal.numero_nota_fiscal;
          if (pedidoLocal?.data_faturamento) update.data_faturamento = pedidoLocal.data_faturamento;

          await base44.asServiceRole.entities.PedidoLiberadoOmie.update(e.id, update);
        }));
        if (i + LOTE < divergentes.length) await new Promise(r => setTimeout(r, 300));
      }
    }

    return Response.json({
      sucesso: true,
      dry_run,
      total_faturados_local: pedidosFiltrados.length,
      divergentes: divergentes.length,
      corrigidos: dry_run ? 0 : divergentes.length,
      detalhes: detalhes.slice(0, 150)
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});