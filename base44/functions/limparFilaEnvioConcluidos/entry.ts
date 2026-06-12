import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Arquiva (remove) registros 'concluido' da FilaEnvioPedidoOmie com mais de X dias.
// Processa em lotes pequenos re-executáveis para não estourar o rate limit do banco.
const DIAS_RETENCAO = 7;
const LOTE = 50;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Permite admin logado OU chamada via service role (automação agendada)
    const isAuthenticated = await base44.auth.isAuthenticated();
    if (isAuthenticated) {
      const user = await base44.auth.me();
      if (user?.role !== 'admin') {
        return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
      }
    }

    const limite = new Date(Date.now() - DIAS_RETENCAO * 24 * 60 * 60 * 1000);

    // Busca um lote de concluídos mais antigos
    const concluidos = await base44.asServiceRole.entities.FilaEnvioPedidoOmie
      .filter({ status: 'concluido' }, 'created_date', LOTE);

    const antigos = concluidos.filter(c => new Date(c.created_date) < limite);

    let removidos = 0;
    for (const item of antigos) {
      await base44.asServiceRole.entities.FilaEnvioPedidoOmie.delete(item.id).catch(() => {});
      removidos++;
      await sleep(60); // throttle leve para não saturar o banco
    }

    return Response.json({
      sucesso: true,
      removidos,
      restam_no_lote: antigos.length === LOTE ? 'possivelmente mais — re-executar' : 'lote final',
      dias_retencao: DIAS_RETENCAO
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});