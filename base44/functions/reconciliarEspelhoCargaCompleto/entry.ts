import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_PEDIDO_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const OMIE_NF_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const DELAY_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve credenciais OBRIGATORIAMENTE da entidade ConfiguracaoOmie (banco), com fallback aos Secrets.
async function resolverCredsOmie(base44) {
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  return {
    app_key: ativo?.app_key || Deno.env.get('OMIE_APP_KEY'),
    app_secret: ativo?.app_secret || Deno.env.get('OMIE_APP_SECRET')
  };
}

async function circuitBreakerAberto(base44) {
  const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const ctrl = cb?.[0];
  return !!(ctrl?.bloqueado && ctrl.bloqueado_ate && new Date(ctrl.bloqueado_ate) > new Date());
}

// ConsultarPedido → extrai etapa, numero_nf, cancelado, cnpj/codigo cliente
async function consultarPedido(creds, codigoPedido) {
  const res = await fetch(OMIE_PEDIDO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call: 'ConsultarPedido', app_key: creds.app_key, app_secret: creds.app_secret, param: [{ codigo_pedido: Number(codigoPedido) }] })
  });
  const data = await res.json();
  if (data.faultstring) {
    return { erro: data.faultstring, status_http: res.status };
  }
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
}

// ConsultarNF (fallback) → confirma se existe NF AUTORIZADA antes de aceitar cancelamento
async function consultarNfAutorizada(creds, codigoPedido) {
  const res = await fetch(OMIE_NF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call: 'ConsultarNF', app_key: creds.app_key, app_secret: creds.app_secret, param: [{ nIdPedido: Number(codigoPedido) }] })
  });
  const data = await res.json();
  if (data.faultstring) return null;
  const ide = data.ide || {};
  const nNF = String(ide.nNF || data.cNumero || '');
  if (!nNF) return null;
  const dCan = String(ide.dCan || '').trim();
  const cDeneg = String(ide.cDeneg || '').trim();
  if (dCan || cDeneg === 'S' || cDeneg === 'D') return null; // cancelada/denegada → não vale
  return nNF;
}

async function logCarga(base44, cargaId, numeroCarga, pedidoId, numeroPedido, campos, numeroNf, motivo, status = 'sucesso') {
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

    // Aceita execução manual (usuário autenticado) OU agendada (sem usuário).
    const body = await req.json().catch(() => ({}));
    const agendada = body.scheduled === true || body.event;
    if (!agendada) {
      const user = await base44.auth.me().catch(() => null);
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const creds = await resolverCredsOmie(base44);
    if (!creds.app_key || !creds.app_secret) {
      return Response.json({ error: 'Credenciais Omie não configuradas (ConfiguracaoOmie ativa nem Secrets).' }, { status: 500 });
    }
    if (await circuitBreakerAberto(base44)) {
      return Response.json({ sucesso: false, bloqueado: true, error: 'API Omie bloqueada pelo circuit breaker. Reconciliação abortada.' });
    }

    // Filtros: opcionalmente reconciliar uma carga específica (por id ou numero_carga).
    const cargaIdFiltro = body.carga_id || null;
    const numeroCargaFiltro = body.numero_carga ? String(body.numero_carga) : null;
    const maxCargas = Math.min(Number(body.max_cargas || 30), 50);

    let cargas = await base44.asServiceRole.entities.Carga.list('-created_date', 500);
    const STATUS_ALVO = new Set(['faturada', 'nf_emitida']);
    if (cargaIdFiltro) {
      cargas = cargas.filter(c => String(c.id) === String(cargaIdFiltro));
    } else if (numeroCargaFiltro) {
      cargas = cargas.filter(c => String(c.numero_carga) === numeroCargaFiltro);
    } else {
      cargas = cargas.filter(c => STATUS_ALVO.has(String(c.status_carga || '').toLowerCase()));
    }
    cargas = cargas.slice(0, maxCargas);

    let cargasProcessadas = 0;
    let pedidosAtualizados = 0;
    let nfsVinculadas = 0;
    let cnpjsPreenchidos = 0;
    const detalhes = [];

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

        if (await circuitBreakerAberto(base44)) break;

        const consulta = await consultarPedido(creds, p.codigo_pedido);
        await sleep(DELAY_MS);
        if (consulta?.erro) {
          detalhes.push({ carga: carga.numero_carga, pedido: p.codigo_pedido, erro: consulta.erro });
          continue;
        }

        const camposAlterados = [];

        // Preenche CNPJ (a partir do cadastro local pelo codigo_cliente do Omie ou cliente_id).
        if (precisaCnpj) {
          let cliente = null;
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

        // Preenche numero_nf — só se a API trouxe NF válida.
        if (precisaNf) {
          let nf = String(consulta.numero_nf || '').trim();
          if (!nf && consulta.cancelado) {
            // API diz cancelado, mas confirmamos via ConsultarNF antes de aceitar.
            const nfConfirmada = await consultarNfAutorizada(creds, p.codigo_pedido);
            await sleep(DELAY_MS);
            if (nfConfirmada) nf = nfConfirmada;
          } else if (!nf) {
            // Sem NF no ConsultarPedido — tenta ConsultarNF mesmo assim (etapa 60 sem infoNfe completa).
            const nfConfirmada = await consultarNfAutorizada(creds, p.codigo_pedido);
            await sleep(DELAY_MS);
            if (nfConfirmada) nf = nfConfirmada;
          }
          if (nf) {
            p.numero_nf = nf; // só preenche quando estava vazio (precisaNf garante isso)
            camposAlterados.push('numero_nf');
            nfsVinculadas++;
          }
        }

        if (camposAlterados.length > 0) {
          novosPedidos[i] = p;
          alterou = true;
          pedidosAtualizados++;
          await logCarga(base44, carga.id, carga.numero_carga, p.codigo_pedido, p.numero_pedido, camposAlterados, p.numero_nf || '', `Reconciliação completa do espelho — ${camposAlterados.join(', ')} preenchido(s)`);
          detalhes.push({ carga: carga.numero_carga, pedido: p.codigo_pedido, numero_pedido: p.numero_pedido, campos: camposAlterados, numero_nf: p.numero_nf || '' });
        }
      }

      if (alterou) {
        const notasFiscais = Array.from(new Set(novosPedidos.map(x => x.numero_nf).filter(Boolean).map(String)));
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
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});