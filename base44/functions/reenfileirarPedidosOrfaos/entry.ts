import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Reenfileira pedidos ÓRFÃOS: status='pendente', omie_enviado=false, sem data_envio,
 * que NÃO possuem entrada ativa na FilaEnvioPedidoOmie.
 *
 * Esses pedidos ficaram presos quando o enfileiramento falhou silenciosamente
 * (ex: circuit breaker bloqueado / rate limit Omie). Enfileirar é só gravar local,
 * então aqui recriamos a entrada na fila para o processamento sequencial enviá-los.
 *
 * Dedup: não reenfileira pedido que já tenha entrada pendente/processando/erro na fila.
 * Ignora internos (troca / modelo_nota d1), que não vão ao Omie.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dryRun = false;

    // 1. Pedidos pendentes não enviados
    const pendentes = await base44.asServiceRole.entities.Pedido.filter({
      status: 'pendente',
      omie_enviado: false
    }, '-created_date', 5000);

    // Considera órfão apenas o que não tem data_envio e NÃO é interno (troca/d1)
    const candidatos = pendentes.filter(p =>
      !p.data_envio &&
      p.tipo !== 'troca' &&
      p.modelo_nota !== 'd1'
    );

    // 2. Fila existente — mapa de pedido_id com entrada ativa (pendente/processando/erro)
    const fila = await base44.asServiceRole.entities.FilaEnvioPedidoOmie.list('-created_date', 5000);
    const jaNaFila = new Set(
      fila
        .filter(f => ['pendente', 'processando', 'erro'].includes(f.status))
        .map(f => f.pedido_id)
    );

    // 3. Órfãos = candidatos sem entrada ativa na fila
    const orfaos = candidatos.filter(p => !jaNaFila.has(p.id));

    const detalhe = orfaos.map(p => ({
      pedido_id: p.id,
      numero_pedido: p.numero_pedido || '',
      cliente_nome: p.cliente_nome || '',
      vendedor_nome: p.vendedor_nome || '',
      created_date: p.created_date
    }));

    if (dryRun || orfaos.length === 0) {
      return Response.json({
        sucesso: true,
        total_pendentes: candidatos.length,
        ja_na_fila: candidatos.length - orfaos.length,
        reenfileirados: 0,
        orfaos_encontrados: orfaos.length,
        detalhe
      });
    }

    // 4. Reenfileira em lote (dedup garantido pelo Set acima)
    const registros = orfaos.map(p => ({
      pedido_id: p.id,
      numero_pedido: p.numero_pedido || '',
      cliente_nome: p.cliente_nome || '',
      vendedor_id: p.vendedor_id || '',
      operacao: 'enviar',
      status: 'pendente',
      tentativas: 0,
      usuario_email: user.email || ''
    }));

    await base44.asServiceRole.entities.FilaEnvioPedidoOmie.bulkCreate(registros);

    return Response.json({
      sucesso: true,
      total_pendentes: candidatos.length,
      ja_na_fila: candidatos.length - orfaos.length,
      reenfileirados: orfaos.length,
      detalhe
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});