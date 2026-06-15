import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

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
      // Tratamento de status HTTP ANTES de res.json() — num 5xx/429 o corpo não costuma ser JSON.
      if (res.status >= 500 || res.status === 429 || res.status === 425) {
        const corpo = await res.text().catch(() => '');
        lastErr = `HTTP ${res.status} Omie${corpo ? ': ' + corpo.slice(0, 200) : ''}`;
        if (res.status === 425) {
          const _cbId = '6a1e06a9aa62ceab7b3b6d97';
          const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []);
          const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3;
          const _p: any = { erros_consecutivos: _erros, ultimo_erro: lastErr.slice(0, 500), atualizado_em: new Date().toISOString() };
          if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); }
          await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null);
          throw new Error(lastErr);
        }
        if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        throw new Error(lastErr);
      }
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 425 || msg.includes('consumo indevido') || msg.includes('bloqueada') || msg.includes('bloqueio')) {
          const _secsCliente = (() => { const m = String(data.faultstring).match(/(\d+)\s*segundo/i); return m ? Math.min(Number(m[1]), 1800) : 0; })();
          { const _cbId = '6a1e06a9aa62ceab7b3b6d97'; const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh && _secsCliente > 0) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + _secsCliente * 1000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null); }
          throw new Error(data.faultstring);
        }
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante') || msg.includes('limite') || msg.includes('timeout') || msg.includes('internal error')) { lastErr = data.faultstring; if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; } }
        throw new Error(data.faultstring);
      }
      if (!options.skipLog) {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: url, call, operacao: options.operation || call, status: 'sucesso', duracao_ms: 0, tentativas: i + 1, entidade_tipo: options.entityType, entidade_id: options.entityId }).catch(() => null);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update('6a1e06a9aa62ceab7b3b6d97', { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
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

// ✅ ITEM 7
const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

async function logOmie(base44, payload) {
    try {
        await base44.asServiceRole.entities.LogIntegracaoOmie.create(payload);
    } catch (_) {}
}

// Mapa de nome completo do estado para sigla UF
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
    let normalizado = (estado || '').trim();
    if (normalizado.length > 2) {
        const chave = normalizado.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        normalizado = estadoParaUF[chave] || normalizado.substring(0, 2).toUpperCase();
    } else {
        normalizado = normalizado.toUpperCase();
    }
    return normalizado;
}

function normalizarCEP(cep) {
    const limpo = (cep || '').replace(/\D/g, '');
    return limpo.substring(0, 8);
}

function normalizarCpfCnpj(doc) {
    return (doc || '').replace(/[.\-\/\s]/g, '');
}

// Valida dígito verificador de CPF
function validarCPF(cpf) {
    cpf = cpf.replace(/\D/g, '');
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    let soma = 0;
    for (let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i);
    let dv1 = (soma * 10) % 11;
    if (dv1 === 10) dv1 = 0;
    if (dv1 !== parseInt(cpf[9])) return false;
    soma = 0;
    for (let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i);
    let dv2 = (soma * 10) % 11;
    if (dv2 === 10) dv2 = 0;
    return dv2 === parseInt(cpf[10]);
}

// Valida dígito verificador de CNPJ
function validarCNPJ(cnpj) {
    cnpj = cnpj.replace(/\D/g, '');
    if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
    const calc = (base, pesos) => {
        let soma = 0;
        for (let i = 0; i < pesos.length; i++) soma += parseInt(base[i]) * pesos[i];
        const r = soma % 11;
        return r < 2 ? 0 : 11 - r;
    };
    const dv1 = calc(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    if (dv1 !== parseInt(cnpj[12])) return false;
    const dv2 = calc(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return dv2 === parseInt(cnpj[13]);
}

function validarCpfCnpj(doc) {
    const limpo = (doc || '').replace(/\D/g, '');
    if (limpo.length === 11) return validarCPF(limpo);
    if (limpo.length === 14) return validarCNPJ(limpo);
    return false;
}


async function buscarClienteOmiePorCpfCnpj(base44, cnpjCpf) {
    if (!cnpjCpf) return null;
    const achado = await omieCall(base44, 'geral/clientes/', {
        pagina: 1,
        registros_por_pagina: 1,
        apenas_importado_api: 'N',
        clientesFiltro: { cnpj_cpf: cnpjCpf }
    }, { call: 'ListarClientes' });
    return achado?.clientes_cadastro?.[0] || null;
}

async function buscarClienteLocalComMesmoDocumento(base44, clienteId, cnpjCpf) {
    const doc = normalizarCpfCnpj(cnpjCpf);
    if (!doc) return null;
    const candidatos = await base44.asServiceRole.entities.Cliente.filter({ cnpj_cpf: cnpjCpf }, '-updated_date', 20).catch(() => []);
    return (candidatos || []).find(c => c.id !== clienteId && (c.codigo_omie || c.codigo_cliente_omie)) || null;
}

async function salvarCodigoOmieNoCliente(base44, clienteId, codigoOmie) {
    if (!clienteId || !codigoOmie) return;
    const codigo = String(codigoOmie);
    const atual = await base44.asServiceRole.entities.Cliente.get(clienteId);
    if (String(atual?.codigo_omie || '') === codigo && String(atual?.codigo_cliente_omie || '') === codigo) return;
    await base44.asServiceRole.entities.Cliente.update(clienteId, {
        codigo_omie: codigo,
        codigo_cliente_omie: codigo
    });
}

function removerAspas(val) {
    if (typeof val !== 'string') return val;
    let v = val.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
    }
    return v;
}

const CAMPOS_OMIE_RELEVANTES = ['razao_social', 'nome', 'cpf_cnpj', 'cnpj_cpf', 'endereco', 'cidade', 'estado', 'cep', 'codigo_omie', 'email_nfe', 'telefone_comercial', 'telefone', 'bairro', 'numero', 'complemento', 'inscricao_estadual', 'nome_fantasia', 'pessoa_fisica', 'tipo_pessoa', 'status', 'email'];

function mudouCampoOmie(data = {}, oldData = {}, changedFields = []) {
    if (!oldData || Object.keys(oldData).length === 0) return true;
    const alterados = Array.isArray(changedFields) && changedFields.length > 0 ? changedFields : Object.keys(data || {}).filter(k => JSON.stringify(data?.[k]) !== JSON.stringify(oldData?.[k]));
    return alterados.some(c => CAMPOS_OMIE_RELEVANTES.includes(c));
}

async function registrarDebounceCliente(base44, clienteId) {
    if (!clienteId) return false;
    const recentes = await base44.asServiceRole.entities.LogIntegracaoOmie.filter({ operacao: 'enviar_cliente_debounce', entidade_id: clienteId }, '-created_date', 1).catch(() => []);
    const ultimo = recentes?.[0];
    if (ultimo && Date.now() - new Date(ultimo.created_date || ultimo.updated_date || 0).getTime() < 30 * 1000) return true;
    await base44.asServiceRole.entities.LogIntegracaoOmie.create({ endpoint: 'geral/clientes', call: 'UpsertCliente', operacao: 'enviar_cliente_debounce', entidade_tipo: 'Cliente', entidade_id: clienteId, status: 'processado' }).catch(() => {});
    return false;
}

function isErroDuplicidadeCliente(resultado) {
    const msg = String(resultado?.faultstring || '').toLowerCase();
    return msg.includes('já cadastrado') || msg.includes('já existe') || msg.includes('duplicidade') || msg.includes('duplicado');
}

function limparCamposTexto(obj) {
    const limpo = {};
    for (const [key, value] of Object.entries(obj)) {
        limpo[key] = typeof value === 'string' ? removerAspas(value) : value;
    }
    return limpo;
}

function mapearClienteParaOmie(clienteData, rotaNome, vendedorNome, tabelaOmieId) {
    // Aceitar tanto cnpj_cpf (nome real da entidade) quanto cpf_cnpj (legado)
    const cnpjCpfLimpo = normalizarCpfCnpj(clienteData.cnpj_cpf || clienteData.cpf_cnpj);
    const estadoNorm = normalizarEstado(clienteData.estado);
    const cepNorm = normalizarCEP(clienteData.cep);
    const isPessoaFisica = cnpjCpfLimpo.length <= 11;

    // === REGRAS DE INSCRIÇÃO ESTADUAL E CONTRIBUINTE (Omie API geral/clientes) ===
    // contribuinte é "S" (sim, contribuinte de ICMS) ou "N" (não-contribuinte / isento / pessoa física)
    // PF (CPF, 11 dígitos): contribuinte="N", IE = "" (vazio, não enviar)
    // PJ com IE preenchida (dígitos): contribuinte="S", IE = só dígitos
    // PJ SEM IE / isenta: contribuinte="N", IE = "ISENTO"
    const ieRaw = String(clienteData.inscricao_estadual || '').trim();
    const ieDigitos = ieRaw.replace(/\D/g, '');
    // IE é considerada inválida (= ISENTO) se:
    //  - vazia
    //  - texto "isento" (qualquer variação)
    //  - menos de 2 dígitos
    //  - todos dígitos iguais (000000000, 111111111, etc.)
    const ieLixo = !ieDigitos
        || /^isent/i.test(ieRaw)
        || ieDigitos.length < 2
        || /^(\d)\1+$/.test(ieDigitos);

    let contribuinte;
    let inscricaoEstadualEnvio;
    if (isPessoaFisica) {
        contribuinte = "N";
        inscricaoEstadualEnvio = "";
    } else if (ieLixo) {
        contribuinte = "N";
        inscricaoEstadualEnvio = "ISENTO";
    } else {
        contribuinte = "S";
        inscricaoEstadualEnvio = ieDigitos;
    }

    // Prepend codigo_interno ao nome para identificacao no Omie (ex: "[28949] MERCADINHO DA FAMILIA")
    const codigoInterno = clienteData.codigo_interno || '';
    const prefixoCodigo = codigoInterno ? `[${codigoInterno}] ` : '';
    
    // Se o nome ja tem o prefixo, nao duplicar
    const prependCodigo = (nome) => {
      if (!nome || !prefixoCodigo) return nome;
      if (nome.startsWith(prefixoCodigo)) return nome; // ja tem o prefixo correto
      const match = nome.match(/^\[\d+\]\s/);
      if (match) return prefixoCodigo + nome.substring(match[0].length); // substitui prefixo antigo
      return prefixoCodigo + nome;
    };

    const razaoSocialFinal = prependCodigo(clienteData.razao_social || clienteData.nome_fantasia || "Cliente sem nome").substring(0, 60);
    const nomeFantasiaFinal = prependCodigo(clienteData.nome_fantasia || clienteData.razao_social || "").substring(0, 100);

    // Mapeamento completo conforme documentação Omie API - clientes_cadastro
    const clienteOmie = {
        // --- Identificação ---
        codigo_cliente_integracao: clienteData.codigo || clienteData.id,
        
        // --- Dados principais ---
        razao_social: razaoSocialFinal,
        nome_fantasia: nomeFantasiaFinal,
        cnpj_cpf: cnpjCpfLimpo,
        pessoa_fisica: isPessoaFisica ? "S" : "N",
        
        // --- Endereço ---
        endereco: (clienteData.endereco || "").substring(0, 60),
        endereco_numero: (clienteData.numero || "S/N").substring(0, 10),
        bairro: (clienteData.bairro || "").substring(0, 60),
        complemento: "",
        cidade: (clienteData.cidade || "").substring(0, 60),
        estado: estadoNorm,
        cep: cepNorm,

        // --- Contato ---
        contato: "",
        email: (clienteData.email || "nfe@paoemel.com.br").substring(0, 500),

        // --- Tributação ---
        contribuinte,
        inscricao_estadual: inscricaoEstadualEnvio,
        
        // --- Observações ---
        observacao: "",
        
        // --- Inatividade ---
        inativo: (clienteData.status || 'ativo').toLowerCase() === 'inativo' ? "S" : "N",

        // --- Bloqueio de faturamento ---
        // REGRA DE NEGÓCIO: O controle de bloqueio financeiro é 100% interno do Base44.
        // O Omie NUNCA deve bloquear um cliente para faturamento.
        // Sempre enviar "N" para garantir que o Omie não tenha clientes bloqueados.
        bloquear_faturamento: "N",

        // --- Tags (código do cliente) ---
        tags: clienteData.codigo ? [{ tag: `COD:${clienteData.codigo}` }] : [],

        // --- Características (Rota + Vendedor) ---
        caracteristicas: [
            ...(rotaNome ? [{ campo: "Rotas", conteudo: rotaNome }] : []),
            ...(vendedorNome ? [{ campo: "Vendedor", conteudo: vendedorNome }] : [])
        ]
    };

    // NOTA: A tag `tabela_preco` NÃO faz parte da estrutura `clientes_cadastro` do Omie.
    // O Omie rejeita o payload com erro: "Tag [TABELA_PRECO] não faz parte da estrutura do tipo complexo [clientes_cadastro]!"
    // A tabela de preço deve ser informada apenas no pedido, não no cadastro do cliente.
    // (Parâmetro `tabelaOmieId` mantido na assinatura para não quebrar chamadas existentes.)
    void tabelaOmieId;

    // Remover campos vazios para não sobrescrever dados no Omie com strings vazias
    // Mantemos sempre: codigo_cliente_integracao, razao_social, pessoa_fisica, contribuinte, inativo
    const camposSempreEnviar = ['codigo_cliente_integracao', 'razao_social', 'pessoa_fisica', 'contribuinte', 'inativo', 'inscricao_estadual', 'bloquear_faturamento'];
    
    for (const [key, value] of Object.entries(clienteOmie)) {
        if (camposSempreEnviar.includes(key)) continue;
        if (value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
            delete clienteOmie[key];
        }
    }

    return clienteOmie;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
        const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
        if (!OMIE_APP_KEY || !OMIE_APP_SECRET) {
            return Response.json({ sucesso: false, erro: 'Credenciais Omie não configuradas: OMIE_APP_KEY/OMIE_APP_SECRET.' }, { status: 500 });
        }
        console.log(`[enviarClienteOmie] Conectando ao Omie com APP_KEY: ...${String(OMIE_APP_KEY).slice(-4)}`);
        const body = await req.json();
        
        // Automação de entidade envia: { event, data, old_data, changed_fields, payload_too_large }
        // Chamada manual aceita: { cliente_id: "..." }
        const { event, data: cliente, old_data: oldData, changed_fields: changedFields = [], cliente_id: clienteIdManual } = body;

        console.log('[enviarClienteOmie] Payload recebido:', JSON.stringify(body).substring(0, 500));
        console.log('[enviarClienteOmie] Event:', JSON.stringify(event));

        // Se for update só de campo interno, ignora antes de buscar dados completos
        let clienteData = cliente;
        if (event?.type === 'update' && !mudouCampoOmie(clienteData || {}, oldData || {}, changedFields)) {
            return Response.json({ sucesso: true, ignorado: true, motivo: 'sem_campos_omie_alterados', cliente_id: clienteData?.id || event?.entity_id });
        }

        // Suporte a chamada manual com { cliente_id }
        const entityIdResolvido = clienteIdManual || event?.entity_id;

        // Se payload_too_large ou data veio vazio, buscar dados do cliente via SDK
        if ((body.payload_too_large || !clienteData || !clienteData.razao_social) && entityIdResolvido) {
            console.log('[enviarClienteOmie] Buscando cliente via SDK, entity_id:', entityIdResolvido);
            clienteData = await base44.asServiceRole.entities.Cliente.get(entityIdResolvido);
            console.log('[enviarClienteOmie] Cliente encontrado via SDK:', clienteData?.razao_social);
        }

        if (!clienteData || (!clienteData.id && !entityIdResolvido)) {
            console.log('[enviarClienteOmie] Cliente não informado no payload');
            return Response.json({ error: 'Cliente não informado' }, { status: 400 });
        }

        const clienteDebounceId = clienteData.id || event?.entity_id;
        if (await registrarDebounceCliente(base44, clienteDebounceId)) {
            return Response.json({ sucesso: true, ignorado: true, motivo: 'debounce_30s', cliente_id: clienteDebounceId });
        }

        // Usar o ID do evento se não vier no data
        if (!clienteData.id && event?.entity_id) {
            clienteData.id = event.entity_id;
        }

        // REGRA D1: cliente com tipo_nota = 'D1' NÃO vai para o Omie
        if (clienteData.tipo_nota === 'D1') {
            console.log('[enviarClienteOmie] Cliente D1 — não envia ao Omie:', clienteData.razao_social);
            await logOmie(base44, {
                endpoint: 'geral/clientes',
                call: 'UpsertCliente',
                operacao: 'enviar_cliente',
                entidade_tipo: 'Cliente',
                entidade_id: clienteData.id,
                status: 'warning',
                mensagem_erro: 'Cliente D1 — envio ao Omie ignorado por regra de negócio',
                tentativas: 0
            });
            return Response.json({ sucesso: true, pulado: true, motivo: 'cliente_d1' });
        }

        // Limpar aspas de todos os campos texto
        clienteData = limparCamposTexto(clienteData);

        console.log('[enviarClienteOmie] Cliente a enviar:', clienteData.razao_social, '- Status:', clienteData.status, '- ID:', clienteData.id);

        // Buscar nome da rota se o cliente tem rota_id
        let rotaNome = '';
        if (clienteData.rota_id) {
            try {
                const rota = await base44.asServiceRole.entities.Rota.get(clienteData.rota_id);
                if (rota) rotaNome = rota.nome || '';
            } catch (e) {
                console.log('[enviarClienteOmie] Erro ao buscar rota:', e.message);
            }
        }

        // Buscar nome do vendedor (se houver)
        let vendedorNome = '';
        if (clienteData.vendedor_id) {
            try {
                const vendedor = await base44.asServiceRole.entities.Vendedor.get(clienteData.vendedor_id);
                if (vendedor) vendedorNome = vendedor.nome || '';
            } catch (e) {
                console.log('[enviarClienteOmie] Erro ao buscar vendedor:', e.message);
            }
        }

        // Buscar omie_id da tabela de preço (se houver)
        let tabelaOmieId = null;
        if (clienteData.tabela_id) {
            try {
                const tabela = await base44.asServiceRole.entities.TabelaPreco.get(clienteData.tabela_id);
                if (tabela?.omie_id) tabelaOmieId = tabela.omie_id;
            } catch (e) {
                console.log('[enviarClienteOmie] Erro ao buscar tabela de preço:', e.message);
            }
        }

        // Mapear campos do Base44 para formato Omie completo
        const clienteOmie = mapearClienteParaOmie(clienteData, rotaNome, vendedorNome, tabelaOmieId);

        // Validar dígito verificador de CPF/CNPJ antes do envio
        if (clienteOmie.cnpj_cpf && !validarCpfCnpj(clienteOmie.cnpj_cpf)) {
            const erro = `CPF/CNPJ inválido: ${clienteOmie.cnpj_cpf} (dígito verificador não confere)`;
            console.error('[enviarClienteOmie]', erro);
            await logOmie(base44, {
                endpoint: 'geral/clientes', call: 'UpsertCliente', operacao: 'enviar_cliente',
                entidade_tipo: 'Cliente', entidade_id: clienteData.id,
                status: 'erro', mensagem_erro: erro, tentativas: 0
            });
            return Response.json({ sucesso: false, erro, cliente_id: clienteData.id });
        }

        // 🐛 FIX 4: Validar campos obrigatórios do Omie ANTES de enviar
        // O Omie rejeita clientes sem estado, cidade, CEP ou CNPJ/CPF.
        const camposFaltantes = [];
        if (!clienteOmie.cnpj_cpf) camposFaltantes.push('CPF/CNPJ');
        if (!clienteOmie.estado) camposFaltantes.push('Estado');
        if (!clienteOmie.cidade) camposFaltantes.push('Cidade');
        if (!clienteOmie.cep) camposFaltantes.push('CEP');
        if (!clienteOmie.razao_social || clienteOmie.razao_social === 'Cliente sem nome') camposFaltantes.push('Razão Social');
        
        if (camposFaltantes.length > 0) {
            const erro = `Campos obrigatórios não preenchidos: ${camposFaltantes.join(', ')}. Preencha o cadastro do cliente antes de sincronizar com o Omie.`;
            console.warn('[enviarClienteOmie]', erro, '- Cliente:', clienteData.razao_social || clienteData.id);
            await logOmie(base44, {
                endpoint: 'geral/clientes', call: 'UpsertCliente', operacao: 'enviar_cliente',
                entidade_tipo: 'Cliente', entidade_id: clienteData.id,
                status: 'erro', mensagem_erro: erro, tentativas: 0
            });
            return Response.json({ sucesso: false, erro, cliente_id: clienteData.id, campos_faltantes: camposFaltantes });
        }

        // Pré-consulta por CNPJ em updates ou quando ainda não há código Omie salvo.
        const cnpjLimpo = clienteOmie.cnpj_cpf;
        const codigoSalvo = clienteData.codigo_cliente_omie || clienteData.codigo_omie;
        if (codigoSalvo) {
            clienteOmie.codigo_cliente_omie = Number(codigoSalvo);
        } else if (cnpjLimpo) {
            const localDuplicado = await buscarClienteLocalComMesmoDocumento(base44, clienteData.id, cnpjLimpo);
            if (localDuplicado?.codigo_omie || localDuplicado?.codigo_cliente_omie) {
                const codigoReutilizado = localDuplicado.codigo_omie || localDuplicado.codigo_cliente_omie;
                clienteOmie.codigo_cliente_omie = Number(codigoReutilizado);
                await salvarCodigoOmieNoCliente(base44, clienteData.id, codigoReutilizado);
            }
        }
        if (cnpjLimpo && (event?.type === 'update' || !codigoSalvo)) {
            try {
                const existente = await buscarClienteOmiePorCpfCnpj(base44, cnpjLimpo);
                if (existente?.codigo_cliente_omie) {
                    if (existente.codigo_cliente_integracao && existente.codigo_cliente_integracao !== clienteOmie.codigo_cliente_integracao) {
                        console.log('[enviarClienteOmie] Reutilizando codigo_cliente_integracao existente no Omie:', existente.codigo_cliente_integracao);
                        clienteOmie.codigo_cliente_integracao = existente.codigo_cliente_integracao;
                    }
                    clienteOmie.codigo_cliente_omie = Number(existente.codigo_cliente_omie);
                    await salvarCodigoOmieNoCliente(base44, clienteData.id, existente.codigo_cliente_omie);
                }
            } catch (e) {
                console.log('[enviarClienteOmie] Pré-consulta CNPJ falhou (segue fluxo normal):', e.message);
            }
        }

        console.log('[enviarClienteOmie] Payload Omie:', JSON.stringify(clienteOmie).substring(0, 800));

        const startedAt = Date.now();
        const resultado = await omieCall(base44, "geral/clientes/", clienteOmie, { call: 'UpsertCliente', entityType: 'Cliente', entityId: clienteData.id });
        const duracao_ms = Date.now() - startedAt;

        console.log('[enviarClienteOmie] Resposta Omie:', JSON.stringify(resultado).substring(0, 500));

        if (resultado.faultstring) {
            if (isErroDuplicidadeCliente(resultado) && cnpjLimpo) {
                console.log('[enviarClienteOmie] Duplicidade detectada; consultando cliente existente e tentando alteração.');
                const existente = await buscarClienteOmiePorCpfCnpj(base44, cnpjLimpo);
                if (existente?.codigo_cliente_omie) {
                    if (existente.codigo_cliente_integracao) clienteOmie.codigo_cliente_integracao = existente.codigo_cliente_integracao;
                    clienteOmie.codigo_cliente_omie = Number(existente.codigo_cliente_omie);
                    await salvarCodigoOmieNoCliente(base44, clienteData.id, existente.codigo_cliente_omie);

                    const retryStartedAt = Date.now();
                    const resultadoAlteracao = await omieCall(base44, "geral/clientes/", clienteOmie, { call: 'UpsertCliente', entityType: 'Cliente', entityId: clienteData.id });
                    const duracaoResolvida = duracao_ms + (Date.now() - retryStartedAt);

                    if (!resultadoAlteracao.faultstring) {
                        await logOmie(base44, {
                            endpoint: 'geral/clientes',
                            call: 'UpsertCliente',
                            operacao: 'enviar_cliente',
                            entidade_tipo: 'Cliente',
                            entidade_id: clienteData.id,
                            status: 'sucesso',
                            mensagem_erro: 'Duplicidade resolvida automaticamente: código Omie vinculado e cliente alterado.',
                            payload_enviado: JSON.stringify(clienteOmie).slice(0, 5000),
                            payload_resposta: JSON.stringify(resultadoAlteracao).slice(0, 5000),
                            duracao_ms: duracaoResolvida,
                            tentativas: 2
                        });
                        return Response.json({
                            sucesso: true,
                            resolvido_automaticamente: true,
                            cliente_id: clienteData.id,
                            codigo_omie: existente.codigo_cliente_omie,
                            mensagem: resultadoAlteracao.descricao_status || 'Cliente alterado com sucesso'
                        });
                    }
                    resultado.faultstring = resultadoAlteracao.faultstring;
                    resultado.faultcode = resultadoAlteracao.faultcode;
                }
            }

            const faultMsg = String(resultado.faultstring || '');
            const faultMsgLower = faultMsg.toLowerCase();
            const faultCodeStr = String(resultado.faultcode || '');

            // CÓDIGO 101 / "já cadastrado" = cliente já existe no Omie → SUCESSO (não erro)
            if (faultCodeStr.includes('101') || isErroDuplicidadeCliente(resultado)) {
                // Tentar recuperar o código Omie para gravar localmente
                let codigoExistente = clienteOmie.codigo_cliente_omie;
                if (!codigoExistente && cnpjLimpo) {
                    try {
                        const existente = await buscarClienteOmiePorCpfCnpj(base44, cnpjLimpo);
                        if (existente?.codigo_cliente_omie) {
                            codigoExistente = existente.codigo_cliente_omie;
                            await salvarCodigoOmieNoCliente(base44, clienteData.id, codigoExistente);
                        }
                    } catch (_) { /* ignore */ }
                }
                await logOmie(base44, {
                    endpoint: 'geral/clientes', call: 'UpsertCliente', operacao: 'enviar_cliente',
                    entidade_tipo: 'Cliente', entidade_id: clienteData.id,
                    status: 'sucesso', mensagem_erro: 'Cliente já cadastrado no Omie (código 101) — tratado como sincronizado.',
                    payload_resposta: JSON.stringify(resultado).slice(0, 5000), duracao_ms, tentativas: 1
                });
                return Response.json({
                    sucesso: true, ja_cadastrado: true, cliente_id: clienteData.id,
                    codigo_omie: codigoExistente || null,
                    mensagem: 'Cliente já sincronizado no Omie'
                });
            }

            // CÓDIGO 6 / REDUNDANT = envio em processamento → aviso neutro (não erro)
            if (faultCodeStr.includes('SOAP-ENV:Client-6') || /c[óo]digo\s*6\b/.test(faultMsgLower) || faultMsgLower.includes('redundant') || faultMsgLower.includes('redundante')) {
                await logOmie(base44, {
                    endpoint: 'geral/clientes', call: 'UpsertCliente', operacao: 'enviar_cliente',
                    entidade_tipo: 'Cliente', entidade_id: clienteData.id,
                    status: 'warning', codigo_erro: resultado.faultcode, mensagem_erro: faultMsg,
                    payload_resposta: JSON.stringify(resultado).slice(0, 5000), duracao_ms, tentativas: 1
                });
                return Response.json({
                    sucesso: true, em_processamento: true, cliente_id: clienteData.id,
                    mensagem: 'Envio já em processamento, aguarde alguns segundos'
                });
            }

            console.error('[enviarClienteOmie] Erro Omie:', resultado.faultstring);
            await logOmie(base44, {
                endpoint: 'geral/clientes',
                call: 'UpsertCliente',
                operacao: 'enviar_cliente',
                entidade_tipo: 'Cliente',
                entidade_id: clienteData.id,
                status: 'erro',
                codigo_erro: resultado.faultcode,
                mensagem_erro: resultado.faultstring,
                payload_enviado: JSON.stringify(clienteOmie).slice(0, 5000),
                payload_resposta: JSON.stringify(resultado).slice(0, 5000),
                duracao_ms,
                tentativas: 1
            });
            return Response.json({
                sucesso: false,
                erro: resultado.faultstring,
                cliente_id: clienteData.id
            });
        }

        // Sucesso: gravar codigo Omie de volta no Cliente
        const codigoOmie = resultado.codigo_cliente_omie || clienteOmie.codigo_cliente_omie;
        if (codigoOmie && clienteData.id) {
            try {
                await salvarCodigoOmieNoCliente(base44, clienteData.id, codigoOmie);
            } catch (e) {
                console.log('[enviarClienteOmie] Falha gravando codigo Omie:', e.message);
            }
        }

        await logOmie(base44, {
            endpoint: 'geral/clientes',
            call: 'UpsertCliente',
            operacao: 'enviar_cliente',
            entidade_tipo: 'Cliente',
            entidade_id: clienteData.id,
            status: 'sucesso',
            payload_enviado: JSON.stringify(clienteOmie).slice(0, 5000),
            payload_resposta: JSON.stringify(resultado).slice(0, 5000),
            duracao_ms,
            tentativas: 1
        });

        console.log('[enviarClienteOmie] Cliente enviado:', clienteData.razao_social, '- Omie:', codigoOmie);
        return Response.json({
            sucesso: true,
            cliente_id: clienteData.id,
            codigo_omie: codigoOmie,
            mensagem: resultado.descricao_status || "Cliente enviado com sucesso"
        });

    } catch (error) {
        const msg = String(error?.message || '');
        const msgLower = msg.toLowerCase();

        // CÓDIGO 101 / "já cadastrado" lançado dentro do omieCall = sucesso
        if (msg.includes('101') || msgLower.includes('já cadastrado') || msgLower.includes('ja cadastrado') || msgLower.includes('já existe') || msgLower.includes('duplicidade')) {
            return Response.json({ sucesso: true, ja_cadastrado: true, mensagem: 'Cliente já sincronizado no Omie' });
        }
        // CÓDIGO 6 / REDUNDANT = aviso neutro
        if (msg.includes('-6') || /c[óo]digo\s*6\b/.test(msgLower) || msgLower.includes('redundant') || msgLower.includes('redundante') || msgLower.includes('aguarde')) {
            return Response.json({ sucesso: true, em_processamento: true, mensagem: 'Envio já em processamento, aguarde alguns segundos' });
        }
        console.error('Erro ao enviar cliente para Omie:', error.message);
        return Response.json({ sucesso: false, erro: msg || 'Falha no envio ao Omie' }, { status: 500 });
    }
});