import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');
let base44Global = null;

async function omieCall(call, param, opts = {}) {
  const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3, cacheMinutes: 0, logIntegration: true } : opts;
  const chave = `${OMIE_URL}|${call}|${JSON.stringify(param || {})}`;
  const controles = await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = controles?.[0];

  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
    throw new Error(`API Omie bloqueada temporariamente. Tente novamente em ${controle.bloqueado_ate}`);
  }

  if (cacheMinutes > 0) {
    const caches = await base44Global.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
    if (caches?.[0] && new Date(caches[0].expira_em) > new Date()) return caches[0].valor;
  }

  let ultimoErro = '';
  for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
    const inicio = Date.now();
    const res = await fetch(OMIE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
    });
    const data = await res.json();

    if (data.faultstring || data.faultcode) {
      const msg = String(data.faultstring || '').toLowerCase();
      const deveBloquear = res.status === 425 || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde');
      if (deveBloquear) {
        const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: data.faultstring || '', atualizado_em: new Date().toISOString() };
        if (controle?.id) await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {});
        else await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
        throw new Error(data.faultstring || 'API Omie bloqueada temporariamente');
      }

      const deveTentar = res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('indispon');
      ultimoErro = data.faultstring || 'Erro Omie';
      if (deveTentar && tentativa < maxRetries) {
        await new Promise(r => setTimeout(r, 2500 * tentativa));
        continue;
      }
      throw new Error(ultimoErro);
    }

    if (logIntegration) {
      await base44Global.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: OMIE_URL,
        call,
        operacao: call,
        status: 'sucesso',
        payload_enviado: JSON.stringify(param || {}).slice(-500),
        payload_resposta: JSON.stringify(data || {}).slice(-500),
        duracao_ms: Date.now() - inicio,
        tentativas: tentativa
      }).catch(() => {});
    }
    return data;
  }

  throw new Error(ultimoErro || 'Máximo de tentativas Omie excedido');
}

// Localiza a Carga a que um pedido pertence (sem alterar) — usado para anexar ao LogCorte
// Retorna { id, numero, pedidoNaCarga } para reaproveitar dados de cliente já carregados no snapshot
async function localizarCargaDoPedido(base44, codigoPedidoOmie, isInterno, pedidoIdInterno) {
  try {
    const cargas = await base44.asServiceRole.entities.Carga.list('-created_date', 200);
    for (const carga of cargas) {
      const arr = isInterno ? (carga.pedidos_internos || []) : (carga.pedidos_omie || []);
      const pedidoNaCarga = arr.find(p => isInterno
        ? String(p.pedido_id) === String(pedidoIdInterno)
        : String(p.codigo_pedido) === String(codigoPedidoOmie));
      if (pedidoNaCarga) return { id: carga.id, numero: carga.numero_carga, pedidoNaCarga };
    }
  } catch (_) {}
  return { id: null, numero: null, pedidoNaCarga: null };
}

// Atualiza Carga.pedidos_omie / pedidos_internos local: aplica novas quantidades
async function refletirCorteNaCargaLocal(base44, codigoPedidoOmie, cortes, isInterno, pedidoIdInterno) {
  try {
    const cargas = await base44.asServiceRole.entities.Carga.list('-created_date', 200);
    for (const carga of cargas) {
      let modificou = false;
      let pedidosArray = isInterno ? (carga.pedidos_internos || []) : (carga.pedidos_omie || []);
      const novos = pedidosArray.map(ped => {
        const match = isInterno
          ? String(ped.pedido_id) === String(pedidoIdInterno)
          : String(ped.codigo_pedido) === String(codigoPedidoOmie);
        if (!match) return ped;

        const novosProdutos = (ped.produtos || []).map(pr => {
          const cod = String(pr.codigo_produto || pr.codigo_produto_integracao || '');
          const corte = cortes.find(c => String(c.codigo_produto) === cod);
          if (!corte) return pr;
          modificou = true;
          const novaQtd = Number(corte.nova_quantidade);
          if (novaQtd === 0) return null; // remover item
          return {
            ...pr,
            quantidade: novaQtd,
            valor_total: novaQtd * Number(pr.valor_unitario || 0)
          };
        }).filter(Boolean);

        // Recalcular totais do pedido
        const valorTotal = novosProdutos.reduce((s, p) => s + Number(p.valor_total || 0), 0);
        const qtdItens = novosProdutos.length;
        return { ...ped, produtos: novosProdutos, valor_total_pedido: valorTotal, quantidade_itens: qtdItens };
      });

      if (modificou) {
        // Recalcular totais da carga
        const todosProds = [
          ...(isInterno ? (carga.pedidos_omie || []) : novos),
          ...(isInterno ? novos : (carga.pedidos_internos || [])),
          ...(carga.pedidos_troca || [])
        ];
        const valorTotalCarga = todosProds.reduce((s, p) => s + Number(p.valor_total_pedido || 0), 0);

        const updateData = isInterno
          ? { pedidos_internos: novos, valor_total: valorTotalCarga, valor_total_carga: valorTotalCarga }
          : { pedidos_omie: novos, valor_total: valorTotalCarga, valor_total_carga: valorTotalCarga };

        await base44.asServiceRole.entities.Carga.update(carga.id, updateData);
        return carga.id;
      }
    }
  } catch (e) {
    console.error('[cortarPedidoOmie] Falha ao refletir corte na Carga local:', e.message);
  }
  return null;
}

