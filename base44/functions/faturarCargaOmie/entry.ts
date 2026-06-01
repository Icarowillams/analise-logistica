import { createClientFromRequest } from 'npm:@base44/sdk@0.8.30';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const OMIE_FAT_URL = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');
let base44Global = null;

async function omieCall(call, param, opts = {}, url = OMIE_URL) {
  const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3 } : opts;
  const chave = `${url}|${call}|${JSON.stringify(param || {})}`;
  const cb = await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) throw new Error(`API Omie bloqueada temporariamente. Tente novamente em ${controle.bloqueado_ate}`);
  let lastError = '';
  for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] }) });
    const data = await res.json();
    if (data.faultstring || data.faultcode || data.status === 'error' || (res.status >= 400 && data.message)) {
      const erro = data.faultstring || data.message || 'Erro Omie';
      const msg = String(erro).toLowerCase();
      if (res.status === 425 || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde')) {
        const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: erro, atualizado_em: new Date().toISOString() };
        if (controle?.id) await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {}); else await base44Global.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
        throw new Error(erro);
      }
      if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('timeout') || msg.includes('indispon')) { lastError = erro; await new Promise(r => setTimeout(r, 2500 * tentativa)); continue; } // DELAY_PADRAO_RETRY
      throw new Error(erro);
    }
    if (logIntegration) await base44Global.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: call, status: 'sucesso', payload_enviado: JSON.stringify(param || {}).slice(-500), payload_resposta: JSON.stringify(data || {}).slice(-500) }).catch(() => {});
    return data;
  }
  throw new Error(lastError || 'Máximo de tentativas Omie excedido');
}

