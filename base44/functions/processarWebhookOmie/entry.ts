import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// 🔄 PROCESSADOR ASSÍNCRONO DE WEBHOOK
// Disparado pela entity automation quando LogIntegracaoOmie é criado com status='pendente'.
// Roteia o evento para o handler correto e atualiza o log.

// Mapeia etapa Omie → status local do pedido
function mapEtapaParaStatus(etapa) {
  const e = String(etapa || '');
  if (e === '10') return 'pendente';
  if (e === '20') return 'liberado';
  if (e === '50') return 'montagem';
  if (e === '60') return 'faturado';
  if (e === '70' || e === '80') return 'cancelado';
  return null;
}

// Recalcula status da carga baseado nos pedidos dela
function recalcularStatusCarga(pedidosOmie, statusAtual) {
  if (!Array.isArray(pedidosOmie) || pedidosOmie.length === 0) return statusAtual || 'montagem';
  const todos = pedidosOmie;
  const todosFaturados = todos.every(p => p.etapa === '60' || p.status_pedido === 'faturado');
  const todosCancelados = todos.every(p => p.etapa === '80' || p.etapa === 'excluido' || p.status_pedido === 'cancelado');
  if (todosFaturados) return 'faturada';
  if (todosCancelados) return 'cancelada';
  if (todos.some(p => p.etapa === '60')) return statusAtual === 'faturada' ? 'faturada' : 'conferindo';
  return statusAtual || 'conferindo';
}

// Remove pedido do espelho PedidoLiberadoOmie (sai da etapa 20)
async function removerDoEspelhoLiberado(base44, omieCodigoPedido) {
  if (!omieCodigoPedido) return;
  const existentes = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(omieCodigoPedido) });
  for (const e of existentes) {
    await base44.asServiceRole.entities.PedidoLiberadoOmie.delete(e.id);
  }
}

