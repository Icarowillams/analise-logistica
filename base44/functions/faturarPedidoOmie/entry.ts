import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = Deno.env.get('OMIE_APP_KEY') || cfg?.app_key || '';
  let appSecret = Deno.env.get('OMIE_APP_SECRET') || cfg?.app_secret || '';
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
          const _p = { erros_consecutivos: _erros, ultimo_erro: lastErr.slice(0, 500), atualizado_em: new Date().toISOString() };
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
        // CONSUMO REDUNDANTE: o Omie só libera o mesmo id após ~60s. Retry rápido falha de novo,
        // então propaga erro claro orientando aguardar a janela — sem esgotar tentativas em 7s.
        if (msg.includes('redundante')) {
          const segs = (String(data.faultstring).match(/(\d+)\s*segundo/i)?.[1]) || '60';
          const redErr: any = new Error(`Consumo redundante detectado pelo Omie. Aguarde ~${segs}s e tente reenviar este pedido.`);
          redErr.redundante = true;
          throw redErr;
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update('6a1e06a9aa62ceab7b3b6d97', { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (e: any) {
      if (e.redundante) throw e; // redundante não retenta — propaga mensagem clara
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

// 🐛 FIX: Credenciais removidas do top-level — resolvidas dinamicamente dentro do omieCall
const OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/";

const TIPOS_COM_MOTIVO = ["troca", "devolucao", "bonificacao"];

function montarTextoMotivos(pedido, itens, pedidosTroca) {
    const linhas = [];

    itens.forEach((item) => {
        const motivo = item.motivo_troca_descricao || item.motivo_descricao;
        const observacao = item.observacao;
        if (!motivo && !observacao) return;

        const produto = item.produto_nome || item.produto_descricao || item.descricao || item.produto_codigo || "Produto";
        let linha = `- [${produto}]: ${motivo || "Motivo não informado"}`;
        if (observacao) linha += ` - ${observacao}`;
        linhas.push(linha);
    });

    pedidosTroca.forEach((troca) => {
        if (troca.motivo_descricao) linhas.push(`Motivo geral: ${troca.motivo_descricao}`);
        if (troca.observacoes) linhas.push(`Observação geral: ${troca.observacoes}`);
    });

    if (pedido.motivo_troca || pedido.motivo_troca_descricao) {
        linhas.push(`Motivo geral: ${pedido.motivo_troca_descricao || pedido.motivo_troca}`);
    }

    if (linhas.length === 0) return "";
    return `MOTIVOS DE TROCA:\n${linhas.join("\n")}`;
}

const memoryCache = new Map();
function getFromMemoryCache(key, ttlMs = 30000) {
  const entry = memoryCache.get(key);
  if (entry && (Date.now() - entry.ts) < ttlMs) return entry.data;
  return null;
}
function setMemoryCache(key, data) {
  memoryCache.set(key, { data, ts: Date.now() });
}

async function injetarMotivosTrocaNoOmie(base44, pedido, codigoPedidoOmie, user) {
    if (!TIPOS_COM_MOTIVO.includes(pedido.tipo)) return;

    const itens = await base44.asServiceRole.entities.PedidoItem.filter({ pedido_id: pedido.id });
    const pedidosTroca = await base44.asServiceRole.entities.PedidoTroca.filter({ pedido_venda_id: pedido.id });
    const textoMotivos = montarTextoMotivos(pedido, itens || [], pedidosTroca || []);

    if (!textoMotivos) return;

    const pedidoOmie = await omieCall(base44, "ConsultarPedido", { codigo_pedido: codigoPedidoOmie });
    const pedidoData = pedidoOmie.pedido_venda_produto || pedidoOmie;
    const obsAtual = pedidoData?.observacoes?.obs_venda || "";
    const obsVenda = obsAtual.includes("MOTIVOS DE TROCA:")
        ? obsAtual
        : [obsAtual.trim(), textoMotivos].filter(Boolean).join("\n\n");

    const etapaAtual = pedidoData?.cabecalho?.etapa || pedido.etapa || "10";
    const payload = {
        cabecalho: {
            codigo_pedido: codigoPedidoOmie,
            etapa: etapaAtual
        },
        observacoes: {
            obs_venda: obsVenda
        }
    };

    try {
        const resultado = await omieCall(base44, "AlterarPedidoVenda", payload);
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
            endpoint: 'produtos/pedido',
            call: 'AlterarPedidoVenda',
            operacao: 'injetar_motivos_troca',
            entidade_tipo: 'Pedido',
            entidade_id: pedido.id,
            status: 'sucesso',
            payload_enviado: JSON.stringify(payload).slice(0, 2000),
            payload_resposta: JSON.stringify(resultado).slice(0, 5000),
            usuario_email: user.email
        }).catch(() => {});
    } catch (error) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
            endpoint: 'produtos/pedido',
            call: 'AlterarPedidoVenda',
            operacao: 'injetar_motivos_troca',
            entidade_tipo: 'Pedido',
            entidade_id: pedido.id,
            status: 'erro_omie',
            mensagem_erro: error.message,
            erro_detalhado: error.message,
            payload_enviado: JSON.stringify(payload).slice(0, 2000),
            usuario_email: user.email
        }).catch(() => {});
        throw error;
    }
}

