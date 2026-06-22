import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Inicia o regime experimental de 30 dias (decisões #2 e #3 / seção 5.5).
// Cria um registro RegimeExperimental por parâmetro-alvo com data_fim_prevista = hoje + 30 dias.
// Idempotente: não recria parâmetros que já estejam EM_ANDAMENTO.

const PARAMETROS = ['PESO_BLOCO_COBERTURA', 'PESO_BLOCO_MIX', 'TETO_SEGURANCA_FINANCEIRA'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const hoje = new Date();
    const fim = new Date(hoje.getTime() + 30 * 86400000);
    const fmt = (d) => d.toISOString().slice(0, 10);

    const existentes = await base44.asServiceRole.entities.RegimeExperimental.filter({ status: 'EM_ANDAMENTO' }, '-created_date', 100).catch(() => []);
    const jaAtivos = new Set(existentes.map(r => r.parametro_alvo));

    const criados = [];
    for (const p of PARAMETROS) {
      if (jaAtivos.has(p)) continue;
      const novo = await base44.asServiceRole.entities.RegimeExperimental.create({
        parametro_alvo: p,
        data_inicio: fmt(hoje),
        data_fim_prevista: fmt(fim),
        status: 'EM_ANDAMENTO',
        canal_alerta: ['email', 'in_app'],
        emails_alerta: [user.email],
        alerta_disparado: false
      });
      criados.push(novo.id);
    }

    return Response.json({ sucesso: true, criados: criados.length, ja_ativos: jaAtivos.size });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});