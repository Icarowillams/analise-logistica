import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_KEY = Deno.env.get('OMIE_API_KEY');
const OMIE_SECRET = Deno.env.get('OMIE_API_SECRET');
const OMIE_BASE = 'https://app.omie.com.br/api/v1';

async function omieCall(path, call, param, retries = 3) {
  const body = { call, app_key: OMIE_KEY, app_secret: OMIE_SECRET, param: [param] };
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(`${OMIE_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    const fault = (data?.faultstring || '').toLowerCase();
    if (res.status === 429 || fault.includes('cota')) {
      await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    return { status: res.status, data };
  }
  return { status: 429, data: { faultstring: 'Cota excedida no Omie' } };
}

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDateBR(d) { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; }

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { codigo_pedido, motivo = 'Cancelado no acerto de caixa' } = await req.json().catch(() => ({}));
    if (!codigo_pedido) return Response.json({ error: 'codigo_pedido obrigatório' }, { status: 400 });

    // 1) ConsultarPedido para pegar codigo_cliente e valor
    const consulta = await omieCall('/produtos/pedido/', 'ConsultarPedido', { codigo_pedido: Number(codigo_pedido) });
    if (consulta.status !== 200 || consulta.data?.faultstring) {
      const fs = (consulta.data?.faultstring || '').toLowerCase();
      if (fs.includes('cancelad') || fs.includes('já foi')) {
        return Response.json({ sucesso: true, ja_cancelada: true, mensagem: 'Pedido já cancelado no Omie' });
      }
      return Response.json({ error: consulta.data?.faultstring || 'Erro ao consultar pedido' }, { status: 400 });
    }
    const ped = consulta.data?.pedido_venda_produto || consulta.data;
    const nCodCli = ped?.cabecalho?.codigo_cliente;
    const valorPedido = Number(ped?.total_pedido?.valor_total_pedido || 0);

    // 2) Listar NFs últimos 2 meses, paginado, ordem decrescente
    const hoje = new Date();
    const inicio = new Date(); inicio.setMonth(inicio.getMonth() - 2);
    let numeroNf = '';
    let nfCancelada = false;

    for (let pagina = 1; pagina <= 5; pagina++) {
      const nfRes = await omieCall('/produtos/nfconsultar/', 'ListarNF', {
        pagina,
        registros_por_pagina: 50,
        apenas_importado_api: 'N',
        ordenar_por: 'CODIGO',
        ordem_decrescente: 'S',
        dEmiInicial: fmtDateBR(inicio),
        dEmiFinal: fmtDateBR(hoje),
        tpNF: '1',
        tpEmis: '1'
      });
      const lista = nfRes.data?.nfCadastro || [];
      if (lista.length === 0) break;

      const match = lista.find(nf => {
        const dest = nf?.nfDestInt || {};
        const ide = nf?.compl || {};
        const vNF = Number(ide?.vNF || nf?.total?.ICMSTot?.vNF || 0);
        const cli = Number(dest?.nCodCli || nf?.identificacao?.nCodCli || 0);
        return cli === Number(nCodCli) && Math.abs(vNF - valorPedido) < 0.05;
      });

      if (match) {
        numeroNf = match?.compl?.nNF || match?.identificacao?.nNF || '';
        const dCan = match?.compl?.dCan || match?.identificacao?.dCan;
        if (dCan) { nfCancelada = true; break; }
        break;
      }
    }

    if (nfCancelada) {
      return Response.json({ sucesso: true, ja_cancelada: true, numero_nf: numeroNf, mensagem: 'NF já cancelada' });
    }

    // 3) Cancelar o pedido no Omie
    const cancel = await omieCall('/produtos/pedidovendafat/', 'CancelarPedidoVenda', { nCodPed: Number(codigo_pedido) });
    const fs = (cancel.data?.faultstring || '').toLowerCase();
    if (cancel.status !== 200 && !fs.includes('cancelad') && !fs.includes('já foi')) {
      return Response.json({ error: cancel.data?.faultstring || 'Erro ao cancelar' }, { status: 400 });
    }

    // 4) Atualiza Pedido local (comercial + logística no mesmo app)
    try {
      const lista = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: String(codigo_pedido) }, '-created_date', 1);
      if (lista?.[0]) {
        await base44.asServiceRole.entities.Pedido.update(lista[0].id, {
          status: 'cancelado',
          motivo_cancelamento: motivo,
          cancelado_por_nome: user.full_name || user.email,
          data_cancelamento: new Date().toISOString()
        });
      }
    } catch (_) {}

    return Response.json({ sucesso: true, numero_nf: numeroNf, mensagem: 'Pedido/NF cancelado(a) no Omie' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});