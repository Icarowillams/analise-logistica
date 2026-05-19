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
const OMIE_NF_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
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
  if (etapa === '50') {
    return { etapa, status: 'rejeitada', codigo_sefaz: '', mensagem: 'NF rejeitada pela SEFAZ — pedido retornou para etapa Faturar (50). Verifique CFOP/IE no cadastro/cenário fiscal.' };
  }
  if (etapa === '70' || etapa === '80') {
    return { etapa, status: 'cancelada', codigo_sefaz: '', mensagem: `Pedido foi cancelado/excluído no Omie (etapa ${etapa})` };
  }
  if (etapa === '60') {
    return { etapa, status: 'aguardando', mensagem: 'Etapa 60 (faturado) mas NF ainda não localizada no listado — aguarde reconciliação' };
  }
  return { etapa, status: 'aguardando', mensagem: `Pedido em etapa ${etapa || '?'} — ainda em processamento SEFAZ` };
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

    // FASE 2 — Janela de espera ATIVA pelo status real da SEFAZ.
    // P2 (16/05): ampliada a janela e combinada com consulta ativa em cada iteração
    // para que o LogEmissaoNF saia desta função já com status final (autorizada/rejeitada)
    // sempre que a SEFAZ retornar dentro de ~45s. Pedidos ainda não respondidos viram
    // 'pendente' e são reconciliados pela automação de 15min.
    const aguardarStatusFinal = async (codPed) => {
      // 6 tentativas com backoff progressivo: 3s, 5s, 7s, 9s, 11s, 13s (≈48s total)
      const intervalos = [3000, 5000, 7000, 9000, 11000, 13000];
      for (let i = 0; i < intervalos.length; i++) {
        await new Promise(r => setTimeout(r, intervalos[i]));

        // 1) Espelho (webhook já chegou?)
        const doEspelho = await lerStatusDoEspelho(base44, codPed);
        if (doEspelho && (doEspelho.status === 'emitida' || doEspelho.status === 'rejeitada')) {
          return doEspelho;
        }

        // 2) A cada 2 tentativas, consulta ATIVAMENTE o Omie (ConsultarPedido + ListarNF)
        if (i === 1 || i === 3 || i === 5) {
          const ativo = await consultarStatusAtivoOmie(codPed);
          if (ativo.status && ativo.status !== 'aguardando') {
            return {
              status: ativo.status === 'autorizada' ? 'emitida' :
                      (ativo.status === 'cancelada' || ativo.status === 'denegada' || ativo.status === 'rejeitada') ? 'rejeitada' :
                      'aguardando',
              numero_nf: ativo.numero_nf || null,
              mensagem: ativo.mensagem,
              codigo_sefaz: ativo.codigo_sefaz || '',
              substatus: ativo.status
            };
          }
        }
      }
      return { status: 'aguardando', mensagem: 'NF em processamento — será reconciliada automaticamente em até 15min' };
    };

    if (pedidosEnviados.length > 0) {
      // Roda as verificações em PARALELO — uma trava não atrasa a outra
      const verificacoes = await Promise.all(
        pedidosEnviados.map(({ codigo_pedido: codPed }) => aguardarStatusFinal(codPed))
      );

      for (let i = 0; i < pedidosEnviados.length; i++) {
        const codPed = pedidosEnviados[i].codigo_pedido;
        const statusReal = verificacoes[i];

        const matchCStat = String(statusReal.mensagem || '').match(/\[SEFAZ (\d+)\]/);
        const cStat = statusReal.codigo_sefaz || (matchCStat ? matchCStat[1] : (statusReal.status === 'emitida' ? '100' : ''));

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
          // substatus distingue rejeitada × denegada × cancelada — todos viram status='rejeitada' no log,
          // mas a mensagem já carrega o detalhe vindo da SEFAZ (xMotivo).
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
          // Só cancela pedido local em casos definitivos (denegada/cancelada). Rejeição "comum"
          // (ex: CFOP errado) o pedido volta pra etapa 50 no Omie e pode ser corrigido — não cancelamos.
          if (statusReal.substatus === 'denegada' || statusReal.substatus === 'cancelada') {
            await cancelarPedidoLocal(base44, codPed, statusReal.mensagem, user);
          }
        } else {
          // PENDENTE — usuário acompanha pelo Log de Emissão; webhook reconcilia depois
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
      }
    }

    // 🤖 Geração automática de boletos APENAS para NFs já autorizadas dentro da janela
    // (as autorizadas depois pelo webhook geram boletos via automação separada).
    let boletosAuto = null;
    if (codigosParaBoleto.length > 0) {
      try {
        await new Promise(r => setTimeout(r, 5000));
        const inv = await base44.functions.invoke('gerarBoletosAutoPedidos', {
          codigos_pedido: codigosParaBoleto
        });
        boletosAuto = inv?.data || null;
      } catch (e) {
        console.error('[emitirNfsLoteOmie] erro ao gerar boletos auto:', e.message);
        boletosAuto = { error: e.message };
      }
    }

    // 🎯 AUTO-RESOLVE: se sobraram pendentes, dispara reconciliação automática
    // (consulta ConsultarPedido + ListarNF) para resolver agora — sem o usuário
    // precisar clicar manualmente em "Resolver pendentes" depois.
    const codigosPendentes = resultados.filter(r => r.pendente).map(r => String(r.codigo_pedido));
    if (codigosPendentes.length > 0) {
      try {
        // Aguarda uns segundos para dar tempo da SEFAZ processar
        await new Promise(r => setTimeout(r, 8000));
        const recon = await base44.functions.invoke('atualizarStatusLogsPendentes', {
          codigos_pedido: codigosPendentes
        });
        const reconData = recon?.data || {};
        // Atualiza os resultados retornados ao frontend com o status reconciliado
        if (Array.isArray(reconData.resultados)) {
          for (const rr of reconData.resultados) {
            const idx = resultados.findIndex(x => String(x.codigo_pedido) === String(rr.codigo_pedido));
            if (idx >= 0 && rr.sucesso) {
              if (rr.novo_status === 'autorizada') {
                resultados[idx] = {
                  codigo_pedido: rr.codigo_pedido,
                  sucesso: true,
                  numero_nf: rr.numero_nf,
                  mensagem: rr.mensagem
                };
              } else if (rr.novo_status === 'rejeitada') {
                resultados[idx] = {
                  codigo_pedido: rr.codigo_pedido,
                  sucesso: false,
                  rejeitada: true,
                  mensagem: rr.mensagem
                };
              }
            }
          }
        }
      } catch (e) {
        console.error('[emitirNfsLoteOmie] erro na reconciliação automática:', e.message);
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