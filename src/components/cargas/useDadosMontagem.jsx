import { useEffect, useState, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

// ─── CACHE sessionStorage (5 min TTL) ───
const CACHE_KEY = 'montagem_carga_v3';
const CACHE_TTL = 5 * 60 * 1000;

function getCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp < CACHE_TTL) return data;
  } catch {}
  return null;
}

function setCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
  } catch {}
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchWithRetry(fn, retries = 3, delay = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || '';
      if (/rate.?limit|too many requests|429/i.test(msg) && i < retries - 1) {
        console.warn(`[MontagemCarga] Rate limit, retry ${i + 1}/${retries} em ${delay}ms...`);
        await sleep(delay);
        delay *= 2;
        continue;
      }
      throw err;
    }
  }
}

// Montar objeto de venda Omie a partir do espelho
function montarVendaOmie(e) {
  return {
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
  };
}

function montarItemProduto(i, tipo) {
  if (tipo === 'troca') {
    return {
      codigo_produto: i.produto_codigo || '', descricao: i.produto_nome || '',
      quantidade: i.quantidade || 0, valor_unitario: i.preco_unitario || 0,
      valor_total: i.valor_total || 0, unidade: i.unidade_medida || 'UN',
      motivo_troca_id: i.motivo_id || i.motivo_troca_id || '',
      motivo_troca_descricao: i.motivo_descricao || i.motivo_troca_descricao || i.motivo || '',
      motivo_descricao: i.motivo_descricao || i.motivo_troca_descricao || i.motivo || '',
      motivo: i.motivo || i.motivo_descricao || i.motivo_troca_descricao || '',
      observacao: i.observacao || ''
    };
  }
  return {
    codigo_produto: i.produto_codigo || '', descricao: i.produto_nome || '',
    quantidade: i.quantidade || 0, valor_unitario: i.valor_unitario || 0,
    valor_total: i.valor_total || 0, unidade: i.unidade_medida || 'UN',
    motivo_troca_id: i.motivo_troca_id || i.motivo_id || '',
    motivo_troca_descricao: i.motivo_troca_descricao || i.motivo_descricao || i.motivo || '',
    motivo_descricao: i.motivo_descricao || i.motivo_troca_descricao || i.motivo || '',
    motivo: i.motivo || i.motivo_descricao || i.motivo_troca_descricao || '',
    observacao: i.observacao || ''
  };
}

