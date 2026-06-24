import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Job: encerra (marca como concluída) visitas com check-in feito mas sem check-out
// após o timeout parametrizado (ParametroCobertura.checkout_timeout_minutos).
// Não inventa GPS de saída — apenas limpa a pendência para não poluir o painel.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const db = base44.asServiceRole.entities;

    const params = (await db.ParametroCobertura.filter({ chave: 'principal' }))[0];
    const timeoutMin = params?.checkout_timeout_minutos || 120;
    const limite = new Date(Date.now() - timeoutMin * 60000);

    const pendentes = await db.Visita.filter({ checkout_pendente: true }, '-created_date', 1000);

    let encerradas = 0;
    for (const v of pendentes) {
      const inicio = v.hora_checkin ? new Date(v.hora_checkin) : (v.created_date ? new Date(v.created_date) : null);
      if (!inicio || inicio > limite) continue; // ainda dentro da janela
      await db.Visita.update(v.id, {
        checkout_pendente: false,
        status: 'concluida',
        observacoes: ((v.observacoes || '') + ' [check-out automático por timeout]').trim(),
      });
      encerradas += 1;
    }

    return Response.json({ ok: true, avaliadas: pendentes.length, encerradas, timeout_minutos: timeoutMin });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});