import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// FUNÇÃO TEMPORÁRIA — SEM AUTENTICAÇÃO. Remover após uso.
//
// Correção pontual para a carga 132 (id fixo abaixo) que ficou presa em
// processamento_omie_status = 'nao_iniciado' sem itens na FilaCargaOmie.
//
// Lógica:
//   - Se existem itens PENDENTES na fila: não faz nada (deixa processarFilaCargaOmie tratar).
//   - Se não há itens pendentes: marca como 'concluido', pois os pedidos já estão
//     no Omie com a etapa correta e não há nada mais a processar.

const CARGA_132_ID = '6a28591179ee3866650f67f6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const carga = await base44.asServiceRole.entities.Carga.get(CARGA_132_ID).catch(() => null);
    if (!carga) {
      return Response.json({ erro: 'Carga 132 não encontrada', id: CARGA_132_ID }, { status: 404 });
    }

    const itens = await base44.asServiceRole.entities.FilaCargaOmie
      .filter({ carga_id: CARGA_132_ID }, '-created_date', 200)
      .catch(() => []);

    const pendentes = itens.filter(i => i.status === 'pendente' || i.status === 'processando');

    if (pendentes.length > 0) {
      return Response.json({
        acao: 'nenhuma_alteracao',
        motivo: 'Existem itens pendentes ou em processamento na fila — processarFilaCargaOmie irá tratar.',
        pendentes: pendentes.length,
        total_itens_fila: itens.length,
        status_atual: carga.processamento_omie_status,
      });
    }

    const statusAnterior = carga.processamento_omie_status;
    await base44.asServiceRole.entities.Carga.update(CARGA_132_ID, {
      processamento_omie_status: 'concluido',
    });

    return Response.json({
      acao: 'marcado_concluido',
      carga_id: CARGA_132_ID,
      numero_carga: carga.numero_carga,
      status_anterior: statusAnterior,
      total_itens_fila: itens.length,
      pendentes: 0,
      mensagem: 'Carga 132 marcada como concluída. Pedidos já estão no Omie com etapa correta.',
    });
  } catch (error) {
    return Response.json({ erro: error.message, stack: error.stack }, { status: 500 });
  }
});