Deno.serve(async (req) => {
    let base44 = null;
    let pedido_id = null;
    let statusAnterior = null;

    try {
        base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (user.role !== 'admin') {
            return Response.json({ error: 'Apenas administradores podem faturar pedidos' }, { status: 403 });
        }

        const body = await req.json();
        pedido_id = body.pedido_id;
        const etapa = body.etapa;

        if (!pedido_id) {
            return Response.json({ error: 'pedido_id é obrigatório' }, { status: 400 });
        }

        // Etapa padrão: 60 ("Faturado"). "Entregue" (50) só é marcado no Acerto de Caixa.
        const etapaDestino = etapa || "60";

        // Buscar pedido
        const pedido = await base44.asServiceRole.entities.Pedido.get(pedido_id);
        if (!pedido) {
            return Response.json({ error: 'Pedido não encontrado' }, { status: 404 });
        }

        if (!pedido.omie_enviado || !pedido.omie_codigo_pedido) {
            return Response.json({ error: 'Este pedido ainda não foi enviado ao Omie' }, { status: 400 });
        }

        // Guardar status anterior para possível rollback
        statusAnterior = pedido.status;

        const codigoPedidoOmie = Number(pedido.omie_codigo_pedido);
        console.log('[faturarPedidoOmie] Pedido:', pedido.id, '- Código Omie:', codigoPedidoOmie, '- Etapa destino:', etapaDestino);

        await injetarMotivosTrocaNoOmie(base44, pedido, codigoPedidoOmie, user);

        // Tentativa 1: TrocarEtapaPedido
        console.log('[faturarPedidoOmie] Tentativa 1: TrocarEtapaPedido com etapa', etapaDestino);
        const resultado1 = await omieCall(base44, "TrocarEtapaPedido", {
            codigo_pedido: codigoPedidoOmie,
            etapa: etapaDestino
        });
        console.log('[faturarPedidoOmie] Resposta Tentativa 1:', JSON.stringify(resultado1).substring(0, 2000));

        // Se tentativa 1 deu certo (verificar se não é mensagem de erro disfarçada)
        const descStatus1 = resultado1?.descricao_status || '';
        const isRealSuccess1 = resultado1 && !resultado1.faultstring && !resultado1.faultcode 
            && !descStatus1.toLowerCase().includes('não é possível')
            && !descStatus1.toLowerCase().includes('utilize o processo');
        
        if (isRealSuccess1) {
            await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: null });
            console.log('[faturarPedidoOmie] Sucesso na Tentativa 1!');
            return Response.json({
                sucesso: true,
                mensagem: descStatus1 || `Pedido movido para etapa ${etapaDestino} no Omie`
            });
        }
        
        console.log('[faturarPedidoOmie] Tentativa 1 falhou:', resultado1?.faultstring || descStatus1);

        // Tentativa 2: Primeiro consultar o pedido no Omie, depois usar AlterarPedidoVenda
        console.log('[faturarPedidoOmie] Tentativa 2: ConsultarPedido + AlterarPedidoVenda');
        
        // Consultar pedido completo no Omie
        const pedidoOmie = await omieCall(base44, "ConsultarPedido", { codigo_pedido: codigoPedidoOmie });
        console.log('[faturarPedidoOmie] ConsultarPedido resposta (primeiros 1000 chars):', JSON.stringify(pedidoOmie).substring(0, 1000));

        if (pedidoOmie.faultstring) {
            await base44.asServiceRole.entities.LogIntegracaoOmie.create({
                endpoint: 'produtos/pedido',
                call: 'ConsultarPedido',
                operacao: 'faturar_pedido',
                status: 'erro_omie',
                codigo_erro: pedidoOmie.faultcode || '',
                mensagem_erro: pedidoOmie.faultstring,
                erro_detalhado: pedidoOmie.faultstring,
                payload_enviado: JSON.stringify({ codigo_pedido: codigoPedidoOmie }).slice(0, 2000),
                payload_resposta: JSON.stringify(pedidoOmie).slice(0, 5000),
                usuario_email: user.email
            }).catch(() => {});
            return Response.json({
                sucesso: false,
                erro: pedidoOmie.faultstring,
                faultstring: pedidoOmie.faultstring,
                faultcode: pedidoOmie.faultcode || ''
            });
        }

        // Log completo do pedido Omie para entender a estrutura
        console.log('[faturarPedidoOmie] Estrutura pedidoOmie keys:', Object.keys(pedidoOmie));
        console.log('[faturarPedidoOmie] pedidoOmie.pedido_venda_produto keys:', pedidoOmie.pedido_venda_produto ? Object.keys(pedidoOmie.pedido_venda_produto) : 'N/A');
        
        // O ConsultarPedido pode retornar dentro de pedido_venda_produto
        const pedidoData = pedidoOmie.pedido_venda_produto || pedidoOmie;
        
        // Modificar a etapa e enviar via AlterarPedidoVenda
        const pedidoParaAlterar = JSON.parse(JSON.stringify(pedidoData));
        
        // Definir a nova etapa
        if (pedidoParaAlterar.cabecalho) {
            pedidoParaAlterar.cabecalho.etapa = etapaDestino;
            // Remover campos read-only do cabecalho
            delete pedidoParaAlterar.cabecalho.numero_pedido;
            delete pedidoParaAlterar.cabecalho.origem_pedido;
            delete pedidoParaAlterar.cabecalho.bloqueado;
            delete pedidoParaAlterar.cabecalho.importado_api;
            delete pedidoParaAlterar.cabecalho.quantidade_itens;
        }
        
        // Remover campos que o Omie não aceita em alteração
        const camposRemover = ['infoCadastro', 'exportacao', 'total_pedido', 'MarketPlace', 'marketplace', 'lista_parcelas'];
        camposRemover.forEach(c => delete pedidoParaAlterar[c]);
        
        // Limpar campos read-only dos itens
        if (pedidoParaAlterar.det) {
            pedidoParaAlterar.det = pedidoParaAlterar.det.map(item => {
                delete item.infAdic;
                delete item.inf_adic;
                delete item.rastreabilidade;
                // Remover impostos calculados (read-only)
                delete item.imposto;
                return item;
            });
        }

        console.log('[faturarPedidoOmie] Enviando AlterarPedidoVenda com etapa:', etapaDestino);
        console.log('[faturarPedidoOmie] Payload keys:', Object.keys(pedidoParaAlterar));
        
        const resultado2 = await omieCall(base44, "AlterarPedidoVenda", pedidoParaAlterar);
        console.log('[faturarPedidoOmie] Resposta Tentativa 2:', JSON.stringify(resultado2).substring(0, 2000));

        if (resultado2.faultstring || resultado2.faultcode) {
            const erro = resultado2.faultstring || resultado2.faultcode;
            console.error('[faturarPedidoOmie] Erro Omie Tentativa 2:', erro);
            await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: erro });
            await base44.asServiceRole.entities.LogIntegracaoOmie.create({
                endpoint: 'produtos/pedido',
                call: 'AlterarPedidoVenda',
                operacao: 'faturar_pedido',
                status: 'erro_omie',
                codigo_erro: resultado2.faultcode || '',
                mensagem_erro: erro,
                erro_detalhado: erro,
                payload_enviado: JSON.stringify(pedidoParaAlterar).slice(0, 2000),
                payload_resposta: JSON.stringify(resultado2).slice(0, 5000),
                usuario_email: user.email
            }).catch(() => {});
            return Response.json({ sucesso: false, erro, faultstring: resultado2.faultstring || '', faultcode: resultado2.faultcode || '' });
        }

        // Sucesso na tentativa 2
        await base44.asServiceRole.entities.Pedido.update(pedido_id, { omie_erro: null });
        console.log('[faturarPedidoOmie] Sucesso na Tentativa 2!');

        return Response.json({
            sucesso: true,
            mensagem: resultado2.descricao_status || `Pedido movido para etapa ${etapaDestino} no Omie`
        });

    } catch (error) {
        console.error('[faturarPedidoOmie] Erro geral:', error.message);
        
        // Reverter status do pedido se possível
        if (base44 && pedido_id && statusAnterior) {
            try {
                await base44.asServiceRole.entities.Pedido.update(pedido_id, {
                    omie_erro: `Erro interno: ${error.message}`
                });
                console.log('[faturarPedidoOmie] Erro registrado no pedido');
            } catch (recoveryErr) {
                console.error('[faturarPedidoOmie] Erro ao registrar erro no pedido:', recoveryErr.message);
            }
        }
        const bloqueada = error?.code === 'OMIE_425';
        return Response.json({ error: error.message, sucesso: false, erro: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
    }
});