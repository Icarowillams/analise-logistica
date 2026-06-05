import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Retorna as credenciais Omie ativas.
 * Prioriza a entidade ConfiguracaoOmie (registro ativo). Se não houver,
 * usa fallback dos Secrets (OMIE_APP_KEY/OMIE_APP_SECRET) e loga aviso.
 *
 * Suporta:
 *  - action "get": retorna { appKey, appSecret, fonte } (mascarado quracao true)
 *  - action "seed": cria registro inicial a partir dos secrets se não existir nenhum
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'get';

    if (action === 'seed') {
      const existentes = await base44.asServiceRole.entities.ConfiguracaoOmie.list('-created_date', 1).catch(() => []);
      if (existentes && existentes.length > 0) {
        return Response.json({ sucesso: true, criado: false, mensagem: 'Já existe configuração no banco.' });
      }
      const appKey = Deno.env.get('OMIE_APP_KEY');
      const appSecret = Deno.env.get('OMIE_APP_SECRET');
      if (!appKey || !appSecret) {
        return Response.json({ sucesso: false, erro: 'Secrets OMIE_APP_KEY/OMIE_APP_SECRET não configurados para seed.' });
      }
      const novo = await base44.asServiceRole.entities.ConfiguracaoOmie.create({
        nome: 'Produção (migrado dos Secrets)',
        app_key: appKey,
        app_secret: appSecret,
        ativo: true
      });
      return Response.json({ sucesso: true, criado: true, id: novo.id });
    }

    // action get
    const registros = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
    const ativo = registros?.[0];
    if (ativo?.app_key && ativo?.app_secret) {
      return Response.json({
        fonte: 'banco',
        appKeyMascarada: `...${String(ativo.app_key).slice(-4)}`,
        appSecretMascarada: `...${String(ativo.app_secret).slice(-4)}`,
        id: ativo.id,
        nome: ativo.nome,
        atualizado_em: ativo.updated_date
      });
    }

    const appKey = Deno.env.get('OMIE_APP_KEY');
    const appSecret = Deno.env.get('OMIE_APP_SECRET');
    console.warn('[getOmieCredentials] Nenhuma ConfiguracaoOmie ativa no banco — usando fallback dos Secrets.');
    return Response.json({
      fonte: 'secrets_fallback',
      appKeyMascarada: appKey ? `...${String(appKey).slice(-4)}` : null,
      appSecretMascarada: appSecret ? `...${String(appSecret).slice(-4)}` : null
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});