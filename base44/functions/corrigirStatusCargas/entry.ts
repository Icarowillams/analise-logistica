import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

async function registrarLog(base44, user, carga, statusAnterior, simular) {
  await base44.asServiceRole.entities.LogGerencial.create({
    tipo_acao: 'edicao',
    entidade_tipo: 'Carga',
    entidade_id: carga.id,
    carga_id: carga.id,
    entidade_descricao: `Carga ${carga.numero_carga || carga.id}`,
    usuario_email: user.email,
    usuario_nome: user.full_name || user.email,
    descricao: `Status da carga corrigido de ${statusAnterior || '-'} para faturada — correção em massa pós-bug`,
    dados_json: JSON.stringify({
      acao: 'correcao_status_carga',
      carga_id: carga.id,
      numero_carga: carga.numero_carga || '',
      status_anterior: statusAnterior || '',
      status_novo: 'faturada',
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

    const alterar = cargas.filter(carga => (carga.status_carga || '') !== 'faturada');
    const jaCorretas = cargas.length - alterar.length;
    const alteradas = [];

    for (const carga of alterar) {
      const statusAnterior = carga.status_carga || '';
      alteradas.push({
        id: carga.id,
        numero_carga: carga.numero_carga || '',
        status_anterior: statusAnterior,
        status_novo: 'faturada'
      });

      if (!simular) {
        await base44.asServiceRole.entities.Carga.update(carga.id, {
          status_carga: 'faturada',
          data_faturamento: carga.data_faturamento || new Date().toISOString()
        });
        await registrarLog(base44, user, carga, statusAnterior, simular);
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