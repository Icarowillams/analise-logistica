import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/nfconsultar/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function omieCall(call, param, tentativa = 1) {
  const res = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  if (res.status === 425) return { faultstring: 'API Omie bloqueada (425)', faultcode: 'BLOQUEIO_425' };
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    const isRate = msg.includes('cota') || msg.includes('aguarde') || res.status === 429;
    if (isRate && tentativa < 3) {
      await sleep(2500 * tentativa);
      return omieCall(call, param, tentativa + 1);
    }
  }
  return data;
}

// Deriva status SEFAZ da NF do Omie (mesma lógica do listarNfsOmie)
function derivarStatus(nf) {
  const ide = nf.ide || {};
  const compl = nf.compl || {};
  const nfStatus = nf.nfStatus || {};
  const cStat = String(nfStatus.cStat || compl.cStat || '').trim();
  if (cStat) {
    if (cStat === '101') return 'cancelada';
    if (cStat === '102') return 'inutilizada';
    if (cStat === '110' || cStat === '301' || cStat === '302') return 'denegada';
    if (cStat === '100' || cStat === '135') return 'autorizada';
    return 'rejeitada';
  }
  if (ide.dCan && String(ide.dCan).trim()) return 'cancelada';
  if (ide.cDeneg === 'S' || ide.cDeneg === 'D') return 'denegada';
  if (ide.dInut && String(ide.dInut).trim()) return 'inutilizada';
  return 'pendente';
}

/**
 * Detecta NFs que estavam "autorizada" no Base44 mas que foram CANCELADAS/DENEGADAS no Omie
 * depois (sem webhook chegando). Atualiza Pedido local + LogEmissaoNF.
 *
 * Estratégia: varre os últimos N dias de NFs no Omie, e para cada que retornar cancelada/denegada,
 * atualiza o Pedido local (status=cancelado) e o LogEmissaoNF correspondente.
 */
Deno.serve(async (req) => {
  try {
    if (!APP_KEY || !APP_SECRET) {
      return Response.json({ sucesso: false, erro: 'Credenciais Omie não configuradas' }, { status: 500 });
    }
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') {
      return Response.json({ error: 'Apenas admin' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const dias = Math.min(Math.max(Number(body.dias) || 7, 1), 30);

    // Janela: últimos N dias até hoje
    const hoje = new Date();
    const inicio = new Date(hoje.getTime() - dias * 24 * 60 * 60 * 1000);
    const fmt = (d) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Recife' });

    const param = {
      pagina: 1,
      registros_por_pagina: 100,
      dEmiInicial: fmt(inicio),
      dEmiFinal: fmt(hoje)
    };

    let pagina = 1;
    let totalPaginas = 1;
    const canceladas = [];

    do {
      const data = await omieCall('ListarNF', { ...param, pagina });
      if (data?.faultstring) {
        return Response.json({ sucesso: false, erro: data.faultstring }, { status: 500 });
      }
      totalPaginas = data.nTotPaginas || data.total_de_paginas || 1;
      const nfs = data.nfCadastro || [];
      for (const nf of nfs) {
        const status = derivarStatus(nf);
        if (status === 'cancelada' || status === 'denegada' || status === 'inutilizada') {
          canceladas.push({
            status,
            codigo_pedido: String(nf.compl?.nIdPedido || nf.nIdPedido || ''),
            numero_nf: String(nf.ide?.nNF || nf.cNumero || ''),
            chave_nfe: String(nf.compl?.cChaveNFe || nf.cChaveNFe || '')
          });
        }
      }
      pagina++;
      await sleep(400);
    } while (pagina <= totalPaginas);

    // Reconciliar cada NF cancelada → atualizar Pedido + LogEmissaoNF
    let pedidosAtualizados = 0;
    let logsAtualizados = 0;
    const motivos = { cancelada: 'NF-e cancelada no Omie', denegada: 'NF-e denegada pela SEFAZ', inutilizada: 'NF-e inutilizada no Omie' };

    for (const nfc of canceladas) {
      if (!nfc.codigo_pedido) continue;

      // 1. Atualizar Pedido local
      try {
        const pedidos = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: nfc.codigo_pedido });
        if (pedidos?.length > 0 && pedidos[0].status !== 'cancelado') {
          await base44.asServiceRole.entities.Pedido.update(pedidos[0].id, {
            status: 'cancelado',
            data_cancelamento: new Date().toISOString(),
            motivo_cancelamento: motivos[nfc.status]
          });
          pedidosAtualizados++;
        }
      } catch (e) {
        console.error(`[reconciliarNfsCanceladasOmie] Falha update Pedido ${nfc.codigo_pedido}:`, e.message);
      }

      // 2. Atualizar LogEmissaoNF (se estava como autorizada)
      try {
        const logs = await base44.asServiceRole.entities.LogEmissaoNF.filter({
          codigo_pedido: nfc.codigo_pedido,
          status: 'autorizada'
        });
        for (const log of logs || []) {
          await base44.asServiceRole.entities.LogEmissaoNF.update(log.id, {
            status: 'rejeitada', // enum não tem 'cancelada' — usar 'rejeitada' com mensagem clara
            mensagem: `[Reconciliação] NF ${nfc.numero_nf} foi ${nfc.status} no Omie após emissão`
          });
          logsAtualizados++;
        }
      } catch (e) {
        console.error(`[reconciliarNfsCanceladasOmie] Falha update LogEmissaoNF ${nfc.codigo_pedido}:`, e.message);
      }
    }

    return Response.json({
      sucesso: true,
      periodo_dias: dias,
      total_nfs_canceladas_no_omie: canceladas.length,
      pedidos_atualizados: pedidosAtualizados,
      logs_atualizados: logsAtualizados
    });
  } catch (error) {
    console.error('[reconciliarNfsCanceladasOmie] Erro:', error.message);
    return Response.json({ sucesso: false, erro: error.message }, { status: 500 });
  }
});