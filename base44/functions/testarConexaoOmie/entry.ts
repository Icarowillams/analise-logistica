import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
import { omieCall, checkCircuitBreaker } from '../_shared/omieClient/entry.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Verificar circuit breaker antes de chamar
    const cb = await checkCircuitBreaker(base44);
    if (cb.blocked) {
      return Response.json({
        ok: false,
        bloqueado: true,
        bloqueado_ate: cb.blockedUntil,
        error: `Circuit breaker ativo até ${cb.blockedUntil}`
      }, { status: 425 });
    }

    const startedAt = Date.now();
    let json: any;
    try {
      // ✅ Correto: endpoint='geral/empresas/', call em options
      json = await omieCall(base44, 'geral/empresas/', { pagina: 1, registros_por_pagina: 1, apenas_importado_api: 'N' }, {
        call: 'ListarEmpresas',
        operation: 'testar_conexao'
      });
    } catch (error: any) {
      const duracao_ms = Date.now() - startedAt;
      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'geral/empresas',
        call: 'ListarEmpresas',
        operacao: 'testar_conexao',
        status: 'erro',
        codigo_erro: error.faultcode || '',
        mensagem_erro: error.message,
        duracao_ms,
        tentativas: 1,
        usuario_email: user.email
      }).catch(() => {});

      return Response.json({
        ok: false,
        bloqueado: error.bloqueado || false,
        bloqueado_ate: error.bloqueado_ate || null,
        error: error.message,
        code: error.faultcode || null,
        duracao_ms
      });
    }

    const duracao_ms = Date.now() - startedAt;
    const empresa = (json as any)?.empresas_cadastro?.[0] || {};
    return Response.json({
      ok: true,
      duracao_ms,
      empresa: {
        razao_social: empresa.razao_social,
        cnpj: empresa.cnpj,
        nome_fantasia: empresa.nome_fantasia
      },
      total_empresas: (json as any)?.total_de_registros || 0
    });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});
