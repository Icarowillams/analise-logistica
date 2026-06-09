import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// FUNÇÃO TEMPORÁRIA DE DIAGNÓSTICO — SEM AUTENTICAÇÃO
// Remover após uso.
//
// Campo correto: processamento_omie_status (não "proc_omie")
// "Aguardando fila" na UI = processamento_omie_status === 'nao_iniciado'
// Valores possíveis: nao_iniciado | em_andamento | concluido | parcial | erro

const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // 1. Estado do circuit breaker
    const cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie
      .filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
    const cb = cbRows?.[0] || null;

    const agora = Date.now();
    const bloqueadoAte = cb?.bloqueado_ate ? new Date(cb.bloqueado_ate).getTime() : 0;
    const bloqueadoAtivo = cb?.bloqueado && bloqueadoAte > agora;
    const tempoRestanteSeg = bloqueadoAtivo ? Math.ceil((bloqueadoAte - agora) / 1000) : 0;

    const circuitBreaker = cb ? {
      id: cb.id,
      bloqueado: cb.bloqueado ?? false,
      bloqueado_ativo: bloqueadoAtivo,
      bloqueado_ate: cb.bloqueado_ate ?? null,
      tempo_restante_segundos: tempoRestanteSeg,
      erros_consecutivos: cb.erros_consecutivos ?? 0,
      threshold_erros: cb.threshold_erros ?? 3,
      ultimo_erro: cb.ultimo_erro ?? null,
      atualizado_em: cb.atualizado_em ?? null,
    } : { encontrado: false };

    // 2. Cargas "Aguardando fila" = processamento_omie_status = 'nao_iniciado'
    const cargas = await base44.asServiceRole.entities.Carga
      .filter({ processamento_omie_status: 'nao_iniciado' }, 'updated_date', 200).catch(() => []);

    const agora30 = new Date(agora - 30 * 60 * 1000).toISOString();
    const cargasAguardando = (cargas || []).map(c => ({
      id: c.id,
      numero_carga: c.numero_carga ?? null,
      status_carga: c.status_carga ?? null,
      processamento_omie_status: c.processamento_omie_status ?? null,
      processamento_omie_total: c.processamento_omie_total ?? 0,
      updated_date: c.updated_date ?? null,
      created_date: c.created_date ?? null,
      atraso_maior_30min: c.updated_date ? c.updated_date < agora30 : null,
    }));

    // 3. Carga 132 — todos os campos (numero_carga pode ser string '132')
    const carga132Rows = await base44.asServiceRole.entities.Carga
      .filter({ numero_carga: '132' }, '-created_date', 1).catch(() => []);
    const carga132 = carga132Rows?.[0] || null;

    // Campos escalares de carga 132 (omite arrays grandes para legibilidade)
    const carga132Resumo = carga132 ? {
      id: carga132.id,
      numero_carga: carga132.numero_carga,
      status_carga: carga132.status_carga,
      processamento_omie_status: carga132.processamento_omie_status,
      processamento_omie_total: carga132.processamento_omie_total,
      data_carga: carga132.data_carga,
      data_faturamento: carga132.data_faturamento,
      motorista_nome: carga132.motorista_nome,
      rota_nome: carga132.rota_nome,
      quantidade_pedidos: carga132.quantidade_pedidos,
      valor_total: carga132.valor_total,
      observacao: carga132.observacao,
      updated_date: carga132.updated_date,
      created_date: carga132.created_date,
      pedidos_omie_count: Array.isArray(carga132.pedidos_omie) ? carga132.pedidos_omie.length : 0,
      pedidos_omie_codigos: Array.isArray(carga132.pedidos_omie)
        ? carga132.pedidos_omie.map(p => ({ codigo: p.codigo_pedido, etapa: p.etapa, numero: p.numero_pedido }))
        : [],
    } : null;

    // 4. Últimos 5 logs
    const logs = await base44.asServiceRole.entities.LogIntegracaoOmie
      .filter({}, '-created_date', 5).catch(() => []);

    const ultimosLogs = (logs || []).map(l => ({
      id: l.id,
      created_date: l.created_date ?? null,
      endpoint: l.endpoint ?? null,
      call: l.call ?? null,
      operacao: l.operacao ?? null,
      status: l.status ?? null,
      mensagem_erro: l.mensagem_erro ?? null,
    }));

    return Response.json({
      timestamp: new Date().toISOString(),
      nota_campo: 'processamento_omie_status (não proc_omie). "Aguardando fila" = nao_iniciado',
      circuit_breaker: circuitBreaker,
      cargas_aguardando_fila: {
        total: cargasAguardando.length,
        com_atraso_maior_30min: cargasAguardando.filter(c => c.atraso_maior_30min).length,
        itens: cargasAguardando,
      },
      carga_132: carga132Resumo,
      ultimos_logs_integracao: ultimosLogs,
    });
  } catch (error) {
    return Response.json({ erro: error.message, stack: error.stack }, { status: 500 });
  }
});
