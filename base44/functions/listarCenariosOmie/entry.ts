import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// ✅ ITEM 7: _shared/omieClient
import { omieCall as omieCallShared, checkCircuitBreaker } from '../_shared/omieClient/entry.ts';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const CENARIOS_URL = "https://app.omie.com.br/api/v1/geral/cenarios/";

// ✅ omieCall local → wrapper _shared/omieClient
async function omieCall(base44, callOrEndpoint, param, optsOrUndef) {
  if (typeof optsOrUndef === 'object' && optsOrUndef !== null) return omieCallShared(base44, callOrEndpoint, param, optsOrUndef);
  if (callOrEndpoint && callOrEndpoint.includes('/')) return omieCallShared(base44, callOrEndpoint, param, {});
  return omieCallShared(base44, 'geral/cnaefiscal/', param, { call: callOrEndpoint });
}) {
    const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3 } : opts;
    const chave = `${url}|${call}|${JSON.stringify(param || {})}`;
    const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
    const controle = cb?.[0];
    if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) return { faultstring: `API Omie bloqueada temporariamente. Tente novamente em ${controle.bloqueado_ate}` };
    if (cacheMinutes > 0) {
        const caches = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
        if (caches?.[0] && new Date(caches[0].expira_em) > new Date()) return caches[0].valor;
    }
    let lastError = '';
    for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] }) });
        const data = await response.json();
        if (data.faultstring || data.faultcode) {
            const msg = String(data.faultstring || '').toLowerCase();
            if (response.status === 425 || msg.includes('bloqueada') || msg.includes('bloqueio') || msg.includes('tente novamente mais tarde')) {
                const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: data.faultstring || '', atualizado_em: new Date().toISOString() };
                if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {}); else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
                return data;
            }
            if (response.status === 429 || msg.includes('limite de requisi') || msg.includes('cota') || msg.includes('aguarde') || msg.includes('timeout') || msg.includes('indispon')) { lastError = data.faultstring; await new Promise(r => setTimeout(r, 2500 * tentativa)); continue; }
        }
        if (cacheMinutes > 0) {
            const payloadCache = { chave, valor: data, tipo: call, expira_em: new Date(Date.now() + cacheMinutes * 60000).toISOString(), criado_em: new Date().toISOString() };
            const existente = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
            if (existente?.[0]?.id) await base44.asServiceRole.entities.CacheOmieConsulta.update(existente[0].id, payloadCache).catch(() => {}); else await base44.asServiceRole.entities.CacheOmieConsulta.create(payloadCache).catch(() => {});
        }
        if (logIntegration) await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: call, status: data?.faultstring ? 'erro' : 'sucesso', mensagem_erro: data?.faultstring || null, payload_enviado: JSON.stringify(param || {}).slice(-500), payload_resposta: JSON.stringify(data || {}).slice(-500) }).catch(() => {});
        return data;
    }
    return { faultstring: lastError || 'Máximo de tentativas Omie excedido' };
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        async function listarPagina(nPagina) {
            return await omieCall(base44, CENARIOS_URL, "ListarCenarios", { nPagina, nRegPorPagina: 100 }, { cacheMinutes: 60 });
        }

        let todosRegistros = [];
        const primeira = await listarPagina(1);
        if (primeira.faultstring) {
            return Response.json({ sucesso: false, erro: primeira.faultstring, cenarios: [] });
        }
        const totalPaginas = primeira.nTotPaginas || 1;
        todosRegistros = todosRegistros.concat(primeira.cenariosEncontrados || []);

        // Demais páginas em paralelo (3 simultâneas)
        const PARALELISMO = 3;
        const restantes = [];
        for (let p = 2; p <= totalPaginas; p++) restantes.push(p);
        for (let i = 0; i < restantes.length; i += PARALELISMO) {
            const lote = restantes.slice(i, i + PARALELISMO);
            const resultados = await Promise.all(lote.map(p => listarPagina(p)));
            for (const r of resultados) {
                if (r.cenariosEncontrados) todosRegistros = todosRegistros.concat(r.cenariosEncontrados);
            }

        }

        // Filtrar apenas cenários ativos
        const cenariosAtivos = todosRegistros.filter(c => c.inativo !== 'S');

        console.log(`[listarCenariosOmie] ${cenariosAtivos.length} cenários fiscais ativos encontrados`);

        return Response.json({
            sucesso: true,
            cenarios: cenariosAtivos.map(c => ({
                codigo: c.nCodigo,
                nome: c.cNome,
                padrao: c.padrao || false,
                industria: c.industria || false,
                comercio_varejista: c.comercioVarejista || false,
                comercio_atacadista: c.comercioAtacadista || false,
                prestador_servico: c.prestadorServico || false
            })),
            total: cenariosAtivos.length
        });

    } catch (error) {
        console.error('[listarCenariosOmie] Erro:', error.message);
        return Response.json({ error: error.message, sucesso: false }, { status: 500 });
    }
});