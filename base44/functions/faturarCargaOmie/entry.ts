import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const OMIE_URL = 'https://app.omie.com.br/api/v1/produtos/pedido/';
const OMIE_FAT_URL = 'https://app.omie.com.br/api/v1/produtos/pedidovendafat/';

// Verifica circuit breaker — bloqueia faturamento se a API Omie estiver indisponível por consumo indevido (425).
// Esta function não chama a API diretamente, mas cria a fila de emissão; abortar cedo evita enfileirar com a API bloqueada.
async function checarBloqueioOmie(base44) {
  const cb = await base44.asServiceRole.entities.ControleCircuitBreakerOmie.filter({ id: '6a1e06a9aa62ceab7b3b6d97' }, '-created_date', 1).catch(() => []);
  const controle = cb?.[0];
  if (controle?.bloqueado && controle.bloqueado_ate && new Date(controle.bloqueado_ate) > new Date()) {
    const err = new Error(`API Omie temporariamente bloqueada por consumo indevido. Desbloqueio previsto: ${new Date(controle.bloqueado_ate).toLocaleString('pt-BR')}.`);
    err.code = 'OMIE_425';
    err.bloqueado_ate = controle.bloqueado_ate;
    throw err;
  }
}

// Fatura uma carga: muda etapa de cada pedido da etapa atual → etapa destino (default 60 = faturar)
// bloqueia tipo_nota='D1' (venda interna sem NF)
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Verificar circuit breaker antes de prosseguir
    await checarBloqueioOmie(base44);

    const body = await req.json().catch(() => ({}));
    const { carga_id, etapa_destino = '50' } = body;
    if (!carga_id) return Response.json({ error: 'carga_id obrigatório' }, { status: 400 });

    let carga;
    try {
      carga = await base44.asServiceRole.entities.Carga.get(carga_id);
    } catch (e) {
      if (/not found/i.test(e.message)) {
        return Response.json({ error: 'Carga não encontrada' }, { status: 404 });
      }
      throw e;
    }
    if (!carga) return Response.json({ error: 'Carga não encontrada' }, { status: 404 });

    const pedidos = carga.pedidos_omie || [];
    const resultados = [];

    // ENRIQUECIMENTO BEST-EFFORT: paralelo (Promise.all) — N awaits sequenciais → 1 rodada paralela
    // 🐛 FIX otimização: com 50 usuários e cargas de 20-30 pedidos, loop sequencial virava gargalo
    const avisosCampos = [];
    await Promise.all(pedidos.map(async (p) => {
      if (p.tipo_nota === 'D1') return;

      if (!p.cnpj_cpf_cliente || !p.nome_cliente) {
        try {
          let cliente = null;
          if (p.cliente_id) {
            cliente = await base44.asServiceRole.entities.Cliente.get(p.cliente_id).catch(() => null);
          }
          if (!cliente && p.codigo_cliente) {
            const porOmie = await base44.asServiceRole.entities.Cliente.filter({ codigo_omie: String(p.codigo_cliente) }, '-updated_date', 1).catch(() => []);
            cliente = porOmie?.[0] || null;
          }
          if (cliente) {
            if (!p.cnpj_cpf_cliente) p.cnpj_cpf_cliente = cliente.cnpj_cpf || '';
            if (!p.nome_cliente) p.nome_cliente = cliente.razao_social || cliente.nome_fantasia || '';
            if (!p.nome_fantasia) p.nome_fantasia = cliente.nome_fantasia || '';
            if (!p.cliente_id) p.cliente_id = cliente.id;
          }
        } catch { /* fallback silencioso */ }
      }

      const faltando = [];
      if (!p.codigo_pedido) faltando.push('codigo_pedido');
      if (!p.cnpj_cpf_cliente) faltando.push('cnpj_cpf_cliente');
      if (!p.nome_cliente) faltando.push('nome_cliente');
      if (faltando.length > 0) {
        avisosCampos.push({ numero_pedido: p.numero_pedido || p.codigo_pedido || '(sem id)', faltando: faltando.join(', ') });
      }
    }));
    // Registrar avisos em log, mas NUNCA bloquear
    if (avisosCampos.length > 0) {
      const detalhe = avisosCampos.map(p => `Pedido ${p.numero_pedido} (sem: ${p.faltando})`).join(' | ');
      await base44.asServiceRole.entities.LogIntegracaoOmie.create({
        endpoint: 'produtos/pedido',
        call: 'faturarCarga_enriquecimento',
        operacao: 'faturar_carga',
        entidade_tipo: 'Carga',
        entidade_id: carga_id,
        status: 'warning',
        mensagem_erro: `Campos faltando (não bloqueante): ${detalhe}`.substring(0, 2000),
        usuario_email: user.email
      }).catch(() => {});
    }

    // ATENÇÃO: Esta função NÃO altera etapa no Omie e NÃO emite NF.
    // Ela apenas marca a carga/pedidos como faturados localmente para liberar a tela "Notas Omie → Emissão".
    for (const p of pedidos) {
      if (p.tipo_nota === 'D1') {
        resultados.push({ codigo_pedido: p.codigo_pedido, skip: true, motivo: 'cliente D1 - não emite NF' });
        continue;
      }

      resultados.push({
        codigo_pedido: p.codigo_pedido,
        sucesso: true,
        etapa_atual: p.etapa || null,
        nf_emitida: false,
        numero_nf: null,
        mensagem: 'Carga faturada localmente. Use "Notas Omie → Emissão" para gerar a NF-e no Omie.'
      });
    }

    const sucessos = resultados.filter(r => r.sucesso).length;
    const erros = resultados.filter(r => r.sucesso === false).length;
    const skips = resultados.filter(r => r.skip).length;
    const nfsEmitidas = 0;
    const aguardandoNf = sucessos;

    // Status local binário: faturar a carga sempre a marca como "faturada".
    const novoStatus = 'faturada';
    const novaDataFat = carga.data_faturamento || new Date().toISOString();

    // Persistir números de NF retornados nos pedidos_omie da carga + montar notas_fiscais[]
    // Sem isso o Romaneio, Boletos e impressão das NFs ficam sem número.
    const mapaNfPorPedido = new Map();
    for (const r of resultados) {
      if (r.numero_nf) mapaNfPorPedido.set(String(r.codigo_pedido), String(r.numero_nf));
    }
    // 🛡️ REGRA IMUTÁVEL: numero_nf preenchido NUNCA é apagado. Só preenchemos quando o
    // valor local está vazio E o Omie retornou um número válido. Usamos os pedidos já
    // enriquecidos acima (variável `pedidos`) para não perder cnpj/nome resolvidos.
    const pedidosOmieAtualizados = pedidos.map(p => {
      const nfNova = mapaNfPorPedido.get(String(p.codigo_pedido));
      if (nfNova && !p.numero_nf) {
        return { ...p, numero_nf: String(nfNova) };
      }
      return p;
    });
    // notas_fiscais[] apenas com valores reais (sem mesclar com lixo anterior)
    const notasFiscaisAtualizadas = Array.from(new Set(
      pedidosOmieAtualizados.map(p => p.numero_nf).filter(Boolean).map(String)
    ));

    await base44.asServiceRole.entities.Carga.update(carga_id, {
      status_carga: novoStatus,
      data_faturamento: novaDataFat,
      pedidos_omie: pedidosOmieAtualizados,
      notas_fiscais: notasFiscaisAtualizadas
    });

    // Atualiza a entidade Pedido local — marca como faturado (mesmo sem NF emitida,
    // pois "faturar carga" agora só move para etapa 50). A NF será gerada depois.
    for (const r of resultados) {
      if (!r.sucesso || !r.codigo_pedido) continue;
      try {
        const pedidosLocais = await base44.asServiceRole.entities.Pedido.filter({
          omie_codigo_pedido: String(r.codigo_pedido)
        });
        for (const pl of pedidosLocais) {
          // 🐛 FIX: status: 'montagem' — aguardando emissão real da NF.
          // status_faturamento: 'pendente' — permite filtro correto na tela de emissão de NF.
          // Só marca 'faturado' de verdade após NF emitida (emitirNfPedidoOmie).
          await base44.asServiceRole.entities.Pedido.update(pl.id, {
            faturado: false,
            status: 'montagem',
            status_faturamento: 'pendente',
            solto_manualmente: false
          });
        }
      } catch { /* não bloqueia o fluxo */ }
    }

    // Pedidos internos (D1 / Troca / Bonificação) também viram "faturado" quando a carga é faturada.
    // Eles não passam por NF no Omie, mas para fins gerenciais (Gerenciar Pedidos) precisam refletir o status.
    if (novoStatus === 'faturada') {
      const internosCarga = carga.pedidos_internos || [];
      const trocasCarga = carga.pedidos_troca || [];
      const idsInternos = [
        ...internosCarga.map(p => p.pedido_id).filter(Boolean),
        ...trocasCarga.map(t => t.pedido_id).filter(Boolean)
      ];
      for (const pedidoId of idsInternos) {
        try {
          // Pedidos internos (D1/Bonificação) não emitem NF — podem ser marcados como faturados
          await base44.asServiceRole.entities.Pedido.update(pedidoId, {
            faturado: true,
            data_faturamento: new Date().toISOString(),
            status: 'faturado',
            status_faturamento: 'faturado'
          });
        } catch { /* não bloqueia o fluxo */ }
      }
      // Trocas via entidade PedidoTroca também: buscar pedido local com mesmo numero_pedido e tipo='troca'
      for (const t of trocasCarga) {
        if (t.pedido_id) continue;
        if (!t.numero_pedido) continue;
        try {
          const matches = await base44.asServiceRole.entities.Pedido.filter({
            numero_pedido: t.numero_pedido,
            tipo: 'troca'
          });
          for (const pl of matches) {
            await base44.asServiceRole.entities.Pedido.update(pl.id, {
              faturado: true,
              data_faturamento: new Date().toISOString(),
              status: 'faturado',
              status_faturamento: 'faturado'
            });
          }
        } catch { /* não bloqueia o fluxo */ }
      }
    }

    const errosDetalhados = resultados
      .filter(r => r.sucesso === false)
      .map(r => `Pedido ${r.codigo_pedido}: ${r.mensagem}`)
      .join(' | ');

    await base44.asServiceRole.entities.LogIntegracaoOmie.create({
      endpoint: 'produtos/pedido',
      call: 'AlterarPedidoVenda',
      operacao: 'faturar_carga',
      entidade_tipo: 'Carga',
      entidade_id: carga_id,
      status: erros > 0 ? 'erro_omie' : 'sucesso',
      mensagem_erro: erros > 0 ? `${erros} pedidos falharam: ${errosDetalhados}`.substring(0, 2000) : null,
      erro_detalhado: erros > 0 ? errosDetalhados.substring(0, 2000) : null,
      payload_resposta: JSON.stringify(resultados).substring(0, 2000),
      usuario_email: user.email
    }).catch(() => {});

    // IMPORTANTE: Faturar carga é uma operação LOCAL e SILENCIOSA.
    // NÃO cria fila de emissão de NF nem dispara emissão em background.
    // A emissão de NF-e é feita manualmente em "Notas Omie → Emissão".

    return Response.json({
      sucesso: true,
      total: pedidos.length,
      sucessos,
      erros,
      skips,
      nfs_emitidas: nfsEmitidas,
      aguardando_nf: aguardandoNf,
      mensagem: `Carga ${carga.numero_carga || ''} faturada com sucesso.`,
      resultados
    });
  } catch (error) {
    const bloqueada = error?.code === 'OMIE_425';
    return Response.json({ error: error.message, omie_bloqueada: bloqueada, bloqueado_ate: error?.bloqueado_ate || null }, { status: bloqueada ? 425 : 500 });
  }
});