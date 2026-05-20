import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const OMIE_FAT_URL = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

async function omieCall(call, param, tentativa = 1, url = OMIE_URL) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  const data = await res.json();
  // Erro no formato faultstring
  if (data.faultstring) {
    const msg = data.faultstring.toLowerCase();
    const isRate = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || res.status === 429;
    if (isRate && tentativa < 4) {
      await new Promise(r => setTimeout(r, 3000 * tentativa));
      return omieCall(call, param, tentativa + 1, url);
    }
    throw new Error(data.faultstring);
  }
  // Erro no formato {status:"error", message:"..."}
  if (data.status === 'error' || (res.status >= 400 && data.message)) {
    throw new Error(data.message || 'Erro desconhecido no Omie');
  }
  return data;
}

// Fatura uma carga: muda etapa de cada pedido da etapa atual → etapa destino (default 60 = faturar)
// bloqueia tipo_nota='D1' (venda interna sem NF)
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
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
      status: erros > 0 ? 'warning' : 'sucesso',
      mensagem_erro: erros > 0 ? `${erros} pedidos falharam: ${errosDetalhados}`.substring(0, 2000) : null,
      payload_resposta: JSON.stringify(resultados).substring(0, 2000),
      usuario_email: user.email
    }).catch(() => {});

    // NOTA: Geração de NF-e e boletos foi movida para a tela "Notas Omie → Emissão"
    // (manual, individual ou em lote). Esta função NÃO emite NF nem boleto.
    return Response.json({
      sucesso: true,
      total: pedidos.length,
      sucessos,
      erros,
      skips,
      nfs_emitidas: nfsEmitidas,
      aguardando_nf: aguardandoNf,
      resultados
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});