// Baixa o PDF de um boleto Omie a partir do codigo_lancamento.
// 1) Chama ObterBoleto (financas/contareceber) para obter cLinkBoleto.
// 2) Faz fetch do PDF no servidor (evita CORS) e devolve em base64.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido, com cache ObterBoleto + retry código 6) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
const CB_FIXED_ID = '6a1e06a9aa62ceab7b3b6d97';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

// Cache em memória (isolate-scoped) para ObterBoleto — evita repetir mesma consulta
const boletoCache = new Map<string, { link: string; at: number }>();
const BOLETO_CACHE_TTL_MS = 3 * 60_000; // 3 minutos

function extrairSegundos(mensagem: string): number {
  const match = String(mensagem).match(/(\d+)\s*segundo/i);
  return match ? Math.min(parseInt(match[1]) + 2, 60) : 0;
}

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: CB_FIXED_ID }, '-created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

async function updateCircuitBreaker(base44: any, erros: number, ultimoErro: string) {
  const threshold = 3;
  const p: any = { erros_consecutivos: erros, ultimo_erro: ultimoErro.slice(0, 500), atualizado_em: new Date().toISOString() };
  if (erros >= threshold) {
    p.bloqueado = true;
    p.bloqueado_ate = new Date(Date.now() + 3 * 60_000).toISOString();
  }
  await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_FIXED_ID, p).catch(() => null);
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [2000, 5000, 10000];
  const MAX_REDUNDANT_RETRIES = 4;
  let lastErr = '';
  let errosConsecutivos = 0;
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || options.timeout || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      const data = await res.json();

      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        lastErr = String(data.faultstring);

        // MISUSE / bloqueio permanente → circuit breaker sem retry
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('misuse')) {
          await updateCircuitBreaker(base44, errosConsecutivos + 1, String(data.faultstring));
          throw new Error(data.faultstring);
        }

        // CÓDIGO 6: "Consumo redundante detectado. Aguarde X segundos"
        const isRedundante = msg.includes('redundante') || msg.includes('aguarde');
        if (isRedundante) {
          const segs = extrairSegundos(String(data.faultstring));
          errosConsecutivos++;
          const waitMs = segs > 0 ? segs * 1000 : 5000; // usa o valor da msg ou fallback 5s
          // Tenta até MAX_REDUNDANT_RETRIES vezes para este tipo de erro
          const redundantTried = i; // i conta tentativas normais
          if (redundantTried < MAX_REDUNDANT_RETRIES) {
            console.log(`[baixarPdfBoletoOmie] Código 6 detectado → aguardando ${waitMs}ms antes de retry ${redundantTried + 1}/${MAX_REDUNDANT_RETRIES}`);
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }
          await updateCircuitBreaker(base44, errosConsecutivos, String(data.faultstring));
          throw new Error(`API Omie bloqueada por consumo redundante após ${MAX_REDUNDANT_RETRIES} tentativas: ${data.faultstring}`);
        }

        // Rate limit / cota / timeout → retry normal
        if (res.status === 429 || msg.includes('cota') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) {
          errosConsecutivos++;
          if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
          await updateCircuitBreaker(base44, errosConsecutivos, String(data.faultstring));
          throw new Error(data.faultstring);
        }

        // Outro erro → falha imediata
        throw new Error(data.faultstring);
      }

      // Sucesso
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(CB_FIXED_ID, { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (e: any) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      errosConsecutivos++;
      if (i < RETRIES.length && !e.message?.includes('bloqueada') && !e.message?.includes('API Omie bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

const CR_URL = 'https://app.omie.com.br/api/v1/financas/contareceber/';
const BOLETO_URL = 'https://app.omie.com.br/api/v1/financas/contareceberboleto/';


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { codigo_lancamento, url_boleto } = body;

    let link = url_boleto || null;

    if (!link) {
      if (!codigo_lancamento) {
        return Response.json({ error: 'Informe codigo_lancamento ou url_boleto' }, { status: 400 });
      }

      // Cache em memória para ObterBoleto (3 min) — evita "consumo redundante"
      const cacheKey = String(codigo_lancamento);
      const cached = boletoCache.get(cacheKey);
      if (cached && Date.now() - cached.at < BOLETO_CACHE_TTL_MS) {
        link = cached.link;
        console.log(`[baixarPdfBoletoOmie] Cache hit para título ${codigo_lancamento}`);
      }

      // 1) Tenta ObterBoleto - param: nCodTitulo
      let cDesStatus = null;
      if (!link) {
        try {
          const data = await omieCall(base44, BOLETO_URL, { nCodTitulo: Number(codigo_lancamento) }, { call: 'ObterBoleto' });
          link = data?.cLinkBoleto || data?.link_boleto || null;
          cDesStatus = data?.cDesStatus || null;
          if (link) {
            boletoCache.set(cacheKey, { link, at: Date.now() });
          }
        } catch (e) {
          cDesStatus = e.message;
        }
      }

      // 2) Fallback: ObterBoleto às vezes responde "nenhum boleto gerado" mesmo para
      // boletos já emitidos via API. GerarBoleto devolve o link do boleto existente.
      if (!link) {
        try {
          const dataGer = await omieCall(base44, BOLETO_URL, { nCodTitulo: Number(codigo_lancamento) }, { call: 'GerarBoleto' });
          link = dataGer?.cLinkBoleto || dataGer?.link_boleto || null;
          if (!link) cDesStatus = dataGer?.cDesStatus || cDesStatus;
          if (link) {
            boletoCache.set(cacheKey, { link, at: Date.now() });
          }
        } catch (e2) {
          cDesStatus = e2.message || cDesStatus;
        }
      }

      if (!link) {
        return Response.json({
          error: cDesStatus || 'Boleto não disponível para este título no Omie.'
        }, { status: 404 });
      }
    }

    const pdfRes = await fetch(link);
    if (!pdfRes.ok) {
      return Response.json({ error: `Falha ao baixar PDF do Omie (HTTP ${pdfRes.status})` }, { status: 502 });
    }
    const buf = await pdfRes.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);

    return Response.json({
      sucesso: true,
      codigo_lancamento,
      pdf_url: link,
      pdf_base64: base64
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});