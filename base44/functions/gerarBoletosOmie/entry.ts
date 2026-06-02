import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_URL = 'https://app.omie.com.br/api/v1/financas/contareceber/';
const STATUS_ABERTOS = new Set(['ABERTO', 'A VENCER', 'A PAGAR', 'A RECEBER', 'VENCIDO', 'PARCIAL']);

let _creds = null;
async function resolverCreds(base44) {
  if (_creds) return _creds;
  try {
    const configs = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1);
    const cfg = configs?.[0];
    if (cfg?.app_key && cfg?.app_secret) { _creds = { app_key: cfg.app_key, app_secret: cfg.app_secret }; return _creds; }
  } catch { /* fallback */ }
  _creds = { app_key: Deno.env.get('OMIE_APP_KEY'), app_secret: Deno.env.get('OMIE_APP_SECRET') };
  return _creds;
}

async function omieCall(base44, call, param, tentativa = 1) {
  const { app_key, app_secret } = await resolverCreds(base44);
  const res = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key, app_secret, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) {
    const msg = String(data.faultstring).toLowerCase();
    const isRate = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || res.status === 429;
    if (isRate && tentativa < 5) {
      await new Promise(r => setTimeout(r, 3000 * tentativa));
      return omieCall(base44, call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

async function listarTitulosDoPedido(base44, codigoPedido) {
  const titulos = [];
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - 30 * 86400000);
  const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

  let pagina = 1;
  const registrosPorPagina = 100;
  while (true) {
    const data = await omieCall(base44, 'ListarContasReceber', {
      pagina,
      registros_por_pagina: registrosPorPagina,
      apenas_importado_api: 'N',
      filtrar_por_emissao_de: fmt(inicio),
      filtrar_por_emissao_ate: fmt(hoje)
    });
    const lista = data?.conta_receber_cadastro || [];
    titulos.push(...lista.filter(t => String(t.nCodPedido || '') === String(codigoPedido)));
    if (lista.length < registrosPorPagina) break;
    pagina++;
    await new Promise(r => setTimeout(r, 300));
  }

  return titulos;
}

async function gerarBoletosTitulos(base44, titulos, idContaCorrente) {
  const resultados = [];
  for (const titulo of titulos) {
    const codigo = titulo.codigo_lancamento_omie || titulo.codigo_lancamento || titulo;
    const status = String(titulo.status_titulo || '').toUpperCase();
    const aberto = !status || STATUS_ABERTOS.has(status);
    const jaTemBoleto = !!(titulo.numero_boleto && String(titulo.numero_boleto).trim()) || titulo.boleto?.cGerado === 'S';

    if (!aberto) {
      resultados.push({ codigo_lancamento: codigo, sucesso: false, skip: true, mensagem: `Título ${status}` });
      continue;
    }
    if (jaTemBoleto) {
      resultados.push({ codigo_lancamento: codigo, sucesso: false, skip: true, mensagem: `Boleto já gerado: ${titulo.numero_boleto || ''}` });
      continue;
    }

    try {
      const param = { codigo_lancamento: Number(codigo) };
      if (idContaCorrente) param.id_conta_corrente = Number(idContaCorrente);
      const data = await omieCall(base44, 'GerarBoleto', param);
      const numBoleto = data.numero_boleto || data.nNumBoleto || '';
      const codBarras = data.codigo_barras || data.cCodBarras || '';
      const linkBoleto = data.link_boleto || data.cLinkBoleto || '';
      const sucessoReal = !!(String(numBoleto).trim() || String(codBarras).trim() || String(linkBoleto).trim());
      resultados.push({
        codigo_lancamento: codigo,
        sucesso: sucessoReal,
        numero_boleto: numBoleto,
        codigo_barras: codBarras,
        linha_digitavel: data.linha_digitavel || data.cLinDig || '',
        link_boleto: linkBoleto,
        mensagem: sucessoReal ? 'Boleto gerado' : 'Omie respondeu sem gerar boleto'
      });
    } catch (err) {
      const msg = err.message.toLowerCase();
      resultados.push({
        codigo_lancamento: codigo,
        sucesso: false,
        skip: msg.includes('liquidado') || msg.includes('baixado') || msg.includes('cancelado'),
        mensagem: err.message
      });
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return resultados;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { origem = 'manual', pedidos = [], titulos = [], id_conta_corrente } = body;

    let user = null;
    try { user = await base44.auth.me(); } catch { user = null; }
    if (!user && origem !== 'auto') return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!user) user = { email: 'sistema@automation' };

    let titulosParaGerar = [];
    if (origem === 'auto') {
      const codigosPedido = pedidos.map(p => p.codigo_pedido || p).filter(Boolean);
      for (const codigoPedido of codigosPedido) {
        const titulosPedido = await listarTitulosDoPedido(base44, codigoPedido);
        titulosParaGerar.push(...titulosPedido.map(t => ({ ...t, codigo_pedido: codigoPedido })));
      }
    } else {
      if (!Array.isArray(titulos) || titulos.length === 0) return Response.json({ error: 'titulos vazio' }, { status: 400 });
      titulosParaGerar = titulos;
    }

    const resultados = await gerarBoletosTitulos(base44, titulosParaGerar, id_conta_corrente);
    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => !r.sucesso && !r.skip).length;
    const skips = resultados.filter(r => r.skip).length;

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'financas/contareceber',
      call: 'GerarBoleto',
      operacao: origem === 'auto' ? 'gerar_boletos_auto' : 'gerar_boletos_lote',
      status: erros > 0 ? 'warning' : 'sucesso',
      mensagem_erro: erros > 0 ? `${erros} boletos falharam` : null,
      tentativas: titulosParaGerar.length,
      usuario_email: user.email,
      payload_resposta: JSON.stringify(resultados).slice(0, 2000)
    }).catch(() => {});

    return Response.json({ sucesso: true, origem, total: titulosParaGerar.length, processados: titulosParaGerar.length, sucessos, erros, skips, resultados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});