// Corte em pedido D1 interno (sem Omie): atualiza apenas o Pedido + Carga local
async function cortarPedidoInterno(base44, pedido_id, cortes, motivo_geral, user) {
  const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
  if (!pedido) throw new Error('Pedido interno não encontrado');
  if (pedido.status === 'cancelado') throw new Error('Pedido cancelado: não permite corte');

  const cargaInfo = await localizarCargaDoPedido(base44, null, true, pedido_id);

  // Atualizar valor total do pedido — itens reais ficam no PedidoItem
  const itens = await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id });
  const logs = [];
  let novoTotal = 0;

  for (const item of itens) {
    const corte = cortes.find(c => String(c.codigo_produto) === String(item.produto_codigo || item.codigo_produto));
    if (!corte) {
      novoTotal += Number(item.valor_total || 0);
      continue;
    }
    const qOrig = Number(item.quantidade || 0);
    const qNova = Number(corte.nova_quantidade);
    const valUnit = Number(item.valor_unitario || 0);

    logs.push({
      pedido_codigo_omie: '',
      numero_pedido: pedido.numero_pedido || '',
      cliente_id: pedido.cliente_id || '',
      cliente_codigo: String(pedido.cliente_codigo || ''),
      cliente_nome: pedido.cliente_nome || pedido.cliente_nome_fantasia || '',
      cnpj_cpf_cliente: pedido.cliente_cpf_cnpj || '',
      carga_id: cargaInfo.id || pedido.carga_id || null,
      carga_numero: cargaInfo.numero || pedido.numero_carga || null,
      produto_codigo: String(item.produto_codigo || ''),
      produto_descricao: item.produto_descricao || item.descricao || '',
      quantidade_anterior: qOrig,
      quantidade_nova: qNova,
      quantidade_cortada: qOrig - qNova,
      valor_unitario: valUnit,
      valor_anterior: qOrig * valUnit,
      valor_novo: qNova * valUnit,
      valor_cortado: (qOrig - qNova) * valUnit,
      motivo: corte.motivo || motivo_geral,
      tipo_operacao: qNova === 0 ? 'remocao_item' : 'corte_quantidade',
      funcionario_nome: user.full_name || user.email,
      sincronizado_omie: false,
      origem_pedido: 'interno_d1'
    });

    if (qNova === 0) {
      await base44.asServiceRole.entities.PedidoItem.delete(item.id);
    } else {
      await base44.asServiceRole.entities.PedidoItem.update(item.id, {
        quantidade: qNova,
        valor_total: qNova * valUnit
      });
      novoTotal += qNova * valUnit;
    }
  }

  await base44.asServiceRole.entities.Pedido.update(pedido_id, { valor_total: novoTotal });

  // Refletir na Carga local também
  await refletirCorteNaCargaLocal(base44, null, cortes, true, pedido_id);

  for (const log of logs) {
    await base44.asServiceRole.entities.LogCorte.create(log).catch(() => {});
  }

  return logs;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    base44Global = base44;
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_pedido, pedido_id_interno, cortes = [], motivo_geral = '' } = body;
    if (cortes.length === 0) return Response.json({ error: 'cortes vazio' }, { status: 400 });

    // === FLUXO PEDIDO INTERNO (D1) ===
    if (pedido_id_interno && !codigo_pedido) {
      const logs = await cortarPedidoInterno(base44, pedido_id_interno, cortes, motivo_geral, user);
      return Response.json({ sucesso: true, itens_alterados: logs.length, logs, origem: 'interno' });
    }

    // === FLUXO PEDIDO OMIE ===
    if (!codigo_pedido) return Response.json({ error: 'codigo_pedido obrigatório' }, { status: 400 });

    const consulta = await omieCall('ConsultarPedido', { codigo_pedido: Number(codigo_pedido) }, { cacheMinutes: 0 });
    const pedido = consulta.pedido_venda_produto;
    if (!pedido) return Response.json({ error: 'Pedido não encontrado no Omie' }, { status: 404 });

    const cargaInfo = await localizarCargaDoPedido(base44, codigo_pedido, false, null);

    // Tenta resolver o cliente local pelo CNPJ/CPF para enriquecer o log
    let clienteLocal = null;
    try {
      const cnpj = String(pedido.cliente?.cnpj_cpf || '').replace(/\D/g, '');
      if (cnpj) {
        const lista = await base44.asServiceRole.entities.Cliente.filter({ cnpj_cpf: cnpj }, '-created_date', 1);
        clienteLocal = lista?.[0] || null;
      }
    } catch (_) {}

    // Detecção precisa de cancelamento (NÃO usa JSON.stringify — pegaria histórico)
    const flagCancelado = pedido?.infoCadastro?.cancelado;
    const etapaAtual = String(pedido?.cabecalho?.etapa || '');
    if (flagCancelado === 'S' || etapaAtual === '99') {
      return Response.json({ error: 'Pedido cancelado: não é permitido editar ou ajustar.' }, { status: 400 });
    }

    // Regra de negócio: só pode cortar pedidos nas etapas 10 (Pedido), 20 (Liberados) ou 50 (Faturar / Montagem).
    // Etapa 60 (Faturado) já gerou NF — não pode mais ajustar.
    const ETAPAS_AJUSTAVEIS = ['10', '20', '50'];
    const ETAPA_NOMES_MAP = { '10': 'Pedido de Venda', '20': 'Liberados (Pendente)', '50': 'Faturar (Montagem)', '60': 'Faturado', '70': 'Entrega' };
    if (!ETAPAS_AJUSTAVEIS.includes(etapaAtual)) {
      const nome = ETAPA_NOMES_MAP[etapaAtual] || `Etapa ${etapaAtual}`;
      return Response.json({
        error: `Não é possível cortar este pedido. Está na etapa "${nome}" (${etapaAtual}). Apenas pedidos Pendentes, Liberados ou em Montagem podem ser cortados.`,
        etapa_atual: etapaAtual,
        etapa_nome: nome
      }, { status: 400 });
    }

    const itensAtuais = pedido.det || [];
    const logs = [];

    const novosItens = [];
    for (const item of itensAtuais) {
      const codProdInt = item.produto?.codigo_produto_integracao;
      const codProd = item.produto?.codigo_produto;
      const corte = cortes.find(c =>
        String(c.codigo_produto) === String(codProd) ||
        String(c.codigo_produto) === String(codProdInt)
      );

      if (!corte) {
        novosItens.push(item);
        continue;
      }

      const qtdAnterior = item.produto?.quantidade || 0;
      const qtdNova = Number(corte.nova_quantidade);
      const valorUnit = item.produto?.valor_unitario || 0;

      const pedNaCarga = cargaInfo.pedidoNaCarga;
      logs.push({
        pedido_codigo_omie: String(codigo_pedido),
        numero_pedido: String(pedido.cabecalho?.numero_pedido || ''),
        cliente_id: clienteLocal?.id || '',
        cliente_codigo: String(clienteLocal?.codigo_interno || pedNaCarga?.codigo_cliente_cod || pedNaCarga?.codigo_cliente || pedido.cliente?.codigo_cliente_omie || ''),
        cliente_nome: clienteLocal?.razao_social || pedNaCarga?.nome_cliente || pedNaCarga?.nome_fantasia || pedido.cliente?.nome_cliente || '',
        cnpj_cpf_cliente: String(pedNaCarga?.cnpj_cpf_cliente || pedido.cliente?.cnpj_cpf || ''),
        carga_id: cargaInfo.id || null,
        carga_numero: cargaInfo.numero || null,
        produto_codigo: String(codProd || ''),
        produto_codigo_integracao: String(codProdInt || ''),
        produto_descricao: item.produto?.descricao || '',
        quantidade_anterior: qtdAnterior,
        quantidade_nova: qtdNova,
        quantidade_cortada: qtdAnterior - qtdNova,
        valor_unitario: valorUnit,
        valor_anterior: qtdAnterior * valorUnit,
        valor_novo: qtdNova * valorUnit,
        valor_cortado: (qtdAnterior - qtdNova) * valorUnit,
        motivo: corte.motivo || motivo_geral,
        tipo_operacao: qtdNova === 0 ? 'remocao_item' : 'corte_quantidade',
        funcionario_nome: user.full_name || user.email,
        origem_pedido: 'omie',
        sincronizado_omie: false
      });

      if (qtdNova > 0) {
        novosItens.push({
          ...item,
          produto: { ...item.produto, quantidade: qtdNova }
        });
      }
    }

    let erroOmie = null;
    try {
      await omieCall('AlterarPedidoVenda', {
        cabecalho: {
          codigo_pedido: Number(codigo_pedido),
          etapa: pedido.cabecalho?.etapa || '10'
        },
        det: novosItens
      }, { cacheMinutes: 0 });
    } catch (err) {
      erroOmie = err.message;
    }

    for (const log of logs) {
      await base44.asServiceRole.entities.LogCorte.create({
        ...log,
        sincronizado_omie: !erroOmie,
        erro_omie: erroOmie
      }).catch(() => {});
    }

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'AlterarPedidoVenda',
      operacao: 'cortar_pedido',
      entidade_tipo: 'Pedido',
      entidade_id: String(codigo_pedido),
      status: erroOmie ? 'erro' : 'sucesso',
      mensagem_erro: erroOmie,
      usuario_email: user.email
    }).catch(() => {});

    if (erroOmie) return Response.json({ error: erroOmie }, { status: 500 });

    // Refletir corte na Carga local (espelho!)
    const cargaAtualizada = await refletirCorteNaCargaLocal(base44, codigo_pedido, cortes, false, null);

    return Response.json({ sucesso: true, itens_alterados: logs.length, logs, carga_atualizada: cargaAtualizada });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});