import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Emite NF-e em lote (ou individual) chamando FaturarPedidoVenda do Omie.
// Após emissão, se o cliente tiver modalidade "BOLETO BANCARIO" no cadastro,
// dispara automaticamente a geração do boleto via gerarBoletosAutoPedidos.
//
// body: { codigos_pedido: [number|string] }
//
// Resposta: { sucesso, total, sucessos, erros, resultados[], boletos_auto }

const OMIE_FAT_URL = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';
const OMIE_PEDIDO_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

async function omieCall(url, call, param, tentativa = 1) {
  const res = await fetch(url, {
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
      return omieCall(url, call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

// Consulta o pedido no Omie para descobrir o status REAL da NF emitida.
// Retorna: { status, numero_nf, mensagem }
//   status: 'emitida' | 'rejeitada' | 'aguardando'
async function consultarStatusRealNF(codigoPedido) {
  try {
    const data = await omieCall(OMIE_PEDIDO_URL, 'ConsultarPedido', { codigo_pedido: Number(codigoPedido) });
    const pv = data?.pedido_venda_produto;
    if (!pv) return { status: 'aguardando', mensagem: 'Pedido não encontrado na consulta' };

    const cab = pv.cabecalho || {};
    const info = pv.infoNfe || pv.info_nf || {};
    const etapa = String(cab.etapa || '');
    const cStat = String(info.cStat || info.codigo_status || '');
    const xMotivo = info.xMotivo || info.motivo_status || info.cMotivo || '';
    const numNf = info.nNF || info.numero_nf || cab.numero_nfe || null;

    // Códigos SEFAZ
    if (cStat === '100' || cStat === '150') {
      return { status: 'emitida', numero_nf: numNf, mensagem: `NF ${numNf} autorizada` };
    }
    if (cStat && Number(cStat) >= 200 && Number(cStat) < 300) {
      return { status: 'rejeitada', mensagem: `[SEFAZ ${cStat}] ${xMotivo || 'NF rejeitada'}` };
    }
    if (['110', '301', '302', '205'].includes(cStat)) {
      return { status: 'rejeitada', mensagem: `[SEFAZ ${cStat}] ${xMotivo || 'NF denegada'}` };
    }
    // Sem cStat ainda — verifica se há nº NF (emitida) ou se etapa voltou (rejeição sem cStat)
    if (numNf && etapa === '60') {
      return { status: 'emitida', numero_nf: numNf, mensagem: `NF ${numNf} emitida` };
    }
    if (etapa === '50') {
      // Voltou para etapa 50 → rejeição
      return { status: 'rejeitada', mensagem: xMotivo || 'NF rejeitada pelo Omie (pedido voltou para etapa Faturar)' };
    }
    return { status: 'aguardando', mensagem: xMotivo || 'NF ainda em processamento' };
  } catch (e) {
    return { status: 'aguardando', mensagem: `Não foi possível consultar status: ${e.message}` };
  }
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
    const pedidosEnviados = []; // pedidos que o Omie aceitou na fila — precisam consulta de status real

    // FASE 1 — Dispara FaturarPedidoVenda para cada pedido (aceita na fila do Omie)
    for (const codPed of codigos_pedido) {
      const t0 = Date.now();
      try {
        const resposta = await omieCall(OMIE_FAT_URL, 'FaturarPedidoVenda', { nCodPed: Number(codPed) });
        pedidosEnviados.push({ codigo_pedido: codPed, resposta });

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
        // Falha imediata (faultstring) — já é erro definitivo
        resultados.push({
          codigo_pedido: codPed,
          sucesso: false,
          mensagem: err.message,
          rejeitada: true
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

    // FASE 2 — Aguarda o Omie processar e consulta o status real de cada NF
    // (cStat da SEFAZ). Só assim sabemos se a NF foi REALMENTE autorizada ou rejeitada.
    if (pedidosEnviados.length > 0) {
      await new Promise(r => setTimeout(r, 8000)); // dá tempo do Omie processar
      for (const { codigo_pedido: codPed } of pedidosEnviados) {
        const statusReal = await consultarStatusRealNF(codPed);
        if (statusReal.status === 'emitida') {
          resultados.push({
            codigo_pedido: codPed,
            sucesso: true,
            numero_nf: statusReal.numero_nf,
            mensagem: statusReal.mensagem
          });
          const usaBoleto = await clienteUsaBoleto(base44, codPed);
          if (usaBoleto) codigosParaBoleto.push(codPed);
        } else if (statusReal.status === 'rejeitada') {
          resultados.push({
            codigo_pedido: codPed,
            sucesso: false,
            rejeitada: true,
            mensagem: statusReal.mensagem
          });
        } else {
          // Ainda processando — registra como pendente (não é sucesso nem erro definitivo)
          resultados.push({
            codigo_pedido: codPed,
            sucesso: false,
            pendente: true,
            mensagem: statusReal.mensagem
          });
        }
        await new Promise(r => setTimeout(r, 800));
      }
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
    const rejeitadas = resultados.filter(r => r.rejeitada).length;
    const pendentes = resultados.filter(r => r.pendente).length;
    const erros = resultados.filter(r => !r.sucesso && !r.pendente).length;

    return Response.json({
      sucesso: true,
      total: codigos_pedido.length,
      sucessos,
      erros,
      rejeitadas,
      pendentes,
      resultados,
      boletos_auto: boletosAuto,
      clientes_boleto: codigosParaBoleto.length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});