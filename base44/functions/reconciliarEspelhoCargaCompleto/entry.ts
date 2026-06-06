import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
  return _credsCache;
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const ctrl = rows?.[0];
  const blocked = !!(ctrl?.bloqueado && ctrl.bloqueado_ate && new Date(ctrl.bloqueado_ate).getTime() > Date.now());
  return { blocked, blockedUntil: ctrl?.bloqueado_ate || '' };
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
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          const until = new Date(Date.now() + 30 * 60000).toISOString();
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create({ chave: 'principal', bloqueado: true, bloqueado_ate: until, ultimo_erro: data.faultstring, atualizado_em: new Date().toISOString() }).catch(() => null);
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      return data;
    } catch (e: any) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Maximo de tentativas Omie excedido');
}
// fim omieClient inline

const DELAY_MS = 3000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ConsultarPedido - extrai etapa, numero_nf, cancelado, cnpj/codigo cliente
async function consultarPedido(base44: any, codigoPedido: string | number) {
  try {
    const data = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(codigoPedido) }, { call: 'ConsultarPedido', skipLog: true });
    const pedido = data.pedido_venda_produto || {};
    const cab = pedido.cabecalho || {};
    const infoNfe = pedido.infoNfe || pedido.info_nf || {};
    const etapa = String(cab.etapa || '');
    const numeroNf = String(infoNfe.nNF || infoNfe.numero_nf || cab.numero_nfe || '');
    const cancelado = etapa === '70' || etapa === '80' || String(cab.cancelado || '').toUpperCase() === 'S';
    return {
      etapa,
      numero_nf: numeroNf,
      cancelado,
      codigo_cliente: String(cab.codigo_cliente || '')
    };
  } catch (e: any) {
    return { erro: e.message };
  }
}

// ListarNF por pedido - busca NF AUTORIZADA (ignora cancelada/denegada)
async function buscarNfAutorizada(base44: any, codigoPedido: string | number) {
  try {
    const data = await omieCall(base44, 'produtos/nfconsultar/', {
      pagina: 1,
      registros_por_pagina: 50,
      nIdPedido: Number(codigoPedido)
    }, { call: 'ListarNF', skipLog: true });

    const nfs = data?.nfCadastro || [];
    if (nfs.length === 0) return null;

    // Prioriza NF autorizada (cStat 100 ou 150)
    for (const nf of nfs) {
      const ide = nf.ide || {};
      const cStat = String(ide.cStat || '');
      const nNF = String(ide.nNF || nf.cNumero || '');
      if (!nNF) continue;
      const dCan = String(ide.dCan || '').trim();
      const cDeneg = String(ide.cDeneg || '').trim();
      if (dCan || cDeneg === 'S' || cDeneg === 'D') continue;
      if (['101', '135'].includes(cStat)) continue;
      return nNF;
    }
    return null;
  } catch {
    return null;
  }
}

