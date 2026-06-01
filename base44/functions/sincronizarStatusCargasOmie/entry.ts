import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const OMIE_NF_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
// Credenciais resolvidas em runtime (ConfiguracaoOmie no banco, com fallback aos Secrets).
let APP_KEY = null;
let APP_SECRET = null;
async function resolverCredsOmie(base44) {
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  APP_KEY = ativo?.app_key || Deno.env.get('OMIE_APP_KEY');
  APP_SECRET = ativo?.app_secret || Deno.env.get('OMIE_APP_SECRET');
}

// Delay mínimo entre chamadas à API Omie (~17 req/min, dentro da cota).
const DELAY_ENTRE_CHAMADAS_MS = 3500;

// Erro especial para sinalizar bloqueio da API (interrompe todo o processamento).
class OmieBloqueadaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OmieBloqueadaError';
  }
}

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

async function omieCall(base44, call, param, opts = {}, url = OMIE_URL) {
  const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3 } : opts;
  const chave = `${url}|${call}|${JSON.stringify(param || {})}`;
  const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) throw new OmieBloqueadaError(`API Omie bloqueada temporariamente. Tente novamente em ${controle.bloqueado_ate}`);
  if (cacheMinutes > 0) {
    const caches = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
    if (caches?.[0] && new Date(caches[0].expira_em) > new Date()) return caches[0].valor;
  }
  let lastError = '';
  for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] }) });
    const data = await res.json();
    if (data.faultstring || data.faultcode) {
      const msg = String(data.faultstring || '').toLowerCase();
      const fc = String(data.faultcode || '');
      if (res.status === 425 || fc.includes('425') || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde')) {
        // Circuit breaker: bloqueio por cota — interrompe TUDO, sem retry.
        const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: data.faultstring || '', atualizado_em: new Date().toISOString() };
        if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {}); else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
        throw new OmieBloqueadaError(data.faultstring || 'API Omie bloqueada temporariamente (cota excedida)');
      }
      if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('limite') || msg.includes('timeout') || msg.includes('indispon')) { lastError = data.faultstring; await new Promise(r => setTimeout(r, 2500 * tentativa)); continue; } // DELAY_PADRAO_RETRY
      throw new Error(data.faultstring || 'Erro Omie');
    }
    if (cacheMinutes > 0) {
      const payloadCache = { chave, valor: data, tipo: call, expira_em: new Date(Date.now() + cacheMinutes * 60000).toISOString(), criado_em: new Date().toISOString() };
      const existente = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
      if (existente?.[0]?.id) await base44.asServiceRole.entities.CacheOmieConsulta.update(existente[0].id, payloadCache).catch(() => {}); else await base44.asServiceRole.entities.CacheOmieConsulta.create(payloadCache).catch(() => {});
    }
    if (logIntegration) await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: call, status: 'sucesso', payload_enviado: JSON.stringify(param || {}).slice(-500), payload_resposta: JSON.stringify(data || {}).slice(-500) }).catch(() => {});
    return data;
  }
  throw new Error(lastError || 'Máximo de tentativas Omie excedido');
}

// Busca NF emitida + cStat (status SEFAZ) para um pedido específico.
async function buscarNfPorPedido(base44, codigoPedido) {
  try {
    const data = await omieCall(base44, 'ListarNF', {
      pagina: 1,
      registros_por_pagina: 50,
      nIdPedido: Number(codigoPedido)
    }, 1, OMIE_NF_URL);
    const nfs = data?.nfCadastro || [];
    if (nfs.length === 0) return null;
    // Prioriza NF NÃO cancelada e mais recente
    const ativa = nfs.find(nf => !['101','135'].includes(String(nf.ide?.cStat || ''))) || nfs[0];
    const cStat = String(ativa.ide?.cStat || '');
    return {
      numero_nf: String(ativa.ide?.nNF || ativa.cNumero || ''),
      serie: ativa.ide?.serie || '',
      chave: ativa.compl?.cChaveNFe || '',
      cStat,
      xMotivo: ativa.ide?.xMotivo || ativa.compl?.cMensagem || '',
      classificacao: classificarCStat(cStat)
    };
  } catch {
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
  const textoPedido = JSON.stringify(pedido || {}).toLowerCase();

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

  const rejeitado =
    textoPedido.includes('rejeitad') ||
    textoPedido.includes('denegad') ||
    textoPedido.includes('sefaz');

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

    await resolverCredsOmie(base44);
    if (!APP_KEY || !APP_SECRET) {
      return Response.json({ error: 'Credenciais Omie não configuradas' }, { status: 500 });
    }
    console.log(`[sincronizarStatusCargasOmie] Usando APP_KEY: ...${String(APP_KEY).slice(-4)}`);

    const body = await req.json().catch(() => ({}));
    const listLimit = Math.min(Number(body.list_limit || 500), 500);
    const syncLimit = Math.min(Number(body.sync_limit || 50), listLimit);
    const cargaIds = Array.isArray(body.carga_ids) ? body.carga_ids : null;
    const diasRetroativos = Number(body.dias_retroativos || 30);

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

      for (const pedido of pedidos) {
        if (apiBloqueada) { pedidosAtualizados.push(pedido); continue; }
        const codigo = pedido.codigo_pedido || pedido.codigo_pedido_integracao;
        if (!codigo) {
          pedidosAtualizados.push(pedido);
          continue;
        }

        try {
          const consulta = await omieCall(base44, 'ConsultarPedido', { codigo_pedido: Number(codigo) }, { cacheMinutes: 10 });
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

          // Caso real Omie: pedido vai para etapa 60, a NF é rejeitada e o pedido aparece como cancelado/sem NF.
          // Isso NÃO deve virar "cancelada" operacional; é rejeição fiscal para o operador corrigir/reemitir.
          if (status.etapa === '60' && !classificacao && !numeroNfFinal && (status.cancelado || status.rejeitado)) {
            classificacao = 'rejeitada';
            xMotivoFinal = xMotivoFinal || 'NF-e rejeitada pela SEFAZ';
          }

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

          pedidosAtualizados.push({
            ...pedido,
            etapa: status.etapa || pedido.etapa,
            status_pedido: status.cancelado ? 'cancelado' : (status.status_pedido || pedido.status_pedido),
            numero_nf: numeroNfFinal,
            cstat_sefaz: cStatFinal || undefined,
            status_nf: status.cancelado ? 'cancelada' : (classificacao || undefined),
            motivo_rejeicao: ['rejeitada','denegada'].includes(classificacao) ? statusRealLabel : undefined,
            status_real_omie: status.cancelado ? 'Cancelado no Omie' : (statusRealLabel || undefined)
          });
        } catch (error) {
          if (error instanceof OmieBloqueadaError) {
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

        cargasAtualizadas.push({ ...carga, pedidos_omie: pedidosAtualizados, notas_fiscais: notasFiscaisAtualizadas });
      } else {
        cargasAtualizadas.push(carga);
      }
    }

    const resto = cargas.slice(syncLimit);

    return Response.json({
      sucesso: !apiBloqueada,
      api_bloqueada: apiBloqueada,
      erro_bloqueio: apiBloqueada ? erroBloqueio : undefined,
      cargas: [...cargasAtualizadas, ...resto],
      sincronizadas: cargasAtualizadas.length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});