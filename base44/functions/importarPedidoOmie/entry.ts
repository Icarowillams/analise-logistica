import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_APP_KEY = Deno.env.get("OMIE_API_KEY") || Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_API_SECRET") || Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

// Endpoint pedido vs geral conforme a call
function urlParaCall(call) {
  return /ConsultarCliente|UpsertCliente|ListarClientes/i.test(call)
    ? 'https://app.omie.com.br/api/v1/geral/clientes/'
    : OMIE_URL;
}

// omieCall com circuit breaker + 425 (bloqueio 30min, sem retry) + retry 429
async function omieCall(base44, endpoint, param, options = {}) {
  const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
  const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');
  const url = urlParaCall(endpoint);

  // Circuit breaker — aborta antes de qualquer chamada
  const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
    const err = new Error(`API Omie temporariamente bloqueada por consumo indevido. Desbloqueio previsto: ${new Date(controle.bloqueado_ate).toLocaleString('pt-BR')}.`);
    err.code = 'OMIE_425';
    err.bloqueado_ate = controle.bloqueado_ate;
    throw err;
  }

  const body = { call: endpoint, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] };
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const data = await res.json();

      if (data.faultstring || data.faultcode) {
        const msg = String(data.faultstring || '').toLowerCase();
        // 425 / consumo indevido → bloqueia 30min, sem retry
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloquead') || msg.includes('bloqueio')) {
          const bloqueadoAte = new Date(Date.now() + 30 * 60000).toISOString();
          const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: bloqueadoAte, ultimo_erro: data.faultstring || 'HTTP 425 consumo indevido', atualizado_em: new Date().toISOString() };
          if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {});
          else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
          const err = new Error(`API Omie bloqueada por consumo indevido (HTTP 425). Desbloqueio previsto: ${new Date(bloqueadoAte).toLocaleString('pt-BR')}.`);
          err.code = 'OMIE_425';
          err.bloqueado_ate = bloqueadoAte;
          throw err;
        }
        // 429 / cota → retry com backoff
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante')) {
          lastError = new Error(data.faultstring);
          if (attempt < 2) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        }
        return data; // erro de negócio — devolve ao chamador
      }
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.code === 'OMIE_425') throw err;
      lastError = err;
      if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}


const ETAPA_STATUS_MAP = {
    '10': 'enviado',
    '20': 'liberado',
    '50': 'faturado',
    '60': 'faturado',
    '70': 'faturado',
    '80': 'cancelado',
};