// Insere/atualiza pedido no espelho PedidoLiberadoOmie quando entra na etapa 20.
// Chama bootstrap em modo "incremental" — busca só esse pedido via ConsultarPedido e faz o upsert.
async function upsertEspelhoLiberado(base44, omieCodigoPedido) {
  if (!omieCodigoPedido) return;

  const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
  const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');
  const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';

  const consultar = async (tentativa = 1) => {
    const res = await fetch(OMIE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: 'ConsultarPedido', app_key: APP_KEY, app_secret: APP_SECRET, param: [{ codigo_pedido: Number(omieCodigoPedido) }] })
    });
    const data = await res.json();
    if (data.faultstring) {
      const msg = String(data.faultstring).toLowerCase();
      if ((msg.includes('cota') || msg.includes('aguarde')) && tentativa < 3) {
        await new Promise(r => setTimeout(r, 2500 * tentativa));
        return consultar(tentativa + 1);
      }
      throw new Error(data.faultstring);
    }
    return data.pedido_venda_produto;
  };

  const pedidoBruto = await consultar();
  if (!pedidoBruto?.cabecalho) return;
  const etapa = String(pedidoBruto.cabecalho.etapa || '');
  if (etapa !== '20') {
    // Mudou de etapa antes de processarmos — garantir que não fica no espelho
    await removerDoEspelhoLiberado(base44, omieCodigoPedido);
    return;
  }

  // Enriquecer com cliente local (mesma lógica do bootstrap, versão mínima)
  const codigoClienteOmie = String(pedidoBruto.cabecalho.codigo_cliente || '');
  const [clientes, pedidosLocais, rotas, vendedores] = await Promise.all([
    base44.asServiceRole.entities.Cliente.list('-created_date', 10000),
    base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(omieCodigoPedido) }),
    base44.asServiceRole.entities.Rota.list('-created_date', 1000),
    base44.asServiceRole.entities.Vendedor.list('-created_date', 1000)
  ]);

  const norm = (v) => String(v || '').trim().toLowerCase();
  const cliente = clientes.find(c =>
    [c.codigo_omie, c.codigo, c.codigo_interno, c.codigo_integracao].some(x => norm(x) === norm(codigoClienteOmie))
  ) || null;

  const pedidoLocal = pedidosLocais[0] || null;
  const mapaRota = new Map(rotas.map(r => [r.id, r.nome]));
  const mapaVendedor = new Map(vendedores.map(v => [v.id, v.nome]));
  const rotaNome = cliente?.rota_id ? (mapaRota.get(cliente.rota_id) || '') : (pedidoLocal?.rota_nome || '');
  const vendedorNome = cliente?.vendedor_id ? (mapaVendedor.get(cliente.vendedor_id) || '') : (pedidoLocal?.vendedor_nome || '');

  const registro = {
    codigo_pedido: String(omieCodigoPedido),
    codigo_pedido_integracao: pedidoBruto.cabecalho.codigo_pedido_integracao || '',
    numero_pedido: String(pedidoBruto.cabecalho.numero_pedido || ''),
    etapa: '20',
    codigo_cliente: codigoClienteOmie,
    codigo_cliente_integracao: cliente?.codigo_integracao || cliente?.codigo || pedidoLocal?.cliente_codigo || '',
    codigo_cliente_cod: String(cliente?.codigo_interno || cliente?.codigo || cliente?.codigo_integracao || pedidoLocal?.cliente_codigo || ''),
    cnpj_cpf_cliente: cliente?.cnpj_cpf || pedidoLocal?.cliente_cpf_cnpj || '',
    cliente_id: cliente?.id || pedidoLocal?.cliente_id || null,
    nome_cliente: cliente?.razao_social || pedidoLocal?.cliente_nome || `Cliente ${codigoClienteOmie}`,
    nome_fantasia: cliente?.nome_fantasia || pedidoLocal?.cliente_nome_fantasia || cliente?.razao_social || '',
    cidade: cliente?.cidade || pedidoLocal?.cliente_cidade || '',
    tipo_nota: cliente?.tipo_nota || pedidoLocal?.modelo_nota || '55',
    tags_cliente: cliente?.tags || [],
    motorista_padrao_id: cliente?.motorista_id || null,
    rota_id: cliente?.rota_id || pedidoLocal?.rota_id || null,
    rota_nome: rotaNome || 'Sem Rota',
    rota_cliente: rotaNome || 'Sem Rota',
    vendedor_id: cliente?.vendedor_id || pedidoLocal?.vendedor_id || null,
    vendedor_nome: vendedorNome,
    data_previsao: pedidoBruto.cabecalho.data_previsao || '',
    quantidade_itens: (pedidoBruto.det || []).length,
    valor_total_pedido: pedidoBruto.total_pedido?.valor_total_pedido || 0,
    pedido_id: pedidoLocal?.id || null,
    produtos: (pedidoBruto.det || []).map(d => ({
      codigo_produto: String(d.produto?.codigo_produto || ''),
      codigo_produto_integracao: d.produto?.codigo_produto_integracao || '',
      descricao: d.produto?.descricao || '',
      quantidade: d.produto?.quantidade || 0,
      valor_unitario: d.produto?.valor_unitario || 0,
      valor_total: d.produto?.valor_total || 0,
      unidade: d.produto?.unidade || ''
    })),
    sincronizado_em: new Date().toISOString(),
    origem_sync: 'webhook'
  };

  const existentes = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(omieCodigoPedido) });
  if (existentes.length > 0) {
    await base44.asServiceRole.entities.PedidoLiberadoOmie.update(existentes[0].id, registro);
  } else {
    await base44.asServiceRole.entities.PedidoLiberadoOmie.create(registro);
  }
}

// Atualiza pedido dentro da carga e recalcula status da carga
async function atualizarPedidoNaCarga(base44, omieCodigoPedido, dadosAtualizados) {
  if (!omieCodigoPedido) return;
  const cargas = await base44.asServiceRole.entities.Carga.list('-created_date', 200);

  for (const carga of cargas) {
    const pedidos = Array.isArray(carga.pedidos_omie) ? carga.pedidos_omie : [];
    const idx = pedidos.findIndex(p => String(p.codigo_pedido) === String(omieCodigoPedido));
    if (idx === -1) continue;

    const novosPedidos = pedidos.map((p, i) => i === idx ? { ...p, ...dadosAtualizados } : p);
    const novoStatus = recalcularStatusCarga(novosPedidos, carga.status_carga);

    const updates = { pedidos_omie: novosPedidos };
    if (novoStatus !== carga.status_carga) updates.status_carga = novoStatus;
    if (novoStatus === 'faturada' && !carga.data_faturamento) updates.data_faturamento = new Date().toISOString();

    await base44.asServiceRole.entities.Carga.update(carga.id, updates);
    console.log(`[processarWebhookOmie] Carga ${carga.numero_carga} → status: ${novoStatus} (pedido ${omieCodigoPedido} atualizado)`);
    return; // pedido só pode estar em 1 carga
  }
}

// === HANDLERS POR DOMÍNIO ===

