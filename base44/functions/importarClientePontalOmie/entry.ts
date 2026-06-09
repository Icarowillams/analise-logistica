import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';
let _credsCache: { appKey: string; appSecret: string; at: number } | null = null;

async function getOmieCredentials(base44: any) {
  if (_credsCache && Date.now() - _credsCache.at < 30_000) return _credsCache;
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  const appKey = cfg?.app_key || Deno.env.get('OMIE_APP_KEY') || '';
  const appSecret = cfg?.app_secret || Deno.env.get('OMIE_APP_SECRET') || '';
  _credsCache = { appKey, appSecret, at: Date.now() };
  return { appKey, appSecret };
}

async function omieCall(base44: any, call: string, param: unknown) {
  const { appKey, appSecret } = await getOmieCredentials(base44);
  if (!appKey || !appSecret) throw new Error('Credenciais Omie não configuradas.');
  const url = OMIE_BASE_URL + 'geral/clientes/';
  const RETRIES = [1000, 2000, 4000];
  let lastErr = '';
  for (let i = 0; i <= RETRIES.length; i++) {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }),
        signal: ctrl.signal
      });
      clearTimeout(tid);
      const data = await res.json();
      if (data.faultstring) {
        const msg = String(data.faultstring).toLowerCase();
        if (res.status === 429 || msg.includes('cota') || msg.includes('aguarde') || msg.includes('redundante')) {
          lastErr = data.faultstring;
          if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
        }
        throw new Error(data.faultstring);
      }
      await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update('6a1e06a9aa62ceab7b3b6d97', { erros_consecutivos: 0, atualizado_em: new Date().toISOString() }).catch(() => null);
      return data;
    } catch (e: any) {
      lastErr = e.name === 'AbortError' ? 'Timeout' : e.message;
      if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas excedido');
}
// ═══ fim omieClient inline ═══

const onlyDigits = (s: any) => String(s || '').replace(/\D/g, '');

// Extrai codigo_interno do campo tags do Omie (formato "COD:XXXXX")
function extrairCodigoInternoDosTags(tags: any[]): string {
  if (!Array.isArray(tags)) return '';
  for (const t of tags) {
    const match = String(t?.tag || '').match(/^COD:(.+)$/i);
    if (match) return match[1].trim();
  }
  return '';
}

// Mapeia registro do Omie (ConsultarCliente) para campos da entidade Cliente Base44
function mapearOmieParaBase44(omie: any): Record<string, any> {
  const pessoaFisica = omie.pessoa_fisica === 'S';
  const inativo = omie.inativo === 'S';

  const codigoInternoTag = extrairCodigoInternoDosTags(omie.tags);

  return {
    // Identificação
    codigo_omie:        String(omie.codigo_cliente_omie || ''),
    codigo_cliente_omie: String(omie.codigo_cliente_omie || ''),
    codigo_integracao:  String(omie.codigo_cliente_integracao || ''),
    codigo_interno:     codigoInternoTag || String(omie.codigo_cliente_omie || ''),

    // Dados principais
    razao_social:       (omie.razao_social || '').trim(),
    nome_fantasia:      (omie.nome_fantasia || '').trim(),
    cnpj_cpf:           onlyDigits(omie.cnpj_cpf),
    tipo_pessoa:        pessoaFisica ? 'fisica' : 'juridica',
    inscricao_estadual: omie.inscricao_estadual === 'ISENTO' ? '' : (omie.inscricao_estadual || ''),

    // Endereço
    endereco:           (omie.endereco || '').trim(),
    numero:             (omie.endereco_numero || '').trim(),
    complemento:        (omie.complemento || '').trim(),
    bairro:             (omie.bairro || '').trim(),
    cidade:             (omie.cidade || '').trim(),
    estado:             (omie.estado || '').trim(),
    cep:                onlyDigits(omie.cep),

    // Contato
    email:              (omie.email || '').trim(),
    telefone:           (omie.telefone_comercial || omie.fone_comercial || '').trim(),

    // Status
    status:             inativo ? 'inativo' : 'ativo',
  };
}

