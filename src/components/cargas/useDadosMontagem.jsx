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
      console.log('[DEBUG MC] ===== INÍCIO CARREGAMENTO =====');
      await sleep(isRetry ? 3000 : 1500);

      const espelhoOmie = await fetchWithRetry(() =>
        base44.entities.PedidoLiberadoOmie.list('-created_date', 500)
      );
      console.log('[DEBUG MC] Total no espelho Omie:', espelhoOmie?.length || 0);
      await sleep(300);

      const todosPedidosLocais = await fetchWithRetry(() =>
        base44.entities.Pedido.list('-created_date', 300)
      );
      console.log('[DEBUG MC] Total Pedido local:', todosPedidosLocais?.length || 0);
      await sleep(300);

      const trocasAprovadas = await fetchWithRetry(() =>
        base44.entities.PedidoTroca.filter({ status: 'aprovado' }, '-created_date', 500)
      );
      console.log('[DEBUG MC] Total Trocas aprovadas:', trocasAprovadas?.length || 0);
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
      console.log('[DEBUG MC] Total Cargas:', carP?.length || 0);

      const rotasMap = new Map((rotas || []).map(r => [r.id, r.nome]));
      const motoristasAtivos = motP.filter(m => m.status === 'ativo');
      const veiculosAtivos = veiP.filter(v => v.ativo !== false);

      // Códigos em carga ativa
      const codigosEmCarga = new Set();
      (carP || []).filter(c => c.status_carga === 'faturada').forEach(c => {
        (c.pedidos_omie || []).forEach(p => {
          if (p?.codigo_pedido) codigosEmCarga.add(String(p.codigo_pedido));
        });
      });
      console.log('[DEBUG MC] Pedidos já em cargas faturadas:', codigosEmCarga.size);

      // Log distribuição de etapas no espelho
      const etapasContagem = {};
      (espelhoOmie || []).forEach(e => {
        const etapa = String(e?.etapa ?? 'sem_etapa');
        etapasContagem[etapa] = (etapasContagem[etapa] || 0) + 1;
      });
      console.log('[DEBUG MC] Distribuição de etapas no espelho:', JSON.stringify(etapasContagem));

      // Vendas Omie etapas 10 e 20
      const ETAPAS_PERMITIDAS = ['10', '20'];
      const vendasBruto = (espelhoOmie || []).filter(e =>
        ETAPAS_PERMITIDAS.includes(String(e?.etapa ?? '').trim())
      );
      console.log('[DEBUG MC] Vendas Omie após filtro de etapa:', vendasBruto.length);

      // Mapear pedidos locais cancelados pelo codigo_pedido_omie
      const codigosCancelados = new Set(
        (todosPedidosLocais || [])
          .filter(p => p.status === 'cancelado' || p.data_cancelamento || p.cancelado_por)
          .map(p => String(p.omie_codigo_pedido || ''))
          .filter(Boolean)
      );

      const vendasSemCarga = vendasBruto.filter(e =>
        e?.codigo_pedido &&
        !codigosEmCarga.has(String(e.codigo_pedido)) &&
        !codigosCancelados.has(String(e.codigo_pedido))
      );
      console.log('[DEBUG MC] Vendas Omie após excluir cargas e cancelados:', vendasSemCarga.length, '(cancelados excluídos:', codigosCancelados.size, ')');

      const vendasEnriquecidas = vendasSemCarga.map(montarVendaOmie);

      // ─── Pedidos NF55 locais liberados que NÃO estão no espelho ───
      // Captura pedidos que foram enviados ao Omie mas cujo webhook
      // ainda não criou o registro PedidoLiberadoOmie
      const codigosNoEspelho = new Set(
        (espelhoOmie || []).map(e => String(e.codigo_pedido)).filter(Boolean)
      );
      const pedidosNf55Locais = (todosPedidosLocais || []).filter(p => {
        const modelo = String(p.modelo_nota || '').trim().toLowerCase();
        return modelo !== 'd1' &&
               p.status === 'liberado' &&
               !p.carga_id &&
               !p.data_cancelamento &&
               !p.cancelado_por &&
               p.omie_codigo_pedido &&
               !codigosNoEspelho.has(String(p.omie_codigo_pedido)) &&
               !codigosEmCarga.has(String(p.omie_codigo_pedido));
      });
      console.log('[DEBUG MC] Pedidos NF55 locais liberados FORA do espelho:', pedidosNf55Locais.length);

      const vendasLocais = pedidosNf55Locais.map(p => ({
        codigo_pedido: String(p.omie_codigo_pedido),
        codigo_pedido_integracao: p.id,
        numero_pedido: p.numero_pedido || '',
        codigo_cliente: p.cliente_id || '',
        codigo_cliente_integracao: '',
        codigo_cliente_cod: p.cliente_codigo || '',
        cnpj_cpf_cliente: p.cliente_cpf_cnpj || '',
        cliente_id: p.cliente_id || null,
        pedido_id: p.id,
        nome_cliente: p.cliente_nome || '',
        nome_fantasia: p.cliente_nome_fantasia || p.cliente_nome || '',
        cidade: p.cliente_cidade || '',
        tipo_nota: '55',
        tags_cliente: [],
        motorista_padrao_id: null,
        rota_id: p.rota_id || null,
        rota_nome: (p.rota_id && rotasMap.get(p.rota_id)) || p.rota_nome || 'Sem Rota',
        rota_cliente: (p.rota_id && rotasMap.get(p.rota_id)) || p.rota_nome || 'Sem Rota',
        vendedor_id: p.vendedor_id || null,
        vendedor_nome: p.vendedor_nome || '',
        data_previsao: p.data_previsao_entrega || '',
        etapa: '20',
        quantidade_itens: p.total_itens || 0,
        valor_total_pedido: p.valor_total || 0,
        produtos: [],
        tipo: 'venda',
        tipo_operacao: p.cenario_local_tipo || 'venda'
      }));

      const todasVendas = [...vendasEnriquecidas, ...vendasLocais];

      // D1 disponíveis (sem itens ainda)
      const d1Todos = (todosPedidosLocais || []).filter(p =>
        String(p.modelo_nota || '').trim().toLowerCase() === 'd1'
      );
      console.log('[DEBUG MC] Total D1 no Pedido local:', d1Todos.length);
      console.log('[DEBUG MC] D1 por status:', JSON.stringify(d1Todos.reduce((acc, p) => {
        acc[p.status || 'sem_status'] = (acc[p.status || 'sem_status'] || 0) + 1;
        return acc;
      }, {})));

      const d1Disponiveis = d1Todos.filter(p => p.status === 'liberado' && !p.carga_id);
      console.log('[DEBUG MC] D1 após filtros (status=liberado, sem carga):', d1Disponiveis.length);

      // Trocas disponíveis (sem itens ainda)
      const trocasDisponiveis = (trocasAprovadas || []).filter(t => !t.carga_id);
      console.log('[DEBUG MC] Trocas após excluir já em cargas:', trocasDisponiveis.length);

      // Buscar clientes das trocas para obter rota (Promise.all paralelo)
      const trocaClienteIds = [...new Set(trocasDisponiveis.map(t => t.cliente_id).filter(Boolean))];
      const trocaClientesArr = trocaClienteIds.length > 0
        ? await Promise.all(trocaClienteIds.map(id => fetchWithRetry(() => base44.entities.Cliente.get(id)).catch(() => null)))
        : [];
      const trocaClientesMap = new Map(trocaClientesArr.filter(Boolean).map(c => [c.id, c]));

      console.log('[DEBUG MC] TOTAL FINAL:', todasVendas.length + d1Disponiveis.length + trocasDisponiveis.length,
        '(Omie:', vendasEnriquecidas.length, '| NF55 local:', vendasLocais.length, '| D1:', d1Disponiveis.length, '| Troca:', trocasDisponiveis.length, ')');
      console.log('[DEBUG MC] ===== FIM CARREGAMENTO =====');

      // Montar D1s e Trocas sem itens (produtos vazio, quantidade 0)
      const d1SemItens = d1Disponiveis.map(p => {
        const rotaNomeD1 = (p.rota_id && rotasMap.get(p.rota_id)) || p.rota_nome || 'Sem Rota';
        return {
          codigo_pedido: `D1-${p.id}`, pedido_id: p.id, numero_pedido: p.numero_pedido,
          codigo_cliente: p.cliente_id, codigo_cliente_cod: p.cliente_codigo || '',
          cliente_id: p.cliente_id,
          nome_cliente: p.cliente_nome || '', nome_fantasia: p.cliente_nome_fantasia || p.cliente_nome || '',
          cidade: p.cliente_cidade || '',
          rota_nome: rotaNomeD1, rota_cliente: rotaNomeD1,
          quantidade_itens: 0, valor_total_pedido: p.valor_total || 0,
          vendedor_nome: p.vendedor_nome || '', observacoes: p.observacoes || '',
          tipo: 'd1', tipo_operacao_fiscal: p.tipo || 'venda', tipo_nota: 'D1', modelo_nota: 'd1',
          cenario_fiscal_nome: p.cenario_local_nome || p.cenario_fiscal_nome || '',
          produtos: []
        };
      });

      const trocasSemItens = trocasDisponiveis.map(t => {
        const cliente = trocaClientesMap.get(t.cliente_id);
        const rotaId = cliente?.rota_id;
        const rotaNome = rotaId ? (rotasMap.get(rotaId) || 'Sem Rota') : 'Sem Rota';
        return {
          codigo_pedido: `TROCA-${t.id}`, pedido_troca_id: t.id, numero_pedido: t.numero_troca,
          codigo_cliente: t.cliente_id, cliente_id: t.cliente_id,
          nome_cliente: t.cliente_nome || cliente?.razao_social || '',
          nome_fantasia: cliente?.nome_fantasia || t.cliente_nome || cliente?.razao_social || '',
          cidade: cliente?.cidade || '',
          rota_nome: rotaNome, rota_cliente: rotaNome,
          quantidade_itens: 0, valor_total_pedido: t.valor_total || 0,
          vendedor_nome: t.vendedor_nome || '', observacoes: t.observacoes || '',
          tipo: 'troca', tipo_nota: '', produtos: []
        };
      });

      // ─── LIBERAR TELA IMEDIATAMENTE ───
      const pedidosFase1 = [...todasVendas, ...d1SemItens, ...trocasSemItens];
      setPedidos(pedidosFase1);
      setMotoristas(motoristasAtivos);
      setVeiculos(veiculosAtivos);
      setCargas(carP);
      setLoading(false);

      // ═══════════════════════════════════════
      // FASE 2: Buscar itens D1/Trocas/NF55locais via backend (1 requisição)
      // ═══════════════════════════════════════
      const temD1 = d1SemItens.length > 0;
      const temTrocas = trocasSemItens.length > 0;
      const temNf55Local = vendasLocais.length > 0;

      if (temD1 || temTrocas || temNf55Local) {
        setCarregandoItens(true);

        // Buscar clientes dos D1 (trocas já foram buscados na Fase 1)
        const d1ClienteIds = [...new Set(d1SemItens.map(p => p.cliente_id).filter(Boolean))];

        const clientesMap = new Map(trocaClientesMap);
        for (const id of d1ClienteIds) {
          if (clientesMap.has(id)) continue;
          await sleep(100);
          const c = await fetchWithRetry(() => base44.entities.Cliente.get(id)).catch(() => null);
          if (c) clientesMap.set(c.id, c);
        }

        // Buscar TODOS os itens em 1 única chamada backend
        await sleep(300);
        let itensPedido = {};
        let itensTroca = {};

        // Incluir pedido_ids dos D1 + NF55 locais (ambos usam PedidoItem)
        const todosIdsPedidos = [
          ...d1SemItens.map(p => p.pedido_id),
          ...vendasLocais.map(p => p.pedido_id)
        ].filter(Boolean);

        try {
          const resp = await base44.functions.invoke('getItensPedidosLote', {
            pedido_ids: todosIdsPedidos.length > 0 ? todosIdsPedidos : [],
            troca_ids: temTrocas ? trocasSemItens.map(t => t.pedido_troca_id) : []
          });
          itensPedido = resp.data?.itens_pedido || {};
          itensTroca = resp.data?.itens_troca || {};
        } catch (err) {
          console.warn('[MontagemCarga] Erro ao buscar itens em lote, itens ficarão vazios:', err?.message);
        }

        // Enriquecer vendas locais NF55 com itens
        const vendasLocaisComItens = vendasLocais.map(p => {
          const itens = itensPedido[p.pedido_id] || [];
          return {
            ...p,
            quantidade_itens: itens.length > 0 ? itens.length : p.quantidade_itens,
            produtos: itens.length > 0 ? itens.map(i => montarItemProduto(i, 'pedido')) : p.produtos
          };
        });

        const todasVendasComItens = [...vendasEnriquecidas, ...vendasLocaisComItens];

        // Montar D1 completos com itens
        const d1Completos = d1SemItens.map(p => {
          const itens = itensPedido[p.pedido_id] || [];
          const cliente = clientesMap.get(p.cliente_id);
          const rotaNomeD1 = (p.rota_nome && p.rota_nome !== 'Sem Rota')
            ? p.rota_nome
            : (cliente?.rota_id ? (rotasMap.get(cliente.rota_id) || 'Sem Rota') : 'Sem Rota');
          return {
            ...p,
            codigo_cliente_cod: p.codigo_cliente_cod || cliente?.codigo_interno || cliente?.codigo_integracao || '',
            nome_cliente: p.nome_cliente || cliente?.razao_social || '',
            nome_fantasia: p.nome_fantasia || cliente?.nome_fantasia || p.nome_cliente || cliente?.razao_social || '',
            cidade: p.cidade || cliente?.cidade || '',
            rota_nome: rotaNomeD1, rota_cliente: rotaNomeD1,
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
        const pedidosFinal = [...todasVendasComItens, ...d1Completos, ...trocasCompletas];
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
        // Sem D1/Trocas/NF55local — cachear direto
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