async function handlePedido(base44, topic, evt) {
  const codigoPedido = String(evt?.idPedido || evt?.codigo_pedido || '');
  if (!codigoPedido) return { acao: 'ignorado', motivo: 'sem codigo_pedido' };

  // 🔄 ESPELHO MONTAGEM: manter PedidoLiberadoOmie em tempo real
  // Qualquer evento que tire o pedido da etapa 20 → remove do espelho
  // EtapaAlterada para 20 → adiciona/atualiza no espelho
  let espelhoAcao = null;
  try {
    if (topic === 'VendaProduto.Faturada' || topic === 'VendaProduto.Cancelada' || topic === 'VendaProduto.Excluida' || topic === 'VendaProduto.Devolvida') {
      await removerDoEspelhoLiberado(base44, codigoPedido);
      espelhoAcao = 'removido';
    } else if (topic === 'VendaProduto.EtapaAlterada' || topic === 'VendaProduto.Incluida' || topic === 'VendaProduto.Alterada') {
      const novaEtapa = String(evt?.etapa || '');
      if (novaEtapa === '20' || topic === 'VendaProduto.Alterada' || topic === 'VendaProduto.Incluida') {
        await upsertEspelhoLiberado(base44, codigoPedido);
        espelhoAcao = 'upsert';
      } else if (novaEtapa && novaEtapa !== '20') {
        await removerDoEspelhoLiberado(base44, codigoPedido);
        espelhoAcao = 'removido';
      }
    }
  } catch (e) {
    console.error(`[espelhoLiberado] erro ao sincronizar ${codigoPedido}:`, e.message);
  }

  const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigoPedido });
  if (pedidos.length === 0) return { acao: 'ignorado', motivo: 'pedido não encontrado no Base44', espelho: espelhoAcao };

  const pedido = pedidos[0];
  const updates = {};
  const dadosCarga = {};

  if (topic === 'VendaProduto.Faturada') {
    updates.status = 'faturado';
    updates.faturado = true;
    updates.data_faturamento = new Date().toISOString();
    if (evt?.numero_nf) {
      updates.numero_nota_fiscal = String(evt.numero_nf);
      dadosCarga.numero_nf = String(evt.numero_nf);
    }
    dadosCarga.etapa = '60';
    dadosCarga.status_pedido = 'faturado';
  } else if (topic === 'VendaProduto.Cancelada' || topic === 'VendaProduto.Excluida') {
    updates.status = 'cancelado';
    updates.data_cancelamento = new Date().toISOString();
    updates.motivo_cancelamento = `Cancelado/excluído no Omie (${topic})`;
    dadosCarga.etapa = topic === 'VendaProduto.Excluida' ? 'excluido' : '80';
    dadosCarga.status_pedido = 'cancelado';
  } else if (topic === 'VendaProduto.EtapaAlterada') {
    const novoStatus = mapEtapaParaStatus(evt?.etapa);
    if (novoStatus) updates.status = novoStatus;
    if (evt?.etapa) dadosCarga.etapa = String(evt.etapa);
  } else if (topic === 'VendaProduto.Devolvida') {
    updates.status = 'cancelado';
    updates.data_cancelamento = new Date().toISOString();
    updates.motivo_cancelamento = 'Pedido devolvido no Omie';
    dadosCarga.etapa = '80';
    dadosCarga.status_pedido = 'devolvido';
  } else {
    return { acao: 'ignorado', motivo: `topic ${topic} sem handler` };
  }

  if (Object.keys(updates).length > 0) {
    await base44.asServiceRole.entities.Pedido.update(pedido.id, updates);
  }
  if (Object.keys(dadosCarga).length > 0) {
    await atualizarPedidoNaCarga(base44, codigoPedido, dadosCarga);
  }

  return { acao: 'atualizado', pedido_id: pedido.id, updates, espelho: espelhoAcao };
}

