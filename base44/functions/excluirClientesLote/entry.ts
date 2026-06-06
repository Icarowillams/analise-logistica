import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.omie_app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.omie_app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  if (!appKey || !appSecret) { appKey = Deno.env.get('OMIE_APP_KEY') || ''; appSecret = Deno.env.get('OMIE_APP_SECRET') || ''; }
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44: any) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

async function omieCall(base44: any, endpoint: string, param: unknown, options: any = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  if (!call) throw new Error('Informe options.call com o método Omie.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada até ${cb.blockedUntil}`);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const RETRIES = [1000, 2000, 4000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), options.timeoutMs || options.timeout || 15000);
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }), signal: controller.signal });
      clearTimeout(tid);
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          const until = new Date(Date.now() + 30 * 60000).toISOString();
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create({ chave: 'principal', bloqueado: true, bloqueado_ate: until, ultimo_erro: data.faultstring, atualizado_em: new Date().toISOString() }).catch(() => null);
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      return data;
    } catch (e: any) {
      lastErr = e.message;
      if (e.name === 'AbortError') lastErr = 'Timeout na chamada Omie';
      if (i < RETRIES.length && !e.message?.includes('bloqueada')) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas Omie excedido');
}
// ═══ fim omieClient inline ═══

const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";


const estadoParaUF = {
    'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM',
    'bahia': 'BA', 'ceara': 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES',
    'goias': 'GO', 'maranhao': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
    'minas gerais': 'MG', 'para': 'PA', 'paraiba': 'PB', 'parana': 'PR',
    'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
    'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC',
    'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO'
};

function normalizarEstado(estado) {
    const s = (estado || '').trim();
    if (s.length <= 2) return s.toUpperCase() || 'PE';
    const chave = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return estadoParaUF[chave] || s.substring(0, 2).toUpperCase() || 'PE';
}

// UpsertCliente com dados obrigatórios + tag Fornecedor
async function mudarTagUpsert(base44, clienteBase44) {
    const cnpj = (clienteBase44.cpf_cnpj || '').replace(/[.\-\/\s]/g, '');
    const isPF = cnpj.length <= 11;
    
    return await omieCall(base44, "UpsertCliente", {
        codigo_cliente_integracao: clienteBase44.codigo || clienteBase44.id,
        razao_social: (clienteBase44.razao_social || clienteBase44.nome_fantasia || 'Cliente').substring(0, 60),
        cnpj_cpf: cnpj,
        pessoa_fisica: isPF ? "S" : "N",
        endereco: (clienteBase44.endereco || 'Rua').substring(0, 60),
        endereco_numero: (clienteBase44.numero || 'S/N').substring(0, 10),
        bairro: (clienteBase44.bairro || 'Centro').substring(0, 60),
        cidade: (clienteBase44.cidade || 'Recife').substring(0, 60),
        estado: normalizarEstado(clienteBase44.estado),
        cep: (clienteBase44.cep || '').replace(/\D/g, '').substring(0, 8) || '50000000',
        tags: [{ tag: "Fornecedor" }]
    }, { cacheMinutes: 0 });
}

// Recebe: { clientes: [{ id, codigo }] }
// Busca dados completos do Base44, muda tag no Omie, depois deleta do Base44
Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { clientes } = await req.json();
        if (!clientes || !Array.isArray(clientes) || clientes.length === 0) {
            return Response.json({ error: 'clientes array obrigatório' }, { status: 400 });
        }

        // Buscar dados completos de cada cliente do Base44 (precisamos dos campos obrigatórios do Omie)
        const clientesCompletos = [];
        for (const c of clientes) {
            try {
                const dados = await base44.asServiceRole.entities.Cliente.get(c.id);
                clientesCompletos.push(dados);
            } catch (e) {
                // Cliente já não existe no Base44 — pular
                clientesCompletos.push({ id: c.id, codigo: c.codigo, _naoEncontrado: true });
            }
        }

        let transformados = 0, erros = 0;
        const errosList = [];
        const idsParaExcluirBase44 = [];

        for (let i = 0; i < clientesCompletos.length; i++) {
            const c = clientesCompletos[i];
            
            if (c._naoEncontrado) {
                // Já não existe no Base44, ignorar
                continue;
            }

            let resultado = null;
            try {
                resultado = await mudarTagUpsert(base44, c);
            } catch (e) {
                resultado = { faultstring: e.message };
            }

            if (resultado.faultstring) {
                const fault = (resultado.faultstring || '').toLowerCase();
                if (fault.includes('não encontrado') || fault.includes('não cadastrado')) {
                    idsParaExcluirBase44.push(c.id);
                } else {
                    erros++;
                    errosList.push(`${c.codigo || c.id}: ${resultado.faultstring}`);
                }
            } else {
                idsParaExcluirBase44.push(c.id);
                transformados++;
            }

        }

        // Excluir do Base44 em lotes de 5 com delay
        let ok = 0;
        for (let i = 0; i < idsParaExcluirBase44.length; i += 5) {
            const chunk = idsParaExcluirBase44.slice(i, i + 5);
            const results = await Promise.allSettled(
                chunk.map(id => base44.asServiceRole.entities.Cliente.delete(id))
            );
            for (let j = 0; j < results.length; j++) {
                if (results[j].status === 'fulfilled') {
                    ok++;
                } else {
                    const errMsg = results[j].reason?.message || '';
                    if (errMsg.includes('not found')) {
                        ok++;
                    } else {
                        try {
                            await base44.asServiceRole.entities.Cliente.delete(chunk[j]);
                            ok++;
                        } catch (e) {
                            ok += e.message?.includes('not found') ? 1 : 0;
                            if (!e.message?.includes('not found')) {
                                erros++;
                                errosList.push(`Base44 delete ${chunk[j]}: ${e.message}`);
                            }
                        }
                    }
                }
            }

        }

        return Response.json({ sucesso: true, processados: ok, transformados_fornecedor: transformados, erros, erros_detalhes: errosList });
    } catch (error) {
        console.error('[excluirClientesLote] Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});