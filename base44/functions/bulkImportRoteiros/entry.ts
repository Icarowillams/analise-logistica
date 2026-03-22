import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { roteiros } = await req.json();

    if (!roteiros || !Array.isArray(roteiros) || roteiros.length === 0) {
      return Response.json({ error: 'Nenhum roteiro fornecido' }, { status: 400 });
    }

    console.log(`Processando ${roteiros.length} roteiros para importação (upsert)`);

    // Buscar todos os roteiros existentes para comparação
    const roteirosExistentes = await base44.asServiceRole.entities.Roteiro.filter({});
    console.log(`Encontrados ${roteirosExistentes.length} roteiros existentes no sistema`);

    // Criar mapa de roteiros existentes: chave = vendedor_id + dia_semana
    const existentesMap = {};
    roteirosExistentes.forEach(r => {
      const key = `${r.vendedor_id}-${r.dia_semana}`;
      existentesMap[key] = r;
    });

    let criados = 0;
    let atualizados = 0;
    const erros = [];

    // Processar cada roteiro sequencialmente para evitar conflitos
    for (const roteiro of roteiros) {
      const key = `${roteiro.vendedor_id}-${roteiro.dia_semana}`;
      const existente = existentesMap[key];

      let tentativa = 0;
      let sucesso = false;

      while (tentativa < 5 && !sucesso) {
        try {
          if (existente) {
            // ATUALIZAR roteiro existente - substitui clientes
            await base44.asServiceRole.entities.Roteiro.update(existente.id, {
              clientes_ids: roteiro.clientes_ids,
              clientes_detalhes: roteiro.clientes_detalhes,
              vendedor_nome: roteiro.vendedor_nome,
              status: roteiro.status || existente.status
            });
            atualizados++;
            sucesso = true;
          } else {
            // CRIAR novo roteiro
            const novoRoteiro = await base44.asServiceRole.entities.Roteiro.create(roteiro);
            // Adicionar ao mapa para evitar duplicatas no mesmo lote
            existentesMap[key] = novoRoteiro;
            criados++;
            sucesso = true;
          }
        } catch (err) {
          tentativa++;
          if (tentativa >= 5) {
            erros.push({
              vendedor: roteiro.vendedor_nome,
              dia: roteiro.dia_semana,
              error: err.message
            });
          } else {
            const delay = 500 * Math.pow(2, tentativa - 1);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }

      // Pequeno delay entre operações
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`Concluído: ${criados} criados, ${atualizados} atualizados, ${erros.length} erros`);

    return Response.json({
      criados,
      atualizados,
      erros: erros.length,
      detalhesErros: erros
    });
  } catch (error) {
    console.error('Erro geral:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});