import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function formatDatePt(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' });
}

// ═══ omieClient mínimo inline (somente leitura: ConsultarNF / ConsultarPedido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';

async function getOmieCreds(base44) {
  // FONTE DE VERDADE = Secrets do backend (o app_secret não fica mais no banco).
  const appSecret = Deno.env.get('OMIE_APP_SECRET') || '';
  let appKey = Deno.env.get('OMIE_APP_KEY') || '';
  if (!appKey) {
    const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
    appKey = rows?.[0]?.app_key || '';
  }
  return { appKey, appSecret };
}

// Chamada Omie de leitura com retry leve para concorrência (CÓDIGO 6 / 8020 / redundante / aguarde).
async function omieRead(base44, endpoint, call, param) {
  const { appKey, appSecret } = await getOmieCreds(base44);
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  const url = OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  let tentativa = 0;
  while (tentativa < 2) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 15000);
    let data;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }),
        signal: controller.signal
      });
      clearTimeout(tid);
      // Erro HTTP do Omie (5xx/429/425): corpo não costuma ser JSON. Trata como concorrência e tenta de novo.
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        const corpo = await res.text().catch(() => '');
        if (tentativa === 0) { await new Promise(r => setTimeout(r, 3000)); tentativa++; continue; }
        throw new Error(`HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`);
      }
      data = await res.json();
    } catch (e) {
      clearTimeout(tid);
      throw new Error(e.name === 'AbortError' ? 'Timeout na chamada Omie' : e.message);
    }
    if (data.faultstring) {
      const msg = String(data.faultstring).toLowerCase();
      const concorrencia = msg.includes('código 6') || msg.includes('codigo 6') || msg.includes('8020') || msg.includes('redundante') || msg.includes('aguarde') || msg.includes('execução') || msg.includes('execucao');
      if (concorrencia && tentativa === 0) {
        await new Promise(r => setTimeout(r, 3000));
        tentativa++;
        continue;
      }
      const err = new Error(data.faultstring);
      err.faultstring = data.faultstring;
      throw err;
    }
    return data;
  }
  return null;
}

// Verifica no Omie, em tempo real, se o pedido JÁ possui NF de verdade.
// Retorna: { existe: true, numero_nf, etapa } se houver NF; { existe: false, etapa } caso contrário.
// Se "NF não cadastrada para o pedido" → existe:false (log local é órfão, libera re-emissão).
async function verificarNfRealOmie(base44, codigoPedidoOmie) {
  const codigo = Number(codigoPedidoOmie);
  if (!Number.isFinite(codigo) || codigo <= 0) return { existe: false, etapa: '', inconclusivo: true };

  // 1) ConsultarNF { nIdPedido } — verdade sobre a NF
  let numeroNf = '';
  let chaveNfe = '';
  try {
    const resp = await omieRead(base44, 'produtos/nfconsultar/', 'ConsultarNF', { nIdPedido: codigo });
    numeroNf = resp?.ide?.nNF || resp?.cNumero || '';
    chaveNfe = resp?.compl?.cChaveNFe || '';
  } catch (e) {
    const msg = String(e.faultstring || e.message || '').toLowerCase();
    // "NF não cadastrada para o pedido" = não existe emissão real → libera
    if (msg.includes('não cadastrada') || msg.includes('nao cadastrada') || msg.includes('não encontrad') || msg.includes('nao encontrad')) {
      // continua para checar etapa (reforço), mas já sabemos que não há NF
      numeroNf = '';
    } else {
      // erro inconclusivo (timeout, bloqueio) → não libera nem confirma
      return { existe: false, etapa: '', inconclusivo: true, erro: e.faultstring || e.message };
    }
  }

  // 2) ConsultarPedido — etapa (60 = faturado). Reforça a verdade.
  let etapa = '';
  try {
    await new Promise(r => setTimeout(r, 3000)); // delay anti-concorrência entre as 2 leituras
    const r = await omieRead(base44, 'produtos/pedido/', 'ConsultarPedido', { codigo_pedido: codigo });
    etapa = String(r?.pedido_venda_produto?.cabecalho?.etapa || '');
  } catch { /* etapa inconclusiva — decide só pela NF */ }

  if (numeroNf || chaveNfe) {
    return { existe: true, numero_nf: String(numeroNf || ''), chave_nfe: chaveNfe, etapa };
  }
  return { existe: false, etapa };
}

