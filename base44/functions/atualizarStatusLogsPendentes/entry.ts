import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// 🔄 ATUALIZA logs de emissão NF que ficaram "pendentes" consultando ATIVAMENTE o Omie.
//
// Quando o webhook NFe.NotaAutorizada/Rejeitada não chega (ou demora demais),
// os logs ficam travados em "pendente". Esta função:
//   1. Lista logs LogEmissaoNF com status='pendente'
//   2. Para cada um, chama ConsultarPedido no Omie para descobrir a etapa real
//   3. Se etapa=60 → busca a NF (ListarNF) para pegar cStat e nNF
//   4. Atualiza o log + o espelho PedidoLiberadoOmie com o resultado real
//   5. Se denegada/cancelada → cancela o pedido local; rejeitada comum volta para etapa 50
//   6. Se autorizada → marca boleto_gerado e dispara gerarBoletosOmie em modo auto
//      (apenas para clientes com BOLETO BANCARIO + tipo=venda)
//
// body: { codigos_pedido?: [string] }  // se omitido, processa TODOS os pendentes (máx 50)
// resposta: { sucesso, processados, autorizados, rejeitados, ainda_pendentes, resultados[] }

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
      if (res.status === 425 || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde')) {
        const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: data.faultstring || '', atualizado_em: new Date().toISOString() };
        if (controle?.id) await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {}); else await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
        throw new Error(data.faultstring || 'API Omie bloqueada temporariamente');
      }
      if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('timeout') || msg.includes('indispon') || msg.includes('soap-error') || msg.includes('broken response')) { lastError = data.faultstring; await new Promise(r => setTimeout(r, 2500 * tentativa)); continue; }
      throw new Error(data.faultstring || 'Erro Omie');
    }
    if (logIntegration) await base44Global.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: call, status: 'sucesso', payload_enviado: JSON.stringify(param || {}).slice(-500), payload_resposta: JSON.stringify(data || {}).slice(-500) }).catch(() => {});
    return data;
  }
  throw new Error(lastError || 'Máximo de tentativas Omie excedido');
}

// Classifica uma NF retornada pelo Omie em status_real + mensagem
function classificarNF(nfEncontrada, codigoPedido) {
  if (!nfEncontrada) return null;
  const cStat = String(nfEncontrada.ide?.cStat || nfEncontrada.cStatus || '');
  const numNf = nfEncontrada.ide?.nNF || nfEncontrada.cNumero || '';
  const xMotivo = nfEncontrada.ide?.xMotivo || nfEncontrada.cMotivo || '';

  if (cStat === '100' || cStat === '150') {
    return { status_real: 'emitida', numero_nf: String(numNf), codigo_sefaz: cStat, mensagem: `NF ${numNf} autorizada` };
  }
  if (cStat === '101' || cStat === '135') {
    return { status_real: 'cancelada', numero_nf: String(numNf), codigo_sefaz: cStat, mensagem: `NF ${numNf} cancelada${xMotivo ? ' — ' + xMotivo : ''}` };
  }
  if (['110', '301', '302', '205'].includes(cStat)) {
    return { status_real: 'denegada', codigo_sefaz: cStat, mensagem: `NF denegada (${cStat})${xMotivo ? ' — ' + xMotivo : ''}` };
  }
  if (cStat && Number(cStat) >= 200) {
    return { status_real: 'rejeitada', codigo_sefaz: cStat, mensagem: `NF rejeitada [SEFAZ ${cStat}]${xMotivo ? ' — ' + xMotivo : ''}` };
  }
  if (numNf) {
    return { status_real: 'emitida', numero_nf: String(numNf), codigo_sefaz: cStat || '100', mensagem: `NF ${numNf}` };
  }
  return null;
}

// Faz UMA varredura de ListarNF cobrindo até 30 dias atrás e indexa por nIdPedido.
// É MUITO mais eficiente que listar NFs uma vez por pedido pendente.
async function indexarNFsRecentes() {
  const map = new Map();
  const hoje = new Date();
  const dias = new Date(hoje.getTime() - 30 * 86400000); // 30 dias é suficiente para pendentes
  const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

  let pagina = 1;
  let totalPaginas = 1;
  do {
    try {
      const nfData = await omieCall(OMIE_NF_URL, 'ListarNF', {
        pagina,
        registros_por_pagina: 200,
        dEmiInicial: fmt(dias),
        dEmiFinal: fmt(hoje)
      });
      totalPaginas = nfData.nTotPaginas || 1;
      (nfData.nfCadastro || []).forEach(nf => {
        const idPed = String(nf.compl?.nIdPedido || nf.nIdPedido || '');
        if (idPed) map.set(idPed, nf);
      });
      pagina++;
      if (pagina > 5) break; // máximo 5 páginas x 200 = 1000 NFs (cobre folga)
    } catch (e) {
      if (/n[ãa]o existem registros/i.test(e.message)) break;
      throw e;
    }
  } while (pagina <= totalPaginas);

  return map;
}

