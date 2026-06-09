import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Função temporária sem autenticação.
// Importa os clientes Omie 28946 e 28964 para o Base44.

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
      return data;
    } catch (e: any) {
      lastErr = e.name === 'AbortError' ? 'Timeout' : e.message;
      if (i < RETRIES.length) { await new Promise(r => setTimeout(r, RETRIES[i])); continue; }
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr || 'Máximo de tentativas excedido');
}

const onlyDigits = (s: any) => String(s || '').replace(/\D/g, '');

function extrairCodigoInternoDosTags(tags: any[]): string {
  if (!Array.isArray(tags)) return '';
  for (const t of tags) {
    const match = String(t?.tag || '').match(/^COD:(.+)$/i);
    if (match) return match[1].trim();
  }
  return '';
}

function mapearOmieParaBase44(omie: any): Record<string, any> {
  const pessoaFisica = omie.pessoa_fisica === 'S';
  const inativo = omie.inativo === 'S';
  const codigoInternoTag = extrairCodigoInternoDosTags(omie.tags);
  return {
    codigo_omie:         String(omie.codigo_cliente_omie || ''),
    codigo_cliente_omie: String(omie.codigo_cliente_omie || ''),
    codigo_integracao:   String(omie.codigo_cliente_integracao || ''),
    codigo_interno:      codigoInternoTag || String(omie.codigo_cliente_omie || ''),
    razao_social:        (omie.razao_social || '').trim(),
    nome_fantasia:       (omie.nome_fantasia || '').trim(),
    cnpj_cpf:            onlyDigits(omie.cnpj_cpf),
    tipo_pessoa:         pessoaFisica ? 'fisica' : 'juridica',
    inscricao_estadual:  omie.inscricao_estadual === 'ISENTO' ? '' : (omie.inscricao_estadual || ''),
    endereco:            (omie.endereco || '').trim(),
    numero:              (omie.endereco_numero || '').trim(),
    complemento:         (omie.complemento || '').trim(),
    bairro:              (omie.bairro || '').trim(),
    cidade:              (omie.cidade || '').trim(),
    estado:              (omie.estado || '').trim(),
    cep:                 onlyDigits(omie.cep),
    email:               (omie.email || '').trim(),
    telefone:            (omie.telefone_comercial || omie.fone_comercial || '').trim(),
    status:              inativo ? 'inativo' : 'ativo',
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const CODIGOS = [28946, 28964];

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

    for (const codigoOmie of CODIGOS) {
      const resultado: any = { codigo_omie: codigoOmie, acao: null, erro: null, cliente_id: null };
      try {
        const omieData = await omieCall(base44, 'ConsultarCliente', { codigo_cliente_omie: codigoOmie });
        // ConsultarCliente pode retornar o objeto diretamente ou dentro de clientes_cadastro
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
        const codStr  = String(codigoOmie);

        const existente = porCodigoOmie.get(codStr) || (docNorm ? porCnpj.get(docNorm) : null) || null;

        if (existente) {
          const precisaAtualizar = !existente.codigo_omie || String(existente.codigo_omie) !== codStr;
          if (precisaAtualizar) {
            await base44.asServiceRole.entities.Cliente.update(existente.id, {
              codigo_omie: codStr,
              codigo_cliente_omie: codStr,
            });
            resultado.acao = 'vinculado_codigo_omie';
          } else {
            resultado.acao = 'ja_existe_sem_alteracao';
          }
          resultado.cliente_id  = existente.id;
          resultado.razao_social = existente.razao_social;
        } else {
          const novo = await base44.asServiceRole.entities.Cliente.create(campos);
          resultado.acao = 'criado';
          resultado.cliente_id = novo.id;
          resultado.campos_criados = Object.keys(campos);
          porCodigoOmie.set(codStr, novo);
          if (docNorm) porCnpj.set(docNorm, novo);
        }

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

    return Response.json({
      sucesso: true,
      resumo: { criados, vinculados, ja_existentes: existentes, erros },
      resultados
    });
  } catch (e: any) {
    console.error('[execOnceImportarClientes]', e.message);
    return Response.json({ sucesso: false, erro: e.message }, { status: 500 });
  }
});

