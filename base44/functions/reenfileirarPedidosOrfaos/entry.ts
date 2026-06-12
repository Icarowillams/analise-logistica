import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Destrava pedidos ÓRFÃOS: status='pendente', omie_enviado=false, sem data_envio,
 * que NÃO possuem entrada ativa na FilaEnvioPedidoOmie.
 *
 * Trata os DOIS tipos exatamente como o fluxo de envio do app (EnvioPedidos):
 *  - VENDA (externo, vai ao Omie): recria entrada na FilaEnvioPedidoOmie → processamento
 *    sequencial envia ao Omie. (enfileirar é só gravação local)
 *  - TROCA / D1 (interno, NÃO vai ao Omie): processa localmente — gera número com
 *    sufixo "D", seta status='enviado' + data_envio, omie_erro=null. Sai de "Pendente"
 *    exatamente como sairia se o vendedor clicasse "Enviar" com a Omie funcionando.
 */

// Gera próximo número interno (sufixo "D") — mesma lógica de getNextNumeroLocal no front
function gerarNumeroInterno(maxNumRef) {
  maxNumRef.valor += 1;
  return String(maxNumRef.valor).padStart(5, '0') + 'D';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Pedidos pendentes não enviados (sem data_envio = órfãos do fluxo de envio)
    const pendentes = await base44.asServiceRole.entities.Pedido.filter({
      status: 'pendente',
      omie_enviado: false
    }, '-created_date', 5000);

    const candidatos = pendentes.filter(p => !p.data_envio);

    // Classificar: interno (troca / d1) vs externo (vai ao Omie)
    const isInterno = (p) => p.tipo === 'troca' || p.modelo_nota === 'd1';
    const internos = candidatos.filter(isInterno);
    const externos = candidatos.filter(p => !isInterno(p));

    // 2. Fila existente — externos que já têm entrada ativa não são reenfileirados
    const fila = await base44.asServiceRole.entities.FilaEnvioPedidoOmie.list('-created_date', 5000);
    const jaNaFila = new Set(
      fila
        .filter(f => ['pendente', 'processando', 'erro'].includes(f.status))
        .map(f => f.pedido_id)
    );
    const externosOrfaos = externos.filter(p => !jaNaFila.has(p.id));

    // ===== VENDAS: reenfileira na FilaEnvioPedidoOmie =====
    if (externosOrfaos.length > 0) {
      const registros = externosOrfaos.map(p => ({
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
    }

    // ===== TROCAS / D1: processa localmente (sai de Pendente, sem Omie) =====
    // Calcular o maior número interno atual (sufixo D ou T) para sequenciar
    const todosPedidos = await base44.asServiceRole.entities.Pedido.list('-created_date', 20000);
    let maxNum = 0;
    todosPedidos.forEach(p => {
      if (p.numero_pedido && /[DT]$/i.test(String(p.numero_pedido))) {
        const num = parseInt(String(p.numero_pedido).replace(/\D/g, ''), 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    });
    const maxNumRef = { valor: maxNum };

    let internosProcessados = 0;
    for (const p of internos) {
      const numero = gerarNumeroInterno(maxNumRef);
      await base44.asServiceRole.entities.Pedido.update(p.id, {
        status: 'enviado',
        numero_pedido: numero,
        data_envio: new Date().toISOString(),
        omie_erro: null
      });
      internosProcessados++;
    }

    return Response.json({
      sucesso: true,
      total_orfaos: candidatos.length,
      vendas_reenfileiradas: externosOrfaos.length,
      vendas_ja_na_fila: externos.length - externosOrfaos.length,
      trocas_processadas: internosProcessados,
      reenfileirados: externosOrfaos.length + internosProcessados,
      detalhe: candidatos.map(p => ({
        pedido_id: p.id,
        tipo: p.tipo,
        modelo_nota: p.modelo_nota,
        cliente_nome: p.cliente_nome || '',
        vendedor_nome: p.vendedor_nome || ''
      }))
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});