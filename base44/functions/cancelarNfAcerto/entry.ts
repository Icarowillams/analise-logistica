import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ENDPOINTS (doc oficial Omie):
// - /produtos/pedido/        → ConsultarPedido     (param: { codigo_pedido })
// - /produtos/nfconsultar/   → ListarNF            (param: { pagina, registros_por_pagina, ordenar_por, dEmiInicial, dEmiFinal, cCPFCNPJDest })
// - /produtos/pedidovendafat/→ CancelarPedidoVenda (param: { nCodPed })
//
// RETORNO ListarNF → array nfCadastro, onde cada item tem:
//   ide.nNF              → número da NF
//   ide.dCan             → data de cancelamento (se preenchido = cancelada)
//   nfDestInt.cnpj_cpf   → CNPJ/CPF do destinatário
//   total.ICMSTot.vNF    → valor total da NF

const APP_KEY = Deno.env.get('OMIE_APP_KEY') || Deno.env.get('OMIE_API_KEY');
const APP_SECRET = Deno.env.get('OMIE_APP_SECRET') || Deno.env.get('OMIE_API_SECRET');

function pad2(n) { return String(n).padStart(2, '0'); }
function dataBR(d) { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; }

async function getOmieCredentials(base44: any) {
  try {
    const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
    if (rows.length > 0) return { appKey: rows[0].app_key, appSecret: rows[0].app_secret };
  } catch (_) { /* ignore */ }
  const appKey = Deno.env.get('OMIE_APP_KEY') || '';
  const appSecret = Deno.env.get('OMIE_APP_SECRET') || '';
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  if (rows.length > 0 && rows[0].bloqueado) {
    const ate = new Date(rows[0].bloqueado_ate || 0);
    if (ate > new Date()) throw new Error(`Circuit breaker ativo até ${ate.toISOString()}`);
  }
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  await checkCircuitBreaker(base44);
  const { appKey, appSecret } = await getOmieCredentials(base44);
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas');
  const call = options.call || endpoint;
  const url = `https://app.omie.com.br/api/v1/${endpoint}`;
  const body = JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] });
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Omie ${call} HTTP ${resp.status}: ${text}`);
  }
  return resp.json();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { codigo_pedido, motivo = 'Cancelado no acerto de caixa' } = await req.json().catch(() => ({}));
    if (!codigo_pedido) return Response.json({ error: 'codigo_pedido obrigatório' }, { status: 400 });

    // ───────────────────────────────────────────────────────────
    // 1) ConsultarPedido — pega CNPJ do cliente e valor total
    //    (doc: /produtos/pedido/ ConsultarPedido { codigo_pedido })
    // ───────────────────────────────────────────────────────────
    const consulta = await omieCall(base44, 'produtos/pedido/', { codigo_pedido: Number(codigo_pedido) }, { call: 'ConsultarPedido' });
    if (consulta.faultstring) {
      const fs = consulta.faultstring.toLowerCase();
      if (fs.includes('cancelad') || fs.includes('excluíd') || fs.includes('excluid') || fs.includes('não encontrad') || fs.includes('nao encontrad')) {
        return Response.json({ sucesso: true, ja_cancelada: true, mensagem: 'Pedido já cancelado/excluído no Omie' });
      }
      return Response.json({ error: consulta.faultstring }, { status: 400 });
    }
    const ped = consulta.pedido_venda_produto;
    if (!ped) return Response.json({ error: 'Pedido não retornado pelo Omie' }, { status: 400 });

    const codigoCliente = Number(ped?.cabecalho?.codigo_cliente || 0);
    const valorPedido = Number(ped?.total_pedido?.valor_total_pedido || 0);
    const dataPrev = ped?.cabecalho?.data_previsao || '';

    // ───────────────────────────────────────────────────────────
    // 2) ListarNF — procura NF pelo nCodCli + valor, últimos 2 meses
    //    Match composto: nfDestInt.nCodCli == codigoCliente E |vNF - valor| < 0.05
    //    Ignora NF de entrada (tpNF != "1")
    // ───────────────────────────────────────────────────────────
    let numeroNf = '';
    let nfJaCancelada = false;

    if (codigoCliente) {
      const hoje = new Date();
      const ini = new Date(); ini.setMonth(ini.getMonth() - 2);

      const param = {
        pagina: 1,
        registros_por_pagina: 100,
        ordenar_por: 'CODIGO',
        ordem_decrescente: 'S',
        filtrar_por_data_de: dataBR(ini),
        filtrar_por_data_ate: dataBR(hoje)
      };

      for (let pagina = 1; pagina <= 5; pagina++) {
        param.pagina = pagina;
        const resp = await omieCall(base44, 'produtos/nfconsultar/', param, { call: 'ListarNF' });
        const lista = resp?.nfCadastro || [];
        if (lista.length === 0) break;

        const match = lista.find(nf => {
          // Ignora NF de entrada
          const tpNF = String(nf?.ide?.tpNF ?? '');
          if (tpNF && tpNF !== '1') return false;
          const nCodCli = Number(nf?.nfDestInt?.nCodCli || 0);
          if (nCodCli !== codigoCliente) return false;
          const vNF = Number(nf?.total?.ICMSTot?.vNF || 0);
          return Math.abs(vNF - valorPedido) < 0.05;
        });

        if (match) {
          numeroNf = match?.ide?.nNF || '';
          if (match?.ide?.dCan) nfJaCancelada = true;
          break;
        }

        const totalPag = Number(resp?.nTotPaginas || resp?.total_de_paginas || 1);
        if (pagina >= totalPag) break;
      }
    }

    if (nfJaCancelada) {
      // NF já cancelada no Omie → só atualiza local e retorna
      await atualizarPedidoLocal(base44, codigo_pedido, motivo, user);
      return Response.json({ sucesso: true, ja_cancelada: true, numero_nf: numeroNf, mensagem: 'NF já estava cancelada no Omie' });
    }

    // ═══ REGRA FISCAL: NF-e só pode ser cancelada em até 24h após emissão ═══
    if (numeroNf) {
      const dFat = ped?.informacoes_adicionais?.dFat || dataPrev;
      if (dFat) {
        const dtFat = new Date(dFat);
        if (!isNaN(dtFat.getTime())) {
          const horasDesdeEmissao = (Date.now() - dtFat.getTime()) / (1000 * 60 * 60);
          if (horasDesdeEmissao > 24) {
            return Response.json({
              error: `NF-e ${numeroNf} foi emitida há ${Math.floor(horasDesdeEmissao)}h. O prazo máximo para cancelamento é de 24 horas. Após esse prazo, é necessário emitir uma NF-e de devolução/estorno.`,
              prazo_expirado: true
            }, { status: 400 });
          }
        }
      }
    }

    // ───────────────────────────────────────────────────────────
    // 2.5) Trocar etapa para "não entregue" (se configurado)
    //      Lê etapa_nao_entregue da ConfiguracaoSistema
    // ───────────────────────────────────────────────────────────
    let etapaTrocada = false;
    try {
      const configs = await base44.asServiceRole.entities.ConfiguracaoSistema.filter({ chave: 'global' }, '-updated_date', 1).catch(() => []);
      const etapaNaoEntregue = configs?.[0]?.etapa_nao_entregue || '70';
      if (etapaNaoEntregue) {
        await omieCall(base44, 'produtos/pedido/', {
          codigo_pedido: Number(codigo_pedido),
          etapa: etapaNaoEntregue
        }, { call: 'TrocarEtapaPedido' });
        etapaTrocada = true;
        console.log(`[cancelarNfAcerto] Pedido ${codigo_pedido} movido para etapa ${etapaNaoEntregue}`);
      }
    } catch (etapaErr) {
      console.warn(`[cancelarNfAcerto] Falha ao trocar etapa: ${etapaErr.message} — prosseguindo com cancelamento`);
    }

    // ───────────────────────────────────────────────────────────
    // 3) CancelarPedidoVenda
    //    (doc: /produtos/pedidovendafat/ CancelarPedidoVenda { nCodPed })
    // ───────────────────────────────────────────────────────────
    const cancel = await omieCall(base44, 'produtos/pedidovendafat/', { nCodPed: Number(codigo_pedido) }, { call: 'CancelarPedidoVenda' });
    if (cancel.faultstring) {
      const fs = cancel.faultstring.toLowerCase();
      if (fs.includes('cancelad') || fs.includes('já foi') || fs.includes('ja foi')) {
        await atualizarPedidoLocal(base44, codigo_pedido, motivo, user);
        return Response.json({ sucesso: true, ja_cancelada: true, numero_nf: numeroNf, mensagem: 'Já cancelado no Omie' });
      }
      return Response.json({ error: cancel.faultstring, numero_nf: numeroNf }, { status: 400 });
    }

    // ───────────────────────────────────────────────────────────
    // 4) Atualiza Pedido local (comercial + logística mesmo app)
    // ───────────────────────────────────────────────────────────
    await atualizarPedidoLocal(base44, codigo_pedido, motivo, user);

    return Response.json({
      sucesso: true,
      numero_nf: numeroNf,
      data_previsao: dataPrev,
      etapa_trocada: etapaTrocada,
      mensagem: 'Pedido cancelado no Omie' + (numeroNf ? ` (NF ${numeroNf})` : '') + (etapaTrocada ? ' — etapa atualizada para não entregue' : '')
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function atualizarPedidoLocal(base44, codigoPedido, motivo, user) {
  try {
    const lista = await base44.asServiceRole.entities.Pedido.filter(
      { omie_codigo_pedido: String(codigoPedido) }, '-created_date', 1
    );
    if (lista?.[0]) {
      await base44.asServiceRole.entities.Pedido.update(lista[0].id, {
        status: 'cancelado',
        motivo_cancelamento: motivo,
        cancelado_por: user.email,
        cancelado_por_nome: user.full_name || user.email,
        data_cancelamento: new Date().toISOString()
      });
    }
  } catch (_) {}
}