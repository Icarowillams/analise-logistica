import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clientes, enviar_omie = true } = await req.json();

    if (!clientes || !Array.isArray(clientes) || clientes.length === 0) {
      return Response.json({ error: 'clientes array é obrigatório' }, { status: 400 });
    }

    let atualizados = 0;
    const detalhesErros = [];
    const idsAtualizadosOk = []; // IDs realmente atualizados — serão enviados ao Omie depois

    // Preparar dados para bulkUpdate
    const updates = clientes.map(c => ({
      id: c.id,
      ...c.data
    }));

    // Processar em sub-lotes de 50 para evitar rate limits
    const SUB_BATCH = 50;
    for (let i = 0; i < updates.length; i += SUB_BATCH) {
      const batch = updates.slice(i, i + SUB_BATCH);
      
      let success = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await base44.asServiceRole.entities.Cliente.bulkUpdate(batch);
          atualizados += batch.length;
          batch.forEach(b => idsAtualizadosOk.push(b.id));
          success = true;
          break;
        } catch (e) {
          const isRateLimit = e.message?.includes('Rate limit') || e.message?.includes('429');
          if (isRateLimit && attempt < 2) {
            const waitMs = 3000 * Math.pow(2, attempt);
            console.log(`[bulkUpdate] Rate limit sub-lote ${i}, tentativa ${attempt + 1}, aguardando ${waitMs}ms`);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }
          
          // Fallback: atualizar individualmente
          console.log(`[bulkUpdate] Bulk falhou, tentando individual para ${batch.length} clientes`);
          for (const item of batch) {
            try {
              const { id, ...data } = item;
              await base44.asServiceRole.entities.Cliente.update(id, data);
              atualizados++;
              idsAtualizadosOk.push(id);
              await new Promise(r => setTimeout(r, 100));
            } catch (itemErr) {
              detalhesErros.push({ id: item.id, error: itemErr.message });
            }
          }
          success = true;
          break;
        }
      }

      // Delay entre sub-lotes
      if (i + SUB_BATCH < updates.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // ===== Espelhar cada cliente atualizado no Omie =====
    // Invoca enviarClienteOmie individualmente (a função já trata D1, dedup por CNPJ, retries etc).
    let omieEnviados = 0;
    let omieErros = 0;
    let omiePulados = 0;
    const omieDetalhesErros = [];

    if (enviar_omie && idsAtualizadosOk.length > 0) {
      console.log(`[bulkUpdate] Iniciando envio Omie para ${idsAtualizadosOk.length} clientes...`);

      for (const clienteId of idsAtualizadosOk) {
        try {
          const cliente = await base44.asServiceRole.entities.Cliente.get(clienteId);
          if (!cliente) continue;

          // Pular clientes D1 (não vão para o Omie)
          if (cliente.tipo_nota === 'D1') {
            omiePulados++;
            continue;
          }

          const res = await base44.asServiceRole.functions.invoke('enviarClienteOmie', {
            event: { type: 'manual_bulk_update', entity_id: clienteId },
            data: cliente
          });

          const respData = res?.data || {};
          if (respData.sucesso) {
            omieEnviados++;
          } else if (respData.pulado) {
            omiePulados++;
          } else {
            omieErros++;
            omieDetalhesErros.push({ id: clienteId, error: respData.erro || 'Erro desconhecido' });
          }

          // Delay pequeno entre clientes para não estourar rate limit do Omie
          await new Promise(r => setTimeout(r, 250));
        } catch (e) {
          omieErros++;
          omieDetalhesErros.push({ id: clienteId, error: e.message });
        }
      }
      console.log(`[bulkUpdate] Omie: ${omieEnviados} enviados, ${omiePulados} pulados (D1), ${omieErros} erros`);
    }

    return Response.json({
      sucesso: true,
      atualizados,
      erros: detalhesErros.length,
      detalhesErros,
      total: clientes.length,
      omie: {
        enviados: omieEnviados,
        pulados: omiePulados,
        erros: omieErros,
        detalhesErros: omieDetalhesErros.slice(0, 20)
      }
    });
  } catch (error) {
    console.error('[bulkUpdateClientes] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});