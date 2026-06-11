import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Diagnostica e corrige os preços de uma tabela:
// - Remove PrecoProduto órfãos (produto_id não existe mais)
// - Remove duplicatas (mantém o de maior valor por produto)
// - Reporta produtos ativos sem preço válido
//
// payload: { tabela_id: string, aplicar?: boolean }
//   aplicar=false (padrão) → apenas diagnóstico (não altera nada)
//   aplicar=true → executa a limpeza
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Acesso restrito a administradores' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { tabela_id, aplicar = false } = body;
    if (!tabela_id) {
      return Response.json({ error: 'tabela_id obrigatório' }, { status: 400 });
    }

    const [precos, produtos] = await Promise.all([
      base44.asServiceRole.entities.PrecoProduto.filter({ tabela_id }),
      base44.asServiceRole.entities.Produto.list('-created_date', 2000)
    ]);

    const produtoById = new Map();
    produtos.forEach(p => produtoById.set(p.id, p));

    const orfaos = [];               // preço aponta para produto inexistente
    const validosPorProduto = new Map(); // produto_id -> [precos válidos]

    for (const preco of precos) {
      const prod = produtoById.get(preco.produto_id);
      if (!prod) {
        orfaos.push(preco);
        continue;
      }
      if (!validosPorProduto.has(preco.produto_id)) validosPorProduto.set(preco.produto_id, []);
      validosPorProduto.get(preco.produto_id).push(preco);
    }

    // Detectar duplicatas — manter o de maior valor_unitario
    const duplicatasParaRemover = [];
    for (const [, lista] of validosPorProduto) {
      if (lista.length <= 1) continue;
      const ordenado = [...lista].sort((a, b) => (b.valor_unitario || 0) - (a.valor_unitario || 0));
      duplicatasParaRemover.push(...ordenado.slice(1));
    }

    // Produtos ativos SEM preço válido (> 0)
    const produtosSemPreco = [];
    for (const prod of produtos) {
      if (prod.status !== 'ativo') continue;
      const lista = validosPorProduto.get(prod.id) || [];
      const temPrecoValido = lista.some(p => (p.valor_unitario || 0) > 0 || (p.ativacao_acao && (p.valor_acao || 0) > 0));
      if (!temPrecoValido) {
        produtosSemPreco.push({ id: prod.id, codigo: prod.codigo, nome: prod.nome, codigo_omie: prod.codigo_omie });
      }
    }

    // Produtos ativos COM preço válido
    let produtosComPrecoValido = 0;
    for (const [pid, lista] of validosPorProduto) {
      const prod = produtoById.get(pid);
      if (prod?.status !== 'ativo') continue;
      if (lista.some(p => (p.valor_unitario || 0) > 0 || (p.ativacao_acao && (p.valor_acao || 0) > 0))) {
        produtosComPrecoValido++;
      }
    }

    let removidos = 0;
    if (aplicar) {
      const aRemover = [...orfaos, ...duplicatasParaRemover];
      for (const p of aRemover) {
        await base44.asServiceRole.entities.PrecoProduto.delete(p.id).catch(() => null);
        removidos++;
      }
    }

    return Response.json({
      sucesso: true,
      aplicado: aplicar,
      total_precos: precos.length,
      precos_orfaos: orfaos.length,
      duplicatas: duplicatasParaRemover.length,
      removidos,
      produtos_com_preco_valido: produtosComPrecoValido,
      produtos_ativos_sem_preco: produtosSemPreco.length,
      lista_produtos_sem_preco: produtosSemPreco.slice(0, 100)
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});