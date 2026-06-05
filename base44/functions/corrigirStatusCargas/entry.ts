import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

async function registrarLog(base44, user, carga, statusAnterior, statusNovo, simular) {
  await base44.asServiceRole.entities.LogGerencial.create({
    tipo_acao: 'edicao',
    entidade_tipo: 'Carga',
    entidade_id: carga.id,
    carga_id: carga.id,
    entidade_descricao: `Carga ${carga.numero_carga || carga.id}`,
    usuario_email: user.email,
    usuario_nome: user.full_name || user.email,
    descricao: `Status da carga migrado de ${statusAnterior || '-'} para ${statusNovo} — normalização para fluxo local binário`,
    dados_json: JSON.stringify({
      acao: 'correcao_status_carga',
      carga_id: carga.id,
      numero_carga: carga.numero_carga || '',
      status_anterior: statusAnterior || '',
      status_novo: statusNovo,
      simular
    }),
    origem: 'backend'
  });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const simular = body.simular !== false;
    const limite = Number(body.limite || 5000);
    const cargas = await base44.asServiceRole.entities.Carga.list('-created_date', limite);

    // Migração para fluxo local binário: tem data_faturamento → "faturada", senão → "montagem".
    const statusDestino = (carga) => (carga.data_faturamento ? 'faturada' : 'montagem');
    const alterar = cargas.filter(carga => (carga.status_carga || '') !== statusDestino(carga));
    const jaCorretas = cargas.length - alterar.length;
    const alteradas = [];

    for (const carga of alterar) {
      const statusAnterior = carga.status_carga || '';
      const statusNovo = statusDestino(carga);
      alteradas.push({
        id: carga.id,
        numero_carga: carga.numero_carga || '',
        status_anterior: statusAnterior,
        status_novo: statusNovo
      });

      if (!simular) {
        await base44.asServiceRole.entities.Carga.update(carga.id, {
          status_carga: statusNovo
        });
        await registrarLog(base44, user, carga, statusAnterior, statusNovo, simular);
      }
    }

    return Response.json({
      sucesso: true,
      simular,
      campo_status_usado: 'status_carga',
      total_cargas: cargas.length,
      total_alteradas: alteradas.length,
      total_ja_corretas: jaCorretas,
      alteradas,
      aviso: simular ? 'Simulação apenas: nada foi alterado. Para aplicar, chame com simular=false.' : 'Correções aplicadas.'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});