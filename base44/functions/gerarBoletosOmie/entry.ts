import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const OMIE_URL = 'https://app.omie.com.br/api/v1/financas/contareceber/';
const APP_KEY = Deno.env.get('OMIE_API_KEY') || Deno.env.get('OMIE_APP_KEY');
const APP_SECRET = Deno.env.get('OMIE_API_SECRET') || Deno.env.get('OMIE_APP_SECRET');

async function omieCall(call, param, tentativa = 1) {
  const res = await fetch(OMIE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: APP_KEY, app_secret: APP_SECRET, param: [param] })
  });
  const data = await res.json();
  if (data.faultstring) {
    const msg = data.faultstring.toLowerCase();
    const isRate = msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || res.status === 429;
    if (isRate && tentativa < 5) {
      await new Promise(r => setTimeout(r, 3000 * tentativa));
      return omieCall(call, param, tentativa + 1);
    }
    throw new Error(data.faultstring);
  }
  return data;
}

// Gera boletos em lote no Omie
// body: { titulos: [codigo_lancamento], id_conta_corrente (opcional) }
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { titulos = [], id_conta_corrente, pular_validacao = false } = body;
    if (!Array.isArray(titulos) || titulos.length === 0) {
      return Response.json({ error: 'titulos vazio' }, { status: 400 });
    }

    // Pré-filtro: consulta os títulos no Omie e remove os que já têm boleto OU foram liquidados/cancelados.
    // Economiza chamadas de GerarBoleto (cada uma consome quota Omie).
    let titulosValidos = titulos;
    let preSkips = [];
    if (!pular_validacao) {
      try {
        const consultaUrl = 'https://app.omie.com.br/api/v1/financas/contareceber/';
        const consultaRes = await fetch(consultaUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            call: 'ListarContasReceber',
            app_key: APP_KEY,
            app_secret: APP_SECRET,
            param: [{ pagina: 1, registros_por_pagina: 500, apenas_importado_api: 'N' }]
          })
        });
        const consultaData = await consultaRes.json();
        const todos = consultaData?.conta_receber_cadastro || [];
        const mapa = new Map(todos.map(t => [String(t.codigo_lancamento_omie), t]));

        titulosValidos = [];
        for (const cod of titulos) {
          const t = mapa.get(String(cod));
          if (!t) {
            // não achou na listagem → manda mesmo assim, deixa o Omie validar
            titulosValidos.push(cod);
            continue;
          }
          const liquidado = t.status_titulo && t.status_titulo !== 'ABERTO';
          const jaTemBoleto = !!(t.numero_boleto && String(t.numero_boleto).trim());
          if (liquidado || jaTemBoleto) {
            preSkips.push({
              codigo_lancamento: cod,
              sucesso: false,
              skip: true,
              mensagem: liquidado ? `Título ${t.status_titulo}` : `Boleto já gerado: ${t.numero_boleto}`
            });
          } else {
            titulosValidos.push(cod);
          }
        }
      } catch (_) {
        // Se a pré-validação falhar, segue com a lista original
        titulosValidos = titulos;
      }
    }

    const resultados = [...preSkips];
    for (const codigo of titulosValidos) {
      try {
        const param = { codigo_lancamento: Number(codigo) };
        if (id_conta_corrente) param.id_conta_corrente = Number(id_conta_corrente);

        const data = await omieCall('GerarBoleto', param);
        resultados.push({
          codigo_lancamento: codigo,
          sucesso: true,
          numero_boleto: data.numero_boleto || data.nNumBoleto || '',
          codigo_barras: data.codigo_barras || data.cCodBarras || '',
          linha_digitavel: data.linha_digitavel || data.cLinDig || '',
          link_boleto: data.link_boleto || data.cLinkBoleto || ''
        });
      } catch (err) {
        const msg = err.message.toLowerCase();
        const liquidado = msg.includes('liquidado') || msg.includes('baixado');
        const cancelado = msg.includes('cancelado');
        resultados.push({
          codigo_lancamento: codigo,
          sucesso: false,
          skip: liquidado || cancelado,
          mensagem: err.message
        });
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => !r.sucesso && !r.skip).length;
    const skips = resultados.filter(r => r.skip).length;

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'financas/contareceber',
      call: 'GerarBoleto',
      operacao: 'gerar_boletos_lote',
      status: erros > 0 ? 'warning' : 'sucesso',
      mensagem_erro: erros > 0 ? `${erros} boletos falharam` : null,
      tentativas: titulos.length,
      usuario_email: user.email
    }).catch(() => {});

    return Response.json({ sucesso: true, total: titulos.length, processados: titulosValidos.length, sucessos, erros, skips, resultados });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});