// Consulta etapa atual do pedido no Omie + busca NF no índice pré-carregado
async function consultarStatusReal(codigoPedido, nfsIndex) {
  let etapa = '';
  try {
    const r = await omieCall(OMIE_PEDIDO_URL, 'ConsultarPedido', { codigo_pedido: Number(codigoPedido) });
    etapa = String(r?.pedido_venda_produto?.cabecalho?.etapa || '');
  } catch (e) {
    return { erro: e.message };
  }

  // Procura NF no índice — pode existir mesmo se etapa estiver desatualizada
  const nf = nfsIndex.get(String(codigoPedido));
  const classificada = classificarNF(nf, codigoPedido);

  if (classificada) return { etapa, ...classificada };

  // Sem NF no índice — interpreta pela etapa
  if (etapa === '50') {
    return { etapa, status_real: 'rejeitada', mensagem: 'NF rejeitada — pedido voltou para etapa Faturar (50)' };
  }
  if (etapa === '60') {
    return { etapa, status_real: 'aguardando', mensagem: 'Etapa 60 mas NF ainda não localizada — aguardando emissão SEFAZ' };
  }
  return { etapa, status_real: 'aguardando', mensagem: `Pedido em etapa ${etapa || '?'} — ainda processando` };
}

// Verifica se o pedido deve gerar boleto auto (tipo=venda + cliente BOLETO BANCARIO)
async function deveGerarBoletoAuto(base44, codigoPedido) {
  try {
    const pedidos = await base44.asServiceRole.entities.Pedido.filter({
      omie_codigo_pedido: String(codigoPedido)
    });
    const pedido = pedidos?.[0];
    if (!pedido?.cliente_id) return false;
    const tipo = String(pedido.tipo || 'venda').toLowerCase();
    if (tipo !== 'venda') return false;
    const cliente = await base44.asServiceRole.entities.Cliente.get(pedido.cliente_id);
    if (!cliente?.modalidade_pagamento_id) return false;
    const modalidade = await base44.asServiceRole.entities.ModalidadePagamento.get(cliente.modalidade_pagamento_id);
    return String(modalidade?.nome || '').toUpperCase().includes('BOLETO');
  } catch {
    return false;
  }
}

// Cancela pedido local com o motivo SEFAZ
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
    console.error('[atualizarStatusLogsPendentes] falha cancelar pedido local:', e.message);
    return false;
  }
}

