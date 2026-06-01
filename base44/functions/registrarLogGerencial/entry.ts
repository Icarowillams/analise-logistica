import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();

    const registro = {
      tipo_acao: body.tipo_acao || 'outro',
      entidade_tipo: body.entidade_tipo || 'Desconhecida',
      entidade_id: body.entidade_id || null,
      pedido_id: body.pedido_id || null,
      carga_id: body.carga_id || null,
      cliente_id: body.cliente_id || null,
      entidade_descricao: body.entidade_descricao || '',
      usuario_email: user.email,
      usuario_nome: user.full_name || user.email,
      descricao: body.descricao || '',
      alteracoes: Array.isArray(body.alteracoes) ? body.alteracoes.slice(0, 100) : [],
      dados_json: body.dados_json || '',
      origem: body.origem || 'frontend',
      observacao: body.observacao || ''
    };

    const saved = await base44.asServiceRole.entities.LogGerencial.create(registro);
    return Response.json({ sucesso: true, id: saved.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});