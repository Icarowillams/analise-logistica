import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Emite NF-e em lote (ou individual) chamando FaturarPedidoVenda do Omie.
// Após emissão, se o cliente tiver modalidade "BOLETO BANCARIO" no cadastro,
// dispara automaticamente a geração do boleto via gerarBoletosOmie.
//
// body: { codigos_pedido: [number|string] }
//
// Resposta: { sucesso, total, sucessos, erros, resultados[], boletos_auto }

const OMIE_FAT_URL = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';
const OMIE_PEDIDO_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const OMIE_NF_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

let base44Global = null;

async function omieCall(url, call, param, opts = {}) {
  const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3 } : opts;
  const chave = `${url}|${call}|${JSON.stringify(param || {})}`;
  const cb = await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) throw new Error(`API Omie bloqueada temporariamente. Tente novamente em ${controle.bloqueado_ate}`);
  if (cacheMinutes > 0) {
    const caches = await base44Global.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
    if (caches?.[0] && new Date(caches[0].expira_em) > new Date()) return caches[0].valor;
  }
  let lastError = '';
  for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] }) });
    const data = await res.json();
    if (data.faultstring || data.faultcode) {
      const msg = String(data.faultstring || '').toLowerCase();
      if (res.status === 425 || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('consumo indevido') || msg.includes('tente novamente mais tarde')) {
        const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: data.faultstring || '', atualizado_em: new Date().toISOString() };
        if (controle?.id) await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {}); else await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
        throw new Error(data.faultstring || 'API Omie bloqueada temporariamente');
      }
      if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('timeout') || msg.includes('indispon') || msg.includes('soap-error') || msg.includes('broken response') || msg.includes('application server')) { lastError = data.faultstring; await new Promise(r => setTimeout(r, 2500 * tentativa)); continue; } // DELAY_PADRAO_RETRY
      throw new Error(data.faultstring || 'Erro Omie');
    }
    if (logIntegration) await base44Global.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: call, status: 'sucesso', payload_enviado: JSON.stringify(param || {}).slice(-500), payload_resposta: JSON.stringify(data || {}).slice(-500) }).catch(() => {});
    return data;
  }
  throw new Error(lastError || 'Máximo de tentativas Omie excedido');
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
    // ⚠️ NÃO classifica etapa 50 como "rejeitada" só pela etapa.
    // Etapa 50 é o estado NORMAL e transitório do pedido logo após FaturarPedidoVenda,
    // enquanto a SEFAZ processa. Só consideramos rejeição quando vier confirmação real
    // via consultarStatusAtivoOmie (cStat>=200 do ListarNF) ou via webhook (status_real='rejeitada').
    return null; // ainda aguardando — deixa o consultarStatusAtivoOmie/webhook decidir
  } catch {
    return null;
  }
}