async function logCarga(base44: any, cargaId: string, numeroCarga: string, pedidoId: string, numeroPedido: string, campos: string[], numeroNf: string, motivo: string, status = 'sucesso') {
  await base44.asServiceRole.entities.LogIntegracaoOmie.create({
    endpoint: 'webhook',
    call: 'atualizacao_espelho_carga_nf',
    operacao: 'reconciliar_espelho_carga_completo',
    entidade_tipo: 'Carga',
    entidade_id: cargaId,
    status,
    payload_resposta: JSON.stringify({
      carga_id: cargaId,
      numero_carga: numeroCarga,
      pedido_id: pedidoId,
      numero_pedido: numeroPedido,
      numero_nf: numeroNf,
      campos_alterados: campos,
      motivo
    }).slice(0, 2000)
  }).catch(() => {});
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Aceita execucao manual (usuario autenticado) OU agendada (sem usuario).
    const body = await req.json().catch(() => ({}));
    const agendada = body.scheduled === true || body.event;
    if (!agendada) {
      const user = await base44.auth.me().catch(() => null);
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { appKey, appSecret } = await getOmieCredentials(base44);
    if (!appKey || !appSecret) {
      return Response.json({ error: 'Credenciais Omie nao configuradas (ConfiguracaoOmie ativa nem Secrets).' }, { status: 500 });
    }
    if ((await checkCircuitBreaker(base44)).blocked) {
      return Response.json({ sucesso: false, bloqueado: true, error: 'API Omie bloqueada pelo circuit breaker. Reconciliacao abortada.' });
    }

    // Filtros: opcionalmente reconciliar uma carga especifica (por id ou numero_carga).
    const cargaIdFiltro = body.carga_id || null;
    const numeroCargaFiltro = body.numero_carga ? String(body.numero_carga) : null;
    const maxCargas = Math.min(Number(body.max_cargas || 30), 50);

    let cargas = await base44.asServiceRole.entities.Carga.list('-created_date', 500);
    const STATUS_ALVO = new Set(['faturada']);
    if (cargaIdFiltro) {
      cargas = cargas.filter((c: any) => String(c.id) === String(cargaIdFiltro));
    } else if (numeroCargaFiltro) {
      cargas = cargas.filter((c: any) => String(c.numero_carga) === numeroCargaFiltro);
    } else {
      cargas = cargas.filter((c: any) => STATUS_ALVO.has(String(c.status_carga || '').toLowerCase()));
    }
    cargas = cargas.slice(0, maxCargas);

    let cargasProcessadas = 0;
    let pedidosAtualizados = 0;
    let nfsVinculadas = 0;
    let cnpjsPreenchidos = 0;
    const detalhes: any[] = [];

    for (const carga of cargas) {
      const pedidos = Array.isArray(carga.pedidos_omie) ? carga.pedidos_omie : [];
      if (pedidos.length === 0) continue;

      let alterou = false;
      const novosPedidos = [...pedidos];

      for (let i = 0; i < novosPedidos.length; i++) {
        const p = { ...novosPedidos[i] };
        if (!p.codigo_pedido) continue;

        const precisaNf = !String(p.numero_nf || '').trim();
        const precisaCnpj = !String(p.cnpj_cpf_cliente || '').trim();
        if (!precisaNf && !precisaCnpj) continue;

        if ((await checkCircuitBreaker(base44)).blocked) break;

        const consulta = await consultarPedido(base44, p.codigo_pedido);
        await sleep(DELAY_MS);
        if (consulta?.erro) {
          detalhes.push({ carga: carga.numero_carga, pedido: p.codigo_pedido, erro: consulta.erro });
          continue;
        }

        const camposAlterados: string[] = [];

        // Preenche CNPJ (a partir do cadastro local pelo codigo_cliente do Omie ou cliente_id).
        if (precisaCnpj) {
          let cliente: any = null;
          if (p.cliente_id) cliente = await base44.asServiceRole.entities.Cliente.get(p.cliente_id).catch(() => null);
          const codCli = consulta.codigo_cliente || p.codigo_cliente;
          if (!cliente && codCli) {
            const porOmie = await base44.asServiceRole.entities.Cliente.filter({ codigo_omie: String(codCli) }, '-updated_date', 1).catch(() => []);
            cliente = porOmie?.[0] || null;
          }
          if (cliente?.cnpj_cpf) {
            p.cnpj_cpf_cliente = cliente.cnpj_cpf;
            if (!p.nome_cliente) p.nome_cliente = cliente.razao_social || cliente.nome_fantasia || '';
            if (!p.cliente_id) p.cliente_id = cliente.id;
            camposAlterados.push('cnpj_cpf_cliente');
            cnpjsPreenchidos++;
          }
        }

        // Preenche numero_nf
        if (precisaNf) {
          let nf = String(consulta.numero_nf || '').trim();
          if (!nf) {
            const nfConfirmada = await buscarNfAutorizada(base44, p.codigo_pedido);
            await sleep(DELAY_MS);
            if (nfConfirmada) nf = nfConfirmada;
          }
          if (nf) {
            p.numero_nf = nf;
            camposAlterados.push('numero_nf');
            nfsVinculadas++;
          }
        }

        if (camposAlterados.length > 0) {
          novosPedidos[i] = p;
          alterou = true;
          pedidosAtualizados++;
          await logCarga(base44, carga.id, carga.numero_carga, p.codigo_pedido, p.numero_pedido, camposAlterados, p.numero_nf || '', 'Reconciliacao completa do espelho - ' + camposAlterados.join(', ') + ' preenchido(s)');
          detalhes.push({ carga: carga.numero_carga, pedido: p.codigo_pedido, numero_pedido: p.numero_pedido, campos: camposAlterados, numero_nf: p.numero_nf || '' });
        }
      }

      if (alterou) {
        const notasFiscais = Array.from(new Set(novosPedidos.map((x: any) => x.numero_nf).filter(Boolean).map(String)));
        await base44.asServiceRole.entities.Carga.update(carga.id, {
          pedidos_omie: novosPedidos,
          notas_fiscais: notasFiscais
        });
        cargasProcessadas++;
      }
    }

    return Response.json({
      sucesso: true,
      cargas_analisadas: cargas.length,
      cargas_processadas: cargasProcessadas,
      pedidos_atualizados: pedidosAtualizados,
      nfs_vinculadas: nfsVinculadas,
      cnpjs_preenchidos: cnpjsPreenchidos,
      detalhes
    });
  } catch (error: any) {
    console.error('[reconciliarEspelhoCargaCompleto] ERRO:', error.message);
    return Response.json({ error: error.message, stack: String(error.stack || '').slice(0, 500) }, { status: 500 });
  }
});
