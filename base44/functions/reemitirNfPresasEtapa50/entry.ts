import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══════════════════════════════════════════════════════════════════════════
// REDE DE SEGURANÇA — Reemissão de NF presas em etapa 50
//
// PROBLEMA QUE RESOLVE:
//   Ao "faturar carga" (faturarCargaOmie), os pedidos vão para etapa 50 e a
//   carga é marcada como faturada LOCALMENTE — mas a emissão real da NF (etapa 60)
//   é um passo separado ("Notas Omie → Emissão"). Se esse passo não é acionado
//   ou é interrompido por bloqueio 425 do Omie, os pedidos ficam presos em
//   etapa 50: faturados internamente, porém SEM NF — silenciosamente.
//
// O QUE FAZ:
//   1. Busca Pedidos locais presos (status=montagem, status_faturamento=pendente,
//      com omie_codigo_pedido) — fonte barata e confiável, sem varrer a API.
//   2. Confirma no Omie (ConsultarPedido) a etapa real de cada um.
//   3. Para os que estão MESMO em etapa 50, dispara FaturarPedidoVenda (emite NF),
//      com delay controlado e respeito ao circuit breaker.
//
// SEGURANÇA:
//   - Respeita o circuit breaker (aborta se Omie bloqueada).
//   - Delay de 2,5s entre cada emissão.
//   - Limite de pedidos por execução (evita timeout e consumo excessivo).
//   - Idempotente: só reemite quem está confirmadamente em etapa 50.
// ═══════════════════════════════════════════════════════════════════════════

const OMIE_CONSULTA_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const OMIE_FAT_URL = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';
const CB_ID = '6a1e06a9aa62ceab7b3b6d97';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getCredenciais(base44) {
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  return { appKey, appSecret };
}

async function circuitBloqueado(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return false;
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return false;
  }
  return true;
}

async function consultarEtapa(appKey, appSecret, codigo) {
  const resp = await fetch(OMIE_CONSULTA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call: 'ConsultarPedido', app_key: appKey, app_secret: appSecret, param: [{ codigo_pedido: Number(codigo) }] })
  });
  const d = await resp.json().catch(() => ({}));
  if (d?.faultstring) return { etapa: null, erro: d.faultstring };
  const pv = d?.pedido_venda_produto || d;
  return { etapa: pv?.cabecalho?.etapa || null };
}

