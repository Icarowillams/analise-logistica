import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Transfere um ou mais pedidos de uma carga para outra (operação LOCAL, não chama Omie)
// body: {
//   pedidos_codigos_omie: string[],   // novo (vários)
//   pedido_codigo_omie: string,        // legacy (um só) — mantido pra compatibilidade
//   carga_origem_id, carga_destino_id, motivo
// }
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const {
      pedidos_codigos_omie,
      pedido_codigo_omie,
      carga_origem_id,
      carga_destino_id,
      motivo = ''
    } = body;

    // Normaliza para sempre trabalhar com array
    const codigos = Array.isArray(pedidos_codigos_omie) && pedidos_codigos_omie.length
      ? pedidos_codigos_omie.map(String)
      : (pedido_codigo_omie ? [String(pedido_codigo_omie)] : []);

    if (codigos.length === 0 || !carga_origem_id || !carga_destino_id) {
      return Response.json({ error: 'pedidos_codigos_omie (ou pedido_codigo_omie), carga_origem_id e carga_destino_id obrigatórios' }, { status: 400 });
    }
    if (carga_origem_id === carga_destino_id) {
      return Response.json({ error: 'Carga origem e destino devem ser diferentes' }, { status: 400 });
    }

    const origem = await base44.asServiceRole.entities.Carga.get(carga_origem_id);
    const destino = await base44.asServiceRole.entities.Carga.get(carga_destino_id);
    if (!origem || !destino) return Response.json({ error: 'Carga origem ou destino não encontrada' }, { status: 404 });

    const pedidosOrigem = origem.pedidos_omie || [];
    const pedidosMover = pedidosOrigem.filter(p => codigos.includes(String(p.codigo_pedido)));

    if (pedidosMover.length === 0) {
      return Response.json({ error: 'Nenhum dos pedidos informados está na carga origem' }, { status: 404 });
    }

    // Bloqueia pedidos cancelados
    const cancelado = pedidosMover.find(p => JSON.stringify(p).toLowerCase().match(/cancelad[oa]/));
    if (cancelado) {
      return Response.json({ error: `Pedido ${cancelado.numero_pedido} está cancelado: não pode ser transferido.` }, { status: 400 });
    }

    // Remove da origem
    const novosPedidosOrigem = pedidosOrigem.filter(p => !codigos.includes(String(p.codigo_pedido)));
    // Adiciona no destino
    const novosPedidosDestino = [...(destino.pedidos_omie || []), ...pedidosMover];

    // Recalcula totais + consolida produtos (entram na Listagem da carga destino)
    const recalcularCarga = async (pedidos, pedidosTroca = []) => {
      const todos = [...pedidos, ...pedidosTroca];
      const valor_total = todos.reduce((s, p) => s + (Number(p.valor_total_pedido) || 0), 0);
      const clientesUnicos = new Set(todos.map(p => p.codigo_cliente || p.cliente_id).filter(Boolean));

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

    // Atualiza Pedido (Base44) — coluna N. Carga em Gerenciar Pedidos puxa daí
    const registros = [];
    for (const ped of pedidosMover) {
      try {
        const lista = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(ped.codigo_pedido) }, '-created_date', 1);
        if (lista && lista[0]) {
          await base44.asServiceRole.entities.Pedido.update(lista[0].id, {
            carga_id: carga_destino_id,
            numero_carga: destino.numero_carga
          });
        }
      } catch (_) { /* ignora — atualização opcional */ }

      // Quantidade total de unidades transferidas (soma das quantidades dos produtos do pedido)
      const qtdUnidades = (ped.produtos || []).reduce((s, p) => s + (Number(p.quantidade) || 0), 0);

      const reg = await base44.asServiceRole.entities.Transferencia.create({
        pedido_codigo_omie: String(ped.codigo_pedido),
        numero_pedido: String(ped.numero_pedido || ''),
        numero_nf: String(ped.numero_nf || ''),
        cliente_codigo: String(ped.codigo_cliente_cod || ped.codigo_cliente || ''),
        cliente_nome: ped.nome_cliente || ped.nome_fantasia || '',
        carga_origem_id,
        carga_origem_numero: origem.numero_carga,
        carga_destino_id,
        carga_destino_numero: destino.numero_carga,
        motivo,
        valor_nf: ped.valor_total_pedido || 0,
        quantidade_itens: qtdUnidades || Number(ped.quantidade_itens || 0),
        funcionario_nome: user.full_name || user.email,
        status: 'concluida'
      });
      registros.push(reg.id);
    }

    return Response.json({
      sucesso: true,
      transferidos: pedidosMover.length,
      registros_ids: registros
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});