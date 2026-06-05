import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const updates = body.updates;
    if (!Array.isArray(updates) || updates.length === 0) {
      return Response.json({ error: 'updates[] obrigatório' }, { status: 400 });
    }

    const todosPrecos: any[] = [];
    const batch1 = await base44.asServiceRole.entities.PrecoProduto.list('-created_date', 500);
    if (batch1 && batch1.length > 0) todosPrecos.push(...batch1);
    if (batch1 && batch1.length === 500) {
      const batch2 = await base44.asServiceRole.entities.PrecoProduto.list('-updated_date', 500);
      if (batch2) todosPrecos.push(...batch2);
    }

    const indice = new Map<string, any>();
    for (const p of todosPrecos) {
      const chave = `${p.tabela_id}__${p.produto_id}`;
      if (!indice.has(chave)) indice.set(chave, p);
    }

    let atualizados = 0, criados = 0, sem_mudanca = 0;
    const erros: string[] = [];

    for (let i = 0; i < updates.length; i += 20) {
      const lote = updates.slice(i, i + 20);
      await Promise.all(lote.map(async (upd: any) => {
        const { tabela_id, produto_id, novo_valor } = upd;
        const chave = `${tabela_id}__${produto_id}`;
        const existente = indice.get(chave);
        try {
          if (existente) {
            if (Math.abs((existente.valor_unitario ?? 0) - novo_valor) < 0.001) { sem_mudanca++; return; }
            await base44.asServiceRole.entities.PrecoProduto.update(existente.id, { valor_unitario: novo_valor, omie_sincronizado: false });
            atualizados++;
          } else {
            await base44.asServiceRole.entities.PrecoProduto.create({ tabela_id, produto_id, valor_unitario: novo_valor, omie_sincronizado: false });
            criados++;
          }
        } catch (e: any) { erros.push(`${chave}: ${e.message}`); }
      }));
      if (i + 20 < updates.length) await new Promise(r => setTimeout(r, 80));
    }

    return Response.json({ sucesso: true, total: updates.length, atualizados, criados, sem_mudanca, erros });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});
