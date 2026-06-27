import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══ omieClient inline (auto-contido) ═══
const OMIE_BASE_URL = 'https://app.omie.com.br/api/v1/';

// FONTE DE VERDADE: Secrets do backend (OMIE_APP_KEY/OMIE_APP_SECRET) — SEMPRE primeiro.
// Sem cache em memória: o Deno.env é atômico e não tem TTL, então nunca serve um app_key
// velho. A entidade ConfiguracaoOmie só é fallback quando o Secret estiver vazio (e pode
// conter um app_key/secret ANTIGO — por isso nunca tem prioridade).
async function getOmieCredentials(base44: any) {
  const envKey = (Deno.env.get('OMIE_APP_KEY') || '').trim();
  const envSecret = (Deno.env.get('OMIE_APP_SECRET') || '').trim();
  if (envKey && envSecret) return { appKey: envKey, appSecret: envSecret };
  const rows = await base44.asServiceRole.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
  const cfg = rows?.[0];
  return { appKey: envKey || String(cfg?.app_key || '').trim(), appSecret: envSecret || String(cfg?.app_secret || '').trim() };
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
          { const _cbId = '6a1e06a9aa62ceab7b3b6d97'; const _cbRows = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: _cbId }, '-created_date', 1).catch(() => []); const _cb = _cbRows?.[0]; const _erros = (_cb?.erros_consecutivos || 0) + 1; const _thresh = _cb?.threshold_erros ?? 3; const _p: any = { erros_consecutivos: _erros, ultimo_erro: String(data.faultstring).slice(0, 500), atualizado_em: new Date().toISOString() }; if (_erros >= _thresh) { _p.bloqueado = true; _p.bloqueado_ate = new Date(Date.now() + 3 * 60000).toISOString(); } await base44.asServiceRole.entities.ControleCircuitBreakerOmie.update(_cbId, _p).catch(() => null); }
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

const ETAPA_STATUS_MAP = {
    '10': 'enviado',
    '20': 'liberado',
    '50': 'faturado',
    '60': 'faturado',
    '70': 'faturado',
    '80': 'cancelado',
};