// Atualiza o espelho PedidoLiberadoOmie para refletir o status real
async function atualizarEspelho(base44, codigoPedido, resultado) {
  try {
    const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter(
      { codigo_pedido: String(codigoPedido) }, '-sincronizado_em', 1
    );
    const esp = espelhos?.[0];
    if (!esp) return;
    await base44.asServiceRole.entities.PedidoLiberadoOmie.update(esp.id, {
      etapa: resultado.etapa || esp.etapa,
      status_real: resultado.status_real,
      status_label: resultado.mensagem,
      numero_nf: resultado.numero_nf || esp.numero_nf || '',
      sincronizado_em: new Date().toISOString(),
      origem_sync: 'reconciliacao'
    });
  } catch (e) {
    console.error('[atualizarStatusLogsPendentes] falha atualizar espelho:', e.message);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    base44Global = base44;
    // Permite execução sem usuário autenticado quando chamada por automation (scheduled).
    // Para chamadas vindas do frontend, exige usuário; para automation, segue como 'sistema'.
    let user = null;
    try { user = await base44.auth.me(); } catch { user = null; }

    const body = await req.json().catch(() => ({}));
    const isSchedule = !!body?.scheduled || !!body?.automation;
    if (!user && !isSchedule) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!user) user = { email: 'sistema@automation', full_name: 'Automação Agendada' };

    const { codigos_pedido, status_filtros } = body;

    // Status que serão reconsultados no Omie. Default: apenas 'pendente'.
    // O botão "Atualizar" da tela passa ['pendente','erro'] para reconsultar também os erros recentes.
    const statusReconsultar = Array.isArray(status_filtros) && status_filtros.length > 0
      ? status_filtros
      : ['pendente'];

    // 1) Carrega logs (filtrados por código ou por status)
    let logs = [];
    if (Array.isArray(codigos_pedido) && codigos_pedido.length > 0) {
      // Reconsulta APENAS os códigos passados — independente do status atual.
      // (O frontend já filtrou quais devem ser reconsultados.)
      for (const cod of codigos_pedido) {
        const l = await base44.asServiceRole.entities.LogEmissaoNF.filter({
          codigo_pedido: String(cod)
        }, '-created_date', 5);
        logs.push(...l);
      }
    } else {
      // Sem códigos específicos: pega os mais recentes de cada status pedido
      for (const st of statusReconsultar) {
        const l = await base44.asServiceRole.entities.LogEmissaoNF.filter({ status: st }, '-created_date', 20);
        logs.push(...l);
      }
    }

    if (logs.length === 0) {
      return Response.json({ sucesso: true, processados: 0, autorizados: 0, rejeitados: 0, ainda_pendentes: 0, resultados: [] });
    }

    // 2) Deduplica por codigo_pedido (logs antigos podem ter várias linhas pendentes)
    const codigosUnicos = [...new Set(logs.map(l => String(l.codigo_pedido)))];

    const resultados = [];
    const codigosParaBoleto = [];

    // 3) Pré-indexa todas as NFs emitidas nos últimos 30 dias (UMA varredura só)
    let nfsIndex;
    try {
      nfsIndex = await indexarNFsRecentes();
    } catch (e) {
      console.error('[atualizarStatusLogsPendentes] erro indexar NFs:', e.message);
      nfsIndex = new Map();
    }

    // 4) Consulta cada pedido no Omie SEQUENCIALMENTE (preserva cota da API)
    for (const codPed of codigosUnicos) {
      const t0 = Date.now();
      try {
        const real = await consultarStatusReal(codPed, nfsIndex);
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
          endpoint: 'produtos/pedido + produtos/nfconsultar',
          call: 'ConsultarPedido + ListarNF',
          operacao: 'atualizar_log_pendente',
          status: real.erro ? 'erro' : 'sucesso',
          duracao_ms: Date.now() - t0,
          mensagem_erro: real.erro || null,
          payload_enviado: JSON.stringify({ codigo_pedido: codPed }),
          payload_resposta: JSON.stringify(real).slice(0, 800),
          usuario_email: user.email
        }).catch(() => {});

        if (real.erro) {
          resultados.push({ codigo_pedido: codPed, sucesso: false, ainda_pendente: true, mensagem: real.erro });
          continue;
        }

        if (real.status_real === 'aguardando') {
          resultados.push({ codigo_pedido: codPed, sucesso: false, ainda_pendente: true, mensagem: real.mensagem });
          continue;
        }

        // ✅ Tem resposta final — atualiza espelho + logs
        await atualizarEspelho(base44, codPed, real);

        const logsDoPedido = logs.filter(l => String(l.codigo_pedido) === String(codPed));
        let novoStatus;
        if (real.status_real === 'emitida') novoStatus = 'autorizada';
        else if (real.status_real === 'rejeitada' || real.status_real === 'cancelada' || real.status_real === 'denegada') novoStatus = 'rejeitada';
        else novoStatus = 'pendente';

        let deveBoleto = false;
        if (novoStatus === 'autorizada') {
          deveBoleto = await deveGerarBoletoAuto(base44, codPed);
          if (deveBoleto) codigosParaBoleto.push(codPed);
        }

        let primeiroLog = true;
        for (const l of logsDoPedido) {
          await base44.asServiceRole.entities.LogEmissaoNF.update(l.id, {
            status: novoStatus,
            numero_nf: real.numero_nf || l.numero_nf || '',
            mensagem: real.mensagem,
            codigo_sefaz: real.codigo_sefaz || (novoStatus === 'autorizada' ? '100' : ''),
            boleto_gerado: (primeiroLog && deveBoleto) ? true : (l.boleto_gerado || false)
          });
          primeiroLog = false;
        }

        // Cancela pedido local apenas em casos definitivos: NF denegada ou NF realmente cancelada.
        // Rejeição comum volta para etapa 50 e deve continuar disponível para correção/reemissão.
        if (real.status_real === 'denegada' || real.status_real === 'cancelada') {
          await cancelarPedidoLocal(base44, codPed, real.mensagem, user);
        }

        resultados.push({
          codigo_pedido: codPed,
          sucesso: true,
          novo_status: novoStatus,
          numero_nf: real.numero_nf || '',
          codigo_sefaz: real.codigo_sefaz || '',
          mensagem: real.mensagem,
          boleto_disparado: deveBoleto
        });
      } catch (e) {
        resultados.push({ codigo_pedido: codPed, sucesso: false, ainda_pendente: true, mensagem: e.message });
      }

      // Espaçamento entre consultas para preservar cota Omie
      await new Promise(r => setTimeout(r, 600));
    }

    // 4) Dispara boletos automáticos para autorizadas (cliente BOLETO + tipo=venda)
    if (codigosParaBoleto.length > 0) {
      try {
        await new Promise(r => setTimeout(r, 3000));
        await base44.asServiceRole.functions.invoke('gerarBoletosOmie', {
          origem: 'auto',
          pedidos: codigosParaBoleto.map(codigo_pedido => ({ codigo_pedido }))
        });
      } catch (e) {
        console.error('[atualizarStatusLogsPendentes] erro gerar boletos:', e.message);
      }
    }

    const autorizados = resultados.filter(r => r.novo_status === 'autorizada').length;
    const rejeitados = resultados.filter(r => r.novo_status === 'rejeitada').length;
    const aindaPendentes = resultados.filter(r => r.ainda_pendente).length;

    return Response.json({
      sucesso: true,
      processados: resultados.length,
      autorizados,
      rejeitados,
      ainda_pendentes: aindaPendentes,
      boletos_disparados: codigosParaBoleto.length,
      resultados
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});