async function verificarJaFaturado(base44, codigoPedido) {
  const codigo = String(codigoPedido);

  // 0. BLINDAGEM FISCAL: nunca emitir NF de pedido solto manualmente ou que não está numa carga ativa.
  const pedidoGuard = (await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigo }, '-updated_date', 1).catch(() => []))?.[0];
  if (pedidoGuard && pedidoGuard.solto_manualmente === true) {
    return { bloqueado: true, mensagem: `Pedido #${pedidoGuard.numero_pedido || codigo} foi solto manualmente — emissão de NF bloqueada (só por ação humana em carga ativa).` };
  }
  if (pedidoGuard && !pedidoGuard.carga_id) {
    return { bloqueado: true, mensagem: `Pedido #${pedidoGuard.numero_pedido || codigo} não está em carga ativa — emissão de NF bloqueada.` };
  }

  // 1. Verificar se já existe NF emitida no espelho PedidoLiberadoOmie (fonte mais confiável)
  const espelhos = await base44.asServiceRole.entities.PedidoLiberadoOmie.filter({ codigo_pedido: codigo }, '-updated_date', 1).catch(() => []);
  const espelho = espelhos?.[0];
  if (espelho?.etapa === '60' && espelho?.numero_nf) {
    return {
      bloqueado: true,
      mensagem: `Pedido #${espelho.numero_pedido || codigo} já possui NF emitida: ${espelho.numero_nf}. Etapa 60 no Omie.`
    };
  }

  // 2. Verificar se o Pedido local tem NF real preenchida (não apenas flags de status)
  const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigo }, '-updated_date', 1).catch(() => []);
  const pedido = pedidos?.[0];
  if (pedido?.numero_nota_fiscal) {
    return {
      bloqueado: true,
      mensagem: `Pedido #${pedido.numero_pedido || codigo} já foi faturado em ${formatDatePt(pedido.data_faturamento || pedido.updated_date)}. NF: ${pedido.numero_nota_fiscal}`
    };
  }

  // 3. Verificar log de emissão autorizada pela SEFAZ
  const logsNF = await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: codigo, status: 'autorizada' }, '-created_date', 1).catch(() => []);
  if (logsNF?.[0]) {
    return {
      bloqueado: true,
      mensagem: `Pedido #${logsNF[0].numero_pedido || codigo} já foi faturado em ${formatDatePt(logsNF[0].created_date)}. NF: ${logsNF[0].numero_nf || '-'}`
    };
  }

  // 4. Verificar log "pendente" recente (emissão acionada mas SEFAZ ainda não retornou)
  // ANTES de bloquear pela trava de 2h, perguntar ao Omie em TEMPO REAL se há NF de verdade.
  // A verdade está no Omie, não no log local — logs "aguardando" podem ser órfãos (emissão abortada por 8020).
  const logsPendentes = await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: codigo, status: 'pendente' }, '-created_date', 1).catch(() => []);
  if (logsPendentes?.[0]) {
    const idadeMs = Date.now() - new Date(logsPendentes[0].created_date).getTime();
    const DUAS_HORAS = 2 * 60 * 60 * 1000;
    if (idadeMs < DUAS_HORAS) {
      const nfReal = await verificarNfRealOmie(base44, codigo);

      // 4a. Omie confirma NF existente → NÃO re-emitir; destrava marcando como autorizada.
      if (nfReal.existe) {
        await marcarAutorizadoSemReemitir(base44, codigo, nfReal, logsPendentes[0]);
        return {
          bloqueado: true,
          ja_autorizado: true,
          mensagem: `Pedido #${logsPendentes[0].numero_pedido || codigo} já possui NF emitida no Omie: ${nfReal.numero_nf || '-'}. Status atualizado para Autorizada (não re-emitido).`
        };
      }

      // 4b. Erro inconclusivo na consulta (timeout/bloqueio) → mantém trava por segurança.
      if (nfReal.inconclusivo) {
        return {
          bloqueado: true,
          mensagem: `Pedido #${logsPendentes[0].numero_pedido || codigo}: não foi possível confirmar no Omie se há NF (${nfReal.erro || 'consulta inconclusiva'}). Tente novamente em instantes.`
        };
      }

      // 4c. Omie confirma que NÃO há NF (e etapa ≠ 60) → log "aguardando" é ÓRFÃO → LIBERA re-emissão.
      console.log(`[emitirNfsLoteOmie] Log pendente órfão para pedido ${codigo} — Omie sem NF (etapa ${nfReal.etapa || '?'}). Liberando re-emissão.`);
      // Marca o log órfão como expirado para não reaparecer como "aguardando".
      await base44.asServiceRole.entities.LogEmissaoNF.update(logsPendentes[0].id, {
        status: 'erro',
        mensagem: 'Log órfão: emissão anterior não completou no Omie (sem NF). Liberado para re-emissão.'
      }).catch(() => {});
      // segue (não bloqueia)
    }
  }

  return { bloqueado: false };
}

