import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const OMIE_NF_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

async function omieCall(call, param, tentativa = 1, url = OMIE_URL) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });

  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring || '').toLowerCase();
    const code = String(data.faultcode || '');
    const retry = res.status === 429 || code.includes('425') || code.includes('520') || msg.includes('cota') || msg.includes('aguarde') || msg.includes('limite') || msg.includes('timeout') || msg.includes('indispon');
    if (retry && tentativa < 4) {
      await new Promise(r => setTimeout(r, 2000 * tentativa));
      return omieCall(call, param, tentativa + 1, url);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

// Busca o número da NF emitida para um pedido específico via ListarNF (filtra por nIdPedido).
// Usado como fallback quando ConsultarPedido não retorna numero_nf (caso comum no Omie).
async function buscarNumeroNfPorPedido(codigoPedido) {
  try {
    const data = await omieCall('ListarNF', {
      pagina: 1,
      registros_por_pagina: 50,
      nIdPedido: Number(codigoPedido)
    }, 1, OMIE_NF_URL);
    const nfs = data?.nfCadastro || [];
    // Primeira NF não cancelada
    const ativa = nfs.find(nf => String(nf.ide?.cStat || '').toUpperCase() !== 'CANCELADA') || nfs[0];
    if (!ativa) return null;
    return {
      numero_nf: String(ativa.ide?.nNF || ativa.cNumero || ''),
      serie: ativa.ide?.serie || '',
      chave: ativa.compl?.cChaveNFe || '',
      status: ativa.ide?.cStat || ''
    };
  } catch {
    return null;
  }
}

function extrairPedido(consulta, pedidoOriginal) {
  const pedido = consulta?.pedido_venda_produto || consulta || {};
  const cab = pedido.cabecalho || {};
  const info = pedido.informacoes_adicionais || {};
  const etapa = String(cab.etapa || pedidoOriginal.etapa || '');
  const numeroNf = cab.numero_nf || cab.numero_nota_fiscal || info.numero_nf || info.numero_nota_fiscal || pedidoOriginal.numero_nf || '';

  // Cancelamento real do Omie vem em cab.cancelado === 'S' ou info.cancelada === 'S'.
  // NUNCA inferir cancelamento por busca textual no JSON — palavras como "cancelar_pedido"
  // aparecem em campos de configuração e davam falso-positivo.
  const cancelado =
    String(cab.cancelado || '').toUpperCase() === 'S' ||
    String(info.cancelada || '').toUpperCase() === 'S' ||
    String(cab.status_pedido || cab.status || '').toLowerCase().includes('cancel');

  return {
    etapa,
    status_pedido: cab.status_pedido || cab.status || pedidoOriginal.status_pedido || '',
    numero_nf: numeroNf,
    faturado: etapa === '60' || !!numeroNf,
    cancelado
  };
}

function erroPedidoExcluido(mensagem) {
  const texto = String(mensagem || '').toLowerCase();
  return texto.includes('não existem registros') || texto.includes('nao existem registros') || texto.includes('não encontrado') || texto.includes('nao encontrado') || texto.includes('não cadastrado') || texto.includes('nao cadastrado') || texto.includes('excluído') || texto.includes('excluido') || texto.includes('inexistente');
}

// Status simplificado: apenas montagem / faturada / cancelada.
// - Todos cancelados/excluídos no Omie → cancelada
// - Carga foi faturada pelo sistema (data_faturamento preenchida) E todos pedidos em etapa 60 → faturada
// - Caso contrário → mantém status atual (em geral montagem)
function definirStatusCarga(pedidosStatus, statusAtual, cargaFoiFaturadaPeloSistema) {
  if (pedidosStatus.length === 0) return statusAtual || 'montagem';
  if (pedidosStatus.every(p => p.cancelado || p.excluido)) return 'cancelada';

  if (cargaFoiFaturadaPeloSistema) {
    // Considera "pronta no Omie" qualquer pedido em etapa 60 ou já com NF emitida
    const ativos = pedidosStatus.filter(p => !p.excluido && !p.cancelado);
    if (ativos.length > 0 && ativos.every(p => p.etapa === '60' || p.faturado)) {
      return 'faturada';
    }
  }

  return statusAtual || 'montagem';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const listLimit = Math.min(Number(body.list_limit || 500), 500);
    const syncLimit = Math.min(Number(body.sync_limit || 50), listLimit);

    const cargas = await base44.asServiceRole.entities.Carga.list('-created_date', listLimit);
    const cargasAtualizadas = [];

    for (const carga of cargas.slice(0, syncLimit)) {
      const pedidos = Array.isArray(carga.pedidos_omie) ? carga.pedidos_omie : [];
      if (pedidos.length === 0) {
        cargasAtualizadas.push(carga);
        continue;
      }

      const pedidosStatus = [];
      const pedidosAtualizados = [];

      for (const pedido of pedidos) {
        const codigo = pedido.codigo_pedido || pedido.codigo_pedido_integracao;
        if (!codigo) {
          pedidosAtualizados.push(pedido);
          continue;
        }

        try {
          const consulta = await omieCall('ConsultarPedido', { codigo_pedido: Number(codigo) });
          const status = extrairPedido(consulta, pedido);

          // Fallback: se o pedido foi faturado (etapa 60) mas o ConsultarPedido não retornou
          // numero_nf, busca diretamente no endpoint de NFs do Omie.
          let numeroNfFinal = status.numero_nf || pedido.numero_nf;
          if (!numeroNfFinal && (status.etapa === '60' || status.faturado)) {
            const nfInfo = await buscarNumeroNfPorPedido(codigo);
            if (nfInfo?.numero_nf) numeroNfFinal = nfInfo.numero_nf;
            await new Promise(r => setTimeout(r, 250));
          }

          pedidosStatus.push({ ...status, numero_nf: numeroNfFinal });
          pedidosAtualizados.push({
            ...pedido,
            etapa: status.etapa || pedido.etapa,
            status_pedido: status.status_pedido || pedido.status_pedido,
            numero_nf: numeroNfFinal
          });
        } catch (error) {
          if (erroPedidoExcluido(error.message)) {
            pedidosStatus.push({ excluido: true, cancelado: true, faturado: false, etapa: 'excluido' });
            pedidosAtualizados.push({
              ...pedido,
              etapa: 'excluido',
              status_pedido: 'excluido_no_omie',
              status_real_omie: 'Pedido excluído/inexistente no Omie'
            });
          } else {
            pedidosAtualizados.push(pedido);
          }
        }

        await new Promise(r => setTimeout(r, 250));
      }

      const novoStatus = definirStatusCarga(pedidosStatus, carga.status_carga, !!carga.data_faturamento);
      const precisaAtualizar = novoStatus !== carga.status_carga || JSON.stringify(pedidosAtualizados) !== JSON.stringify(pedidos);

      // Consolida notas_fiscais[] APENAS com números reais de NF retornados pelo Omie
      // (não mescla com valores antigos para evitar lixo persistido erroneamente).
      const notasFiscaisAtualizadas = Array.from(new Set(
        pedidosAtualizados.map(p => p.numero_nf).filter(Boolean).map(String)
      ));
      const notasMudaram = JSON.stringify(notasFiscaisAtualizadas) !== JSON.stringify(carga.notas_fiscais || []);

      if (precisaAtualizar || notasMudaram) {
        await base44.asServiceRole.entities.Carga.update(carga.id, {
          status_carga: novoStatus,
          pedidos_omie: pedidosAtualizados,
          notas_fiscais: notasFiscaisAtualizadas,
          data_faturamento: novoStatus === 'faturada' ? (carga.data_faturamento || new Date().toISOString()) : carga.data_faturamento
        });

        // Reflete o numero_nf nos Pedidos locais correspondentes
        for (const p of pedidosAtualizados) {
          if (!p.numero_nf || !p.codigo_pedido) continue;
          try {
            const pedidosLocais = await base44.asServiceRole.entities.Pedido.filter({
              omie_codigo_pedido: String(p.codigo_pedido)
            });
            for (const pl of pedidosLocais) {
              if (pl.numero_nota_fiscal !== String(p.numero_nf)) {
                await base44.asServiceRole.entities.Pedido.update(pl.id, {
                  numero_nota_fiscal: String(p.numero_nf),
                  faturado: true,
                  data_faturamento: pl.data_faturamento || new Date().toISOString(),
                  status: 'faturado'
                });
              }
            }
          } catch { /* não bloqueia */ }
        }

        cargasAtualizadas.push({ ...carga, status_carga: novoStatus, pedidos_omie: pedidosAtualizados, notas_fiscais: notasFiscaisAtualizadas });
      } else {
        cargasAtualizadas.push(carga);
      }
    }

    const resto = cargas.slice(syncLimit);

    return Response.json({
      sucesso: true,
      cargas: [...cargasAtualizadas, ...resto],
      sincronizadas: cargasAtualizadas.length
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});