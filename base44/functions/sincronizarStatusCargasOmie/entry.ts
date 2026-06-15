import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [1000, 2000, 4000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || options.timeout || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      // Tratamento de status HTTP ANTES de res.json() — num 5xx/429 o corpo não costuma ser JSON.
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        const corpo = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
        if (res.status === 425) {
          const _cbId = '6a1e06a9aa62ceab7b3b6d97';
          const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []);
          const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
          const _p: any = { erros_consecutivos: _erros, ultimo_erro: lastErr.slice(0, 500), atualizado_em: new Date().toISOString() };
          if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null);
          throw new Error(lastErr);
        }
        if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        throw new Error(lastErr);
      }
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          { const _cbId = '6a1e06a9aa62ceab7b3b6d97'; const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null); }
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update('6a1e06a9aa62ceab7b3b6d97', { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (e: any) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══


// Delay mínimo entre chamadas à API Omie (~17 req/min, dentro da cota).
const DELAY_ENTRE_CHAMADAS_MS = 3500;


// cStat SEFAZ:
//   100/150 = autorizada
//   101/135 = cancelada (após autorizada)
//   110/301/302/205 = denegada
//   >=200 (demais) = rejeitada
function classificarCStat(cStat) {
  const c = String(cStat || '').trim();
  if (!c) return null;
  if (['100', '150'].includes(c)) return 'autorizada';
  if (['101', '135'].includes(c)) return 'cancelada';
  if (['110', '301', '302', '205'].includes(c)) return 'denegada';
  if (Number(c) >= 200) return 'rejeitada';
  return null;
}


// Método correto p/ obter o número de NF de um pedido: ConsultarNF (produtos/nfconsultar/)
// com { nIdPedido }. ListarNF + nIdPedido é rejeitado pelo Omie ("Tag NIDPEDIDO não faz
// parte da estrutura"). ConsultarNF retorna a NF única do pedido em ide.nNF / ide.cStat.
async function buscarNfPorPedido(base44, codigoPedido) {
  try {
    const data = await omieCall(base44, 'produtos/nfconsultar/', {
      nIdPedido: Number(codigoPedido)
    }, { call: 'ConsultarNF' });
    const ide = data?.ide || data?.nfConsultada?.ide || {};
    const compl = data?.compl || data?.nfConsultada?.compl || {};
    const cStat = String(ide.cStat || '');
    const numeroNf = String(ide.nNF || '');
    if (!numeroNf && !cStat) return null;
    return {
      numero_nf: numeroNf,
      serie: ide.serie || '',
      chave: compl.cChaveNFe || '',
      cStat,
      xMotivo: ide.xMotivo || compl.cMensagem || '',
      classificacao: classificarCStat(cStat)
    };
  } catch {
    // Falha de consulta (incl. comunicação) → null: nunca infere rejeição daqui.
    return null;
  }
}

function extrairPedido(consulta, pedidoOriginal) {
  const pedido = consulta?.pedido_venda_produto || consulta || {};
  const cab = pedido.cabecalho || {};
  const info = pedido.informacoes_adicionais || {};
  const infoNfe = pedido.infoNfe || pedido.info_nf || {};
  const etapa = String(cab.etapa || pedidoOriginal.etapa || '');
  const numeroNf = infoNfe.nNF || cab.numero_nf || cab.numero_nota_fiscal || info.numero_nf || info.numero_nota_fiscal || pedidoOriginal.numero_nf || '';
  const cStatPedido = String(infoNfe.cStat || '');

  // Cancelamento só pode vir de campo/etapa explícita; nunca por texto solto do retorno,
  // pois descrições/observações podem conter a palavra "cancelado" e cancelar carga indevidamente.
  const statusTexto = String(cab.status_pedido || cab.status || '').toLowerCase();
  const cancelado =
    etapa === '70' ||
    etapa === '80' ||
    String(cab.cancelado || '').toUpperCase() === 'S' ||
    String(info.cancelada || '').toUpperCase() === 'S' ||
    statusTexto === 'cancelado' ||
    statusTexto === 'cancelada';

  // 🛡️ Rejeição SÓ pode vir do cStat estruturado real da NF — NUNCA de busca de texto.
  // (O bug antigo marcava como rejeitado qualquer JSON que contivesse "sefaz"/"rejeitad"/"denegad".)
  // cStat >= 200 e fora das faixas de autorizada/cancelada (100,150,101,135) = rejeição real.
  const cRej = Number(cStatPedido || infoNfe?.cStat || 0);
  const rejeitado = cRej >= 200 && ![100, 150, 101, 135].includes(cRej);

  return {
    etapa,
    status_pedido: cab.status_pedido || cab.status || pedidoOriginal.status_pedido || '',
    numero_nf: numeroNf,
    faturado: etapa === '60' || !!numeroNf,
    cancelado,
    rejeitado,
    cStat: cStatPedido,
    xMotivo: infoNfe.xMotivo || infoNfe.cMensStatus || ''
  };
}

function erroPedidoExcluido(mensagem) {
  const texto = String(mensagem || '').toLowerCase();
  return texto.includes('não existem registros') || texto.includes('nao existem registros') || texto.includes('não encontrado') || texto.includes('nao encontrado') || texto.includes('não cadastrado') || texto.includes('nao cadastrado') || texto.includes('excluído') || texto.includes('excluido') || texto.includes('inexistente');
}

// 🎯 Status REAL refletindo o que o Omie mostra:
//  - todos cancelados/excluídos → cancelada
//  - todos com NF autorizada → faturada
//  - todos com NF rejeitada/denegada (etapa 60 mas faixa vermelha) → faturada_com_rejeicao
//  - todos etapa 60 sem cStat ainda → aguardando_nf
//  - mistura autorizadas + rejeitadas/pendentes → faturada_parcial
//  - nenhum em 60 → mantém status atual (provavelmente montagem)
function definirStatusCarga(pedidosStatus, statusAtual) {
  if (pedidosStatus.length === 0) return statusAtual || 'montagem';

  const ativos = pedidosStatus.filter(p => !p.excluido && !p.cancelado);
  if (ativos.length === 0) return 'cancelada';

  const em60 = ativos.filter(p => p.etapa === '60' || p.faturado);

  // Nenhum pedido faturado ainda e ainda há pedidos ativos → não pode ficar como cancelada.
  if (em60.length === 0) return statusAtual === 'cancelada' ? 'montagem' : (statusAtual || 'montagem');

  const autorizadas = em60.filter(p => p.classificacao === 'autorizada').length;
  const rejeitadas = em60.filter(p => p.classificacao === 'rejeitada' || p.classificacao === 'denegada').length;
  const aguardando = em60.filter(p => !p.classificacao && !p.numero_nf).length;
  const todosFaturados = em60.length === ativos.length;

  if (todosFaturados) {
    if (autorizadas === em60.length) return 'faturada';
    if (rejeitadas === em60.length) return 'faturada_com_rejeicao';
    if (aguardando === em60.length) return 'aguardando_nf';
    return 'faturada_parcial';
  }

  // Alguns em 60, outros não — considera parcial
  return autorizadas > 0 ? 'faturada_parcial' : 'aguardando_nf';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { appKey: _ak, appSecret: _as } = await getOmieCredentials(base44);
    if (!_ak || !_as) {
      return Response.json({ error: 'Credenciais Omie não configuradas' }, { status: 500 });
    }
    console.log(`[sincronizarStatusCargasOmie] Usando APP_KEY: ...${String(_ak).slice(-4)}`);

    const body = await req.json().catch(() => ({}));
    const listLimit = Math.min(Number(body.list_limit || 500), 500);
    // Máximo absoluto de 10 cargas por execução para evitar rate limit (cada carga = N chamadas × N pedidos)
    const syncLimit = Math.min(Number(body.sync_limit || 10), 10);
    const cargaIds = Array.isArray(body.carga_ids) ? body.carga_ids : null;
    const diasRetroativos = Number(body.dias_retroativos || 30);
    // Limite de pedidos ainda-não-reconciliados consultados por chamada (evita 504 com Omie lento).
    const maxPedidosPorChamada = Math.max(1, Math.min(Number(body.max_pedidos_por_chamada || 8), 30));

    // Um pedido já reconciliado (NF real + etapa 60) não precisa reconsultar no Omie.
    const jaReconciliado = (p) => String(p?.etapa || '') === '60' && !!String(p?.numero_nf || '').trim();

    let cargas = await base44.asServiceRole.entities.Carga.list('-created_date', listLimit);

    // Filtro opcional por IDs específicos (força atualização manual, ignora demais filtros)
    if (cargaIds && cargaIds.length > 0) {
      const set = new Set(cargaIds.map(String));
      cargas = cargas.filter(c => set.has(String(c.id)));
    } else {
      // Sincronização SELETIVA: só cargas que realmente precisam.
      // Ignora cargas já finalizadas (faturada/cancelada/entregue) e mais antigas que diasRetroativos.
      const limiteData = Date.now() - diasRetroativos * 24 * 60 * 60 * 1000;
      const statusFinalizado = new Set(['faturada', 'cancelada', 'entregue']);
      cargas = (cargas || []).filter(c =>
        !statusFinalizado.has(String(c.status_carga || '').toLowerCase()) &&
        new Date(c.created_date || c.updated_date || 0).getTime() >= limiteData
      );
      if (cargas.length === 0) {
        return Response.json({ sucesso: true, cargas: [], sincronizadas: 0, otimizado: true, motivo: 'sem_cargas_pendentes_no_periodo' });
      }
    }

    const totalASincronizar = Math.min(cargas.length, syncLimit);
    console.log(`[sincronizarStatusCargasOmie] ${totalASincronizar} carga(s) a sincronizar (delay ${DELAY_ENTRE_CHAMADAS_MS}ms entre chamadas)`);

    const cargasAtualizadas = [];
    let apiBloqueada = false;
    let erroBloqueio = '';

    let indiceCarga = 0;
    for (const carga of cargas.slice(0, syncLimit)) {
      if (apiBloqueada) { cargasAtualizadas.push(carga); continue; }
      indiceCarga++;
      console.log(`[sincronizarStatusCargasOmie] Processando carga ${indiceCarga}/${totalASincronizar} (${carga.numero_carga || carga.id})`);

      const pedidos = Array.isArray(carga.pedidos_omie) ? carga.pedidos_omie : [];
      if (pedidos.length === 0) {
        cargasAtualizadas.push(carga);
        continue;
      }

      const pedidosStatus = [];
      const pedidosAtualizados = [];
      let consultasFeitas = 0;
      let pendentesCarga = 0;

      for (const pedido of pedidos) {
        if (apiBloqueada) { pedidosAtualizados.push(pedido); continue; }
        const codigo = pedido.codigo_pedido || pedido.codigo_pedido_integracao;
        if (!codigo) {
          pedidosAtualizados.push(pedido);
          continue;
        }

        // Pula quem já está reconciliado (NF real + etapa 60) — corta a maior parte das consultas.
        if (jaReconciliado(pedido)) {
          pedidosAtualizados.push(pedido);
          continue;
        }

        // Estourou o limite desta leva: deixa o resto como pendente para a próxima chamada.
        if (consultasFeitas >= maxPedidosPorChamada) {
          pendentesCarga++;
          pedidosAtualizados.push(pedido);
          continue;
        }
        consultasFeitas++;

        try {
          const consulta = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(codigo) }, { call: 'ConsultarPedido', cacheMinutes: 10 });
          const status = extrairPedido(consulta, pedido);

          // Fallback: se etapa 60 mas SEM cStat (ConsultarPedido não trouxe infoNfe completo),
          // busca NF direto pra capturar cStat real (autorizada/rejeitada/denegada)
          let cStatFinal = status.cStat;
          let xMotivoFinal = status.xMotivo;
          let numeroNfFinal = status.numero_nf || pedido.numero_nf;
          let classificacao = classificarCStat(cStatFinal);

          if (status.etapa === '60' && (!classificacao || !numeroNfFinal)) {
            const nfInfo = await buscarNfPorPedido(base44, codigo);
            if (nfInfo) {
              if (nfInfo.numero_nf) numeroNfFinal = nfInfo.numero_nf;
              if (nfInfo.cStat) cStatFinal = nfInfo.cStat;
              if (nfInfo.xMotivo) xMotivoFinal = nfInfo.xMotivo;
              if (nfInfo.classificacao) classificacao = nfInfo.classificacao;
            }
            await new Promise(r => setTimeout(r, DELAY_ENTRE_CHAMADAS_MS));
          }

          // Rejeição SÓ vem de cStat real (já refletido em `classificacao` via classificarCStat).
          // Etapa 60 sem cStat = NF ainda não consultável OU erro de comunicação Omie (425/500/timeout):
          // NÃO classificamos como rejeitada nem cancelada — preservamos o status anterior e re-tentamos depois.
          pedidosStatus.push({
            ...status,
            cancelado: status.cancelado && classificacao !== 'rejeitada',
            numero_nf: numeroNfFinal,
            cStat: cStatFinal,
            xMotivo: xMotivoFinal,
            classificacao
          });

          const statusRealLabel = classificacao
            ? `${cStatFinal ? `[${cStatFinal}] ` : ''}${xMotivoFinal || classificacao}`.slice(0, 200)
            : null;

          // 🛡️ REGRA IMUTÁVEL: numero_nf já preenchido NUNCA é apagado.
          // Só atualiza se houver um número válido novo; senão mantém o que já existe localmente.
          // Só aceita numero_nf NOVO quando a NF está realmente em etapa 60 (emitida) — evita
          // gravar número de PEDIDO disfarçado de NF e poluir carga.notas_fiscais.
          const nfNovaConfiavel = status.etapa === '60' ? String(numeroNfFinal || '').trim() : '';
          const nfPreservada = nfNovaConfiavel || String(pedido.numero_nf || '').trim() || '';

          // Sem classificação NOVA (cStat ausente = comunicação/NF ainda não consultável):
          // preserva os campos de status fiscal anteriores em vez de zerá-los.
          pedidosAtualizados.push({
            ...pedido,
            etapa: status.etapa || pedido.etapa,
            status_pedido: status.cancelado ? 'cancelado' : (status.status_pedido || pedido.status_pedido),
            numero_nf: nfPreservada,
            cstat_sefaz: cStatFinal || pedido.cstat_sefaz || undefined,
            status_nf: status.cancelado ? 'cancelada' : (classificacao || pedido.status_nf || undefined),
            motivo_rejeicao: ['rejeitada','denegada'].includes(classificacao) ? statusRealLabel : (pedido.motivo_rejeicao || undefined),
            status_real_omie: status.cancelado ? 'Cancelado no Omie' : (statusRealLabel || pedido.status_real_omie || undefined)
          });
        } catch (error) {
          if (error.message && (error.message.includes('bloqueada') || error.message.includes('bloqueio'))) {
            apiBloqueada = true;
            erroBloqueio = error.message;
            console.error(`[sincronizarStatusCargasOmie] API BLOQUEADA — interrompendo. ${error.message}`);
            pedidosAtualizados.push(pedido);
            break;
          }
          if (erroPedidoExcluido(error.message)) {
            pedidosStatus.push({ excluido: true, cancelado: true, faturado: false, etapa: 'excluido' });
            pedidosAtualizados.push({
              ...pedido,
              etapa: 'excluido',
              status_pedido: 'excluido_no_omie',
              status_real_omie: 'Pedido excluído/inexistente no Omie'
            });
          } else {
            pedidosAtualizados.push(pedido);
          }
        }

        if (!apiBloqueada) await new Promise(r => setTimeout(r, DELAY_ENTRE_CHAMADAS_MS));
      }

      // O status da carga é controlado exclusivamente por ações internas do sistema.
      // A sincronização com Omie atualiza apenas detalhes dos pedidos/NFs para consulta e auditoria.
      const precisaAtualizar = JSON.stringify(pedidosAtualizados) !== JSON.stringify(pedidos);

      const notasFiscaisAtualizadas = Array.from(new Set(
        pedidosAtualizados.map(p => p.numero_nf).filter(Boolean).map(String)
      ));
      const notasMudaram = JSON.stringify(notasFiscaisAtualizadas) !== JSON.stringify(carga.notas_fiscais || []);

      if (precisaAtualizar || notasMudaram) {
        // status_carga é LOCAL (montagem/faturada) e NUNCA é alterado pela sincronização Omie.
        // Aqui atualizamos apenas detalhes dos pedidos_omie e notas_fiscais para consulta/auditoria.
        await base44.asServiceRole.entities.Carga.update(carga.id, {
          pedidos_omie: pedidosAtualizados,
          notas_fiscais: notasFiscaisAtualizadas
        });

        // Reflete apenas autorização fiscal nos Pedidos locais.
        // Rejeição/denegação de NF-e NÃO altera Pedido.status nem omie_erro — fica apenas em logs/Notas Omie.
        for (const p of pedidosAtualizados) {
          if (!p.codigo_pedido) continue;
          try {
            const pedidosLocais = await base44.asServiceRole.entities.Pedido.filter({
              omie_codigo_pedido: String(p.codigo_pedido)
            });
            for (const pl of pedidosLocais) {
              if (p.status_nf === 'cancelada') {
                await base44.asServiceRole.entities.Pedido.update(pl.id, {
                  status: 'cancelado',
                  motivo_cancelamento: p.status_real_omie || 'Cancelado no Omie',
                  data_cancelamento: new Date().toISOString(),
                  cancelado_por: 'sistema',
                  cancelado_por_nome: 'Sincronização Omie'
                });
              } else if (p.status_nf === 'autorizada' && p.numero_nf && pl.numero_nota_fiscal !== String(p.numero_nf)) {
                await base44.asServiceRole.entities.Pedido.update(pl.id, {
                  numero_nota_fiscal: String(p.numero_nf),
                  faturado: true,
                  data_faturamento: pl.data_faturamento || new Date().toISOString()
                });
              } else if (p.status_nf === 'rejeitada' || p.status_nf === 'denegada') {
                await base44.asServiceRole.entities.LogIntegracaoOmie.create({
                  endpoint: 'produtos/nfconsultar',
                  call: 'ListarNF',
                  operacao: 'sincronizar_status_carga_nf_rejeitada',
                  entidade_tipo: 'Pedido',
                  entidade_id: pl.id,
                  status: 'warning',
                  mensagem_erro: p.motivo_rejeicao || p.status_real_omie || 'NF-e rejeitada pela SEFAZ',
                  payload_resposta: JSON.stringify({ codigo_pedido: p.codigo_pedido, numero_pedido: p.numero_pedido, status_nf: p.status_nf, cstat_sefaz: p.cstat_sefaz }).slice(0, 2000),
                  usuario_email: user.email
                }).catch(() => {});
              }
            }
          } catch { /* não bloqueia */ }
        }

        cargasAtualizadas.push({ ...carga, pedidos_omie: pedidosAtualizados, notas_fiscais: notasFiscaisAtualizadas, _pendentes: pendentesCarga });
      } else {
        cargasAtualizadas.push({ ...carga, _pendentes: pendentesCarga });
      }
    }

    const resto = cargas.slice(syncLimit);

    const pendentes = cargasAtualizadas.reduce((acc, c) => acc + (c._pendentes || 0), 0);
    const concluida = !apiBloqueada && pendentes === 0;

    return Response.json({
      sucesso: !apiBloqueada,
      api_bloqueada: apiBloqueada,
      erro_bloqueio: apiBloqueada ? erroBloqueio : undefined,
      cargas: [...cargasAtualizadas, ...resto],
      sincronizadas: cargasAtualizadas.length,
      pendentes,
      concluida
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});