import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function omieCall(call, param, tentativa = 1) {
  const res = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  if (res.status === 425) {
    return { faultstring: 'API Omie bloqueada (HTTP 425). Aguarde até 30 minutos.', faultcode: 'BLOQUEIO_425' };
  }
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    const isRate = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || res.status === 429;
    if (isRate && tentativa < 4) {
      await sleep(3000 * tentativa);
      return omieCall(call, param, tentativa + 1);
    }
  }
  return data;
}

// Hoje em America/Recife no formato dd/mm/yyyy
function hojeBR() {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Recife' });
}

// Constrói payload IncluirPedido a partir de um pedido_venda_produto consultado
function montarPayloadDuplicado(pedidoOriginal, codigoIntegracaoNovo) {
  const cab = pedidoOriginal.cabecalho || {};
  const det = (pedidoOriginal.det || []).map((d, idx) => {
    const novoIde = { codigo_item_integracao: `${codigoIntegracaoNovo}-${idx + 1}` };
    return {
      ide: novoIde,
      inf_adic: d.inf_adic || {},
      produto: { ...(d.produto || {}) }
    };
  });

  const cabecalho = {
    codigo_pedido_integracao: codigoIntegracaoNovo,
    // Cliente — usa o mesmo do original
    ...(cab.codigo_cliente ? { codigo_cliente: cab.codigo_cliente } : {}),
    ...(cab.codigo_cliente_integracao ? { codigo_cliente_integracao: cab.codigo_cliente_integracao } : {}),
    data_previsao: hojeBR(),
    etapa: '10',
    codigo_parcela: cab.codigo_parcela || '999',
    quantidade_itens: det.length,
    ...(cab.codigo_cenario_impostos ? { codigo_cenario_impostos: String(cab.codigo_cenario_impostos) } : {})
  };

  const payload = {
    cabecalho,
    det,
    frete: pedidoOriginal.frete || { modalidade: '9' },
    informacoes_adicionais: {
      ...(pedidoOriginal.informacoes_adicionais || {}),
      // Limpa campos que não devem vir do pedido antigo
      numero_pedido_cliente: undefined,
    }
  };

  // Replica parcelas se houver
  if (pedidoOriginal.lista_parcelas?.parcela?.length > 0) {
    payload.lista_parcelas = {
      parcela: pedidoOriginal.lista_parcelas.parcela.map((p, i) => ({
        numero_parcela: p.numero_parcela || (i + 1),
        data_vencimento: hojeBR(), // recalcular conforme política seria mais correto, mas Omie aceita
        percentual: p.percentual,
        valor: p.valor
      }))
    };
  }

  // Remove chaves undefined
  Object.keys(payload.informacoes_adicionais).forEach(k => {
    if (payload.informacoes_adicionais[k] === undefined) delete payload.informacoes_adicionais[k];
  });

  return payload;
}

