import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Grava credenciais Omie de forma WRITE-ONLY e admin-only.
 * - Valida user.role === 'admin' (403 caso contrário).
 * - app_secret / app_key em BRANCO = mantém o valor atual do banco (não sobrescreve).
 * - Só atualiza os campos que vierem preenchidos.
 * O secret real NUNCA é devolvido ao cliente — a resposta traz apenas status mascarado.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const nome = String(body.nome || '').trim() || 'Produção';
    const appKey = String(body.app_key || '').trim();
    const appSecret = String(body.app_secret || '').trim();

    // SEGURANÇA: o app_secret NÃO é mais persistido em texto plano no banco.
    // A fonte de verdade do secret são os Secrets do backend (OMIE_APP_SECRET).
    // Aqui gravamos apenas app_key + uma máscara dos últimos 4 dígitos do secret.
    const secretMascara = appSecret ? `...${appSecret.slice(-4)}` : '';

    const registros = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
    const ativo = registros?.[0];

    if (ativo?.id) {
      const patch = { nome, ativo: true, secret_em_secrets: true };
      if (appKey) patch.app_key = appKey;                  // em branco = mantém o atual
      if (secretMascara) patch.app_secret_mascara = secretMascara;
      await base44.asServiceRole.entities.ConfiguracaoOmie.update(ativo.id, patch);
    } else {
      if (!appKey) {
        return Response.json({ error: 'Para criar a configuração inicial, informe o App Key. O App Secret deve ser cadastrado nos Secrets do app (OMIE_APP_SECRET).' }, { status: 400 });
      }
      await base44.asServiceRole.entities.ConfiguracaoOmie.create({ nome, app_key: appKey, app_secret_mascara: secretMascara, secret_em_secrets: true, ativo: true });
    }

    const atualizado = (await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []))?.[0];
    return Response.json({
      sucesso: true,
      nome: atualizado?.nome || nome,
      appKeyMascarada: atualizado?.app_key ? `...${String(atualizado.app_key).slice(-4)}` : null,
      appSecretMascarada: atualizado?.app_secret_mascara || (atualizado?.app_secret ? `...${String(atualizado.app_secret).slice(-4)}` : null),
      fonte_secret: 'secrets_backend'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});