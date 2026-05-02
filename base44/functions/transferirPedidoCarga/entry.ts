import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Transfere um pedido de uma carga para outra (operação LOCAL, não chama Omie)
// body: { pedido_codigo_omie, carga_origem_id, carga_destino_id, motivo }
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { pedido_codigo_omie, carga_origem_id, carga_destino_id, motivo = '' } = body;
    if (!pedido_codigo_omie || !carga_origem_id || !carga_destino_id) {
      return Response.json({ error: 'pedido_codigo_omie, carga_origem_id e carga_destino_id obrigatórios' }, { status: 400 });
    }

    const origem = await base44.asServiceRole.entities.Carga.get(carga_origem_id);
    const destino = await base44.asServiceRole.entities.Carga.get(carga_destino_id);
    if (!origem || !destino) return Response.json({ error: 'Carga origem ou destino não encontrada' }, { status: 404 });

    const pedido = (origem.pedidos_omie || []).find(p => String(p.codigo_pedido) === String(pedido_codigo_omie));
    if (!pedido) return Response.json({ error: 'Pedido não está na carga origem' }, { status: 404 });
    if (JSON.stringify(pedido).toLowerCase().includes('cancelado') || JSON.stringify(pedido).toLowerCase().includes('cancelada')) {
      return Response.json({ error: 'Pedido cancelado: não é permitido editar ou ajustar.' }, { status: 400 });
    }

    // Remove da origem
    const novosPedidosOrigem = (origem.pedidos_omie || []).filter(p => String(p.codigo_pedido) !== String(pedido_codigo_omie));

    // Adiciona no destino
    const novosPedidosDestino = [...(destino.pedidos_omie || []), pedido];

    // Recalcula totais (valor, pedidos, clientes únicos, peso, volume e produtos consolidados)
    const recalcularCarga = async (pedidos, pedidosTroca = []) => {
      const todos = [...pedidos, ...pedidosTroca];
      const valor_total = todos.reduce((s, p) => s + (Number(p.valor_total_pedido) || 0), 0);
      const clientesUnicos = new Set(todos.map(p => p.codigo_cliente || p.cliente_id).filter(Boolean));

      // Consolida produtos por código (somando quantidades)
      const produtosMap = new Map();
      let peso_total_kg = 0;
      let volume_total_m3 = 0;
      const codigosOmie = new Set();

      for (const p of todos) {
        for (const prod of (p.produtos || [])) {
          const cod = String(prod.codigo_produto || prod.codigo_produto_integracao || '');
          codigosOmie.add(cod);
          const atual = produtosMap.get(cod) || {
            codigo_produto: cod,
            descricao: prod.descricao || '',
            quantidade_total: 0,
            unidade: prod.unidade || 'UN'
          };
          atual.quantidade_total += Number(prod.quantidade) || 0;
          produtosMap.set(cod, atual);
        }
      }

      // Busca produtos no Base44 (uma vez só) para obter peso/volume reais
      if (codigosOmie.size > 0) {
        const codArr = Array.from(codigosOmie);
        const produtosBase = await base44.asServiceRole.entities.Produto.filter({ codigo_omie: { $in: codArr } }, '-created_date', 1000);
        const pesoMap = new Map();
        produtosBase.forEach(pr => {
          if (pr.codigo_omie) pesoMap.set(String(pr.codigo_omie), { peso: pr.peso || 0, volume: pr.volume_m3 || 0 });
        });
        for (const [cod, item] of produtosMap.entries()) {
          const dados = pesoMap.get(cod);
          if (dados) {
            peso_total_kg += dados.peso * item.quantidade_total;
            volume_total_m3 += dados.volume * item.quantidade_total;
          }
        }
      }

      return {
        pedidos_omie: pedidos,
        quantidade_pedidos: pedidos.length,
        quantidade_clientes: clientesUnicos.size,
        valor_total,
        valor_total_carga: valor_total,
        peso_total_kg: Math.round(peso_total_kg * 100) / 100,
        volume_total_m3: Math.round(volume_total_m3 * 1000) / 1000,
        produtos_resumo: Array.from(produtosMap.values())
      };
    };

    const novaOrigem = await recalcularCarga(novosPedidosOrigem, origem.pedidos_troca || []);
    const novoDestino = await recalcularCarga(novosPedidosDestino, destino.pedidos_troca || []);

    await base44.asServiceRole.entities.Carga.update(carga_origem_id, novaOrigem);
    await base44.asServiceRole.entities.Carga.update(carga_destino_id, novoDestino);

    const registro = await base44.asServiceRole.entities.Transferencia.create({
      pedido_codigo_omie: String(pedido_codigo_omie),
      numero_pedido: String(pedido.numero_pedido || ''),
      cliente_nome: pedido.nome_cliente || '',
      carga_origem_id,
      carga_origem_numero: origem.numero_carga,
      carga_destino_id,
      carga_destino_numero: destino.numero_carga,
      motivo,
      valor_nf: pedido.valor_total_pedido || 0,
      funcionario_nome: user.full_name || user.email,
      status: 'concluida'
    });

    return Response.json({ sucesso: true, registro_id: registro.id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});