// Função utilitária de TESTE: cria PrecoProduto para todos os produtos ativos
// em todas as tabelas ativas. Pula os que já têm preço.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const valorPadrao = Number(body.valor) || 10.0;

    const produtos = (await base44.asServiceRole.entities.Produto.list('-created_date', 2000))
      .filter(p => p.status === 'ativo');
    const tabelas = (await base44.asServiceRole.entities.TabelaPreco.list('-created_date', 200))
      .filter(t => t.status === 'ativo');
    const precosExistentes = await base44.asServiceRole.entities.PrecoProduto.list('-created_date', 5000);

    const chaves = new Set(precosExistentes.map(p => `${p.produto_id}::${p.tabela_id}`));
    const novos = [];
    for (const prod of produtos) {
      for (const tab of tabelas) {
        const key = `${prod.id}::${tab.id}`;
        if (chaves.has(key)) continue;
        novos.push({
          produto_id: prod.id,
          tabela_id: tab.id,
          valor_unitario: valorPadrao,
          ativacao_acao: false,
          omie_sincronizado: false
        });
      }
    }

    // Inserir em lotes de 50
    let inseridos = 0;
    for (let i = 0; i < novos.length; i += 50) {
      const lote = novos.slice(i, i + 50);
      await base44.asServiceRole.entities.PrecoProduto.bulkCreate(lote);
      inseridos += lote.length;
    }

    return Response.json({
      sucesso: true,
      produtos: produtos.length,
      tabelas: tabelas.length,
      ja_existiam: precosExistentes.length,
      criados: inseridos
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});