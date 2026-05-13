import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Emite NF-e em lote (ou individual) chamando FaturarPedidoVenda do Omie.
// Após emissão, se o cliente tiver modalidade "BOLETO BANCARIO" no cadastro,
// dispara automaticamente a geração do boleto via gerarBoletosAutoPedidos.
//
// body: { codigos_pedido: [number|string] }
//
// Resposta: { sucesso, total, sucessos, erros, resultados[], boletos_auto }

const OMIE_FAT_URL = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

async function omieCall(call, param, tentativa = 1) {
  const res = await fetch(OMIE_FAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    const isRate = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || res.status === 429;
    if (isRate && tentativa < 4) {
      await new Promise(r => setTimeout(r, 3000 * tentativa));
      return omieCall(call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

// Verifica se o cliente do pedido usa BOLETO BANCARIO como modalidade padrão.
async function clienteUsaBoleto(base44, codigoPedido) {
  try {
    // Tenta achar o Pedido local com esse omie_codigo_pedido para pegar o cliente_id
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({
      omie_codigo_pedido: String(codigoPedido)
    });
    const pedido = pedidos?.[0];
    if (!pedido?.cliente_id) return false;

    const cliente = await base44.asServiceRole.entities.Cliente.get(pedido.cliente_id);
    if (!cliente?.modalidade_pagamento_id) return false;

    const modalidade = await base44.asServiceRole.entities.ModalidadePagamento.get(cliente.modalidade_pagamento_id);
    const nome = String(modalidade?.nome || '').toUpperCase();
    return nome.includes('BOLETO');
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigos_pedido = [] } = body;
    if (!Array.isArray(codigos_pedido) || codigos_pedido.length === 0) {
      return Response.json({ error: 'codigos_pedido vazio' }, { status: 400 });
    }

    const resultados = [];
    const codigosParaBoleto = [];

    for (const codPed of codigos_pedido) {
      const t0 = Date.now();
      try {
        const resposta = await omieCall('FaturarPedidoVenda', { nCodPed: Number(codPed) });
        resultados.push({
          codigo_pedido: codPed,
          sucesso: true,
          cCodStatus: resposta?.cCodStatus,
          mensagem: resposta?.cDescStatus || 'NF-e enviada para emissão. Aguarde processamento SEFAZ.'
        });

        // Verifica se cliente usa boleto — se sim, marca para gerar boleto depois
        const usaBoleto = await clienteUsaBoleto(base44, codPed);
        if (usaBoleto) codigosParaBoleto.push(codPed);

        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
          endpoint: 'produtos/pedidovendafat',
          call: 'FaturarPedidoVenda',
          operacao: 'emitir_nf_lote',
          status: 'sucesso',
          duracao_ms: Date.now() - t0,
          payload_enviado: JSON.stringify({ nCodPed: codPed }).slice(0, 800),
          payload_resposta: JSON.stringify(resposta).slice(0, 800),
          usuario_email: user.email
        }).catch(() => {});
      } catch (err) {
        resultados.push({
          codigo_pedido: codPed,
          sucesso: false,
          mensagem: err.message
        });
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
          endpoint: 'produtos/pedidovendafat',
          call: 'FaturarPedidoVenda',
          operacao: 'emitir_nf_lote',
          status: 'erro',
          duracao_ms: Date.now() - t0,
          mensagem_erro: err.message,
          payload_enviado: JSON.stringify({ nCodPed: codPed }).slice(0, 800),
          usuario_email: user.email
        }).catch(() => {});
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    // 🤖 Geração automática de boletos para clientes BOLETO BANCARIO
    let boletosAuto = null;
    if (codigosParaBoleto.length > 0) {
      try {
        // Aguarda o Omie processar o faturamento antes de tentar gerar boleto
        await new Promise(r => setTimeout(r, 8000));
        const inv = await base44.functions.invoke('gerarBoletosAutoPedidos', {
          codigos_pedido: codigosParaBoleto
        });
        boletosAuto = inv?.data || null;
      } catch (e) {
        console.error('[emitirNfsLoteOmie] erro ao gerar boletos auto:', e.message);
        boletosAuto = { error: e.message };
      }
    }

    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => !r.sucesso).length;

    return Response.json({
      sucesso: true,
      total: codigos_pedido.length,
      sucessos,
      erros,
      resultados,
      boletos_auto: boletosAuto,
      clientes_boleto: codigosParaBoleto.length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});