// Quando o Omie confirma que a NF já existe: atualiza log + pedido local para Autorizada, sem re-emitir.
async function marcarAutorizadoSemReemitir(base44, codigoPedido, nfReal, logPendente) {
  try {
    await base44.asServiceRole.entities.LogEmissaoNF.update(logPendente.id, {
      status: 'autorizada',
      numero_nf: nfReal.numero_nf || logPendente.numero_nf || '',
      codigo_sefaz: '100',
      mensagem: `NF ${nfReal.numero_nf || ''} confirmada no Omie (já existia).`
    }).catch(() => {});

    const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigoPedido) }, '-updated_date', 1).catch(() => []);
    const p = pedidos?.[0];
    if (p?.id) {
      await base44.asServiceRole.entities.Pedido.update(p.id, {
        status: 'faturado',
        status_faturamento: 'faturado',
        faturado: true,
        numero_nota_fiscal: nfReal.numero_nf || p.numero_nota_fiscal || '',
        data_faturamento: p.data_faturamento || new Date().toISOString()
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[emitirNfsLoteOmie] falha marcarAutorizadoSemReemitir:', e.message);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    // Dedup por código de pedido — nunca emite a mesma NF 2x na mesma rodada (evita CÓDIGO 6 redundante)
    const codigosPedido = Array.isArray(body.codigos_pedido)
      ? [...new Set(body.codigos_pedido.map(c => String(c)).filter(Boolean))]
      : [];

    if (codigosPedido.length === 0) {
      return Response.json({ error: 'codigos_pedido vazio' }, { status: 400 });
    }

    // Circuit breaker: não enfileira emissão se a API Omie estiver bloqueada por consumo indevido (425).
    const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: '6a1e06a9aa62ceab7b3b6d97' }, '-updated_date', 1).catch(() => []);
    const controle = cb?.[0];
    if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
      return Response.json({
        sucesso: false,
        error: `API Omie temporariamente bloqueada por consumo indevido. Desbloqueio previsto: ${new Date(controle.bloqueado_ate).toLocaleString('pt-BR')}.`,
        omie_bloqueada: true,
        bloqueado_ate: controle.bloqueado_ate
      }, { status: 425 });
    }

    const errosDuplicidade = [];
    const codigosValidos = [];
    const checks = await Promise.all(codigosPedido.map(async (codigo) => ({
      codigo,
      check: await verificarJaFaturado(base44, codigo)
    })));
    for (const { codigo, check } of checks) {
      if (check.bloqueado) errosDuplicidade.push({ codigo_pedido: codigo, mensagem: check.mensagem });
      else codigosValidos.push(codigo);
    }

    if (errosDuplicidade.length > 0 && codigosValidos.length === 0) {
      return Response.json({ sucesso: false, error: errosDuplicidade[0].mensagem, erros: errosDuplicidade }, { status: 409 });
    }

    const loteId = `LOTE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const fila = await base44.asServiceRole.entities.FilaEmissaoNF.create({
      tipo: 'emissao_nf_lote',
      lote_id: loteId,
      carga_id: body.carga_id || '',
      numero_carga: body.numero_carga || '',
      total_pedidos: codigosValidos.length,
      processados: 0,
      status: 'processando',
      pedidos: codigosValidos,
      resultados: [],
      erros: errosDuplicidade,
      mensagem: 'Faturamento iniciado em background. Acompanhe o progresso na tela.',
      usuario_email: user.email,
      iniciado_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString()
    });

    const LOTE = 5;
    for (let i = 0; i < codigosValidos.length; i += LOTE) {
      const lote = codigosValidos.slice(i, i + LOTE);
      await Promise.all(lote.map(async (codigo) => {
        const pedidos = await base44.asServiceRole.entities.Pedido
          .filter({ omie_codigo_pedido: codigo }, '-updated_date', 1)
          .catch(() => []);
        if (pedidos?.[0]?.id) {
          await base44.asServiceRole.entities.Pedido
            .update(pedidos[0].id, { status_faturamento: 'processando' })
            .catch(() => {});
        }
      }));
      if (i + LOTE < codigosValidos.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    return Response.json({
      sucesso: true,
      assincrono: true,
      fila_id: fila.id,
      lote_id: loteId,
      status: 'processando',
      total: codigosValidos.length,
      ignorados: errosDuplicidade.length,
      erros: errosDuplicidade,
      mensagem: 'Faturamento iniciado em background. Acompanhe o progresso na tela.'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});