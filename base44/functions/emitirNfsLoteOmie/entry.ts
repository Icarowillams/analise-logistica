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

// Flag global do lote: se Omie bloquear por consumo, paramos de bater pra evitar piorar.
let omieRateLimitAtivo = false;

async function omieCall(url, call, param, tentativa = 1) {
  if (omieRateLimitAtivo) {
    throw new Error('API Omie em rate limit — consulta abortada para preservar cota');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    const isBlock = msg.includes('bloqueada por consumo') || msg.includes('consumo indevido');
    const isRate = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || res.status === 429;
    // Erros TRANSITÓRIOS do servidor Omie/SEFAZ — vale a pena tentar de novo
    // "SOAP-ERROR: Broken response from Application Server (BG)" = falha intermitente do BG (Background) do Omie
    const isTransient =
      msg.includes('soap-error') ||
      msg.includes('broken response') ||
      msg.includes('application server') ||
      msg.includes('timeout') ||
      msg.includes('temporariamente') ||
      msg.includes('instavel') ||
      msg.includes('instável');
    if (isBlock) {
      // Não insiste — Omie pôs a chave em "timeout". Marca a flag e sai.
      omieRateLimitAtivo = true;
      throw new Error(data.faultstring);
    }
    if ((isRate || isTransient) && tentativa < 4) {
      // backoff progressivo: 5s, 10s, 20s
      const espera = 5000 * Math.pow(2, tentativa - 1);
      console.warn(`[emitirNfsLoteOmie] erro transitório Omie (tent ${tentativa}/4): ${data.faultstring} — retry em ${espera}ms`);
      await new Promise(r => setTimeout(r, espera));
      return omieCall(url, call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

// 🎯 PRIMEIRA FONTE DE VERDADE: o espelho PedidoLiberadoOmie é atualizado em tempo real
// pelos webhooks NFe.NotaAutorizada / VendaProduto.Faturada / NFe.NotaCancelada.
// Sempre que possível, lemos daqui antes de bater na API Omie.
async function lerStatusDoEspelho(base44, codigoPedido) {
  try {
    const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
      { codigo_pedido: String(codigoPedido) },
      '-sincronizado_em',
      1
    );
    const esp = espelhos[0];
    if (!esp) return null;

    const etapa = String(esp.etapa || '');
    const statusReal = String(esp.status_real || '');
    const numNf = esp.numero_nf || null;

    if (statusReal === 'emitida' || (etapa === '60' && numNf)) {
      return { status: 'emitida', numero_nf: numNf, mensagem: `NF ${numNf} autorizada` };
    }
    if (statusReal === 'rejeitada') {
      return { status: 'rejeitada', mensagem: esp.status_label || 'NF rejeitada' };
    }
    if (statusReal === 'cancelada' || statusReal === 'denegada') {
      return { status: 'rejeitada', mensagem: esp.status_label || `NF ${statusReal}` };
    }
    // Pedido voltou para etapa 50 (rejeição implícita)
    if (etapa === '50') {
      return { status: 'rejeitada', mensagem: 'NF rejeitada pelo Omie (pedido voltou para etapa Faturar)' };
    }
    return null; // ainda aguardando
  } catch {
    return null;
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

// Busca dados do pedido local (cliente, carga, número) para enriquecer o log
async function buscarContextoPedido(base44, codigoPedido) {
  try {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({
      omie_codigo_pedido: String(codigoPedido)
    });
    const p = pedidos?.[0];
    if (!p) return {};
    return {
      pedido_id: p.id,
      numero_pedido: p.numero_pedido || '',
      cliente_id: p.cliente_id || '',
      cliente_nome: p.cliente_nome || '',
      carga_id: p.carga_id || '',
      numero_carga: p.numero_carga || ''
    };
  } catch {
    return {};
  }
}

// Cancela o pedido local (Gerenciar Pedidos) gravando o motivo da rejeição da SEFAZ.
async function cancelarPedidoLocal(base44, codigoPedido, motivo, user) {
  try {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({
      omie_codigo_pedido: String(codigoPedido)
    });
    const p = pedidos?.[0];
    if (!p) return false;
    await base44.asServiceRole.entities.Pedido.update(p.id, {
      status: 'cancelado',
      motivo_cancelamento: motivo,
      cancelado_por: user.email,
      cancelado_por_nome: user.full_name || '',
      data_cancelamento: new Date().toISOString()
    });
    return true;
  } catch (e) {
    console.error('[emitirNfsLoteOmie] falha ao cancelar pedido local:', e.message);
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

    // ID único do lote — agrupa todos os pedidos emitidos juntos
    const loteId = `LOTE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Helper para gravar log persistente de cada pedido
    const gravarLog = async (dados) => {
      try {
        const ctx = await buscarContextoPedido(base44, dados.codigo_pedido);
        await base44.asServiceRole.entities.LogEmissaoNF.create({
          codigo_pedido: String(dados.codigo_pedido),
          numero_pedido: ctx.numero_pedido,
          numero_nf: dados.numero_nf || '',
          cliente_id: ctx.cliente_id,
          cliente_nome: ctx.cliente_nome,
          carga_id: ctx.carga_id,
          numero_carga: ctx.numero_carga,
          lote_id: loteId,
          status: dados.status,
          codigo_sefaz: dados.codigo_sefaz || '',
          mensagem: dados.mensagem || '',
          boleto_gerado: !!dados.boleto_gerado,
          usuario_email: user.email,
          usuario_nome: user.full_name || ''
        });
      } catch (e) {
        console.error('[emitirNfsLoteOmie] falha ao gravar LogEmissaoNF:', e.message);
      }
    };

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
        const motivoErro = `[OMIE] ${err.message}`;
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
        // Log persistente do erro (vem do Omie via faultstring)
        await gravarLog({
          codigo_pedido: codPed,
          status: 'erro',
          mensagem: motivoErro
        });
        // Cancela pedido local com o motivo
        await cancelarPedidoLocal(base44, codPed, motivoErro, user);
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    // FASE 2 — Aguarda webhook chegar (espelho PedidoLiberadoOmie).
    // ESTRATÉGIA CORRETA: NÃO fazemos polling agressivo na API Omie (gera rate limit).
    // O webhook NFe.NotaAutorizada / VendaProduto.Faturada / NFe.NotaRejeitada já atualiza
    // o espelho PedidoLiberadoOmie em tempo real. Lemos APENAS do espelho.
    // Pedidos que ficarem "pendente" são reconciliados automaticamente pela automação
    // reconciliarLogEmissaoNF assim que o webhook chegar (pode levar alguns segundos a minutos).
    const aguardarEspelho = async (codPed, maxTentativas = 10, intervaloMs = 10000) => {
      for (let i = 0; i < maxTentativas; i++) {
        await new Promise(r => setTimeout(r, intervaloMs));
        const doEspelho = await lerStatusDoEspelho(base44, codPed);
        if (doEspelho && (doEspelho.status === 'emitida' || doEspelho.status === 'rejeitada')) {
          return doEspelho;
        }
      }
      return { status: 'aguardando', mensagem: 'NF ainda em processamento na SEFAZ — será atualizada automaticamente pelo webhook' };
    };

    if (pedidosEnviados.length > 0) {
      // Aguarda inicial: Omie precisa colocar na fila + SEFAZ responder + webhook chegar
      await new Promise(r => setTimeout(r, 5000));
      for (const { codigo_pedido: codPed } of pedidosEnviados) {
        const statusReal = await aguardarEspelho(codPed);
        // extrai cStat da mensagem se houver (formato "[SEFAZ NNN] ...")
        const matchCStat = String(statusReal.mensagem || '').match(/\[SEFAZ (\d+)\]/);
        const cStat = matchCStat ? matchCStat[1] : (statusReal.status === 'emitida' ? '100' : '');

        if (statusReal.status === 'emitida') {
          const usaBoleto = await clienteUsaBoleto(base44, codPed);
          if (usaBoleto) codigosParaBoleto.push(codPed);
          resultados.push({
            codigo_pedido: codPed,
            sucesso: true,
            numero_nf: statusReal.numero_nf,
            mensagem: statusReal.mensagem
          });
          await gravarLog({
            codigo_pedido: codPed,
            status: 'autorizada',
            numero_nf: statusReal.numero_nf || '',
            mensagem: statusReal.mensagem,
            codigo_sefaz: cStat,
            boleto_gerado: usaBoleto
          });
        } else if (statusReal.status === 'rejeitada') {
          resultados.push({
            codigo_pedido: codPed,
            sucesso: false,
            rejeitada: true,
            mensagem: statusReal.mensagem
          });
          await gravarLog({
            codigo_pedido: codPed,
            status: 'rejeitada',
            mensagem: statusReal.mensagem,
            codigo_sefaz: cStat
          });
          // Cancela pedido local em "Gerenciar Pedidos" com o motivo SEFAZ
          await cancelarPedidoLocal(base44, codPed, statusReal.mensagem, user);
        } else {
          resultados.push({
            codigo_pedido: codPed,
            sucesso: false,
            pendente: true,
            mensagem: statusReal.mensagem
          });
          await gravarLog({
            codigo_pedido: codPed,
            status: 'pendente',
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
      lote_id: loteId,
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