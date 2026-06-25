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

    const registros = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
    const ativo = registros?.[0];

    if (ativo?.id) {
      const patch = { nome, ativo: true };
      if (appKey) patch.app_key = appKey;       // em branco = mantém o atual
      if (appSecret) patch.app_secret = appSecret; // em branco = mantém o atual
      await base44.asServiceRole.entities.ConfiguracaoOmie.update(ativo.id, patch);
    } else {
      // Criação inicial exige ambos os campos.
      if (!appKey || !appSecret) {
        return Response.json({ error: 'Para criar a configuração inicial, informe App Key e App Secret.' }, { status: 400 });
      }
      await base44.asServiceRole.entities.ConfiguracaoOmie.create({ nome, app_key: appKey, app_secret: appSecret, ativo: true });
    }

    const atualizado = (await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []))?.[0];
    return Response.json({
      sucesso: true,
      nome: atualizado?.nome || nome,
      appKeyMascarada: atualizado?.app_key ? `...${String(atualizado.app_key).slice(-4)}` : null,
      appSecretMascarada: atualizado?.app_secret ? `...${String(atualizado.app_secret).slice(-4)}` : null
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});