async function handleNFe(base44, topic, evt) {
  const codigoPedido = String(evt?.idPedido || evt?.codigo_pedido || '');
  if (!codigoPedido) return { acao: 'ignorado', motivo: 'sem codigo_pedido' };

  const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigoPedido });
  if (pedidos.length === 0) return { acao: 'ignorado', motivo: 'pedido não encontrado' };

  const pedido = pedidos[0];
  const updates = {};
  const dadosCarga = {};

  if (topic === 'NFe.NotaAutorizada') {
    updates.faturado = true;
    updates.status = 'faturado';
    updates.data_faturamento = new Date().toISOString();
    const numNf = evt?.numero_nf || evt?.numero_nota;
    if (numNf) {
      updates.numero_nota_fiscal = String(numNf);
      dadosCarga.numero_nf = String(numNf);
    }
    dadosCarga.etapa = '60';
    dadosCarga.status_pedido = 'faturado';
  } else if (topic === 'NFe.NotaCancelada') {
    updates.status = 'cancelado';
    updates.data_cancelamento = new Date().toISOString();
    updates.motivo_cancelamento = 'NF-e cancelada no Omie';
    dadosCarga.etapa = '80';
    dadosCarga.status_pedido = 'cancelado';
  } else if (topic === 'NFe.NotaDevolucaoAutorizada') {
    updates.motivo_cancelamento = 'NF-e de devolução autorizada no Omie';
    const numNf = evt?.numero_nf || evt?.numero_nota;
    if (numNf) updates.numero_nota_fiscal = String(numNf);
    dadosCarga.status_pedido = 'devolvido';
  }

  if (Object.keys(updates).length > 0) {
    await base44.asServiceRole.entities.Pedido.update(pedido.id, updates);
  }
  if (Object.keys(dadosCarga).length > 0) {
    await atualizarPedidoNaCarga(base44, codigoPedido, dadosCarga);
  }

  return { acao: 'atualizado', pedido_id: pedido.id, updates };
}

async function handleFinanceiro(base44, topic, evt) {
  // Eventos financeiros: só loga (acerto de caixa tem fluxo próprio)
  return {
    acao: 'logado',
    topic,
    codigo_lancamento: evt?.codigo_lancamento || null,
    valor: evt?.valor_pago || evt?.valor || null
  };
}

// === HANDLER PRINCIPAL (entity automation payload) ===

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json().catch(() => ({}));

    // Entity automation envia: { event: {type, entity_name, entity_id}, data: {...} }
    const eventType = payload?.event?.type;
    const entityName = payload?.event?.entity_name;
    const entityId = payload?.event?.entity_id;
    let logData = payload?.data;

    // Só processa criação de LogIntegracaoOmie
    if (eventType !== 'create' || entityName !== 'LogIntegracaoOmie') {
      return Response.json({ ignorado: true, motivo: 'evento não aplicável' });
    }

    // Se payload veio truncado, busca o log
    if (payload?.payload_too_large || !logData) {
      logData = await base44.asServiceRole.entities.LogIntegracaoOmie.get(entityId);
    }

    // Só processa logs de webhook pendentes
    if (logData?.endpoint !== 'webhook' || logData?.status !== 'pendente') {
      return Response.json({ ignorado: true, motivo: 'log não é webhook pendente' });
    }

    const topic = logData.webhook_topic || logData.call || '';
    let body;
    try { body = JSON.parse(logData.payload_resposta || '{}'); } catch { body = {}; }
    const evt = body.event || body;

    let resultado = { acao: 'ignorado' };

    // ROTEAMENTO
    if (topic.startsWith('VendaProduto.')) {
      resultado = await handlePedido(base44, topic, evt);
    } else if (topic.startsWith('NFe.')) {
      resultado = await handleNFe(base44, topic, evt);
    } else if (topic.startsWith('Financas.ContaReceber.')) {
      resultado = await handleFinanceiro(base44, topic, evt);
    } else if (topic.startsWith('ClienteFornecedor.')) {
      // Decisão do usuário: SÓ LOGAR, sem atualizar
      resultado = {
        acao: 'logado',
        motivo: 'Cliente alterado no Omie — sem sincronização automática',
        codigo_omie: evt?.codigo_cliente_omie || evt?.idCliente || null
      };
    } else if (topic.startsWith('Produto.')) {
      // Decisão do usuário: SÓ LOGAR, sem atualizar
      resultado = {
        acao: 'logado',
        motivo: 'Produto alterado no Omie — sem sincronização automática',
        codigo_omie: evt?.codigo_produto || evt?.idProduto || null
      };
    }

    // Marca log como processado
    await base44.asServiceRole.entities.LogIntegracaoOmie.update(entityId, {
      status: resultado.acao === 'ignorado' ? 'ignorado' : 'processado',
      webhook_processado_em: new Date().toISOString(),
      mensagem_erro: resultado.motivo || null,
      payload_enviado: JSON.stringify(resultado).slice(0, 3000)
    });

    return Response.json({ sucesso: true, topic, resultado });
  } catch (error) {
    console.error('[processarWebhookOmie] Erro:', error.message);

    // Marca log como erro
    try {
      const base44 = createClientFromRequest(req);
      const payload = await req.json().catch(() => ({}));
      const entityId = payload?.event?.entity_id;
      if (entityId) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.update(entityId, {
          status: 'erro',
          mensagem_erro: error.message.slice(0, 500),
          webhook_processado_em: new Date().toISOString()
        });
      }
    } catch {}

    return Response.json({ error: error.message }, { status: 500 });
  }
});