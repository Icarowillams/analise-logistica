import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Apenas administradores podem executar esta operacao' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const apenasSimular = body.simular === true;

    console.log('[atualizarNomesClientesComCodigo] Iniciando... simular:', apenasSimular);

    // Etapa 1: Ler todos os clientes
    let todosClientes = [];
    let pagina = 0;
    while (true) {
      const lote = await base44.asServiceRole.entities.Cliente.list('-updated_date', 200, pagina * 200);
      if (!lote || lote.length === 0) break;
      todosClientes.push(...lote);
      if (lote.length < 200) break;
      pagina++;
    }

    console.log(`[atualizarNomesClientesComCodigo] Total: ${todosClientes.length}`);

    // Etapa 2: Filtrar
    const paraAtualizar = [];
    const jaFeitos = [];

    for (const c of todosClientes) {
      const codigo = c.codigo_interno;
      if (!codigo) continue;

      const nomeAtual = c.nome_fantasia || '';
      const prefixo = `[${codigo}] `;

      if (nomeAtual.startsWith(prefixo)) {
        jaFeitos.push(c);
        continue;
      }

      const prefixoExistente = nomeAtual.match(/^\[\d+\]\s/);
      const novoNome = prefixoExistente
        ? prefixo + nomeAtual.substring(prefixoExistente[0].length)
        : prefixo + nomeAtual;

      paraAtualizar.push({ id: c.id, novo_nome_fantasia: novoNome, codigo });
    }

    console.log(`[atualizarNomesClientesComCodigo] Para atualizar: ${paraAtualizar.length}, Ja feitos: ${jaFeitos.length}`);

    if (apenasSimular) {
      return Response.json({
        sucesso: true,
        simulado: true,
        total: todosClientes.length,
        para_atualizar: paraAtualizar.length,
        ja_feitos: jaFeitos.length,
        exemplos: paraAtualizar.slice(0, 5).map(c => ({
          codigo: c.codigo,
          nome_novo: c.novo_nome_fantasia
        }))
      });
    }

    // Etapa 3: Atualizar UM POR UM com pausa (respeitar rate limit)
    let ok = 0;
    let erros = 0;
    const MAX_POR_EXECUCAO = 200; // Limite seguro por chamada

    for (let i = 0; i < Math.min(paraAtualizar.length, MAX_POR_EXECUCAO); i++) {
      const c = paraAtualizar[i];
      try {
        await base44.asServiceRole.entities.Cliente.update(c.id, {
          nome_fantasia: c.novo_nome_fantasia
        });
        ok++;
      } catch (err) {
        erros++;
        if (erros <= 3) console.error(`[${c.codigo}] ${err.message}`);
        if (err.message?.includes('429') || err.message?.includes('Rate limit')) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      // Pausa de 200ms entre cada update
      if (i < Math.min(paraAtualizar.length, MAX_POR_EXECUCAO) - 1) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    const restante = Math.max(0, paraAtualizar.length - MAX_POR_EXECUCAO);

    let mensagem = `${ok} clientes atualizados no Base44.`;
    if (restante > 0) {
      mensagem += ` Faltam ${restante}. Execute novamente para continuar.`;
    }
    mensagem += ` A automacao enviarClienteOmie vai sincronizar com o Omie.`;

    console.log(`[atualizarNomesClientesComCodigo] OK: ${ok}, Erros: ${erros}, Restante: ${restante}`);

    return Response.json({
      sucesso: true,
      atualizados: ok,
      erros,
      restante,
      total_pendentes: paraAtualizar.length,
      ja_feitos: jaFeitos.length,
      mensagem
    });

  } catch (error) {
    console.error('[atualizarNomesClientesComCodigo] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});