async function duplicarUm(base44, codigo_pedido, codigo_pedido_integracao, userEmail) {
  // 1. Consultar pedido original
  const param = {};
  if (codigo_pedido) param.codigo_pedido = Number(codigo_pedido);
  else if (codigo_pedido_integracao) param.codigo_pedido_integracao = String(codigo_pedido_integracao);
  else return { sucesso: false, erro: 'codigo_pedido obrigatório' };

  const consulta = await omieCall('ConsultarPedido', param);
  if (consulta?.faultstring) return { sucesso: false, erro: `Consulta Omie: ${consulta.faultstring}` };
  const pedidoOriginal = consulta.pedido_venda_produto;
  if (!pedidoOriginal) return { sucesso: false, erro: 'Pedido não encontrado no Omie' };

  // 2. Gerar codigo_pedido_integracao único
  const codigoIntegracaoNovo = `DUP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // 3. Montar payload e enviar IncluirPedido
  const payload = montarPayloadDuplicado(pedidoOriginal, codigoIntegracaoNovo);
  const resultado = await omieCall('IncluirPedido', payload);
  if (resultado?.faultstring) {
    return { sucesso: false, erro: resultado.faultstring, origem_codigo: codigo_pedido };
  }

  const novoCodigoPedido = resultado.codigo_pedido || resultado.codigo_pedido_omie || null;
  const novoNumeroPedido = resultado.numero_pedido || resultado.numero_pedido_omie || null;

  // 4. Criar registro local na entidade Pedido (status pendente) para aparecer no Gerenciar Pedidos
  let pedidoLocalId = null;
  try {
    const cab = pedidoOriginal.cabecalho || {};

    // Tenta primeiro pegar do espelho PedidoLiberadoOmie (já tem cliente_id resolvido)
    let clienteLocal = null;
    let vendedorLocal = null;
    try {
      const espelho = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: String(codigo_pedido) });
      if (espelho?.length) {
        const esp = espelho[0];
        if (esp.cliente_id) {
          clienteLocal = await base44.asServiceRole.entities.Cliente.get(esp.cliente_id).catch(() => null);
        }
        if (esp.vendedor_id) {
          vendedorLocal = await base44.asServiceRole.entities.Vendedor.get(esp.vendedor_id).catch(() => null);
        }
      }
    } catch { /* ignore */ }

    // Fallback: resolver pelo codigo_omie do cliente
    if (!clienteLocal && cab.codigo_cliente) {
      const found = await base44.asServiceRole.entities.Cliente.filter({ codigo_omie: String(cab.codigo_cliente) });
      if (found?.length) clienteLocal = found[0];
    }
    if (!clienteLocal && cab.codigo_cliente_integracao) {
      const found = await base44.asServiceRole.entities.Cliente.filter({ codigo_integracao: String(cab.codigo_cliente_integracao) });
      if (found?.length) clienteLocal = found[0];
    }

    const totalItens = (pedidoOriginal.det || []).length;
    const valorTotal = (pedidoOriginal.det || []).reduce((s, d) => s + (Number(d.produto?.valor_total) || 0), 0);

    const novoPedidoLocal = await base44.asServiceRole.entities.Pedido.create({
      tipo: 'venda',
      origem: 'omie',
      numero_pedido: novoNumeroPedido ? String(novoNumeroPedido) : '',
      status: 'pendente',
      etapa: 'comercial',
      cliente_id: clienteLocal?.id || '',
      cliente_codigo: clienteLocal?.codigo_interno || clienteLocal?.codigo_omie || '',
      cliente_nome: clienteLocal?.razao_social || '',
      cliente_nome_fantasia: clienteLocal?.nome_fantasia || '',
      cliente_cpf_cnpj: clienteLocal?.cnpj_cpf || '',
      cliente_endereco: clienteLocal?.endereco || '',
      cliente_numero: clienteLocal?.numero || '',
      cliente_bairro: clienteLocal?.bairro || '',
      cliente_cidade: clienteLocal?.cidade || '',
      cliente_estado: clienteLocal?.estado || '',
      cliente_cep: clienteLocal?.cep || '',
      vendedor_id: vendedorLocal?.id || clienteLocal?.vendedor_id || '',
      vendedor_nome: vendedorLocal?.nome || '',
      modelo_nota: '55',
      total_itens: totalItens,
      valor_total: valorTotal,
      omie_enviado: true,
      omie_codigo_pedido: String(novoCodigoPedido || ''),
      data_envio: new Date().toISOString(),
      pedido_origem_numero: cab.numero_pedido || '',
      observacoes: `Pedido duplicado a partir do pedido Omie ${cab.numero_pedido || codigo_pedido}`
    });
    pedidoLocalId = novoPedidoLocal?.id;
  } catch (e) {
    console.error('[duplicarPedidoOmie] Falha ao criar Pedido local:', e.message);
  }

  // 5. Log gerencial
  try {
    await base44.asServiceRole.functions.invoke('registrarLogGerencial', {
      tipo_acao: 'criacao',
      entidade_tipo: 'Pedido',
      entidade_id: String(pedidoLocalId || novoCodigoPedido || ''),
      entidade_descricao: `Pedido duplicado ${novoNumeroPedido || novoCodigoPedido} (origem: ${pedidoOriginal.cabecalho?.numero_pedido || codigo_pedido})`,
      usuario_email: userEmail,
      descricao: `Duplicou pedido ${pedidoOriginal.cabecalho?.numero_pedido || codigo_pedido} → novo pedido ${novoNumeroPedido || novoCodigoPedido}`,
      origem: 'backend'
    });
  } catch { /* ignore */ }

  return {
    sucesso: true,
    origem_codigo: codigo_pedido,
    origem_numero: pedidoOriginal.cabecalho?.numero_pedido,
    novo_codigo_pedido: novoCodigoPedido,
    novo_numero_pedido: novoNumeroPedido,
    pedido_local_id: pedidoLocalId,
    codigo_pedido_integracao: codigoIntegracaoNovo
  };
}

// Duplica pedido(s) Omie. Aceita { codigo_pedido } ou { pedidos: [{codigo_pedido, codigo_pedido_integracao}] }
Deno.serve(async (req) => {
  try {
    if (!APP_KEY || !APP_SECRET) {
      return Response.json({ sucesso: false, erro: 'Credenciais Omie não configuradas' }, { status: 500 });
    }
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Verifica permissão de digitar pedido de venda
    if (user.role !== 'admin') {
      const allVendedores = await base44.asServiceRole.entities.Vendedor.list();
      const vendedor = allVendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
      if (!vendedor) return Response.json({ error: 'Funcionário não encontrado' }, { status: 403 });
      const permissoes = await base44.asServiceRole.entities.Permissao.filter({ vendedor_id: vendedor.id });
      const perm = permissoes[0];
      if (!perm?.permissoes_pedidos?.digitar_pedido_venda) {
        return Response.json({ error: 'Sem permissão para digitar pedidos' }, { status: 403 });
      }
    }

    const body = await req.json().catch(() => ({}));
    let listaEntrada = [];
    if (Array.isArray(body.pedidos) && body.pedidos.length > 0) {
      listaEntrada = body.pedidos;
    } else if (body.codigo_pedido || body.codigo_pedido_integracao) {
      listaEntrada = [{ codigo_pedido: body.codigo_pedido, codigo_pedido_integracao: body.codigo_pedido_integracao }];
    } else {
      return Response.json({ sucesso: false, erro: 'Informe codigo_pedido ou pedidos[]' }, { status: 400 });
    }

    const resultados = [];
    for (const item of listaEntrada) {
      const r = await duplicarUm(base44, item.codigo_pedido, item.codigo_pedido_integracao, user.email);
      resultados.push(r);
      // pequeno espaçamento pra não estourar cota
      await sleep(400);
    }

    const sucesso = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => !r.sucesso).length;

    return Response.json({
      sucesso: erros === 0,
      total: resultados.length,
      sucessos: sucesso,
      erros,
      resultados
    });
  } catch (error) {
    console.error('[duplicarPedidoOmie] Erro:', error.message);
    return Response.json({ sucesso: false, erro: error.message }, { status: 500 });
  }
});