export default function useDadosMontagem() {
  const [loading, setLoading] = useState(true);
  const [pedidos, setPedidos] = useState([]);
  const [motoristas, setMotoristas] = useState([]);
  const [veiculos, setVeiculos] = useState([]);
  const [cargas, setCargas] = useState([]);
  const [carregandoItens, setCarregandoItens] = useState(false);
  const retryTimerRef = useRef(null);

  const carregar = useCallback(async (isRetry = false) => {
    // Cache: mostrar dados imediatos
    if (!isRetry) {
      const cached = getCache();
      if (cached && cached.pedidos?.length > 0) {
        setPedidos(cached.pedidos);
        setMotoristas(cached.motoristas || []);
        setVeiculos(cached.veiculos || []);
        setCargas(cached.cargas || []);
        setLoading(false);
        // continua para atualizar em background
      }
    }

    try {
      // ═══════════════════════════════════════
      // FASE 1: Dados essenciais (libera tela)
      // ═══════════════════════════════════════
      await sleep(isRetry ? 3000 : 1500);

      const espelhoOmie = await fetchWithRetry(() =>
        base44.entities.PedidoLiberadoOmie.list('-created_date', 200)
      );
      await sleep(300);

      const todosPedidosLocais = await fetchWithRetry(() =>
        base44.entities.Pedido.list('-created_date', 300)
      );
      await sleep(300);

      const trocasAprovadas = await fetchWithRetry(() =>
        base44.entities.PedidoTroca.filter({ status: 'aprovado' }, '-created_date', 500)
      );
      await sleep(300);

      const rotas = await fetchWithRetry(() =>
        base44.entities.Rota.list('-created_date', 500)
      );
      await sleep(300);

      const motP = await fetchWithRetry(() =>
        base44.entities.Motorista.list('-created_date', 500)
      );
      await sleep(300);

      const veiP = await fetchWithRetry(() =>
        base44.entities.Veiculo.list('-created_date', 500)
      );
      await sleep(300);

      const carP = await fetchWithRetry(() =>
        base44.entities.Carga.list('-created_date', 500)
      );

      const rotasMap = new Map((rotas || []).map(r => [r.id, r.nome]));
      const motoristasAtivos = motP.filter(m => m.status === 'ativo');
      const veiculosAtivos = veiP.filter(v => v.ativo !== false);

      // Códigos em carga ativa
      const codigosEmCarga = new Set();
      (carP || []).filter(c => c.status_carga !== 'cancelada').forEach(c => {
        (c.pedidos_omie || []).forEach(p => {
          if (p?.codigo_pedido) codigosEmCarga.add(String(p.codigo_pedido));
        });
      });

      // Vendas Omie etapa 20
      const vendasEnriquecidas = (espelhoOmie || [])
        .filter(e => String(e?.etapa ?? '').trim() === '20')
        .filter(e => e?.codigo_pedido && !codigosEmCarga.has(String(e.codigo_pedido)))
        .map(montarVendaOmie);

      // D1 disponíveis (sem itens ainda)
      const d1Disponiveis = (todosPedidosLocais || []).filter(p =>
        String(p.modelo_nota || '').toLowerCase() === 'd1' && p.status === 'liberado' && !p.carga_id
      );

      // Trocas disponíveis (sem itens ainda)
      const trocasDisponiveis = (trocasAprovadas || []).filter(t => !t.carga_id);

      // Montar D1s e Trocas sem itens (produtos vazio, quantidade 0)
      const d1SemItens = d1Disponiveis.map(p => ({
        codigo_pedido: `D1-${p.id}`, pedido_id: p.id, numero_pedido: p.numero_pedido,
        codigo_cliente: p.cliente_id, codigo_cliente_cod: p.cliente_codigo || '',
        cliente_id: p.cliente_id,
        nome_cliente: p.cliente_nome || '', nome_fantasia: p.cliente_nome_fantasia || p.cliente_nome || '',
        cidade: p.cliente_cidade || '',
        rota_nome: p.rota_nome || 'Sem Rota', rota_cliente: p.rota_nome || 'Sem Rota',
        quantidade_itens: 0, valor_total_pedido: p.valor_total || 0,
        vendedor_nome: p.vendedor_nome || '', observacoes: p.observacoes || '',
        tipo: 'd1', tipo_operacao_fiscal: p.tipo || 'venda', tipo_nota: 'D1', modelo_nota: 'd1',
        cenario_fiscal_nome: p.cenario_local_nome || p.cenario_fiscal_nome || '',
        produtos: []
      }));

      const trocasSemItens = trocasDisponiveis.map(t => ({
        codigo_pedido: `TROCA-${t.id}`, pedido_troca_id: t.id, numero_pedido: t.numero_troca,
        codigo_cliente: t.cliente_id, cliente_id: t.cliente_id,
        nome_cliente: t.cliente_nome || '', nome_fantasia: t.cliente_nome || '',
        cidade: '', rota_nome: 'Sem Rota', rota_cliente: 'Sem Rota',
        quantidade_itens: 0, valor_total_pedido: t.valor_total || 0,
        vendedor_nome: t.vendedor_nome || '', observacoes: t.observacoes || '',
        tipo: 'troca', tipo_nota: '', produtos: []
      }));

      // ─── LIBERAR TELA IMEDIATAMENTE ───
      const pedidosFase1 = [...vendasEnriquecidas, ...d1SemItens, ...trocasSemItens];
      setPedidos(pedidosFase1);
      setMotoristas(motoristasAtivos);
      setVeiculos(veiculosAtivos);
      setCargas(carP);
      setLoading(false);

      // ═══════════════════════════════════════
      // FASE 2: Buscar itens D1/Trocas via backend (1 requisição)
      // ═══════════════════════════════════════
      const temD1 = d1SemItens.length > 0;
      const temTrocas = trocasSemItens.length > 0;

      if (temD1 || temTrocas) {
        setCarregandoItens(true);

        // Buscar clientes necessários em sequencial
        const clienteIds = [...new Set([
          ...d1SemItens.map(p => p.cliente_id),
          ...trocasSemItens.map(t => t.cliente_id)
        ].filter(Boolean))];

        const clientesMap = new Map();
        for (const id of clienteIds) {
          await sleep(100);
          const c = await fetchWithRetry(() => base44.entities.Cliente.get(id)).catch(() => null);
          if (c) clientesMap.set(c.id, c);
        }

        // Buscar TODOS os itens em 1 única chamada backend
        await sleep(300);
        let itensPedido = {};
        let itensTroca = {};

        try {
          const resp = await base44.functions.invoke('getItensPedidosLote', {
            pedido_ids: temD1 ? d1SemItens.map(p => p.pedido_id) : [],
            troca_ids: temTrocas ? trocasSemItens.map(t => t.pedido_troca_id) : []
          });
          itensPedido = resp.data?.itens_pedido || {};
          itensTroca = resp.data?.itens_troca || {};
        } catch (err) {
          console.warn('[MontagemCarga] Erro ao buscar itens em lote, itens ficarão vazios:', err?.message);
        }

        // Montar D1 completos com itens
        const d1Completos = d1SemItens.map(p => {
          const itens = itensPedido[p.pedido_id] || [];
          const cliente = clientesMap.get(p.cliente_id);
          const rotaNome = p.rota_nome || (cliente?.rota_id ? rotasMap.get(cliente.rota_id) : '') || 'Sem Rota';
          return {
            ...p,
            codigo_cliente_cod: p.codigo_cliente_cod || cliente?.codigo_interno || cliente?.codigo_integracao || '',
            nome_cliente: p.nome_cliente || cliente?.razao_social || '',
            nome_fantasia: p.nome_fantasia || cliente?.nome_fantasia || p.nome_cliente || cliente?.razao_social || '',
            cidade: p.cidade || cliente?.cidade || '',
            rota_nome: rotaNome, rota_cliente: rotaNome,
            quantidade_itens: itens.length,
            produtos: itens.map(i => montarItemProduto(i, 'pedido'))
          };
        });

        // Montar Trocas completas com itens
        const trocasCompletas = trocasSemItens.map(t => {
          const itens = itensTroca[t.pedido_troca_id] || [];
          const cliente = clientesMap.get(t.cliente_id);
          const rotaNome = cliente?.rota_id ? (rotasMap.get(cliente.rota_id) || 'Sem Rota') : 'Sem Rota';
          return {
            ...t,
            nome_fantasia: cliente?.nome_fantasia || cliente?.razao_social || t.nome_cliente || '',
            cidade: cliente?.cidade || '',
            rota_nome: rotaNome, rota_cliente: rotaNome,
            quantidade_itens: itens.length,
            produtos: itens.map(i => montarItemProduto(i, 'troca'))
          };
        });

        // Atualizar pedidos com itens completos
        const pedidosFinal = [...vendasEnriquecidas, ...d1Completos, ...trocasCompletas];
        setPedidos(pedidosFinal);
        setCarregandoItens(false);

        // Cachear dados completos
        setCache({
          pedidos: pedidosFinal,
          motoristas: motoristasAtivos,
          veiculos: veiculosAtivos,
          cargas: carP
        });
      } else {
        // Sem D1/Trocas — cachear direto
        setCache({
          pedidos: pedidosFase1,
          motoristas: motoristasAtivos,
          veiculos: veiculosAtivos,
          cargas: carP
        });
      }

    } catch (e) {
      const msg = e?.response?.data?.error || e.message || '';
      if (/rate.?limit|too many requests|429/i.test(msg)) {
        console.warn('[MontagemCarga] Rate limit após retries, retry em 5s...');
        const cached = getCache();
        if (cached && cached.pedidos?.length > 0) {
          setPedidos(cached.pedidos);
          setMotoristas(cached.motoristas || []);
          setVeiculos(cached.veiculos || []);
          setCargas(cached.cargas || []);
          setLoading(false);
        }
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => carregar(true), 5000);
        return;
      }
      toast.error('[MontagemCarga] Erro ao carregar: ' + msg);
      setLoading(false);
    }
  }, []);

  const recarregar = useCallback(async () => {
    sessionStorage.removeItem(CACHE_KEY);
    setLoading(true);
    base44.functions.invoke('sincronizarLiberadosOmieRapido', {})
      .catch((e) => console.warn('[useDadosMontagem] sync Omie falhou:', e?.message));
    await carregar();
  }, [carregar]);

  useEffect(() => {
    carregar();
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [carregar]);

  return { loading, pedidos, motoristas, veiculos, cargas, recarregar, carregandoItens };
}