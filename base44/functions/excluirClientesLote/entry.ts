import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
// ✅ ITEM 7: _shared/omieClient
import { omieCall as omieCallShared, checkCircuitBreaker } from '../_shared/omieClient/entry.ts';

const OMIE_APP_KEY = Deno.env.get('OMIE_APP_KEY');
const OMIE_APP_SECRET = Deno.env.get('OMIE_APP_SECRET');
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

// ✅ omieCall local → wrapper _shared/omieClient
async function omieCall(base44, callOrEndpoint, param, optsOrUndef) {
  if (typeof optsOrUndef === 'object' && optsOrUndef !== null) return omieCallShared(base44, callOrEndpoint, param, optsOrUndef);
  if (callOrEndpoint && callOrEndpoint.includes('/')) return omieCallShared(base44, callOrEndpoint, param, {});
  return omieCallShared(base44, 'geral/clientes/', param, { call: callOrEndpoint });
}) {
    const { maxRetries = 3, cacheMinutes = 0, logIntegration = true } = typeof opts === 'number' ? { maxRetries: 3, cacheMinutes: 0, logIntegration: true } : opts;
    const chave = `${OMIE_URL}|${call}|${JSON.stringify(param || {})}`;
    const controles = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, '-updated_date', 1).catch(() => []);
    const controle = controles?.[0];

    if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
        return { faultstring: `API Omie bloqueada temporariamente. Tente novamente em ${controle.bloqueado_ate}`, faultcode: 'CIRCUIT_OPEN' };
    }

    if (cacheMinutes > 0) {
        const caches = await base44.asServiceRole.entities.CacheOmieConsulta.filter({ chave }, '-created_date', 1).catch(() => []);
        if (caches?.[0] && new Date(caches[0].expira_em) > new Date()) return caches[0].valor;
    }

    let ultimoErro = '';
    for (let tentativa = 1; tentativa <= maxRetries; tentativa++) {
        const inicio = Date.now();
        const response = await fetch(OMIE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ call, app_key: OMIE_APP_KEY, app_secret: OMIE_APP_SECRET, param: [param] })
        });
        const data = await response.json();

        if (data.faultstring || data.faultcode) {
            const fault = String(data.faultstring || '').toLowerCase();
            const deveBloquear = response.status === 425 || fault.includes('bloqueada') || fault.includes('bloqueio') || fault.includes('tente novamente mais tarde');
            if (deveBloquear) {
                const payloadCb = { chave: 'principal', bloqueado: true, bloqueado_ate: new Date(Date.now() + 30 * 60000).toISOString(), ultimo_erro: data.faultstring || '', atualizado_em: new Date().toISOString() };
                if (controle?.id) await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(controle.id, payloadCb).catch(() => {});
                else await base44.asServiceRole.entities.ControleCircuitBreakerOmie.create(payloadCb).catch(() => {});
                return data;
            }

            const deveTentar = response.status === 429 || fault.includes('too many requests') || fault.includes('já existe uma requisição') || fault.includes('try again') || fault.includes('limite') || fault.includes('cota') || fault.includes('aguarde') || fault.includes('timeout');
            ultimoErro = data.faultstring || 'Erro Omie';
            if (deveTentar && tentativa < maxRetries) {
                await new Promise(r => setTimeout(r, 2500 * tentativa));
                continue;
            }
        }

        if (logIntegration) {
            await base44.asServiceRole.entities.LogIntegracaoOmie.create({
                endpoint: OMIE_URL,
                call,
                operacao: call,
                status: data?.faultstring ? 'erro' : 'sucesso',
                mensagem_erro: data?.faultstring || null,
                payload_enviado: JSON.stringify(param || {}).slice(-500),
                payload_resposta: JSON.stringify(data || {}).slice(-500),
                duracao_ms: Date.now() - inicio,
                tentativas: tentativa
            }).catch(() => {});
        }
        return data;
    }

    return { faultstring: ultimoErro || 'Máximo de tentativas Omie excedido' };
}

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