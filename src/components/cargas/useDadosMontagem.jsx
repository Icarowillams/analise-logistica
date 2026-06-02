import { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

// Hook central da tela de Montagem de Carga (otimizado via espelho local).
//
// Arquitetura:
//   - Vendas Omie (etapa 20) → lidas de PedidoLiberadoOmie (espelho mantido por webhook + backup 1h)
//   - Pedidos D1 internos    → Pedido (modelo_nota=d1, status=liberado, sem carga_id)
//   - Trocas                 → PedidoTroca (status=aprovado, sem carga_id)
//   - SEM subscribe — refresh apenas manual (botão "Recarregar")
//
// TODAS as chamadas são sequenciais (for...of) para NUNCA estourar rate limit.

// Cooldown global: impede que a sincronização Omie seja chamada mais de 1x a cada 2 minutos.
const SYNC_COOLDOWN_MS = 2 * 60 * 1000;
let lastSyncTimestamp = 0;

export default function useDadosMontagem() {
  const [loading, setLoading] = useState(true);
  const [pedidos, setPedidos] = useState([]);
  const [motoristas, setMotoristas] = useState([]);
  const [veiculos, setVeiculos] = useState([]);
  const [cargas, setCargas] = useState([]);

  const carregar = useCallback(async () => {
    try {
      // ─── FASE 1: entidades pequenas (sequencial) ───
      const motP = await base44.entities.Motorista.list('-created_date', 500);
      const veiP = await base44.entities.Veiculo.list('-created_date', 500);
      const carP = await base44.entities.Carga.list('-created_date', 500);
      const rotas = await base44.entities.Rota.list('-created_date', 500);

      // ─── FASE 2: entidades grandes (sequencial) ───
      const espelhoOmie = await base44.entities.PedidoLiberadoOmie.list('-created_date', 300);
      const todosPedidosLocais = await base44.entities.Pedido.list('-created_date', 500);
      const trocasAprovadas = await base44.entities.PedidoTroca.filter({ status: 'aprovado' }, '-created_date', 500);

      setMotoristas(motP.filter(m => m.status === 'ativo'));
      setVeiculos(veiP.filter(v => v.ativo !== false));
      setCargas(carP);

      const rotasMap = new Map((rotas || []).map(r => [r.id, r.nome]));

      // Códigos de pedido Omie já em carga ativa
      const codigosEmCarga = new Set();
      (carP || [])
        .filter(c => c.status_carga !== 'cancelada')
        .forEach(c => {
          (c.pedidos_omie || []).forEach(p => {
            if (p?.codigo_pedido) codigosEmCarga.add(String(p.codigo_pedido));
          });
        });

      // ─── 1. Vendas Omie (etapa 20 do espelho) ───
      const vendasEnriquecidas = (espelhoOmie || [])
        .filter(e => {
          const etapa = e?.etapa == null ? '' : String(e.etapa).trim();
          return etapa === '20';
        })
        .filter(e => e?.codigo_pedido && !codigosEmCarga.has(String(e.codigo_pedido)))
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
          tipo_operacao: e.tipo_operacao || 'venda'
        }));

      // ─── 2. Pedidos D1 internos ───
      const pedidosD1Locais = (todosPedidosLocais || []).filter(p => {
        const modelo = String(p.modelo_nota || '').toLowerCase();
        return modelo === 'd1' && p.status === 'liberado';
      });
      const d1Disponiveis = pedidosD1Locais.filter(p => !p.carga_id);

      // ─── 2b. Trocas ───
      const trocasDisponiveis = (trocasAprovadas || []).filter(t => !t.carga_id);

      // ─── FASE 3: Buscar clientes necessários — SEQUENCIAL ───
      const clienteIdsNecessarios = [...new Set([
        ...d1Disponiveis.map(p => p.cliente_id),
        ...trocasDisponiveis.map(t => t.cliente_id)
      ].filter(Boolean))];

      const clientesMap = new Map();
      for (const id of clienteIdsNecessarios) {
        const c = await base44.entities.Cliente.get(id).catch(() => null);
        if (c) clientesMap.set(c.id, c);
      }

      // ─── FASE 4: Buscar itens D1 — SEQUENCIAL ───
      const d1ComItens = [];
      for (const p of d1Disponiveis) {
        const itens = await base44.entities.PedidoItem.filter({ pedido_id: p.id });
        const cliente = clientesMap.get(p.cliente_id);
        const codigoCliente = p.cliente_codigo || cliente?.codigo_interno || cliente?.codigo_integracao || cliente?.codigo || '';
        const rotaNome = p.rota_nome || (cliente?.rota_id ? rotasMap.get(cliente.rota_id) : '') || 'Sem Rota';
        d1ComItens.push({
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
            motivo_troca_id: i.motivo_troca_id || i.motivo_id || '',
            motivo_troca_descricao: i.motivo_troca_descricao || i.motivo_descricao || i.motivo || '',
            motivo_descricao: i.motivo_descricao || i.motivo_troca_descricao || i.motivo || '',
            motivo: i.motivo || i.motivo_descricao || i.motivo_troca_descricao || '',
            observacao: i.observacao || ''
          }))
        });
      }

      // ─── FASE 5: Buscar itens Trocas — SEQUENCIAL ───
      const trocasComItens = [];
      for (const t of trocasDisponiveis) {
        const itens = await base44.entities.ItemPedidoTroca.filter({ pedido_troca_id: t.id });
        trocasComItens.push({
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
            motivo_troca_id: i.motivo_id || i.motivo_troca_id || '',
            motivo_troca_descricao: i.motivo_descricao || i.motivo_troca_descricao || i.motivo || '',
            motivo_descricao: i.motivo_descricao || i.motivo_troca_descricao || i.motivo || '',
            motivo: i.motivo || i.motivo_descricao || i.motivo_troca_descricao || '',
            observacao: i.observacao || ''
          }))
        });
      }

      // Enriquecer trocas com dados do cliente
      trocasComItens.forEach(t => {
        const c = clientesMap.get(t.cliente_id);
        if (c) {
          t.nome_fantasia = c.nome_fantasia || c.razao_social || t.nome_cliente;
          t.cidade = c.cidade || '';
          t.rota_nome = c.rota_id ? (rotasMap.get(c.rota_id) || 'Sem Rota') : 'Sem Rota';
          t.rota_cliente = t.rota_nome;
        }
      });

      setPedidos([...vendasEnriquecidas, ...d1ComItens, ...trocasComItens]);
    } catch (e) {
      const msg = e?.response?.data?.error || e.message;
      toast.error('Erro ao carregar dados: ' + msg);
    }
    setLoading(false);
  }, []);

  // Sincronização Omie com cooldown de 2 min.
  const sincronizarComCooldown = useCallback(() => {
    const agora = Date.now();
    if (agora - lastSyncTimestamp < SYNC_COOLDOWN_MS) return;
    lastSyncTimestamp = agora;
    base44.functions.invoke('sincronizarLiberadosOmieRapido', {})
      .catch((e) => console.warn('[useDadosMontagem] sincronização Omie falhou:', e?.message));
  }, []);

  // Refresh manual
  const recarregar = useCallback(async () => {
    setLoading(true);
    sincronizarComCooldown();
    await carregar();
  }, [carregar, sincronizarComCooldown]);

  useEffect(() => {
    carregar();
    sincronizarComCooldown();
  }, [carregar, sincronizarComCooldown]);

  return { loading, pedidos, motoristas, veiculos, cargas, recarregar };
}