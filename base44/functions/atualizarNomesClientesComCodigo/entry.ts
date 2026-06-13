import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache = null;

async function getOmieCredentials(base44) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  let appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  let appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function checkCircuitBreaker(base44) {
  const rows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ chave: 'principal' }, 'created_date', 1).catch(() => []);
  const c = rows?.[0];
  if (!c?.bloqueado) return { blocked: false };
  if (c.bloqueado_ate && new Date(c.bloqueado_ate).getTime() <= Date.now()) {
    await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(c.id, { bloqueado: false, atualizado_em: new Date().toISOString() }).catch(() => null);
    return { blocked: false };
  }
  return { blocked: true, blockedUntil: c.bloqueado_ate, lastError: c.ultimo_erro };
}

async function omieCall(base44, endpoint, param, options = {}) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  const call = options.call || '';
  if (!appKey || !appSecret) throw new Error('Credenciais Omie nao configuradas.');
  const cb = await checkCircuitBreaker(base44);
  if (cb.blocked) throw new Error(`API Omie bloqueada ate ${cb.blockedUntil}`);
  const url = /^https?:\/\//i.test(endpoint) ? endpoint : OMIE_BASE_URL + endpoint.replace(/^\/+/, '');
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }),
      signal: controller.signal
    });
    clearTimeout(tid);
    const data = await res.json();
    if (data.faultstring) {
      throw new Error(data.faultstring);
    }
    return data;
  } finally {
    clearTimeout(tid);
  }
}

function normalizarCpfCnpj(doc) {
  return (doc || '').replace(/[.\-\/\s]/g, '');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Apenas administradores podem executar esta operacao' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const apenasSimular = body.simular === true;

    console.log('[atualizarNomesClientesComCodigo] Iniciando... simular:', apenasSimular);

    // Etapa 1: Ler todos os clientes ativos com codigo_interno (em lotes)
    let todosClientes = [];
    let pagina = 0;
    const TAMANHO_LOTE = 100;
    while (true) {
      const lote = await base44.asServiceRole.entities.Cliente.list('-updated_date', TAMANHO_LOTE, pagina * TAMANHO_LOTE);
      if (!lote || lote.length === 0) break;
      todosClientes.push(...lote);
      if (lote.length < TAMANHO_LOTE) break;
      pagina++;
    }

    console.log(`[atualizarNomesClientesComCodigo] Total de clientes: ${todosClientes.length}`);

    // Etapa 2: Filtrar apenas clientes com codigo_interno e que ainda nao tem o prefixo
    const clientesParaAtualizar = [];
    const clientesJaAtualizados = [];

    for (const c of todosClientes) {
      const codigo = c.codigo_interno;
      if (!codigo) continue;

      const nomeAtual = c.nome_fantasia || '';
      const prefixo = `[${codigo}] `;

      if (nomeAtual.startsWith(prefixo)) {
        clientesJaAtualizados.push(c);
        continue;
      }

      // Verifica se ja tem algum prefixo [XXX] no inicio
      const prefixoExistente = nomeAtual.match(/^\[\d+\]\s/);
      if (prefixoExistente) {
        // Substituir prefixo antigo pelo novo
        const novoNome = prefixo + nomeAtual.substring(prefixoExistente[0].length);
        clientesParaAtualizar.push({ ...c, novo_nome_fantasia: novoNome });
      } else {
        const novoNome = prefixo + nomeAtual;
        clientesParaAtualizar.push({ ...c, novo_nome_fantasia: novoNome });
      }
    }

    console.log(`[atualizarNomesClientesComCodigo] Clientes para atualizar: ${clientesParaAtualizar.length}`);
    console.log(`[atualizarNomesClientesComCodigo] Clientes ja atualizados: ${clientesJaAtualizados.length}`);

    if (apenasSimular) {
      return Response.json({
        sucesso: true,
        simulado: true,
        total_clientes: todosClientes.length,
        para_atualizar: clientesParaAtualizar.length,
        ja_atualizados: clientesJaAtualizados.length,
        exemplos: clientesParaAtualizar.slice(0, 10).map(c => ({
          codigo: c.codigo_interno,
          nome_antigo: c.nome_fantasia,
          nome_novo: c.novo_nome_fantasia
        }))
      });
    }

    // Etapa 3: Atualizar no Base44 e sincronizar com Omie (com intervalo entre chamadas)
    let atualizadosBase44 = 0;
    let sincronizadosOmie = 0;
    let erros = 0;
    const detalhesErros = [];

    for (let i = 0; i < clientesParaAtualizar.length; i++) {
      const c = clientesParaAtualizar[i];
      
      try {
        // Atualizar nome_fantasia no Base44
        await base44.asServiceRole.entities.Cliente.update(c.id, {
          nome_fantasia: c.novo_nome_fantasia
        });
        atualizadosBase44++;

        // Sincronizar com Omie
        try {
          const cnpjCpfLimpo = normalizarCpfCnpj(c.cnpj_cpf);
          
          const clienteOmie = {
            codigo_cliente_integracao: c.codigo_integracao || c.id,
            razao_social: (c.razao_social || 'Cliente sem nome').substring(0, 60),
            nome_fantasia: c.novo_nome_fantasia.substring(0, 100),
            cnpj_cpf: cnpjCpfLimpo,
            pessoa_fisica: cnpjCpfLimpo.length <= 11 ? 'S' : 'N',
          };

          // Se tem codigo Omie, usa para update
          if (c.codigo_cliente_omie || c.codigo_omie) {
            clienteOmie.codigo_cliente_omie = Number(c.codigo_cliente_omie || c.codigo_omie);
          }

          await omieCall(base44, 'geral/clientes/', clienteOmie, { call: 'UpsertCliente' });
          sincronizadosOmie++;
        } catch (omieErr) {
          if (String(omieErr.message).toLowerCase().includes('bloqueada')) {
            throw omieErr; // Para o processo se API bloqueada
          }
          erros++;
          detalhesErros.push(`[${c.codigo_interno}] ${c.razao_social}: Omie - ${omieErr.message}`);
        }
      } catch (err) {
        erros++;
        detalhesErros.push(`[${c.codigo_interno}] ${c.razao_social}: ${err.message}`);
        
        if (String(err.message).toLowerCase().includes('bloqueada')) {
          console.error('[atualizarNomesClientesComCodigo] API Omie bloqueada, parando...');
          break;
        }
      }

      // Intervalo entre chamadas (1 por segundo para nao sobrecarregar)
      if (i < clientesParaAtualizar.length - 1) {
        await new Promise(r => setTimeout(r, 250));
      }
    }

    console.log(`[atualizarNomesClientesComCodigo] Finalizado: ${atualizadosBase44} Base44, ${sincronizadosOmie} Omie, ${erros} erros`);

    return Response.json({
      sucesso: true,
      total_clientes: todosClientes.length,
      atualizados_base44: atualizadosBase44,
      sincronizados_omie: sincronizadosOmie,
      ja_atualizados: clientesJaAtualizados.length,
      erros,
      erros_detalhes: detalhesErros.slice(0, 20)
    });

  } catch (error) {
    console.error('[atualizarNomesClientesComCodigo] Erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});