// ═══ Handler principal ═══
// Body: { codigos_omie: number[] }
// Para cada codigo_omie:
//   1. ConsultarCliente no Omie
//   2. Verifica se já existe no Base44 por CNPJ ou codigo_omie
//   3. Se não existir, cria; se existir, atualiza codigo_omie

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Apenas admins' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const codigos: number[] = (body.codigos_omie || []).map(Number).filter(Boolean);
    if (!codigos.length) return Response.json({ error: 'codigos_omie obrigatório (array de números)' }, { status: 400 });

    return Response.json(await processarImportacao(base44, codigos));
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
});

async function processarImportacao(base44: any, codigos: number[]) {
  // Pré-carrega todos os clientes Base44 para lookups O(1)
  const todosClientes = await base44.asServiceRole.entities.Cliente.list();
  const porCnpj = new Map<string, any>();
  const porCodigoOmie = new Map<string, any>();
  for (const c of todosClientes) {
    const doc = onlyDigits(c.cnpj_cpf);
    if (doc) porCnpj.set(doc, c);
    const cod = String(c.codigo_omie || c.codigo_cliente_omie || '');
    if (cod) porCodigoOmie.set(cod, c);
  }

  const resultados: any[] = [];

  for (const codigoOmie of codigos) {
    const resultado: any = { codigo_omie: codigoOmie, acao: null, erro: null, cliente_id: null };
    try {
      // 1. Consultar no Omie
      const omieData = await omieCall(base44, 'ConsultarCliente', { codigo_cliente_omie: codigoOmie });
      const omie = omieData?.clientes_cadastro?.[0] ?? omieData;

      if (!omie?.razao_social && !omie?.cnpj_cpf) {
        resultado.acao = 'nao_encontrado_no_omie';
        resultado.erro = `Omie não retornou dados para código ${codigoOmie}`;
        resultados.push(resultado);
        continue;
      }

      resultado.razao_social = omie.razao_social;
      resultado.cnpj_cpf = onlyDigits(omie.cnpj_cpf);

      const campos = mapearOmieParaBase44(omie);
      const docNorm = onlyDigits(omie.cnpj_cpf);
      const codStr = String(codigoOmie);

      // 2. Verificar existência
      const existentePorCod  = porCodigoOmie.get(codStr) || null;
      const existentePorCnpj = docNorm ? porCnpj.get(docNorm) : null;
      const existente = existentePorCod || existentePorCnpj || null;

      if (existente) {
        // Já existe — atualiza apenas codigo_omie/codigo_cliente_omie se estiver vazio
        const precisaAtualizar =
          !existente.codigo_omie ||
          !existente.codigo_cliente_omie ||
          String(existente.codigo_omie) !== codStr;

        if (precisaAtualizar) {
          await base44.asServiceRole.entities.Cliente.update(existente.id, {
            codigo_omie: codStr,
            codigo_cliente_omie: codStr,
          });
          resultado.acao = 'vinculado_codigo_omie';
        } else {
          resultado.acao = 'ja_existe_sem_alteracao';
        }
        resultado.cliente_id = existente.id;
        resultado.razao_social = existente.razao_social;
      } else {
        // 3. Não existe — criar
        const novoCliente = await base44.asServiceRole.entities.Cliente.create(campos);
        resultado.acao = 'criado';
        resultado.cliente_id = novoCliente.id;
        resultado.campos_criados = Object.keys(campos);
        // Atualizar índices locais para evitar duplicata no próximo loop
        porCodigoOmie.set(codStr, novoCliente);
        if (docNorm) porCnpj.set(docNorm, novoCliente);
      }

      // Throttle entre chamadas Omie
      await new Promise(r => setTimeout(r, 300));
    } catch (e: any) {
      resultado.acao = 'erro';
      resultado.erro = e.message;
    }
    resultados.push(resultado);
  }

  const criados    = resultados.filter(r => r.acao === 'criado').length;
  const vinculados = resultados.filter(r => r.acao === 'vinculado_codigo_omie').length;
  const existentes = resultados.filter(r => r.acao === 'ja_existe_sem_alteracao').length;
  const erros      = resultados.filter(r => r.acao === 'erro').length;

  return { sucesso: true, resumo: { criados, vinculados, ja_existentes: existentes, erros }, resultados };
}