function formatOmieDate(dateStr) {
    if (!dateStr) return '';
    if (dateStr.includes('/')) {
        const [d, m, y] = dateStr.split('/');
        return `${y}-${m}-${d}`;
    }
    return dateStr;
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();
        if (user?.role !== 'admin') {
            return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
        }

        const body = await req.json();
        const { codigo_pedido_omie } = body;

        if (!codigo_pedido_omie) {
            return Response.json({ error: 'codigo_pedido_omie é obrigatório' }, { status: 400 });
        }

        console.log(`[importarPedidoOmie] Consultando código Omie: ${codigo_pedido_omie}`);

        const result = await omieCall(base44, "ConsultarPedido", { codigo_pedido: Number(codigo_pedido_omie) });

        if (result.faultstring) {
            return Response.json({ sucesso: false, erro: result.faultstring });
        }

        const pedidoOmie = result.pedido_venda_produto || result;
        const cabecalho = pedidoOmie.cabecalho || {};
        const det = pedidoOmie.det || [];
        const infAdic = pedidoOmie.informacoes_adicionais || {};
        const infCadastro = pedidoOmie.infoCadastro || {};

        const codigoPedidoOmie = cabecalho.codigo_pedido;
        const numeroPedido = cabecalho.numero_pedido;
        const etapa = cabecalho.etapa || '10';
        const cancelado = infCadastro.cancelado === 'S';
        const codigoClienteIntegracao = cabecalho.codigo_cliente_integracao;
        const codigoClienteOmie = cabecalho.codigo_cliente;

        console.log(`[importarPedidoOmie] Pedido #${numeroPedido}, etapa ${etapa}, ${det.length} itens, cliente_integ: ${codigoClienteIntegracao}, cliente_omie: ${codigoClienteOmie}`);

        // Verificar duplicata
        const existentes = await base44.asServiceRole.entities.Pedido.filter({ omie_codigo_pedido: codigoPedidoOmie });
        if (existentes.length > 0) {
            return Response.json({ sucesso: false, erro: `Pedido #${numeroPedido} já existe no Base44 (ID: ${existentes[0].id})` });
        }

        // Buscar cliente
        let cliente = null;
        if (codigoClienteIntegracao) {
            try { cliente = await base44.asServiceRole.entities.Cliente.get(codigoClienteIntegracao); } catch (e) {}
            if (!cliente) {
                const porCodigo = await base44.asServiceRole.entities.Cliente.filter({ codigo: codigoClienteIntegracao });
                if (porCodigo.length > 0) cliente = porCodigo[0];
            }
        }
        if (!cliente && codigoClienteOmie) {
            try {
                const cliOmie = await omieCall(base44, "ConsultarCliente", { codigo_cliente_omie: codigoClienteOmie });
                if (!cliOmie.faultstring && cliOmie.cnpj_cpf) {
                    const cpf = cliOmie.cnpj_cpf.replace(/[^\d]/g, '');
                    // 🐛 FIX: usar filter por cnpj_cpf em vez de list(5000) — evita timeout com >1000 clientes
                    const porCnpj = await base44.asServiceRole.entities.Cliente.filter({ cnpj_cpf: cliOmie.cnpj_cpf }).catch(() => []);
                    cliente = porCnpj[0] || null;
                    // Fallback: busca por cnpj sem formatação se não encontrou
                    if (!cliente && cpf) {
                      const porCnpjAlt = await base44.asServiceRole.entities.Cliente.filter({ cnpj_cpf: cpf }).catch(() => []);
                      cliente = porCnpjAlt[0] || null;
                    }
                    if (cliente) console.log(`[importarPedidoOmie] Cliente por CPF/CNPJ: ${cliente.razao_social}`);
                }
            } catch (e) { console.log(`[importarPedidoOmie] Erro busca cliente Omie: ${e.message}`); }
        }

        let vendedor = null;
        if (cliente?.vendedor_id) {
            try { vendedor = await base44.asServiceRole.entities.Vendedor.get(cliente.vendedor_id); } catch (e) {}
        }

        let statusLocal = ETAPA_STATUS_MAP[etapa] || 'enviado';
        if (cancelado) statusLocal = 'cancelado';

        // Itens
        const itensImportados = [];
        let valorTotal = 0;
        for (const d of det) {
            const prod = d.produto || {};
            let prodBase44 = null;
            if (prod.codigo_produto_integracao) {
                try { prodBase44 = await base44.asServiceRole.entities.Produto.get(prod.codigo_produto_integracao); } catch (e) {}
            }
            if (!prodBase44 && prod.codigo) {
                const pc = await base44.asServiceRole.entities.Produto.filter({ codigo: prod.codigo });
                if (pc.length > 0) prodBase44 = pc[0];
            }
            const vItem = (prod.quantidade || 0) * (prod.valor_unitario || 0);
            valorTotal += vItem;
            itensImportados.push({
                produto_id: prodBase44?.id || prod.codigo_produto_integracao || '',
                produto_codigo: prodBase44?.codigo || prod.codigo || '',
                produto_nome: prodBase44?.nome || prod.descricao || '',
                quantidade: prod.quantidade || 0,
                valor_unitario: prod.valor_unitario || 0,
                valor_total: vItem,
            });
        }

        // Criar pedido
        const pedidoData = {
            numero_pedido: String(numeroPedido),
            tipo: 'venda',
            status: statusLocal,
            cliente_id: cliente?.id || '',
            cliente_codigo: cliente?.codigo || codigoClienteIntegracao || '',
            cliente_nome: cliente?.razao_social || '',
            cliente_nome_fantasia: cliente?.nome_fantasia || '',
            cliente_endereco: cliente?.endereco || '',
            cliente_numero: cliente?.numero || '',
            cliente_bairro: cliente?.bairro || '',
            cliente_cidade: cliente?.cidade || '',
            cliente_estado: cliente?.estado || '',
            cliente_cep: cliente?.cep || '',
            cliente_cpf_cnpj: cliente?.cpf_cnpj || '',
            vendedor_id: vendedor?.id || '',
            vendedor_nome: vendedor?.nome || '',
            plano_pagamento_id: cliente?.plano_pagamento_id || '',
            tabela_preco_id: cliente?.tabela_id || '',
            modelo_nota: '55',
            data_previsao_entrega: cabecalho.data_previsao ? formatOmieDate(cabecalho.data_previsao) : '',
            total_itens: itensImportados.length,
            valor_total: valorTotal,
            data_envio: new Date().toISOString(),
            omie_codigo_pedido: codigoPedidoOmie,
            omie_enviado: true,
            omie_erro: null,
            dados_adicionais_nf: infAdic.dados_adicionais_nf || '',
        };

        if (statusLocal === 'liberado') {
            pedidoData.liberado_por = user.email;
            pedidoData.liberado_por_nome = user.full_name;
            pedidoData.data_liberacao = new Date().toISOString();
        }

        const novoPedido = await base44.asServiceRole.entities.Pedido.create(pedidoData);

        for (const item of itensImportados) {
            await base44.asServiceRole.entities.PedidoItem.create({ pedido_id: novoPedido.id, ...item });
        }

        console.log(`[importarPedidoOmie] Importado! ID: ${novoPedido.id}, #${numeroPedido}, ${itensImportados.length} itens, R$ ${valorTotal.toFixed(2)}`);

        return Response.json({
            sucesso: true,
            pedido_id: novoPedido.id,
            numero_pedido: numeroPedido,
            codigo_omie: codigoPedidoOmie,
            status: statusLocal,
            cliente: cliente?.razao_social || 'Não identificado',
            itens: itensImportados.length,
            valor_total: valorTotal,
            mensagem: `Pedido #${numeroPedido} importado com sucesso!`
        });

    } catch (error) {
        console.error('[importarPedidoOmie] Erro:', error.message);
        const bloqueada = error?.code === 'OMIE_425';
        return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
    }
});