// Fatura uma carga: muda etapa de cada pedido da etapa atual → etapa destino (default 60 = faturar)
// bloqueia tipo_nota='D1' (venda interna sem NF)
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    base44Global = base44;
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { carga_id, etapa_destino = '50' } = body;
    if (!carga_id) return Response.json({ error: 'carga_id obrigatório' }, { status: 400 });

    let carga;
    try {
      carga = await base44.asServiceRole.entities.Carga.get(carga_id);
    } catch (e) {
      if (/not found/i.test(e.message)) {
        return Response.json({ error: 'Carga não encontrada' }, { status: 404 });
      }
      throw e;
    }
    if (!carga) return Response.json({ error: 'Carga não encontrada' }, { status: 404 });

    const pedidos = carga.pedidos_omie || [];
    const resultados = [];

    // ATENÇÃO: Esta função NÃO altera etapa no Omie e NÃO emite NF.
    // Ela apenas marca a carga/pedidos como faturados localmente para liberar a tela "Notas Omie → Emissão".
    for (const p of pedidos) {
      if (p.tipo_nota === 'D1') {
        resultados.push({ codigo_pedido: p.codigo_pedido, skip: true, motivo: 'cliente D1 - não emite NF' });
        continue;
      }

      resultados.push({
        codigo_pedido: p.codigo_pedido,
        sucesso: true,
        etapa_atual: p.etapa || null,
        nf_emitida: false,
        numero_nf: null,
        mensagem: 'Carga faturada localmente. Use "Notas Omie → Emissão" para gerar a NF-e no Omie.'
      });
    }

    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => r.sucesso === false).length;
    const skips = resultados.filter(r => r.skip).length;
    const nfsEmitidas = 0;
    const aguardandoNf = sucessos;

    // Status local: faturar carga apenas libera a carga para a tela de Emissão NF-e.
    const processados = resultados.length - skips;
    let novoStatus = carga.status_carga;
    let novaDataFat = carga.data_faturamento;

    if (resultados.length > 0 && (processados === 0 || sucessos === processados)) {
      novoStatus = 'faturada';
      novaDataFat = new Date().toISOString();
    } else {
      novoStatus = 'montagem';
    }

    // Persistir números de NF retornados nos pedidos_omie da carga + montar notas_fiscais[]
    // Sem isso o Romaneio, Boletos e impressão das NFs ficam sem número.
    const mapaNfPorPedido = new Map();
    for (const r of resultados) {
      if (r.numero_nf) mapaNfPorPedido.set(String(r.codigo_pedido), String(r.numero_nf));
    }
    const pedidosOmieAtualizados = (carga.pedidos_omie || []).map(p => {
      const nfNova = mapaNfPorPedido.get(String(p.codigo_pedido));
      if (nfNova) {
        return { ...p, numero_nf: nfNova };
      }
      return p;
    });
    // notas_fiscais[] apenas com valores reais (sem mesclar com lixo anterior)
    const notasFiscaisAtualizadas = Array.from(new Set(
      pedidosOmieAtualizados.map(p => p.numero_nf).filter(Boolean).map(String)
    ));

    await base44.asServiceRole.entities.Carga.update(carga_id, {
      status_carga: novoStatus,
      data_faturamento: novaDataFat,
      pedidos_omie: pedidosOmieAtualizados,
      notas_fiscais: notasFiscaisAtualizadas
    });

    // Atualiza a entidade Pedido local — marca como faturado (mesmo sem NF emitida,
    // pois "faturar carga" agora só move para etapa 50). A NF será gerada depois.
    for (const r of resultados) {
      if (!r.sucesso || !r.codigo_pedido) continue;
      try {
        const pedidosLocais = await base44.asServiceRole.entities.Pedido.filter({
          omie_codigo_pedido: String(r.codigo_pedido)
        });
        for (const pl of pedidosLocais) {
          await base44.asServiceRole.entities.Pedido.update(pl.id, {
            faturado: true,
            data_faturamento: new Date().toISOString(),
            status: 'faturado'
          });
        }
      } catch { /* não bloqueia o fluxo */ }
    }

    // Pedidos internos (D1 / Troca / Bonificação) também viram "faturado" quando a carga é faturada.
    // Eles não passam por NF no Omie, mas para fins gerenciais (Gerenciar Pedidos) precisam refletir o status.
    if (novoStatus === 'faturada') {
      const internosCarga = carga.pedidos_internos || [];
      const trocasCarga = carga.pedidos_troca || [];
      const idsInternos = [
        ...internosCarga.map(p => p.pedido_id).filter(Boolean),
        ...trocasCarga.map(t => t.pedido_id).filter(Boolean)
      ];
      for (const pedidoId of idsInternos) {
        try {
          await base44.asServiceRole.entities.Pedido.update(pedidoId, {
            faturado: true,
            data_faturamento: new Date().toISOString(),
            status: 'faturado'
          });
        } catch { /* não bloqueia o fluxo */ }
      }
      // Trocas via entidade PedidoTroca também: buscar pedido local com mesmo numero_pedido e tipo='troca'
      for (const t of trocasCarga) {
        if (t.pedido_id) continue;
        if (!t.numero_pedido) continue;
        try {
          const matches = await base44.asServiceRole.entities.Pedido.filter({
            numero_pedido: t.numero_pedido,
            tipo: 'troca'
          });
          for (const pl of matches) {
            await base44.asServiceRole.entities.Pedido.update(pl.id, {
              faturado: true,
              data_faturamento: new Date().toISOString(),
              status: 'faturado'
            });
          }
        } catch { /* não bloqueia o fluxo */ }
      }
    }

    const errosDetalhados = resultados
      .filter(r => r.sucesso === false)
      .map(r => `Pedido ${r.codigo_pedido}: ${r.mensagem}`)
      .join(' | ');

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'AlterarPedidoVenda',
      operacao: 'faturar_carga',
      entidade_tipo: 'Carga',
      entidade_id: carga_id,
      status: erros > 0 ? 'erro_omie' : 'sucesso',
      mensagem_erro: erros > 0 ? `${erros} pedidos falharam: ${errosDetalhados}`.substring(0, 2000) : null,
      erro_detalhado: erros > 0 ? errosDetalhados.substring(0, 2000) : null,
      payload_resposta: JSON.stringify(resultados).substring(0, 2000),
      usuario_email: user.email
    }).catch(() => {});

    const codigosParaEmitir = [];
    const errosDuplicidade = [];
    for (const p of pedidos.filter(p => p.tipo_nota !== 'D1' && p.codigo_pedido && !p.numero_nf)) {
      const codigo = String(p.codigo_pedido);
      const locais = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigo }, '-updated_date', 1).catch(() => []);
      const local = locais?.[0];
      const logsNF = await base44.asServiceRole.entities.LogEmissaoNF.filter({ codigo_pedido: codigo, status: 'autorizada' }, '-created_date', 1).catch(() => []);
      if (local?.numero_nota_fiscal || local?.status_faturamento === 'faturado' || local?.faturado === true || logsNF?.[0]) {
        errosDuplicidade.push({ codigo_pedido: codigo, mensagem: `Pedido #${local?.numero_pedido || p.numero_pedido || codigo} já foi faturado em ${new Date(local?.data_faturamento || logsNF?.[0]?.created_date || new Date()).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })}. NF: ${local?.numero_nota_fiscal || logsNF?.[0]?.numero_nf || '-'}` });
        continue;
      }
      codigosParaEmitir.push(codigo);
    }

    let filaEmissao = null;
    if (codigosParaEmitir.length > 0) {
      const loteId = `LOTE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      filaEmissao = await base44.asServiceRole.entities.FilaEmissaoNF.create({
        tipo: 'emissao_nf_lote',
        lote_id: loteId,
        carga_id,
        numero_carga: carga.numero_carga || '',
        total_pedidos: codigosParaEmitir.length,
        processados: 0,
        status: 'processando',
        pedidos: codigosParaEmitir,
        resultados: [],
        erros: errosDuplicidade,
        mensagem: 'Faturamento iniciado em background. Acompanhe o progresso na tela.',
        usuario_email: user.email,
        iniciado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString()
      });
    }

    return Response.json({
      sucesso: true,
      total: pedidos.length,
      sucessos,
      erros,
      skips,
      nfs_emitidas: nfsEmitidas,
      aguardando_nf: aguardandoNf,
      fila_id: filaEmissao?.id || null,
      lote_id: filaEmissao?.lote_id || null,
      assincrono: !!filaEmissao,
      mensagem: filaEmissao ? 'Faturamento iniciado em background. Acompanhe o progresso na tela.' : 'Carga faturada localmente. Não havia NF-e para emitir em background.',
      ignorados_duplicidade: errosDuplicidade?.length || 0,
      erros_duplicidade: errosDuplicidade || [],
      resultados
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});