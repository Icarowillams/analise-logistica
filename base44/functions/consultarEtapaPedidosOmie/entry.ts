import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Rate limit seguro: 1 chamada a cada 1.5 segundo (Omie permite ~1/seg, usamos margem)
const DELAY_ENTRE_CHAMADAS_MS = 1500;
const MAX_PEDIDOS = 40;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 3000;
const TIMEOUT_MS = 15000;

function classificarStatus(pedido, etapa) {
  const texto = JSON.stringify(pedido || {}).toLowerCase();
  if (pedido?.infoCadastro?.cancelado === 'S' || texto.includes('cancelad')) return 'cancelada';
  if (texto.includes('rejeitad')) return 'rejeitada';
  if (texto.includes('denegad')) return 'denegada';
  if (etapa === '50') return 'faturar';
  if (etapa === '60') return 'faturado';
  if (etapa === '20') return 'liberado';
  if (etapa === '10') return 'pedido_venda';
  return 'outra_etapa';
}

function extrairNumeroNf(pedido) {
  const json = JSON.stringify(pedido || {});
  const match = json.match(/"(?:nNF|numero_nf|numero_nfe|numeroNotaFiscal|nNumNF)"\s*:\s*"?([^",}]+)"?/i);
  return match?.[1] ? String(match[1]).trim() : '';
}

let _credsCache = null;
async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 60000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  if (rows.length > 0 && rows[0].app_key && rows[0].app_secret) {
    _credsCache = { appKey: String(rows[0].app_key), appSecret: String(rows[0].app_secret), at: Date.now() };
    return _credsCache;
  }
  _credsCache = { appKey: Deno.env.get('OMIE_APP_KEY') || '', appSecret: Deno.env.get('OMIE_APP_SECRET') || '', at: Date.now() };
  return _credsCache;
}

async function omieCallSafe(base44, endpoint, param, options = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas');
  const call = options.call || endpoint;
  const url = `https://app.omie.com.br/api/v1/${endpoint}`;
  const body = JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] });

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal
      });
      clearTimeout(timer);

      // Rate limit (429) e erro interno do Omie (5xx) — espera e retenta com backoff.
      // O corpo de um 5xx/429 costuma NÃO ser JSON, por isso tratamos antes do parse.
      if (resp.status === 429 || resp.status >= 500) {
        console.warn(`[consultarEtapa] HTTP ${resp.status} na tentativa ${attempt + 1}/${MAX_RETRIES + 1}`);
        await resp.text().catch(() => '');
        if (attempt < MAX_RETRIES) {
          await delay(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        throw new Error(`Erro HTTP ${resp.status} Omie — tentativas esgotadas`);
      }
      if (resp.status === 425) {
        await resp.text().catch(() => '');
        return { _bloqueio_omie: true, faultstring: 'HTTP 425 — consumo indevido' };
      }

      const text = await resp.text();
      const data = text ? JSON.parse(text) : {};

      // Detectar bloqueio por consumo indevido — abortar IMEDIATAMENTE
      const faultStr = String(data?.faultstring || '').toLowerCase();
      if (faultStr.includes('consumo indevido') || faultStr.includes('misuse') ||
          faultStr.includes('bloqueada') || faultStr.includes('suspended')) {
        // Retornar erro especial que sinaliza ao loop para PARAR TUDO
        return { _bloqueio_omie: true, faultstring: data.faultstring };
      }

      return data;
    } catch (error) {
      clearTimeout(timer);
      if (error.name === 'AbortError') {
        if (attempt < MAX_RETRIES) { await delay(RETRY_DELAY_MS); continue; }
        throw new Error(`Timeout de ${TIMEOUT_MS}ms`);
      }
      throw error;
    }
  }
}

async function consultarEtapa(base44, codigoPedido) {
  let data;
  try {
    data = await omieCallSafe(base44, 'produtos/pedido/', { codigo_pedido: Number(codigoPedido) }, { call: 'ConsultarPedido' });
  } catch (e) {
    return { etapa: null, status: 'erro', numero_nf: '', encontrado: false, mensagem: e.message };
  }

  // Bloqueio detectado — propagar para parar o loop
  if (data?._bloqueio_omie) {
    return { etapa: null, status: 'bloqueio_omie', numero_nf: '', encontrado: false, mensagem: data.faultstring, _bloqueio_omie: true };
  }

  if (data?.faultstring || data?.faultcode) {
    const msg = String(data.faultstring || '').toLowerCase();
    const naoEncontrado = msg.includes('não encontrad') || msg.includes('nao encontrad') ||
      msg.includes('não existe') || msg.includes('nao existe') || msg.includes('inexistente') ||
      msg.includes('excluíd') || msg.includes('excluid') || msg.includes('não cadastrad') || msg.includes('nao cadastrad');

    return {
      etapa: naoEncontrado ? '80' : null,
      status: naoEncontrado ? 'nao_encontrado' : 'erro',
      numero_nf: '',
      encontrado: false,
      mensagem: data.faultstring || 'Erro Omie'
    };
  }

  const pedido = data?.pedido_venda_produto;
  if (!pedido) {
    return { etapa: null, status: 'nao_encontrado', numero_nf: '', encontrado: false };
  }

  const etapa = String(pedido?.cabecalho?.etapa || '').trim();
  const numeroNf = extrairNumeroNf(pedido);

  return {
    etapa,
    status: classificarStatus(pedido, etapa),
    numero_nf: numeroNf,
    encontrado: true
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const codigos = [...new Set((Array.isArray(body.codigos_pedido) ? body.codigos_pedido : [])
      .map(c => String(c))
      .filter(Boolean))]
      .slice(0, MAX_PEDIDOS);

    if (codigos.length === 0) {
      return Response.json({ sucesso: true, resultados: {} });
    }

    console.log(`[consultarEtapaPedidosOmie] Consultando ${codigos.length} pedidos com ${DELAY_ENTRE_CHAMADAS_MS}ms entre chamadas`);

    const resultados = {};
    let bloqueado = false;

    for (let i = 0; i < codigos.length; i++) {
      const codigo = codigos[i];
      const resultado = await consultarEtapa(base44, codigo);
      resultados[codigo] = resultado;

      // Se a API bloqueou, PARA IMEDIATAMENTE — não faz mais nenhuma chamada
      if (resultado._bloqueio_omie) {
        bloqueado = true;
        console.error(`[consultarEtapaPedidosOmie] API BLOQUEADA após ${i + 1} chamadas. Abortando restantes.`);
        // Marca os restantes como não consultados
        for (let j = i + 1; j < codigos.length; j++) {
          resultados[codigos[j]] = { etapa: null, status: 'nao_consultado', numero_nf: '', encontrado: false, mensagem: 'Consulta abortada — API bloqueada' };
        }
        break;
      }

      // Delay entre chamadas (exceto após a última)
      if (i < codigos.length - 1) {
        await delay(DELAY_ENTRE_CHAMADAS_MS);
      }
    }

    return Response.json({ 
      sucesso: !bloqueado, 
      resultados,
      total_consultados: Object.values(resultados).filter(r => r.status !== 'nao_consultado').length,
      total_pedidos: codigos.length,
      bloqueado
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});