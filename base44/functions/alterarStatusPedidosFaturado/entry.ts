import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const PEDIDOS_PADRAO = ['344', '345', '346', '326', '325', '327', '329', '330', '333', '332', '328', '331', '317', '316', '296', '295', '294', '293', '287', '283', '282', '281', '247'];

function normalizarNumero(valor) {
  return String(valor || '').replace(/\D/g, '').replace(/^0+/, '') || String(valor || '');
}

function encontrarPedido(pedidos, chave) {
  const chaveTexto = String(chave || '').trim();
  const chaveNormalizada = normalizarNumero(chaveTexto);
  return pedidos.find(p =>
    p.id === chaveTexto ||
    String(p.numero_pedido || '') === chaveTexto ||
    normalizarNumero(p.numero_pedido) === chaveNormalizada

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const simular = body.simular !== false;
    const idsSolicitados = Array.isArray(body.ids) && body.ids.length > 0 ? body.ids.map(String) : PEDIDOS_PADRAO;
    const todosPedidos = await base44.asServiceRole.entities.Pedido.list('-created_date', 5000);

    const alteracoes = [];
    const jaEstavamCorretos = [];
    const naoEncontrados = [];

    for (const chave of idsSolicitados) {
      const pedido = encontrarPedido(todosPedidos, chave);
      if (!pedido) {
        naoEncontrados.push(String(chave));
        continue;
      }

      if (pedido.status === 'faturado') {
        jaEstavamCorretos.push({
          id: pedido.id,
          id_solicitado: String(chave),
          numero_pedido: pedido.numero_pedido || '',
          status_atual: pedido.status,
          cliente_nome: pedido.cliente_nome || ''
        });
        continue;
      }

      const registro = {
        id: pedido.id,
        id_solicitado: String(chave),
        numero_pedido: pedido.numero_pedido || '',
        cliente_nome: pedido.cliente_nome || '',
        status_atual: pedido.status || '',
        status_novo: 'faturado'
      };
      alteracoes.push(registro);

      if (!simular) {
        await base44.asServiceRole.entities.Pedido.update(pedido.id, { status: 'faturado' });
        await base44.asServiceRole.entities.LogGerencial.create({
          tipo_acao: 'edicao',
          entidade_tipo: 'Pedido',
          entidade_id: pedido.id,
          pedido_id: pedido.id,
          cliente_id: pedido.cliente_id || '',
          entidade_descricao: `Pedido ${pedido.numero_pedido || pedido.id}`,
          usuario_email: user.email,
          usuario_nome: user.full_name || user.email,
          descricao: `Status alterado manualmente de ${pedido.status || '-'} para faturado — pedido ID ${pedido.id}, solicitado pelo gestor`,
          alteracoes: [{ campo: 'status', valor_anterior: pedido.status || '', valor_novo: 'faturado' }],
          dados_json: JSON.stringify({
            acao: 'alteracao_status_pedido_manual',
            pedido_id: pedido.id,
            numero_pedido: pedido.numero_pedido || '',
            status_anterior: pedido.status || '',
            status_novo: 'faturado',
            id_solicitado: String(chave)
          }),
          origem: 'backend'
        });
      }
    }

    return Response.json({
      sucesso: true,
      simular,
      total_ids_solicitados: idsSolicitados.length,
      total_seriam_alterados: alteracoes.length,
      total_alterados: simular ? 0 : alteracoes.length,
      total_ja_estavam_faturados: jaEstavamCorretos.length,
      total_nao_encontrados: naoEncontrados.length,
      alteracoes,
      ja_estavam_corretos: jaEstavamCorretos,
      nao_encontrados: naoEncontrados,
      aviso: simular ? 'Simulação obrigatória: nada foi alterado. Para aplicar, rode com simular=false após validação do gestor.' : 'Alterações aplicadas apenas nos pedidos da lista.'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});