// Verifica se o pedido deve gerar boleto automático:
//   - precisa ser do tipo VENDA (não troca/bonificação/devolução)
//   - cliente precisa ter modalidade BOLETO BANCARIO no cadastro
async function clienteUsaBoleto(base44, codigoPedido) {
  try {
    // Tenta achar o Pedido local com esse omie_codigo_pedido para pegar tipo + cliente_id
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({
      omie_codigo_pedido: String(codigoPedido)
    });
    const pedido = pedidos?.[0];
    if (!pedido?.cliente_id) {
      console.log(`[clienteUsaBoleto] pedido ${codigoPedido}: não encontrado localmente ou sem cliente_id`);
      return false;
    }

    // 🚫 Apenas pedidos de VENDA geram boleto — troca/bonificação/devolução NÃO
    const tipo = String(pedido.tipo || 'venda').toLowerCase();
    if (tipo !== 'venda') {
      console.log(`[clienteUsaBoleto] pedido ${codigoPedido}: tipo=${tipo} (não-venda) — sem boleto`);
      return false;
    }

    const cliente = await base44.asServiceRole.entities.Cliente.get(pedido.cliente_id);
    if (!cliente?.modalidade_pagamento_id) {
      console.log(`[clienteUsaBoleto] pedido ${codigoPedido}: cliente sem modalidade_pagamento_id`);
      return false;
    }

    const modalidade = await base44.asServiceRole.entities.ModalidadePagamento.get(cliente.modalidade_pagamento_id);
    const nome = String(modalidade?.nome || '').toUpperCase();
    const usa = nome.includes('BOLETO');
    console.log(`[clienteUsaBoleto] pedido ${codigoPedido}: modalidade="${nome}" → boleto=${usa}`);
    return usa;
  } catch (e) {
    console.error(`[clienteUsaBoleto] erro pedido ${codigoPedido}:`, e.message);
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

// 🎯 CONSULTA ATIVA AO OMIE — quando o webhook não chegou no prazo, vamos buscar
// ConsultarPedido (etapa) + ListarNF (cStat/xMotivo) e retornar o status REAL.
// Diferencia rejeição (etapa volta pra 50) × cancelamento × denegação (cStat 110/301/302).
async function consultarStatusAtivoOmie(codigoPedido) {
  const t0 = Date.now();
  let etapa = '';
  try {
    const r = await fetch(OMIE_PEDIDO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: 'ConsultarPedido', app_key: APP_KEY, app_secret: APP_SECRET, param: [{ codigo_pedido: Number(codigoPedido) }] })
    });
    const d = await r.json();
    if (d.faultstring) throw new Error(d.faultstring);
    etapa = String(d?.pedido_venda_produto?.cabecalho?.etapa || '');
  } catch (e) {
    return { erro: e.message, duracao_ms: Date.now() - t0 };
  }

  // Lista NFs dos últimos 7 dias e filtra pelo nIdPedido
  try {
    const hoje = new Date();
    const seteDias = new Date(hoje.getTime() - 7 * 86400000);
    const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

    let nfEncontrada = null;
    for (let pagina = 1; pagina <= 3 && !nfEncontrada; pagina++) {
      const res = await fetch(OMIE_NF_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call: 'ListarNF', app_key: APP_KEY, app_secret: APP_SECRET,
          param: [{ pagina, registros_por_pagina: 200, dEmiInicial: fmt(seteDias), dEmiFinal: fmt(hoje) }]
        })
      });
      const data = await res.json();
      if (data.faultstring) {
        if (/n[ãa]o existem registros/i.test(data.faultstring)) break;
        throw new Error(data.faultstring);
      }
      nfEncontrada = (data.nfCadastro || []).find(nf => String(nf.compl?.nIdPedido || nf.nIdPedido || '') === String(codigoPedido));
      if (!nfEncontrada && pagina >= (data.nTotPaginas || 1)) break;
    }

    if (nfEncontrada) {
      const cStat = String(nfEncontrada.ide?.cStat || '');
      const numNf = nfEncontrada.ide?.nNF || '';
      const xMotivo = nfEncontrada.ide?.xMotivo || '';

      if (cStat === '100' || cStat === '150') {
        return { etapa, status: 'autorizada', numero_nf: String(numNf), codigo_sefaz: cStat, mensagem: `NF ${numNf} autorizada` };
      }
      if (cStat === '101' || cStat === '135') {
        return { etapa, status: 'cancelada', numero_nf: String(numNf), codigo_sefaz: cStat, mensagem: `NF ${numNf} cancelada${xMotivo ? ' — ' + xMotivo : ''}` };
      }
      if (['110', '301', '302', '205'].includes(cStat)) {
        return { etapa, status: 'denegada', codigo_sefaz: cStat, mensagem: `[SEFAZ ${cStat}] NF DENEGADA${xMotivo ? ' — ' + xMotivo : ''}` };
      }
      if (cStat && Number(cStat) >= 200) {
        return { etapa, status: 'rejeitada', codigo_sefaz: cStat, mensagem: `[SEFAZ ${cStat}] NF REJEITADA${xMotivo ? ' — ' + xMotivo : ''}` };
      }
      if (numNf) {
        return { etapa, status: 'autorizada', numero_nf: String(numNf), codigo_sefaz: cStat || '100', mensagem: `NF ${numNf}` };
      }
    }
  } catch (e) {
    console.error('[consultarStatusAtivoOmie] erro ListarNF:', e.message);
  }

  // Sem NF localizada — interpreta pela etapa
  // ⚠️ Etapa 50 SEM NF localizada NÃO é rejeição: é o estado transitório normal
  // (pedido aguardando processamento SEFAZ ou NF ainda não indexada no ListarNF).
  // Só consideramos rejeitada quando houver cStat>=200 EXPLÍCITO retornado acima.
  if (etapa === '70' || etapa === '80') {
    return { etapa, status: 'cancelada', codigo_sefaz: '', mensagem: `Pedido foi cancelado/excluído no Omie (etapa ${etapa})` };
  }
  if (etapa === '60') {
    return { etapa, status: 'aguardando', mensagem: 'Etapa 60 (faturado) mas NF ainda não localizada no listado — aguarde reconciliação' };
  }
  if (etapa === '50') {
    return { etapa, status: 'aguardando', mensagem: 'Pedido em etapa 50 (Faturar) — aguardando processamento SEFAZ' };
  }
  return { etapa, status: 'aguardando', mensagem: `Pedido em etapa ${etapa || '?'} — ainda em processamento SEFAZ` };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    base44Global = base44;
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
        // Erro/rejeição de NF-e fica apenas nos logs; não altera o status local do pedido.
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    // FASE 2 — Não aguarda nem consulta SEFAZ aqui.
    // Esta função apenas aciona a emissão no Omie e grava os logs como pendentes.
    // A consulta de autorização/rejeição é feita automaticamente pela aba Log de Emissão.
    for (const { codigo_pedido: codPed } of pedidosEnviados) {
      resultados.push({
        codigo_pedido: codPed,
        sucesso: false,
        pendente: true,
        mensagem: 'Emissão acionada no Omie — aguardando retorno da SEFAZ'
      });
      await gravarLog({
        codigo_pedido: codPed,
        status: 'pendente',
        mensagem: 'Emissão acionada no Omie — aguardando retorno da SEFAZ'
      });
    }

    // Boletos permanecem manuais; autorização/rejeição será apurada no Log de Emissão.
    const boletosAuto = null;

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