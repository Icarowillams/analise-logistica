import { useEffect, useState, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

// Hook central da tela de Montagem de Carga (otimizado via espelho local em tempo real).
//
// Arquitetura:
//   - Vendas Omie (etapa 20) → lidas de PedidoLiberadoOmie (espelho mantido por webhook + backup 1h)
//   - Pedidos D1 internos    → Pedido (modelo_nota=d1, status=liberado, sem carga_id)
//   - Trocas                 → PedidoTroca (status=aprovado, sem carga_id)
//   - Tempo real             → subscribe em PedidoLiberadoOmie, Pedido e PedidoTroca
//
// Mantém EXATAMENTE a mesma forma final de cada pedido (compatível com PedidosPorRota, ProdutosConsolidados, etc).

export default function useDadosMontagem() {
  const [loading, setLoading] = useState(true);
  const [pedidos, setPedidos] = useState([]);
  const [motoristas, setMotoristas] = useState([]);
  const [veiculos, setVeiculos] = useState([]);
  const [cargas, setCargas] = useState([]);
  const refreshTimer = useRef(null);

  // Função única que reconstrói todos os pedidos a partir das fontes locais
  const carregar = useCallback(async () => {
    try {
      const [motP, veiP, carP, espelhoOmie, todosPedidosLocais, trocasAprovadas, clientes, rotas] = await Promise.all([
        base44.entities.Motorista.list('-created_date', 500),
        base44.entities.Veiculo.list('-created_date', 500),
        base44.entities.Carga.list('-created_date', 500),
        base44.entities.PedidoLiberadoOmie.list('-created_date', 5000),
        base44.entities.Pedido.list('-created_date', 1000),
        base44.entities.PedidoTroca.filter({ status: 'aprovado' }, '-created_date', 500),
        base44.entities.Cliente.list('-created_date', 5000),
        base44.entities.Rota.list('-created_date', 500)
      ]);

      setMotoristas(motP.filter(m => m.status === 'ativo'));
      setVeiculos(veiP.filter(v => v.ativo !== false));
      setCargas(carP);

      const clientesMap = new Map((clientes || []).map(c => [c.id, c]));
      const rotasMap = new Map((rotas || []).map(r => [r.id, r.nome]));

      // Conjunto de códigos de pedido Omie já vinculados a alguma carga ATIVA (não cancelada)
      // Protege contra duplicidade: um pedido já em outra carga nunca pode reaparecer na montagem,
      // mesmo se o espelho ainda estiver com etapa desatualizada (timing do Omie x webhook).
      const codigosEmCarga = new Set();
      (carP || [])
        .filter(c => c.status_carga !== 'cancelada')
        .forEach(c => {
          (c.pedidos_omie || []).forEach(p => {
            if (p?.codigo_pedido) codigosEmCarga.add(String(p.codigo_pedido));
          });
        });

      // 1. Vendas Omie já vêm enriquecidas no espelho — Montagem só monta a partir da ETAPA 20 (Liberados)
      //    + exclui pedidos já vinculados a outra carga ativa
      const vendasEnriquecidas = (espelhoOmie || [])
        .filter(e => String(e.etapa) === '20')
        .filter(e => !codigosEmCarga.has(String(e.codigo_pedido)))
        .map(e => ({
        codigo_pedido: e.codigo_pedido,
        codigo_pedido_integracao: e.codigo_pedido_integracao || '',
        numero_pedido: e.numero_pedido || '',
        codigo_cliente: e.codigo_cliente || '',
        codigo_cliente_integracao: e.codigo_cliente_integracao || '',
        codigo_cliente_cod: e.codigo_cliente_cod || '',
        cnpj_cpf_cliente: e.cnpj_cpf_cliente || '',
        cliente_id: e.cliente_id || null,
        pedido_id: e.pedido_id || null,
        nome_cliente: e.nome_cliente || '',
        nome_fantasia: e.nome_fantasia || '',
        cidade: e.cidade || '',
        tipo_nota: e.tipo_nota || '55',
        tags_cliente: e.tags_cliente || [],
        motorista_padrao_id: e.motorista_padrao_id || null,
        rota_id: e.rota_id || null,
        rota_nome: e.rota_nome || 'Sem Rota',
        rota_cliente: e.rota_cliente || e.rota_nome || 'Sem Rota',
        vendedor_id: e.vendedor_id || null,
        vendedor_nome: e.vendedor_nome || '',
        data_previsao: e.data_previsao || '',
        etapa: e.etapa || '20',
        quantidade_itens: e.quantidade_itens || 0,
        valor_total_pedido: e.valor_total_pedido || 0,
        produtos: e.produtos || [],
        tipo: 'venda',
        // tipo_operacao do espelho (venda/bonificacao/troca/devolucao/remessa)
        tipo_operacao: e.tipo_operacao || 'venda'
      }));

      // 2. Pedidos D1 internos (mesma lógica de antes)
      const pedidosD1Locais = (todosPedidosLocais || []).filter(p => {
        const modelo = String(p.modelo_nota || '').toLowerCase();
        return modelo === 'd1' && p.status === 'liberado';
      });
      const d1Disponiveis = pedidosD1Locais.filter(p => !p.carga_id);

      const d1ComItens = await Promise.all(
        d1Disponiveis.map(async (p) => {
          const itens = await base44.entities.PedidoItem.filter({ pedido_id: p.id });
          const cliente = clientesMap.get(p.cliente_id);
          const codigoCliente = p.cliente_codigo || cliente?.codigo_interno || cliente?.codigo_integracao || cliente?.codigo || '';
          const rotaNome = p.rota_nome || (cliente?.rota_id ? rotasMap.get(cliente.rota_id) : '') || 'Sem Rota';
          return {
            codigo_pedido: `D1-${p.id}`,
            pedido_id: p.id,
            numero_pedido: p.numero_pedido,
            codigo_cliente: p.cliente_id,
            codigo_cliente_cod: codigoCliente,
            cliente_id: p.cliente_id,
            nome_cliente: p.cliente_nome || cliente?.razao_social || '',
            nome_fantasia: p.cliente_nome_fantasia || cliente?.nome_fantasia || p.cliente_nome || cliente?.razao_social || '',
            cidade: p.cliente_cidade || cliente?.cidade || '',
            rota_nome: rotaNome,
            rota_cliente: rotaNome,
            quantidade_itens: itens.length,
            valor_total_pedido: p.valor_total || 0,
            vendedor_nome: p.vendedor_nome || '',
            observacoes: p.observacoes || '',
            // SEMPRE 'd1' quando modelo_nota=d1, independente do tipo da operação fiscal
            // (venda, bonificação, troca, devolução). Isso garante que o pedido vá para
            // pedidos_internos no fechamento da carga e apareça na aba "Impressão D1".
            tipo: 'd1',
            tipo_operacao_fiscal: p.tipo || 'venda',
            tipo_nota: 'D1',
            modelo_nota: 'd1',
            cenario_fiscal_nome: p.cenario_local_nome || p.cenario_fiscal_nome || '',
            produtos: itens.map(i => ({
              codigo_produto: i.produto_codigo || '',
              descricao: i.produto_nome || '',
              quantidade: i.quantidade || 0,
              valor_unitario: i.valor_unitario || 0,
              valor_total: i.valor_total || 0,
              unidade: i.unidade_medida || 'UN',
              motivo_troca_id: i.motivo_troca_id || '',
              motivo_troca_descricao: i.motivo_troca_descricao || ''
            }))
          };
        })
      );

      // 3. Trocas (mesma lógica de antes)
      const trocasDisponiveis = (trocasAprovadas || []).filter(t => !t.carga_id);
      const trocasComItens = await Promise.all(
        trocasDisponiveis.map(async (t) => {
          const itens = await base44.entities.ItemPedidoTroca.filter({ pedido_troca_id: t.id });
          return {
            codigo_pedido: `TROCA-${t.id}`,
            pedido_troca_id: t.id,
            numero_pedido: t.numero_troca,
            codigo_cliente: t.cliente_id,
            cliente_id: t.cliente_id,
            nome_cliente: t.cliente_nome || '',
            nome_fantasia: t.cliente_nome || '',
            cidade: '',
            rota_nome: 'Sem Rota',
            rota_cliente: 'Sem Rota',
            quantidade_itens: itens.length,
            valor_total_pedido: t.valor_total || 0,
            vendedor_nome: t.vendedor_nome || '',
            observacoes: t.observacoes || '',
            tipo: 'troca',
            tipo_nota: '',
            produtos: itens.map(i => ({
              codigo_produto: i.produto_codigo || '',
              descricao: i.produto_nome || '',
              quantidade: i.quantidade || 0,
              valor_unitario: i.preco_unitario || 0,
              valor_total: i.valor_total || 0,
              unidade: i.unidade_medida || 'UN',
              motivo_troca_id: i.motivo_id || '',
              motivo_troca_descricao: i.motivo_descricao || ''
            }))
          };
        })
      );

      // Enriquecer trocas com cliente (mesma lógica)
      const clienteIds = [...new Set(trocasComItens.map(t => t.cliente_id).filter(Boolean))];
      if (clienteIds.length > 0) {
        trocasComItens.forEach(t => {
          const c = clientesMap.get(t.cliente_id);
          if (c) {
            t.nome_fantasia = c.nome_fantasia || c.razao_social || t.nome_cliente;
            t.cidade = c.cidade || '';
            t.rota_nome = c.rota_id ? (rotasMap.get(c.rota_id) || 'Sem Rota') : 'Sem Rota';
            t.rota_cliente = t.rota_nome;
          }
        });
      }

      setPedidos([...vendasEnriquecidas, ...d1ComItens, ...trocasComItens]);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message;
      toast.error('Erro ao carregar dados: ' + msg);
    }
    setLoading(false);
  }, []);

  // Debounce de refresh — várias mudanças em sequência → 1 reload
  const agendarRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => { carregar(); }, 600);
  }, [carregar]);

  // Trigger manual: sincroniza espelho com Omie (etapa 20) ANTES de recarregar dados locais.
  // Garante que pedidos recém-liberados no Omie apareçam imediatamente, mesmo se o webhook atrasar.
  const recarregar = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await base44.functions.invoke('sincronizarLiberadosOmieRapido', {});
      const r = resp?.data || {};
      if (r?.sucesso) {
        const novos = r.criados || 0;
        if (novos > 0) toast.success(`${novos} pedido(s) novo(s) sincronizado(s) do Omie`);
      }
    } catch (e) {
      // Não bloqueia o reload local em caso de falha na sincronização
      console.warn('[useDadosMontagem] sincronização Omie falhou:', e?.message);
    }
    await carregar();
  }, [carregar]);

  useEffect(() => {
    // No primeiro load, SINCRONIZA com o Omie antes de carregar do espelho local.
    // Isso garante que pedidos recém-liberados no Omie apareçam mesmo quando o
    // webhook atrasou ou não chegou ainda (espelho desatualizado).
    (async () => {
      try {
        await base44.functions.invoke('sincronizarLiberadosOmieRapido', {});
      } catch (e) {
        console.warn('[useDadosMontagem] sincronização inicial Omie falhou:', e?.message);
      }
      await carregar();
    })();

    // Subscribe em tempo real — qualquer mudança nas 3 fontes reagenda refresh
    const unsubEspelho = base44.entities.PedidoLiberadoOmie.subscribe(() => agendarRefresh());
    const unsubPedido = base44.entities.Pedido.subscribe(() => agendarRefresh());
    const unsubTroca = base44.entities.PedidoTroca.subscribe(() => agendarRefresh());
    const unsubCarga = base44.entities.Carga.subscribe(() => agendarRefresh());

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      unsubEspelho?.();
      unsubPedido?.();
      unsubTroca?.();
      unsubCarga?.();
    };
  }, [carregar, agendarRefresh]);

  return { loading, pedidos, motoristas, veiculos, cargas, recarregar };
}