import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const [planos, modalidades, tabelas] = await Promise.all([
      base44.asServiceRole.entities.PlanoPagamento.list(),
      base44.asServiceRole.entities.ModalidadePagamento.list(),
      base44.asServiceRole.entities.TabelaPreco.list(),
    ]);

    const planosIds = new Set(planos.map(p => p.id));
    const modalidadesIds = new Set(modalidades.map(m => m.id));
    const tabelasIds = new Set(tabelas.map(t => t.id));

    let allClientes = [];
    let page = 0;
    const batchSize = 200;
    while (true) {
      const batch = await base44.asServiceRole.entities.Cliente.list('-created_date', batchSize, page * batchSize);
      allClientes = allClientes.concat(batch);
      if (batch.length < batchSize) break;
      page++;
    }

    const orfaosPlano = [];
    const orfaosModalidade = [];
    const orfaosTabela = [];
    
    // Coletar IDs inválidos únicos
    const idsPlanoInvalidos = new Set();
    const idsModalidadeInvalidos = new Set();
    const idsTabelaInvalidos = new Set();

    let semPlano = 0, semModalidade = 0, semTabela = 0;

    for (const cli of allClientes) {
      if (cli.plano_pagamento_id) {
        if (!planosIds.has(cli.plano_pagamento_id)) {
          idsPlanoInvalidos.add(cli.plano_pagamento_id);
          orfaosPlano.push({ id: cli.id, codigo: cli.codigo, nome: cli.razao_social, id_invalido: cli.plano_pagamento_id });
        }
      } else {
        semPlano++;
      }

      if (cli.modalidade_pagamento_id) {
        if (!modalidadesIds.has(cli.modalidade_pagamento_id)) {
          idsModalidadeInvalidos.add(cli.modalidade_pagamento_id);
          orfaosModalidade.push({ id: cli.id, codigo: cli.codigo, nome: cli.razao_social, id_invalido: cli.modalidade_pagamento_id });
        }
      } else {
        semModalidade++;
      }

      if (cli.tabela_id) {
        if (!tabelasIds.has(cli.tabela_id)) {
          idsTabelaInvalidos.add(cli.tabela_id);
          orfaosTabela.push({ id: cli.id, codigo: cli.codigo, nome: cli.razao_social, id_invalido: cli.tabela_id });
        }
      } else {
        semTabela++;
      }
    }

    return Response.json({
      sucesso: true,
      total_clientes: allClientes.length,
      resumo: {
        plano_pagamento: {
          orfaos: orfaosPlano.length,
          sem_vinculo: semPlano,
          ids_invalidos_unicos: [...idsPlanoInvalidos],
        },
        modalidade_pagamento: {
          orfaos: orfaosModalidade.length,
          sem_vinculo: semModalidade,
          ids_invalidos_unicos: [...idsModalidadeInvalidos],
        },
        tabela_preco: {
          orfaos: orfaosTabela.length,
          sem_vinculo: semTabela,
          ids_invalidos_unicos: [...idsTabelaInvalidos],
        }
      },
      amostra_orfaos_plano: orfaosPlano.slice(0, 5),
      amostra_orfaos_modalidade: orfaosModalidade.slice(0, 5),
      amostra_orfaos_tabela: orfaosTabela.slice(0, 5),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});