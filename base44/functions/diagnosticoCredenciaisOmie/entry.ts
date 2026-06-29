import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══════════════════════════════════════════════════════════════════════════
// DIAGNÓSTICO DE CREDENCIAIS OMIE — somente leitura, NUNCA toca o Omie.
//
// Investiga o erro recorrente "A chave de acesso está inválida ou o aplicativo
// está suspenso". Hipótese: o Secret OMIE_APP_KEY/OMIE_APP_SECRET tem espaço
// ou \n nas pontas e é lido CRU (sem .trim()) em ~98 funções → chave malformada.
//
// GARANTIAS:
//   - ZERO chamadas ao Omie (sem omieCall/fetch para app.omie.com.br).
//   - NÃO adquire o portão global, NÃO mexe no circuit breaker.
//   - NUNCA retorna a credencial inteira — só tamanhos, flags de whitespace
//     e os 2 primeiros / 2 últimos caracteres.
// ═══════════════════════════════════════════════════════════════════════════

// Diagnostica uma string de credencial sem expor o valor.
function diagnosticarValor(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { definido: false };
  }
  const trimmed = raw.trim();
  return {
    definido: true,
    tamanho_bruto: raw.length,
    tamanho_apos_trim: trimmed.length,
    tem_espaco_inicio: /^\s/.test(raw),
    tem_espaco_fim: /\s$/.test(raw),
    tem_quebra_linha: /[\r\n]/.test(raw),
    // 2 primeiros / 2 últimos chars do valor JÁ TRIMADO (nunca o valor inteiro).
    primeiros_2_chars: trimmed.slice(0, 2),
    ultimos_2_chars: trimmed.slice(-2)
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Admin-only: este diagnóstico revela metadados sensíveis de credenciais.
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // 1) Secrets de ambiente (leitura crua — propositalmente SEM .trim() para detectar whitespace).
    const envKeyRaw = Deno.env.get('OMIE_APP_KEY');
    const envSecretRaw = Deno.env.get('OMIE_APP_SECRET');

    const env = {
      OMIE_APP_KEY: diagnosticarValor(envKeyRaw),
      OMIE_APP_SECRET: diagnosticarValor(envSecretRaw)
    };

    // 2) Banco ConfiguracaoOmie (registro ativo) — só VAZIO/PREENCHIDO + tamanho, nunca o valor.
    let banco;
    const rows = await base44.asServiceRole.entities.ConfiguracaoOmie
      .filter({ ativo: true }, '-updated_date', 1).catch(() => []);
    const cfg = rows?.[0];
    if (!cfg) {
      banco = { registro_ativo: false };
    } else {
      const appKey = String(cfg.app_key || '');
      const appSecret = String(cfg.app_secret || '');
      banco = {
        registro_ativo: true,
        nome: cfg.nome || null,
        app_key: { estado: appKey ? 'PREENCHIDO' : 'VAZIO', tamanho: appKey.length },
        app_secret: { estado: appSecret ? 'PREENCHIDO' : 'VAZIO', tamanho: appSecret.length },
        secret_em_secrets: cfg.secret_em_secrets ?? null,
        app_secret_mascara: cfg.app_secret_mascara || null
      };
    }

    // 3) Ordem de precedência que getOmieCredentials usa hoje.
    // Padrão observado nas funções (ex: processarFilaWebhookOmie, processarFilaCargaOmie,
    // processarWebhookOmie): ENV primeiro (fonte de verdade); banco só como fallback do app_key
    // quando o env está vazio. O app_secret vem SEMPRE do Secret.
    const precedencia = {
      descricao: 'ENV primeiro (fonte de verdade). Banco (ConfiguracaoOmie.app_key) só como fallback quando OMIE_APP_KEY do env está vazio. O app_secret vem sempre do Secret OMIE_APP_SECRET.',
      env_tem_prioridade: true,
      banco_usado_como_fallback_de: ['app_key']
    };

    return Response.json({
      sucesso: true,
      tocou_omie: false,
      gerado_em: new Date().toISOString(),
      env,
      banco,
      precedencia
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});