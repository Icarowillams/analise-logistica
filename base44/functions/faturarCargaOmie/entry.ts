import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const APP_KEY = Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET');

async function omieCall(call, param, tentativa = 1) {
  const res = await fetch(OMIE_URL, {
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
      return omieCall(call, param, tentativa + 1);
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

    for (const p of pedidos) {
      // Pula pedidos D1 (cliente não emite NF)
      if (p.tipo_nota === 'D1') {
        resultados.push({ codigo_pedido: p.codigo_pedido, skip: true, motivo: 'cliente D1 - não emite NF' });
        continue;
      }

      try {
        // Move pedido para etapa 50 (Faturar). A emissão da NF-e no Omie é
        // feita automaticamente pelo scheduler interno assim que o pedido
        // está na etapa 50 sem pendências.
        await omieCall('TrocarEtapaPedido', {
          codigo_pedido: Number(p.codigo_pedido),
          etapa: String(etapa_destino)
        });
        resultados.push({
          codigo_pedido: p.codigo_pedido,
          sucesso: true,
          etapa_atual: String(etapa_destino),
          nf_emitida: false,
          numero_nf: null,
          mensagem: `Movido para etapa ${etapa_destino}. Aguardando emissão da NF no Omie…`
        });
      } catch (err) {
        resultados.push({
          codigo_pedido: p.codigo_pedido,
          sucesso: false,
          mensagem: err.message
        });
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    // Aguarda alguns segundos para o scheduler do Omie processar e consulta
    // o status real de cada pedido que foi movido com sucesso.
    const paraConsultar = resultados.filter(r => r.sucesso === true);
    if (paraConsultar.length > 0) {
      await new Promise(r => setTimeout(r, 8000));

      for (const r of paraConsultar) {
        try {
          const consulta = await omieCall('ConsultarPedido', {
            codigo_pedido: Number(r.codigo_pedido)
          });
          const cab = consulta?.pedido_venda_produto?.cabecalho || consulta?.cabecalho || {};
          const infoNf = consulta?.pedido_venda_produto?.informacoes_adicionais || consulta?.informacoes_adicionais || {};
          const totalNf = consulta?.pedido_venda_produto?.total_pedido || {};

          const numeroNf = cab.numero_nf || infoNf.numero_nf || totalNf.numero_nf || null;
          const etapaAtual = cab.etapa || null;
          const nfEmitida = !!numeroNf;

          r.etapa_atual = etapaAtual;
          r.numero_nf = numeroNf;
          r.nf_emitida = nfEmitida;
          r.mensagem = nfEmitida
            ? `NF ${numeroNf} emitida no Omie.`
            : `Pedido na etapa ${etapaAtual || '?'}. NF ainda não emitida — verifique pendências no Omie.`;
        } catch (err) {
          r.mensagem = `Movido, mas falha ao consultar status: ${err.message}`;
        }
        await new Promise(r2 => setTimeout(r2, 800));
      }
    }

    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => r.sucesso === false).length;
    const skips = resultados.filter(r => r.skip).length;
    const nfsEmitidas = resultados.filter(r => r.nf_emitida).length;
    const aguardandoNf = resultados.filter(r => r.sucesso === true && !r.nf_emitida).length;

    await base44.asServiceRole.entities.Carga.update(carga_id, {
      status_carga: erros > 0 ? 'conferindo' : 'faturada',
      data_faturamento: new Date().toISOString()
    });

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