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

    for (const p of pedidos) {
      // Pula pedidos D1 (cliente não emite NF)
      if (p.tipo_nota === 'D1') {
        resultados.push({ codigo_pedido: p.codigo_pedido, skip: true, motivo: 'cliente D1 - não emite NF' });
        continue;
      }

      try {
        // 1) Move pedido para etapa 50 (Faturar)
        await omieCall('TrocarEtapaPedido', {
          codigo_pedido: Number(p.codigo_pedido),
          etapa: String(etapa_destino)
        });

        // 2) Dispara a emissão da NF-e via FaturarPedidoVenda (endpoint pedidovendafat)
        // Sem esse passo o pedido fica parado em 50 esperando o scheduler interno do Omie.
        let faturamentoErro = null;
        try {
          await omieCall('FaturarPedidoVenda', {
            nCodPed: Number(p.codigo_pedido)
          }, 1, OMIE_FAT_URL);
        } catch (fatErr) {
          faturamentoErro = fatErr.message;
        }

        resultados.push({
          codigo_pedido: p.codigo_pedido,
          sucesso: !faturamentoErro,
          etapa_atual: String(etapa_destino),
          nf_emitida: false,
          numero_nf: null,
          mensagem: faturamentoErro
            ? `Movido para etapa ${etapa_destino}, mas Omie rejeitou faturamento: ${faturamentoErro}`
            : `Movido para etapa ${etapa_destino} e faturamento solicitado. Aguardando SEFAZ…`
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

          if (nfEmitida) {
            r.mensagem = `NF ${numeroNf} emitida no Omie.`;
          } else if (String(etapaAtual) === '60') {
            // Etapa 60 significa que o faturamento foi aceito/processado no Omie.
            // A NF pode aparecer alguns minutos depois; isso NÃO é erro da carga.
            r.sucesso = true;
            r.mensagem = 'Pedido faturado no Omie (etapa 60). NF ainda aguardando processamento/retorno da SEFAZ.';
          } else {
            // Só trata como erro quando o pedido NÃO chegou na etapa de faturado.
            let motivoOmie = null;
            try {
              const status = await omieCall('StatusPedido', {
                codigo_pedido: Number(r.codigo_pedido)
              });
              const pendencias = status?.pendencias || status?.lista_pendencias || [];
              const pendenciasArr = Array.isArray(pendencias) ? pendencias : (pendencias?.pendencia || []);
              if (pendenciasArr.length > 0) {
                motivoOmie = pendenciasArr
                  .map(p => p.cDescricao || p.descricao || p.cMensagem || p.mensagem)
                  .filter(Boolean)
                  .join(' | ');
              }
              if (!motivoOmie && status?.cDescStatus) {
                motivoOmie = status.cDescStatus;
              }
            } catch (statusErr) {
              motivoOmie = `Falha ao consultar status: ${statusErr.message}`;
            }

            r.motivo_omie = motivoOmie;
            r.sucesso = false;
            r.mensagem = motivoOmie
              ? `NF NÃO emitida — Omie: ${motivoOmie}`
              : `Pedido na etapa ${etapaAtual || '?'}. NF ainda não emitida — verifique pendências no Omie.`;
          }
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

    // STATUS DINÂMICO baseado no resultado real de cada pedido — NUNCA assumir 'faturada' às cegas.
    // Regras:
    // - Se todos pedidos foram skip (ex: todos D1) → mantém status atual (não faturou nada de fato)
    // - Se todos os processados emitiram NF → 'faturada'
    // - Se houver pedidos na etapa 60 mas sem NF ainda → 'pronta' (aguardando SEFAZ)
    // - Se houver erros → 'conferindo'
    const processados = resultados.length - skips;
    let novoStatus = carga.status_carga;
    let novaDataFat = carga.data_faturamento;

    if (processados === 0) {
      // Só havia D1 — nada foi enviado ao Omie, mantém status atual
      novoStatus = carga.status_carga;
    } else if (erros > 0) {
      novoStatus = 'conferindo';
    } else if (nfsEmitidas === processados) {
      novoStatus = 'faturada';
      novaDataFat = new Date().toISOString();
    } else if (sucessos === processados) {
      // Todos foram aceitos (etapa 60) mas NF ainda processando — fica 'pronta' até webhook NFe.NotaAutorizada
      novoStatus = 'pronta';
    } else {
      novoStatus = 'conferindo';
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

    // Atualiza também a entidade Pedido local (se houver match por omie_codigo_pedido)
    for (const r of resultados) {
      if (!r.numero_nf || !r.codigo_pedido) continue;
      try {
        const pedidosLocais = await base44.asServiceRole.entities.Pedido.filter({
          omie_codigo_pedido: String(r.codigo_pedido)
        });
        for (const pl of pedidosLocais) {
          await base44.asServiceRole.entities.Pedido.update(pl.id, {
            numero_nota_fiscal: String(r.numero_nf),
            faturado: true,
            data_faturamento: new Date().toISOString(),
            status: 'faturado'
          });
        }
      } catch { /* não bloqueia o fluxo */ }
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