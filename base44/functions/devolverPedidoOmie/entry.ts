import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');
let base44Global = null;

async function omieCall(call, param, opts = {}) {
  const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3, cacheMinutes: 0, logIntegration: true } : opts;
  const chave = `${OMIE_URL}|${call}|${JSON.stringify(param || {})}`;
  const controles = await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = controles?.[0];

  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
    throw new Error(`API Omie bloqueada temporariamente. Tente novamente em ${controle.bloqueado_ate}`);
  }

  if (cacheMinutes > 0) {
    const caches = await base44Global.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
    if (caches?.[0] && new Date(caches[0].expira_em) > new Date()) return caches[0].valor;
  }

  let ultimoErro = '';
  for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
    const inicio = Date.now();
    const res = await fetch(OMIE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
    });
    const data = await res.json();

    if (data.faultstring || data.faultcode) {
      const msg = String(data.faultstring || '').toLowerCase();
      const deveBloquear = res.status === 425 || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde');
      if (deveBloquear) {
        const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: data.faultstring || '', atualizado_em: new Date().toISOString() };
        if (controle?.id) await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {});
        else await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
        throw new Error(data.faultstring || 'API Omie bloqueada temporariamente');
      }

      const deveTentar = res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('indispon');
      ultimoErro = data.faultstring || 'Erro Omie';
      if (deveTentar && tentativa < maxRetries) {
        await new Promise(r => setTimeout(r, 2500 * tentativa));
        continue;
      }
      throw new Error(ultimoErro);
    }

    if (logIntegration) {
      await base44Global.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: OMIE_URL,
        call,
        operacao: call,
        status: 'sucesso',
        payload_enviado: JSON.stringify(param || {}).slice(-500),
        payload_resposta: JSON.stringify(data || {}).slice(-500),
        duracao_ms: Date.now() - inicio,
        tentativas: tentativa
      }).catch(() => {});
    }
    return data;
  }

  throw new Error(ultimoErro || 'Máximo de tentativas Omie excedido');
}

// Devolve itens de um pedido Omie (parcial ou total)
// body: { codigo_pedido, produtos: [{nCodProd, quantidade, motivo}], tipo_retorno, motivo_geral }
// IMPORTANTE: usa nCodProd (código interno do Omie), NÃO codigo_produto_integracao
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    base44Global = base44;
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_pedido, produtos = [], tipo_retorno = 'devolucao_parcial', motivo_geral = '', carga_id = null } = body;
    if (!codigo_pedido) return Response.json({ error: 'codigo_pedido obrigatório' }, { status: 400 });
    if (produtos.length === 0) return Response.json({ error: 'produtos vazio' }, { status: 400 });

    const consulta = await omieCall('ConsultarPedido', { codigo_pedido: Number(codigo_pedido) }, { cacheMinutes: 0 });
    const pedido = consulta?.pedido_venda_produto;
    if (!pedido) return Response.json({ error: 'Pedido não encontrado no Omie' }, { status: 404 });

    // Detecção precisa de cancelamento
    const flagCancelado = pedido?.infoCadastro?.cancelado;
    const etapaAtual = String(pedido?.cabecalho?.etapa || '');
    if (flagCancelado === 'S' || etapaAtual === '99') {
      return Response.json({ error: 'Pedido cancelado: não é permitido editar ou ajustar.' }, { status: 400 });
    }

    // Regra: só pode devolver/ajustar pedidos nas etapas 10/20/50 (antes do faturamento).
    const ETAPAS_AJUSTAVEIS = ['10', '20', '50'];
    const ETAPA_NOMES_MAP = { '10': 'Pedido de Venda', '20': 'Liberados (Pendente)', '50': 'Faturar (Montagem)', '60': 'Faturado', '70': 'Entrega' };
    if (!ETAPAS_AJUSTAVEIS.includes(etapaAtual)) {
      const nome = ETAPA_NOMES_MAP[etapaAtual] || `Etapa ${etapaAtual}`;
      return Response.json({
        error: `Não é possível devolver/ajustar este pedido. Está na etapa "${nome}" (${etapaAtual}). Apenas pedidos Pendentes, Liberados ou em Montagem podem ser ajustados.`,
        etapa_atual: etapaAtual, etapa_nome: nome
      }, { status: 400 });
    }

    const produtosDevolver = produtos.map(p => ({
      nCodProd: Number(p.nCodProd || p.codigo_produto),
      nQtde: Number(p.quantidade)
    }));

    let erroOmie = null;
    let nIdDevolucao = null;
    try {
      const resp = await omieCall('DevolverPedido', {
        nCodPed: Number(codigo_pedido),
        produtos: produtosDevolver
      }, { cacheMinutes: 0 });
      // Captura nIdDevolucao retornado pelo Omie para rastreio
      nIdDevolucao = resp?.nIdDevolucao || resp?.nCodDevolucao || null;
    } catch (err) {
      erroOmie = err.message;
    }

    // Calcula valor total da devolução
    const valorTotal = produtos.reduce((s, p) => s + (Number(p.valor_unitario || 0) * Number(p.quantidade || 0)), 0);

    const registro = await base44.asServiceRole.entities.Retorno.create({
      pedido_codigo_omie: String(codigo_pedido),
      carga_id,
      data_retorno: new Date().toISOString().slice(0, 10),
      produtos: produtos.map(p => ({
        codigo_produto: String(p.nCodProd || p.codigo_produto),
        descricao: p.descricao || '',
        quantidade: Number(p.quantidade),
        valor_unitario: Number(p.valor_unitario || 0),
        valor_total: Number(p.valor_unitario || 0) * Number(p.quantidade),
        motivo: p.motivo || motivo_geral
      })),
      tipo_retorno,
      valor_total_retorno: valorTotal,
      motivo_geral,
      status: erroOmie ? 'pendente' : 'devolvido_omie',
      observacoes: nIdDevolucao ? `nIdDevolucao Omie: ${nIdDevolucao}` : null
    });

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'DevolverPedido',
      operacao: 'devolver_pedido',
      entidade_tipo: 'Pedido',
      entidade_id: String(codigo_pedido),
      status: erroOmie ? 'erro' : 'sucesso',
      mensagem_erro: erroOmie,
      usuario_email: user.email
    }).catch(() => {});

    if (erroOmie) return Response.json({ error: erroOmie, registro_id: registro.id }, { status: 500 });
    return Response.json({ sucesso: true, registro_id: registro.id, valor_total: valorTotal, nIdDevolucao });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});