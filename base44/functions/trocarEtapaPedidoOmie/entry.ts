import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

async function trocarUmPedido(base44, pedido, etapaDestino) {
  const etapa = String(pedido.etapa || etapaDestino || '');
  if (!etapa) return { sucesso: false, mensagem: 'etapa obrigatória', ...pedido };
  if (!pedido.codigo_pedido && !pedido.codigo_pedido_integracao) {
    return { sucesso: false, mensagem: 'Informe codigo_pedido ou codigo_pedido_integracao', ...pedido };
  }

  // NÃO usar guarda anti-retrocesso por espelho LOCAL: o espelho PedidoLiberadoOmie pode estar
  // adiantado (gravado como etapa maior sem que o Omie tenha efetivado a troca) e isso fazia a
  // troca ser ignorada — pedido ficava liberado no app e preso na etapa anterior no Omie.
  // A própria régua do Omie já rejeita retrocesso real via codigo_status "6" (tratado abaixo),
  // que é a única fonte de verdade confiável.
  const param = { etapa };
  if (pedido.codigo_pedido) param.codigo_pedido = Number(pedido.codigo_pedido);
  if (pedido.codigo_pedido_integracao) param.codigo_pedido_integracao = String(pedido.codigo_pedido_integracao);

  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const resposta = await omieCall(base44, 'produtos/pedido/', param, { call: 'TrocarEtapaPedido' });
      // Omie pode retornar codigo_status != "0" indicando que a troca foi recusada.
      const codStatus = String(resposta?.codigo_status || '0');
      const descStatus = resposta?.descricao_status || '';
      // codigo_status "6" ("pode ser alterado apenas para: 60,70,80") = INFO/idempotente, não erro vermelho.
      // É permanente (não adianta retry): o pedido já passou da etapa solicitada. Tratar como ignorado/sucesso.
      if (codStatus === '6') {
        return {
          codigo_pedido: pedido.codigo_pedido,
          codigo_pedido_integracao: pedido.codigo_pedido_integracao,
          numero_pedido: pedido.numero_pedido,
          etapa,
          sucesso: true,
          ignorado: true,
          mensagem: `Omie codigo_status 6 (etapa não regride): ${descStatus}`,
          resposta
        };
      }
      const rejeitado = codStatus !== '0' && descStatus.toLowerCase().includes('não é possível');
      return {
        codigo_pedido: pedido.codigo_pedido,
        codigo_pedido_integracao: pedido.codigo_pedido_integracao,
        numero_pedido: pedido.numero_pedido,
        etapa,
        sucesso: !rejeitado,
        mensagem: rejeitado ? descStatus : undefined,
        resposta
      };
    } catch (e) {
      if (e.code === 'OMIE_425') throw e; // propaga bloqueio para parar o lote
      // REDUNDANT (consumo redundante) = throttling: aguardar e reenviar o MESMO pedido
      if (e.code === 'OMIE_REDUNDANT' && tentativa < 2) {
        const espera = Math.min(Number(e.esperaSegundos) || 30, 60);
        await new Promise(r => setTimeout(r, espera * 1000));
        continue;
      }
      return {
        codigo_pedido: pedido.codigo_pedido,
        codigo_pedido_integracao: pedido.codigo_pedido_integracao,
        numero_pedido: pedido.numero_pedido,
        etapa,
        sucesso: false,
        redundant: e.code === 'OMIE_REDUNDANT',
        mensagem: e.code === 'OMIE_REDUNDANT'
          ? 'Omie ocupado (REDUNDANT), tente em 1 min'
          : e.message
      };
    }
  }
}

async function getOmieCredentials(base44: any) {
  // ENV PRIMEIRO (fonte de verdade). Banco só como fallback — o banco foi esvaziado como blindagem.
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { appKey: envKey, appSecret: envSecret };
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  return { appKey: envKey || String(cfg?.app_key || '').trim(), appSecret: envSecret || String(cfg?.app_secret || '').trim() };
}