function formatOmieDate(dateStr) {
    if (!dateStr) return '';
    if (dateStr.includes('/')) {
        const [d, m, y] = dateStr.split('/');
        return `${y}-${m}-${d}`;
    }
    return dateStr;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const body = await req.json();
        const { codigo_pedido_omie } = body;

        if (!codigo_pedido_omie) {
            return Response.json({ error: 'codigo_pedido_omie é obrigatório' }, { status: 400 });
        }

        console.log(`[importarPedidoOmie] Consultando código Omie: ${codigo_pedido_omie}`);

        const result = await omieCall(base44, "ConsultarPedido", { codigo_pedido: Number(codigo_pedido_omie) });

        if (result.faultstring) {
            return Response.json({ sucesso: false, erro: result.faultstring });
        }

        const pedidoOmie = result.pedido_venda_produto || result;
        const cabecalho = pedidoOmie.cabecalho || {};
        const det = pedidoOmie.det || [];
        const infAdic = pedidoOmie.informacoes_adicionais || {};
        const infCadastro = pedidoOmie.infoCadastro || {};

        const codigoPedidoOmie = cabecalho.codigo_pedido;
        const numeroPedido = cabecalho.numero_pedido;
        const etapa = cabecalho.etapa || '10';
        const cancelado = infCadastro.cancelado === 'S';
        const codigoClienteIntegracao = cabecalho.codigo_cliente_integracao;
        const codigoClienteOmie = cabecalho.codigo_cliente;

        console.log(`[importarPedidoOmie] Pedido #${numeroPedido}, etapa ${etapa}, ${det.length} itens, cliente_integ: ${codigoClienteIntegracao}, cliente_omie: ${codigoClienteOmie}`);

        // Verificar duplicata
        const existentes = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigoPedidoOmie });
        if (existentes.length > 0) {
            return Response.json({ sucesso: false, erro: `Pedido #${numeroPedido} já existe no Base44 (ID: ${existentes[0].id})` });
        }

        // Buscar cliente
        let cliente = null;
        if (codigoClienteIntegracao) {
            try { cliente = await base44.asServiceRole.entities.Cliente.get(codigoClienteIntegracao); } catch (e) {}
            if (!cliente) {
                const porCodigo = await base44.asServiceRole.entities.Cliente.filter({ codigo: codigoClienteIntegracao });
                if (porCodigo.length > 0) cliente = porCodigo[0];
            }
        }
        if (!cliente && codigoClienteOmie) {
            try {
                const cliOmie = await omieCall(base44, "ConsultarCliente", { codigo_cliente_omie: codigoClienteOmie });
                if (!cliOmie.faultstring && cliOmie.cnpj_cpf) {
                    const cpf = cliOmie.cnpj_cpf.replace(/[^\d]/g, '');
                    const todos = await base44.asServiceRole.entities.Cliente.list('-created_date', 5000);
                    cliente = todos.find(c => (c.cpf_cnpj || '').replace(/[^\d]/g, '') === cpf);
                    if (cliente) console.log(`[importarPedidoOmie] Cliente por CPF/CNPJ: ${cliente.razao_social}`);
                }
            } catch (e) { console.log(`[importarPedidoOmie] Erro busca cliente Omie: ${e.message}`); }
        }

        let vendedor = null;
        if (cliente?.vendedor_id) {
            try { vendedor = await base44.asServiceRole.entities.Vendedor.get(cliente.vendedor_id); } catch (e) {}
        }

        let statusLocal = ETAPA_STATUS_MAP[etapa] || 'enviado';
        if (cancelado) statusLocal = 'cancelado';

        // Itens
        const itensImportados = [];
        let valorTotal = 0;
        for (const d of det) {
            const prod = d.produto || {};
            let prodBase44 = null;
            if (prod.codigo_produto_integracao) {
                try { prodBase44 = await base44.asServiceRole.entities.Produto.get(prod.codigo_produto_integracao); } catch (e) {}
            }
            if (!prodBase44 && prod.codigo) {
                const pc = await base44.asServiceRole.entities.Produto.filter({ codigo: prod.codigo });
                if (pc.length > 0) prodBase44 = pc[0];
            }
            const vItem = (prod.quantidade || 0) * (prod.valor_unitario || 0);
            valorTotal += vItem;
            itensImportados.push({
                produto_id: prodBase44?.id || prod.codigo_produto_integracao || '',
                produto_codigo: prodBase44?.codigo || prod.codigo || '',
                produto_nome: prodBase44?.nome || prod.descricao || '',
                quantidade: prod.quantidade || 0,
                valor_unitario: prod.valor_unitario || 0,
                valor_total: vItem,
            });
        }

        // Criar pedido
        const pedidoData = {
            numero_pedido: String(numeroPedido),
            tipo: 'venda',
            status: statusLocal,
            cliente_id: cliente?.id || '',
            cliente_codigo: cliente?.codigo || codigoClienteIntegracao || '',
            cliente_nome: cliente?.razao_social || '',
            cliente_nome_fantasia: cliente?.nome_fantasia || '',
            cliente_endereco: cliente?.endereco || '',
            cliente_numero: cliente?.numero || '',
            cliente_bairro: cliente?.bairro || '',
            cliente_cidade: cliente?.cidade || '',
            cliente_estado: cliente?.estado || '',
            cliente_cep: cliente?.cep || '',
            cliente_cpf_cnpj: cliente?.cpf_cnpj || '',
            vendedor_id: vendedor?.id || '',
            vendedor_nome: vendedor?.nome || '',
            plano_pagamento_id: cliente?.plano_pagamento_id || '',
            tabela_preco_id: cliente?.tabela_id || '',
            modelo_nota: '55',
            data_previsao_entrega: cabecalho.data_previsao ? formatOmieDate(cabecalho.data_previsao) : '',
            total_itens: itensImportados.length,
            valor_total: valorTotal,
            data_envio: new Date().toISOString(),
            omie_codigo_pedido: codigoPedidoOmie,
            omie_enviado: true,
            omie_erro: null,
            dados_adicionais_nf: infAdic.dados_adicionais_nf || '',
        };

        if (statusLocal === 'liberado') {
            pedidoData.liberado_por = user.email;
            pedidoData.liberado_por_nome = user.full_name;
            pedidoData.data_liberacao = new Date().toISOString();
        }

        const novoPedido = await base44.asServiceRole.entities.Pedido.create(pedidoData);

        for (const item of itensImportados) {
            await base44.asServiceRole.entities.PedidoItem.create({ pedido_id: novoPedido.id, ...item });
        }

        console.log(`[importarPedidoOmie] Importado! ID: ${novoPedido.id}, #${numeroPedido}, ${itensImportados.length} itens, R$ ${valorTotal.toFixed(2)}`);

        return Response.json({
            sucesso: true,
            pedido_id: novoPedido.id,
            numero_pedido: numeroPedido,
            codigo_omie: codigoPedidoOmie,
            status: statusLocal,
            cliente: cliente?.razao_social || 'Não identificado',
            itens: itensImportados.length,
            valor_total: valorTotal,
            mensagem: `Pedido #${numeroPedido} importado com sucesso!`
        });

    } catch (error) {
        console.error('[importarPedidoOmie] Erro:', error.message);
        const bloqueada = error?.code === 'OMIE_425';
        return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
    }
});