import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const LOCK_KEY = 'lock_sincronizarLiberadosOmieRapido';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cria 1 registro com retry/backoff em caso de rate limit (429), para nunca estourar a cota do Base44.
async function criarComRetry(base44, registro, maxTentativas = 5) {
  let espera = 800;
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      await base44.asServiceRole.entities.PedidoLiberadoOmie.create(registro);
      return;
    } catch (e) {
      const msg = String(e?.message || '');
      const isRate = msg.includes('429') || msg.toLowerCase().includes('rate limit');
      if (isRate && tentativa < maxTentativas) {
        await sleep(espera);
        espera = Math.min(espera * 2, 8000);
        continue;
      }
      throw e;
    }
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admin apenas' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    // limite_lote: quantos espelhos criar por execução (re-executável). delay_ms: pausa entre criações.
    const { limpar_lock = false, dry_run = false, limite_lote = 150, delay_ms = 150 } = body;

    // Limpar lock preso se solicitado
    if (limpar_lock) {
      const lockRows = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave: LOCK_KEY }, '-created_date', 1).catch(() => []);
      if (lockRows?.[0]?.id) {
        await base44.asServiceRole.entities.CacheOmieConsulta.update(lockRows[0].id, {
          criado_em: new Date(0).toISOString(),
          valor: { status: 'livre' }
        });
        console.log('[criarEspelhosPedidosSemEspelho] Lock liberado manualmente');
      }
    }

    // Busca pedidos enviados ao Omie que não têm espelho local
    const [pedidos, espelhos, clientes, rotas, vendedores] = await Promise.all([
      base44.asServiceRole.entities.Pedido.filter({ omie_enviado: true }, '-created_date', 2000),
      base44.asServiceRole.entities.PedidoLiberadoOmie.list('-created_date', 5000),
      base44.asServiceRole.entities.Cliente.list('-created_date', 5000),
      base44.asServiceRole.entities.Rota.list('-created_date', 500),
      base44.asServiceRole.entities.Vendedor.list('-created_date', 500)
    ]);

    const espelhosCodigos = new Set((espelhos || []).map(e => String(e.codigo_pedido).trim()));
    const mapaRota = new Map((rotas || []).map(r => [r.id, r.nome]));
    const mapaVendedor = new Map((vendedores || []).map(v => [v.id, v.nome]));
    const mapaCliente = new Map((clientes || []).map(c => [c.id, c]));

    // Pedidos sem espelho
    const semEspelhoTotal = (pedidos || []).filter(p => {
      if (!p.omie_codigo_pedido) return false;
      const cod = String(p.omie_codigo_pedido).trim();
      return !espelhosCodigos.has(cod) && !espelhosCodigos.has(String(parseInt(cod, 10)));
    });

    console.log(`[criarEspelhosPedidosSemEspelho] ${semEspelhoTotal.length} pedidos sem espelho de ${(pedidos || []).length} total`);

    if (dry_run) {
      return Response.json({
        sucesso: true,
        dry_run: true,
        sem_espelho: semEspelhoTotal.length,
        pedidos: semEspelhoTotal.slice(0, 50).map(p => ({
          id: p.id,
          numero_pedido: p.numero_pedido,
          omie_codigo_pedido: p.omie_codigo_pedido,
          status: p.status
        }))
      });
    }

    // Processa apenas um LOTE por execução — re-executável até zerar (restantes > 0)
    const semEspelho = semEspelhoTotal.slice(0, limite_lote);

    // Mapeia status local → etapa Omie estimada (sem chamar a API)
    const statusParaEtapa = { pendente: '10', enviado: '10', liberado: '20', montagem: '50', faturado: '60', cancelado: '99', cancelado_pos_faturamento: '60' };

    let criados = 0;
    let erros = 0;
    const detalhes = [];

    for (const pedido of semEspelho) {
      const codigoPedido = String(pedido.omie_codigo_pedido).trim();
      try {
        const cliente = mapaCliente.get(pedido.cliente_id);
        const rotaNome = cliente?.rota_id ? (mapaRota.get(cliente.rota_id) || '') : (pedido.rota_nome || '');
        const vendedorNome = cliente?.vendedor_id ? (mapaVendedor.get(cliente.vendedor_id) || '') : (pedido.vendedor_nome || '');

        // Estima a etapa com base no status local — o sync periódico corrige depois
        const etapaEstimada = statusParaEtapa[pedido.status] || '10';

        // Pedidos cancelados ficam com status_real cancelada
        const cancelado = pedido.status === 'cancelado' || pedido.status === 'cancelado_pos_faturamento';
        const status_real = cancelado ? 'cancelada' : null;
        const status_label = cancelado ? 'Cancelado' : null;

        const registro = {
          codigo_pedido: codigoPedido,
          codigo_pedido_integracao: pedido.id || '',
          numero_pedido: String(pedido.numero_pedido || ''),
          etapa: etapaEstimada,
          status_real,
          status_label,
          numero_nf: pedido.numero_nota_fiscal || '',
          data_faturamento: pedido.data_faturamento || null,
          codigo_cliente: '',
          codigo_cliente_integracao: cliente?.codigo_integracao || pedido.cliente_codigo || '',
          codigo_cliente_cod: pedido.cliente_codigo || '',
          cnpj_cpf_cliente: cliente?.cnpj_cpf || pedido.cliente_cpf_cnpj || '',
          cliente_id: pedido.cliente_id || null,
          nome_cliente: cliente?.razao_social || pedido.cliente_nome || '',
          nome_fantasia: cliente?.nome_fantasia || pedido.cliente_nome_fantasia || '',
          cidade: cliente?.cidade || pedido.cliente_cidade || '',
          tipo_nota: pedido.modelo_nota || cliente?.tipo_nota || '55',
          tipo_operacao: pedido.cenario_local_tipo || '',
          tags_cliente: cliente?.tags || [],
          motorista_padrao_id: cliente?.motorista_id || null,
          rota_id: cliente?.rota_id || pedido.rota_id || null,
          rota_nome: rotaNome || 'Sem Rota',
          rota_cliente: rotaNome || 'Sem Rota',
          vendedor_id: cliente?.vendedor_id || pedido.vendedor_id || null,
          vendedor_nome: vendedorNome,
          data_previsao: pedido.data_previsao_entrega || '',
          quantidade_itens: 0,
          valor_total_pedido: pedido.valor_total || 0,
          pedido_id: pedido.id,
          produtos: [],
          sincronizado_em: new Date().toISOString(),
          origem_sync: 'reconciliacao'
        };

        await criarComRetry(base44, registro);
        criados++;
        detalhes.push({ codigo_pedido: codigoPedido, numero_pedido: pedido.numero_pedido, etapa: etapaEstimada, status: 'criado' });
        if (delay_ms > 0) await sleep(delay_ms);
      } catch (e) {
        erros++;
        detalhes.push({ codigo_pedido: codigoPedido, numero_pedido: pedido.numero_pedido, status: 'erro', erro: e.message });
        console.error(`[criarEspelhosPedidosSemEspelho] Erro no pedido ${codigoPedido}: ${e.message}`);
      }
    }

    const restantes = Math.max(0, semEspelhoTotal.length - criados);

    return Response.json({
      sucesso: true,
      sem_espelho_total: semEspelhoTotal.length,
      processados_neste_lote: semEspelho.length,
      criados,
      erros,
      restantes,
      mensagem: restantes > 0
        ? `${criados} espelho(s) criado(s). Ainda restam ${restantes} — execute novamente para continuar.`
        : `${criados} espelho(s) criado(s). Todos os pedidos sem espelho foram reconciliados.`,
      detalhes: detalhes.slice(0, 50)
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});