const CB_ID = '6a1e06a9aa62ceab7b3b6d97';

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return;
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    // Expirou — desbloquear automaticamente
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_ID, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return;
  }
  const err = new Error(`API Omie bloqueada até ${c.bloqueado_ate}`);
  err.code = 'OMIE_425';
  throw err;
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  await checkCircuitBreaker(base44);
  const { appKey, appSecret } = await getOmieCredentials(base44);
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas');
  const call = options.call || endpoint;
  const url = `https://app.omie.com.br/api/v1/${endpoint}`;
  const bodyStr = JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyStr,
  });
  // Erro HTTP do Omie (5xx/429/425): corpo costuma não ser JSON. 425 abre circuit breaker.
  if (resp.status >= 500 || resp.status === 429 || resp.status === 425) {
    const corpo = await resp.text().catch(() => '');
    if (resp.status === 425) {
      const err = new Error(`HTTP 425 Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`);
      err.code = 'OMIE_425';
      throw err;
    }
    throw new Error(`Omie ${call} HTTP ${resp.status}${corpo ? ': ' + corpo.slice(0, 200) : ''}`);
  }
  const data = await resp.json().catch(async () => {
    const text = await resp.text().catch(() => '');
    throw new Error(`Omie ${call} HTTP ${resp.status}: ${text}`);
  });
  // Omie pode retornar erro como array [{CODIGO, MENSAGEM, ORIGEM}] com HTTP 200.
  // CODIGO 6 / "REDUNDANT" = throttling (consumo redundante), não falha real.
  const erroArr = Array.isArray(data) ? data[0] : null;
  if (erroArr && (erroArr.CODIGO !== undefined || erroArr.MENSAGEM)) {
    const codigo = Number(erroArr.CODIGO);
    const mensagem = String(erroArr.MENSAGEM || '');
    if (codigo === 6 || /redundant/i.test(mensagem)) {
      const m = mensagem.match(/aguarde\s+(\d+)\s+segundo/i);
      const err = new Error(mensagem);
      err.code = 'OMIE_REDUNDANT';
      err.esperaSegundos = Math.min((m ? parseInt(m[1], 10) : 30), 60);
      throw err;
    }
    throw new Error(mensagem || `Omie ${call} erro CODIGO ${codigo}`);
  }
  // Omie retorna HTTP 200 mesmo com erro — verificar faultstring
  if (data.faultstring) {
    const msg = String(data.faultstring);
    const lower = msg.toLowerCase();
    if (lower.includes('bloqueada') || lower.includes('consumo indevido') || lower.includes('bloqueio')) {
      const err = new Error(msg);
      err.code = 'OMIE_425';
      throw err;
    }
    throw new Error(msg);
  }
  if (!resp.ok) throw new Error(`Omie ${call} HTTP ${resp.status}`);
  return data;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const pedidos = Array.isArray(body.pedidos) ? body.pedidos : null;

    if (pedidos) {
      // Dedupe por codigo_pedido (ou codigo_pedido_integracao) — não enviar o mesmo pedido 2x no mesmo processo
      const vistos = new Set();
      const pedidosUnicos = pedidos.filter(p => {
        const chave = String(p.codigo_pedido || p.codigo_pedido_integracao || '');
        if (!chave) return true;
        if (vistos.has(chave)) return false;
        vistos.add(chave);
        return true;
      });
      const resultados = [];
      let bloqueio425 = false;
      for (let i = 0; i < pedidosUnicos.length; i++) {
        try {
          resultados.push(await trocarUmPedido(base44, pedidosUnicos[i], body.etapa_destino));
        } catch (e) {
          // 425 / circuit breaker aberto: PARAR o laço imediatamente — não martelar o Omie
          // durante a janela de penalidade. Os restantes ficam como "aguardando".
          if (e.code === 'OMIE_425') {
            bloqueio425 = true;
            for (let j = i; j < pedidosUnicos.length; j++) {
              const p = pedidosUnicos[j];
              resultados.push({
                codigo_pedido: p.codigo_pedido,
                codigo_pedido_integracao: p.codigo_pedido_integracao,
                numero_pedido: p.numero_pedido,
                etapa: String(p.etapa || body.etapa_destino || ''),
                sucesso: false,
                aguardando: true,
                mensagem: 'API Omie bloqueada (425) — aguardando próxima janela'
              });
            }
            break;
          }
          throw e;
        }
        // Intervalo ENTRE pedidos para reduzir REDUNDANT (não após o último)
        if (i < pedidosUnicos.length - 1) await new Promise(r => setTimeout(r, 1500));
      }
      const sucessos = resultados.filter(r => r.sucesso).length;
      const ignorados = resultados.filter(r => r.sucesso && r.ignorado).length;
      const aguardando = resultados.filter(r => r.aguardando).length;
      const erros = resultados.filter(r => !r.sucesso).length;
      const errosDetalhe = resultados
        .filter(r => !r.sucesso)
        .map(r => `Ped ${r.numero_pedido || r.codigo_pedido}: ${r.mensagem || 'sem detalhe'}`)
        .join(' | ');
      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'produtos/pedido',
        call: 'TrocarEtapaPedido',
        operacao: `trocar_etapa_lote_${body.etapa_destino || 'multi'}`,
        status: erros > 0 ? 'warning' : (ignorados > 0 ? 'ignorado' : 'sucesso'),
        mensagem_erro: erros > 0 ? `${erros} pedidos falharam: ${errosDetalhe}`.substring(0, 2000) : null,
        erro_detalhado: erros > 0 ? errosDetalhe.substring(0, 2000) : null,
        payload_resposta: JSON.stringify(resultados).substring(0, 2000),
        usuario_email: user.email
      }).catch(() => {});
      return Response.json({ sucesso: true, total: pedidos.length, sucessos, ignorados, aguardando, erros, omie_bloqueada: bloqueio425, resultados });
    }

    const resultado = await trocarUmPedido(base44, body, body.etapa);
    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'TrocarEtapaPedido',
      operacao: 'trocar_etapa',
      status: resultado.ignorado ? 'ignorado' : (resultado.sucesso ? 'sucesso' : (resultado.redundant ? 'warning' : 'erro')),
      mensagem_erro: resultado.sucesso ? null : resultado.mensagem,
      payload_enviado: JSON.stringify(body).substring(0, 1500),
      payload_resposta: JSON.stringify(resultado).substring(0, 1500),
      usuario_email: user.email
    }).catch(() => {});

    if (!resultado.sucesso) return Response.json({ sucesso: false, error: resultado.mensagem, resultado }, { status: 400 });
    return Response.json(resultado);
  } catch (error) {
    const bloqueada = error?.code === 'OMIE_425';


    return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
  }
});