async function emitirNf(appKey, appSecret, codigo, tentativa = 1) {
  const resp = await fetch(OMIE_FAT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call: 'FaturarPedidoVenda', app_key: appKey, app_secret: appSecret, param: [{ nCodPed: Number(codigo) }] })
  });
  const d = await resp.json().catch(() => ({}));
  if (d?.faultstring) {
    const fs = String(d.faultstring);
    // Concorrência / consumo redundante: aguarda janela do Omie e tenta de novo (até 3x)
    if (/redundante|concorr|425/i.test(fs) && tentativa < 3) {
      await sleep(60000);
      return emitirNf(appKey, appSecret, codigo, tentativa + 1);
    }
    return { ok: false, msg: fs };
  }
  return { ok: true, status: d?.cCodStatus, msg: d?.cDesStatus };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Autenticação: apenas admin pode disparar manualmente; automação roda como serviço.
    const ehAutomacao = !!(req.headers.get('x-base44-automation') || req.headers.get('X-Base44-Automation'));
    if (!ehAutomacao) {
      const user = await base44.auth.me().catch(() => null);
      if (!user || user.role !== 'admin') {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const body = await req.json().catch(() => ({}));
    const apenasDetectar = body.apenas_detectar === true; // dry-run: só lista, não reemite
    // Na detecção (dry-run) varremos mais pedidos para o alerta refletir a realidade;
    // na reemissão real mantemos o teto baixo (consumo Omie + timeout).
    const limite = apenasDetectar
      ? Math.min(Number(body.limite) || 60, 100)
      : Math.min(Number(body.limite) || 12, 25);

    // Circuit breaker
    if (await circuitBloqueado(base44)) {
      return Response.json({ sucesso: false, omie_bloqueada: true, mensagem: 'API Omie bloqueada — execução adiada.' }, { status: 425 });
    }

    const { appKey, appSecret } = await getCredenciais(base44);
    if (!appKey || !appSecret) {
      return Response.json({ error: 'Credenciais Omie não configuradas.' }, { status: 500 });
    }

    // Fonte confiável e barata: pedidos locais presos no estado "faturado localmente, sem NF".
    // Inclui também os que ficaram em status_faturamento='processando' SEM nota (ex: 1867 órfão por
    // reconsulta antiga) — desde que NÃO estejam faturados de verdade.
    const presosPendente = await base44.asServiceRole.entities.Pedido.filter({
      status: 'montagem',
      status_faturamento: 'pendente',
      faturado: false
    }, '-data_faturamento', 200).catch(() => []);
    const presosProcessando = await base44.asServiceRole.entities.Pedido.filter({
      status: 'montagem',
      status_faturamento: 'processando',
      faturado: false
    }, '-data_faturamento', 100).catch(() => []);
    const vistos = new Set();
    const presos = [...presosPendente, ...presosProcessando].filter(p => {
      if (vistos.has(p.id)) return false;
      vistos.add(p.id);
      // Sem número de NF — se já tem NF não é "preso".
      return !p.numero_nota_fiscal;
    });

    // BLINDAGEM FISCAL: jamais reemitir pedido solto manualmente ou que não está numa carga ativa.
    // codigo_pedido_omie nulo será resolvido abaixo pelo espelho PedidoLiberadoOmie — não descarta aqui.
    const candidatos = presos.filter(p =>
      p.modelo_nota !== 'd1' &&
      p.solto_manualmente !== true &&
      !!p.carga_id
    );

    // BUG-FIX codigo_pedido_omie nulo: pedido existe no Omie mas o vínculo local ficou em branco.
    // Resolve pelo espelho PedidoLiberadoOmie (match por numero_pedido) e grava de volta no Pedido —
    // barato, sem bater no Omie. Geral, não só pro 1867.
    for (const p of candidatos) {
      if (p.omie_codigo_pedido) continue;
      const numPed = String(p.numero_pedido || '').replace(/^0+/, '');
      if (!numPed) continue;
      const esp = await base44.asServiceRole.entities.PedidoLiberadoOmie
        .filter({ numero_pedido: p.numero_pedido }, '-sincronizado_em', 1).catch(() => []);
      let codOmie = esp?.[0]?.codigo_pedido;
      // Tenta também sem zeros à esquerda, caso o espelho guarde normalizado.
      if (!codOmie && numPed !== p.numero_pedido) {
        const esp2 = await base44.asServiceRole.entities.PedidoLiberadoOmie
          .filter({ numero_pedido: numPed }, '-sincronizado_em', 1).catch(() => []);
        codOmie = esp2?.[0]?.codigo_pedido;
      }
      if (codOmie) {
        p.omie_codigo_pedido = String(codOmie);
        await base44.asServiceRole.entities.Pedido.update(p.id, { omie_codigo_pedido: String(codOmie) }).catch(() => {});
      }
    }

    // Após tentar preencher, só seguem os que têm código Omie (sem código não há como consultar/reemitir).
    const candidatosComCodigo = candidatos.filter(p => p.omie_codigo_pedido);

    // NORMALIZAÇÃO DO LIMBO (operação LOCAL, sem Omie, sem emitir NF):
    // pedidos que ficaram em status_faturamento='processando' sem nota (ex: 1867 órfão por reconsulta)
    // são revertidos para 'pendente' + pendente_emissao=true, voltando a ser detectáveis pelo banner.
    for (const p of candidatosComCodigo) {
      if (p.status_faturamento === 'processando' && !p.numero_nota_fiscal && p.faturado !== true) {
        p.status_faturamento = 'pendente';
        p.pendente_emissao = true;
        if (!p.motivo_pendencia_emissao) p.motivo_pendencia_emissao = 'Faturado na carga, sem NF — saiu de "processando" sem transmitir';
        await base44.asServiceRole.entities.Pedido.update(p.id, {
          status_faturamento: 'pendente',
          pendente_emissao: true,
          motivo_pendencia_emissao: p.motivo_pendencia_emissao
        }).catch(() => {});
      }
    }

    if (candidatosComCodigo.length === 0) {
      return Response.json({ sucesso: true, detectados: 0, reemitidos: 0, presos: [], mensagem: 'Nenhum pedido preso encontrado.' });
    }

    // DETECÇÃO BARATA (alerta automático): só dados locais, SEM consultar o Omie em rajada.
    // Os pedidos já estão flagueados como "faturado localmente, sem NF" — basta listá-los.
    if (apenasDetectar) {
      const presosLista = candidatosComCodigo.slice(0, limite).map(p => ({
        codigo_pedido: p.omie_codigo_pedido,
        numero_pedido: p.numero_pedido || '',
        cliente_nome: p.cliente_nome || '',
        numero_carga: p.numero_carga || '',
        carga_id: p.carga_id || '',
        motivo: p.motivo_pendencia_emissao || p.omie_erro || 'Faturado na carga, sem NF (preso em etapa 50)'
      }));
      return Response.json({
        sucesso: true,
        apenas_detectar: true,
        detectados: candidatosComCodigo.length,
        presos: presosLista,
        mensagem: `${candidatosComCodigo.length} pedido(s) faturados sem NF.`
      });
    }

    const detalhes = [];
    let reemitidos = 0;
    let processadosNoOmie = 0;

    for (const p of candidatosComCodigo) {
      if (processadosNoOmie >= limite) break;
      // Reverificar circuit breaker a cada iteração
      if (await circuitBloqueado(base44)) break;

      const cod = p.omie_codigo_pedido;
      const { etapa, erro } = await consultarEtapa(appKey, appSecret, cod);
      await sleep(800);

      if (erro) {
        detalhes.push({ codigo_pedido: cod, numero_pedido: p.numero_pedido, etapa: null, acao: 'erro_consulta', msg: erro });
        continue;
      }

      // Etapa 60 = já tem NF → corrige o status local que ficou defasado.
      if (String(etapa) === '60') {
        await base44.asServiceRole.entities.Pedido.update(p.id, {
          status: 'faturado',
          status_faturamento: 'faturado',
          faturado: true,
          pendente_emissao: false,
          motivo_pendencia_emissao: ''
        }).catch(() => {});
        detalhes.push({ codigo_pedido: cod, numero_pedido: p.numero_pedido, etapa, acao: 'ja_emitido_status_corrigido' });
        continue;
      }

      // Etapa 50 = faturado localmente mas SEM NF → este é o problema. Reemite.
      if (String(etapa) === '50') {
        processadosNoOmie++;
        if (apenasDetectar) {
          detalhes.push({ codigo_pedido: cod, numero_pedido: p.numero_pedido, etapa, acao: 'detectado' });
          continue;
        }

        const r = await emitirNf(appKey, appSecret, cod);
        if (r.ok) {
          reemitidos++;
          await base44.asServiceRole.entities.Pedido.update(p.id, {
            status_faturamento: 'processando',
            pendente_emissao: false,
            motivo_pendencia_emissao: ''
          }).catch(() => {});
          await base44.asServiceRole.entities.LogIntegracaoOmie.create({
            endpoint: 'produtos/pedidovendafat',
            call: 'FaturarPedidoVenda',
            operacao: 'reemitir_nf_presa_etapa50',
            entidade_tipo: 'Pedido',
            entidade_id: p.id,
            status: 'sucesso',
            payload_enviado: JSON.stringify({ nCodPed: cod }).slice(0, 800),
            usuario_email: 'rede_seguranca'
          }).catch(() => {});
          // Registra também em LogEmissaoNF para aparecer na tela "Log de Emissão".
          await base44.asServiceRole.entities.LogEmissaoNF.create({
            codigo_pedido: String(cod),
            numero_pedido: p.numero_pedido || '',
            cliente_id: p.cliente_id || '',
            cliente_nome: p.cliente_nome || '',
            carga_id: p.carga_id || '',
            numero_carga: p.numero_carga || '',
            status: 'pendente',
            mensagem: 'Reemissão automática (rede de segurança — etapa 50). Aguardando confirmação da SEFAZ.',
            usuario_email: 'rede_seguranca',
            usuario_nome: 'Rede de Segurança'
          }).catch(() => {});
          detalhes.push({ codigo_pedido: cod, numero_pedido: p.numero_pedido, etapa, acao: 'reemitido' });
        } else {
          await base44.asServiceRole.entities.LogIntegracaoOmie.create({
            endpoint: 'produtos/pedidovendafat',
            call: 'FaturarPedidoVenda',
            operacao: 'reemitir_nf_presa_etapa50',
            entidade_tipo: 'Pedido',
            entidade_id: p.id,
            status: 'erro_omie',
            mensagem_erro: String(r.msg).slice(0, 2000),
            usuario_email: 'rede_seguranca'
          }).catch(() => {});
          detalhes.push({ codigo_pedido: cod, numero_pedido: p.numero_pedido, etapa, acao: 'falha_reemissao', msg: r.msg });
          // Se o erro indica bloqueio, para tudo para não insistir contra a API bloqueada.
          if (/bloqueada|bloqueio|consumo indevido/i.test(String(r.msg))) break;
        }

        // Delay controlado entre emissões reais.
        await sleep(2500);
        continue;
      }

      // Outras etapas (10/20) → ainda não estão prontos para NF; não mexe.
      detalhes.push({ codigo_pedido: cod, numero_pedido: p.numero_pedido, etapa, acao: 'etapa_anterior_ignorado' });
    }

    return Response.json({
      sucesso: true,
      candidatos: candidatosComCodigo.length,
      verificados_omie: detalhes.length,
      reemitidos,
      mensagem: `${reemitidos} NF reemitida(s). ${candidatosComCodigo.length} pedido(s) presos candidatos no total.`,
      detalhes
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});