import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const simulacao = body.simulacao === true || body.simular === true;
    const tipoPadrao = body.tipo_padrao || body.tipoNotaPadrao || '55';
    const offset = Number(body.offset) || 0;
    const limite = Number(body.limite) || 80; // bloco pequeno para evitar rate limit

    // Buscar todos os clientes
    const todos = await base44.asServiceRole.entities.Cliente.list('-created_date', 10000);
    const semTipo = todos.filter(c => !c.tipo_nota || c.tipo_nota === '');
    const totalPendente = semTipo.length;

    console.log(`Total clientes: ${todos.length} | Sem tipo_nota: ${totalPendente} | offset: ${offset} | limite: ${limite}`);

    if (simulacao) {
      return Response.json({
        simulacao: true,
        total_clientes: todos.length,
        sem_tipo_nota: totalPendente,
        serao_atualizados_para: tipoPadrao,
        amostra: semTipo.slice(0, 5).map(c => ({
          id: c.id,
          codigo: c.codigo_interno,
          razao_social: c.razao_social,
          tipo_nota_atual: c.tipo_nota || '(vazio)'
        }))
      });
    }

    // Seleciona somente o bloco atual
    const bloco = semTipo.slice(offset, offset + limite);
    let atualizados = 0;
    let erros = 0;
    const detalhesErros = [];

    // Processamento SEQUENCIAL (para evitar rate-limit 429)
    for (const c of bloco) {
      let tentativa = 0;
      let sucesso = false;
      while (tentativa < 5 && !sucesso) {
        try {
          await base44.asServiceRole.entities.Cliente.update(c.id, { tipo_nota: tipoPadrao });
          atualizados++;
          sucesso = true;
        } catch (err) {
          tentativa++;
          if (tentativa >= 5) {
            erros++;
            detalhesErros.push({ id: c.id, codigo: c.codigo_interno, erro: err.message });
          } else {
            // backoff: 2s, 4s, 8s, 16s (rate-limit agressivo)
            const delay = 2000 * Math.pow(2, tentativa - 1);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }
      // Delay maior entre cada update para respeitar rate limit do Base44 SDK
      await new Promise(r => setTimeout(r, 350));
    }

    const proximoOffset = offset + bloco.length;
    const restantes = Math.max(0, totalPendente - proximoOffset);

    return Response.json({
      sucesso: true,
      bloco_processado: bloco.length,
      atualizados,
      erros,
      tipo_aplicado: tipoPadrao,
      offset_atual: offset,
      proximo_offset: proximoOffset,
      restantes,
      total_pendente_inicial: totalPendente,
      concluido: restantes === 0,
      amostra_erros: detalhesErros.slice(0, 5)
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});