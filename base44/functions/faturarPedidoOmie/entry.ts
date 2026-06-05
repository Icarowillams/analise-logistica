import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

// omieCall robusto: circuit breaker + 425 (bloqueio 30min, sem retry) + retry 429 + log padronizado.
async function resolverCredsOmie(base44) {
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const ativo = rows?.[0];
  if (ativo?.app_key && ativo?.app_secret) return { OMIE_APP_KEY: String(ativo.app_key), OMIE_APP_SECRET: String(ativo.app_secret) };
  return { OMIE_APP_KEY: Deno.env.get('OMIE_APP_KEY'), OMIE_APP_SECRET: Deno.env.get('OMIE_APP_SECRET') };
}

async function omieCall(base44, call, param, options = {}) {
  const { OMIE_APP_KEY, OMIE_APP_SECRET } = await resolverCredsOmie(base44);
  if (!OMIE_APP_KEY || !OMIE_APP_SECRET) throw new Error('Credenciais Omie não configuradas: OMIE_APP_KEY/OMIE_APP_SECRET.');
  console.log(`[faturarPedidoOmie] Conectando ao Omie com APP_KEY: ...${String(OMIE_APP_KEY).slice(-4)} | método: ${call}`);
  const maxTentativas = options.maxTentativas || 3;
  const cacheKey = `${call}_${JSON.stringify(param)}`;
  const isReadOnly = /^(Listar|Consultar|Pesquisar|Buscar)/.test(call);
  if (isReadOnly) {
    const cached = getFromMemoryCache(cacheKey);
    if (cached) return cached;
  }

  const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
    const err = new Error(`API Omie temporariamente bloqueada por consumo indevido. Desbloqueio previsto: ${new Date(controle.bloqueado_ate).toLocaleString('pt-BR')}.`);
    err.code = 'OMIE_425';
    err.bloqueado_ate = controle.bloqueado_ate;
    throw err;
  }

  const body = { call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] };
  let lastError = '';
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 15000);
    try {
      const res = await fetch(OMIE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      clearTimeout(timeoutId);
      const data = await res.json();

      if (data.faultstring || data.faultcode) {
        const msg = String(data.faultstring || '').toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloquead') || msg.includes('bloqueio')) {
          const bloqueadoAte = new Date(Date.now() + 30 * 60000).toISOString();
          const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: bloqueadoAte, ultimo_erro: data.faultstring || 'HTTP 425 consumo indevido', atualizado_em: new Date().toISOString() };
          if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {});
          else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
          await base44.asServiceRole.entities.LogIntegracaoOmie.create({
            endpoint: OMIE_URL, call, operacao: call, status: 'erro', codigo_erro: '425',
            mensagem_erro: data.faultstring || 'HTTP 425 — consumo indevido',
            payload_enviado: JSON.stringify(param || {}).slice(0, 2000),
            payload_resposta: JSON.stringify(data || {}).slice(0, 2000)
          }).catch(() => {});
          const err = new Error(`API Omie bloqueada por consumo indevido (HTTP 425). Desbloqueio previsto: ${new Date(bloqueadoAte).toLocaleString('pt-BR')}.`);
          err.code = 'OMIE_425';
          err.bloqueado_ate = bloqueadoAte;
          throw err;
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('indispon')) {
          lastError = data.faultstring;
          if (tentativa < maxTentativas) { await new Promise(r => setTimeout(r, 2500 * tentativa)); continue; }
        }
        return data;
      }

      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({
          endpoint: OMIE_URL, call, operacao: call, status: 'sucesso',
          payload_enviado: JSON.stringify(param || {}).slice(0, 2000),
          payload_resposta: JSON.stringify(data || {}).slice(0, 2000)
        }).catch(() => {});
      }
      if (isReadOnly) setMemoryCache(cacheKey, data);
      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.code === 'OMIE_425') throw err;
      lastError = err.message;
      if (tentativa < maxTentativas) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, tentativa)));
    }
  }
  throw new Error(lastError || 'Máximo de tentativas Omie excedido');
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

        // Etapa padrão: 50 (Faturar)
        const etapaDestino = etapa || "50";

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