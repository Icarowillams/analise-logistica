import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Função utilitária para registrar logs gerenciais a partir do frontend.
// Pode ser chamada de qualquer página para gravar uma ação.
//
// Payload esperado:
// {
//   tipo_acao: 'envio' | 'exclusao' | 'edicao' | ...,
//   entidade_tipo: 'Pedido' | 'Cliente' | ...,
//   entidade_id?: string,
//   entidade_descricao?: string,
//   descricao: string,
//   alteracoes?: [{ campo, valor_anterior, valor_novo }],
//   observacao?: string,
//   origem?: 'frontend' | 'backend' | 'automation' | 'webhook'
// }

// ── LGPD: mascara CPF (11 díg) e CNPJ (14 díg) em qualquer texto de log ──
// Mantém 3 primeiros e 2 últimos dígitos para rastreabilidade, oculta o miolo.
function mascararPII(texto) {
  if (!texto || typeof texto !== 'string') return texto;
  return texto
    .replace(/\b(\d{2})\.?\d{3}\.?\d{3}\/?\d{4}-?(\d{2})\b/g, '$1.***.***/****-$2')
    .replace(/\b(\d{3})\.?\d{3}\.?\d{3}-?(\d{2})\b/g, '$1.***.***-$2');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();

    const alteracoesMasc = (Array.isArray(body.alteracoes) ? body.alteracoes.slice(0, 100) : []).map((a) => ({
      ...a,
      valor_anterior: mascararPII(a?.valor_anterior),
      valor_novo: mascararPII(a?.valor_novo)
    }));

    const registro = {
      tipo_acao: body.tipo_acao || 'outro',
      entidade_tipo: body.entidade_tipo || 'Desconhecida',
      entidade_id: body.entidade_id || null,
      pedido_id: body.pedido_id || null,
      carga_id: body.carga_id || null,
      cliente_id: body.cliente_id || null,
      entidade_descricao: mascararPII(body.entidade_descricao || ''),
      usuario_email: user.email,
      usuario_nome: user.full_name || user.email,
      descricao: mascararPII(body.descricao || ''),
      alteracoes: alteracoesMasc,
      dados_json: mascararPII(body.dados_json || ''),
      origem: body.origem || 'frontend',
      observacao: mascararPII(body.observacao || '')
    };

    const saved = await base44.asServiceRole.entities.LogGerencial.create(registro);
    return Response.json({ sucesso: true, id: saved.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});