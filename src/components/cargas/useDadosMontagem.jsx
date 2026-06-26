import { useEffect, useState, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

// ─── CACHE localStorage (60s TTL — montagem é operação em tempo real) ───
const CACHE_KEY = 'montagem_carga_v4';
const CACHE_TTL = 60 * 1000;

function getUserCacheKey() {
  try {
    const raw = localStorage.getItem('base44_user') ||
                sessionStorage.getItem('base44_user') || '';
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.email || parsed?.id || 'anon';
  } catch { return 'anon'; }
}

// Retorna { data, fresco } — fresco=true se dentro do TTL.
// IMPORTANTE: NÃO removemos mais o cache expirado. Servimos o snapshot velho na hora
// (stale-while-revalidate) para a tela abrir instantânea, e revalidamos em background.
function getCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY + '_' + getUserCacheKey());
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    return { data, fresco: Date.now() - timestamp < CACHE_TTL };
  } catch {}
  return null;
}

function setCache(data) {
  try {
    localStorage.setItem(CACHE_KEY + '_' + getUserCacheKey(), JSON.stringify({ timestamp: Date.now(), data }));
  } catch {}
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Paginação completa (contorna o truncamento de 5.000 da SDK) usando fetchWithRetry
// para manter o tratamento de rate-limit/retry já existente neste hook.
// OTIMIZAÇÃO: aceita um filtro para reduzir o volume lido já na consulta (server-side),
// em vez de baixar a tabela inteira e filtrar depois no navegador.
async function listarTudoComRetry(entity, sort = '-created_date', pageSize = 500, query = {}) {
  const out = [];
  let skip = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await fetchWithRetry(() => entity.filter(query, sort, pageSize, skip));
    out.push(...(page || []));
    if (!page || page.length < pageSize) break;
    skip += pageSize;
  }
  return out;
}

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
    numero_nf: e.numero_nf || '',
    quantidade_itens: e.quantidade_itens || 0,
    valor_total_pedido: e.valor_total_pedido || 0,
    produtos: e.produtos || [],
    tipo: 'venda',
    tipo_operacao: e.tipo_operacao || 'venda',
    tipo_operacao_fiscal: e.tipo_operacao_fiscal || e.tipo_operacao || e.cenario_local_tipo || 'venda'
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
  // Espelha o tamanho atual da lista para a revalidação em background saber se a tela
  // já tem dados. Quando já tem, NÃO repintamos com a Fase 1 (produtos[] ainda vazios) —
  // evita o "pacotes zerando e voltando" a cada auto-refresh de 60s.
  const temPedidosRef = useRef(false);

  const carregar = useCallback(async (isRetry = false) => {
    // Cache stale-while-revalidate: serve o último snapshot IMEDIATAMENTE (mesmo expirado),
    // para a tela abrir sem spinner. Se ainda estiver fresco (<TTL), nem revalida agora.
    if (!isRetry) {
      const cached = getCache();
      if (cached?.data?.pedidos?.length > 0) {
        setPedidos(cached.data.pedidos);
        temPedidosRef.current = true;
        setMotoristas(cached.data.motoristas || []);
        setVeiculos(cached.data.veiculos || []);
        setCargas(cached.data.cargas || []);
        setLoading(false);
        // Cache ainda fresco → não busca de novo agora (o auto-refresh de 60s cuida disso).
        if (cached.fresco) return;
        // Expirado → segue para revalidar em background, sem tirar os dados da tela.
      }
    }

    try {
      // ═══════════════════════════════════════
      // FASE 1: Dados essenciais (libera tela)
      // ═══════════════════════════════════════
      if (isRetry) await sleep(2000);

      // OTIMIZAÇÃO: pedidos/espelho/trocas/listas pequenas em PARALELO.
      // ⚠️ Cliente NÃO é mais carregado por inteiro (antes: list 10000 = ~958 reg / 4,4s).
      // Os clientes são buscados DEPOIS, filtrando só pelos cliente_ids referenciados.
      // ⚡ FILTRO SERVER-SIDE: o espelho só traz etapas 20/50 (únicas usadas na montagem) e os
      // pedidos locais só os status que a lógica consome (liberado/cancelado/faturado) — evita
      // baixar o histórico inteiro a cada abertura.
      const [espelhoOmieBruto, todosPedidosLocais, trocasAprovadas, rotas, motP, veiP, carP] = await Promise.all([
        listarTudoComRetry(base44.entities.PedidoLiberadoOmie, '-created_date', 500, { etapa: { $in: ['20', '50'] } }),
        listarTudoComRetry(base44.entities.Pedido, '-created_date', 500, { status: { $in: ['liberado', 'cancelado', 'faturado'] } }),
        fetchWithRetry(() => base44.entities.PedidoTroca.filter({ status: 'aprovado' }, '-created_date', 500)),
        fetchWithRetry(() => base44.entities.Rota.list('-created_date', 500)),
        fetchWithRetry(() => base44.entities.Motorista.list('-created_date', 500)),
        fetchWithRetry(() => base44.entities.Veiculo.list('-created_date', 500)),
        fetchWithRetry(() => base44.entities.Carga.list('-created_date', 1000))
      ]);

      // 🛡️ DEDUPE DEFENSIVO DO ESPELHO (BUG espelho duplicado/vazio):
      // Podem coexistir 2+ registros PedidoLiberadoOmie para o MESMO codigo_pedido — um COM
      // produtos e um VAZIO (origem antiga de INSERT-cego). A Montagem calcula pacotes pelo
      // produtos[]; se pegar o vazio, mostra "0 pacotes" indevidamente. Aqui mantemos, por
      // codigo_pedido, o registro com produtos preenchido (e mais recente como desempate).
      const espelhoDedupMap = new Map();
      (espelhoOmieBruto || []).forEach(e => {
        const k = String(e?.codigo_pedido || '');
        if (!k) return;
        const atual = espelhoDedupMap.get(k);
        if (!atual) { espelhoDedupMap.set(k, e); return; }
        const peso = (r) => ((r.produtos || []).length > 0 ? 1e15 : 0) + new Date(r.sincronizado_em || 0).getTime();
        if (peso(e) > peso(atual)) espelhoDedupMap.set(k, e);
      });
      const espelhoOmie = Array.from(espelhoDedupMap.values());

      // Cliente_ids efetivamente referenciados (espelho + pedidos locais + trocas)
      const clienteIdsRef = new Set();
      (espelhoOmie || []).forEach(e => { if (e.cliente_id) clienteIdsRef.add(e.cliente_id); });
      (todosPedidosLocais || []).forEach(p => { if (p.cliente_id) clienteIdsRef.add(p.cliente_id); });
      (trocasAprovadas || []).forEach(t => { if (t.cliente_id) clienteIdsRef.add(t.cliente_id); });

      // Busca SÓ os clientes referenciados, em lotes PARALELOS (evita payload gigante / list total).
      // Antes os lotes rodavam em série (um await por vez); agora disparam juntos via Promise.all.
      const idsArr = [...clienteIdsRef];
      const LOTE_CLI = 200;
      const lotesIds = [];
      for (let i = 0; i < idsArr.length; i += LOTE_CLI) lotesIds.push(idsArr.slice(i, i + LOTE_CLI));
      const resultadosLotes = await Promise.all(
        lotesIds.map(lote => fetchWithRetry(() => base44.entities.Cliente.filter({ id: { $in: lote } })))
      );
      const clientesRef = resultadosLotes.flat().filter(Boolean);
      // Mapa global de clientes — evita N chamadas individuais depois
      const clientesMapGlobal = new Map(clientesRef.map(c => [c.id, c]));

      const rotasMap = new Map((rotas || []).map(r => [r.id, r.nome]));
      const motoristasAtivos = motP.filter(m => m.status === 'ativo');
      const veiculosAtivos = veiP.filter(v => v.ativo !== false);

      // Códigos em carga ativa
      const codigosEmCarga = new Set();
      const idsInternosEmCarga = new Set();
      const idsTrocasEmCarga = new Set();

      (carP || [])
        .filter(c => c.status_carga === 'faturada' || c.status_carga === 'montagem')
        .forEach(c => {
          (c.pedidos_omie || []).forEach(p => {
            if (p?.codigo_pedido) codigosEmCarga.add(String(p.codigo_pedido));
          });
          (c.pedidos_internos || []).forEach(p => {
            if (p?.pedido_id) idsInternosEmCarga.add(String(p.pedido_id));
          });
          (c.pedidos_troca || []).forEach(p => {
            if (p?.pedido_troca_id) idsTrocasEmCarga.add(String(p.pedido_troca_id));
          });
        });

      // Log distribuição de etapas no espelho
      const etapasContagem = {};
      (espelhoOmie || []).forEach(e => {
        const etapa = String(e?.etapa ?? 'sem_etapa');
        etapasContagem[etapa] = (etapasContagem[etapa] || 0) + 1;
      });
      console.log(`[DEBUG MC] Total no espelho Omie: ${(espelhoOmie || []).length} | por etapa:`, etapasContagem);

      // Vendas Omie etapas 10 e 20
      const ETAPAS_PERMITIDAS = ['20', '50']; // Apenas Liberados (20) e Em montagem (50)
      const vendasBruto = (espelhoOmie || []).filter(e =>
        ETAPAS_PERMITIDAS.includes(String(e?.etapa ?? '').trim())
      );

      // Mapear pedidos locais cancelados pelo codigo_pedido_omie
      // Fonte da verdade = status. data_cancelamento/cancelado_por podem ficar residuais
      // (cancelamento fantasma revertido) e NÃO devem, sozinhos, esconder um liberado da montagem.
      const codigosCancelados = new Set(
        (todosPedidosLocais || [])
          .filter(p => p.status === 'cancelado')
          .map(p => String(p.omie_codigo_pedido || ''))
          .filter(Boolean)
      );

      const codigosFaturadosLocais = new Set(
        (todosPedidosLocais || [])
          .filter(p => p.status === 'faturado' || p.faturado === true)
          .map(p => String(p.omie_codigo_pedido || ''))
          .filter(Boolean)
      );

      const vendasSemCarga = vendasBruto.filter(e =>
        e?.codigo_pedido &&
        !codigosEmCarga.has(String(e.codigo_pedido)) &&
        !codigosCancelados.has(String(e.codigo_pedido)) &&
        !codigosFaturadosLocais.has(String(e.codigo_pedido))
      );

      // Mapa id→Pedido local para fallback de rota pelo cliente (espelho sem rota_id)
      const pedidosLocaisMap = new Map((todosPedidosLocais || []).map(p => [String(p.id), p]));

      const vendasEnriquecidas = vendasSemCarga.map(e => {
        const venda = montarVendaOmie(e);
        // Resolver rota SEMPRE pelo cadastro atual (via rota_id), nunca pelo rota_nome
        // congelado no pedido. Assim, ao renomear uma rota, todos os pedidos passam a
        // agrupar sob o nome novo — sem aparecer "duas rotas 08" (nome antigo x novo).
        // 1) tenta o rota_id do próprio pedido; 2) fallback: rota_id do cliente.
        const pedidoLocal = venda.pedido_id ? pedidosLocaisMap.get(String(venda.pedido_id)) : null;
        const clienteIdFallback = venda.cliente_id || pedidoLocal?.cliente_id;
        const cliente = clienteIdFallback ? clientesMapGlobal.get(clienteIdFallback) : null;
        const rotaIdResolvido = venda.rota_id || cliente?.rota_id;
        const nomeRotaAtual = rotaIdResolvido ? rotasMap.get(rotaIdResolvido) : null;
        if (nomeRotaAtual) {
          venda.rota_id = rotaIdResolvido;
          venda.rota_nome = nomeRotaAtual;
          venda.rota_cliente = nomeRotaAtual;
        }
        return venda;
      });

      // ─── Pedidos NF55 locais liberados que NÃO estão no espelho ───
      // Captura pedidos que foram enviados ao Omie mas cujo webhook
      // ainda não criou o registro PedidoLiberadoOmie
      // TAMBÉM captura pedidos NF55 liberados que ainda não têm omie_codigo_pedido
      const codigosNoEspelho = new Set(
        (espelhoOmie || []).map(e => String(e.codigo_pedido)).filter(Boolean)
      );
      const pedidosNf55Locais = (todosPedidosLocais || []).filter(p => {
        const modelo = String(p.modelo_nota || '').trim().toLowerCase();
        if (modelo === 'd1') return false;
        if (p.status !== 'liberado') return false;
        if (p.carga_id) return false;
        if (p.data_cancelamento || p.cancelado_por) return false;

        // Pedido sem omie_codigo_pedido — ainda não enviado ao Omie, mas liberado
        if (!p.omie_codigo_pedido) return true;

        // Pedido com omie_codigo_pedido — incluir apenas se NÃO está no espelho e NÃO em carga
        return !codigosNoEspelho.has(String(p.omie_codigo_pedido)) &&
               !codigosEmCarga.has(String(p.omie_codigo_pedido));
      });

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

      // ─── DEDUPLICAÇÃO (exibição) ───
      // O mesmo pedido pode chegar pelo espelho Omie (codigo_pedido "limpo", ex: 1999)
      // E como NF55 local (codigo_pedido = String(omie_codigo_pedido), que pode vir com
      // padding, ex: 000000000001999). Mesmo omie_codigo_pedido = MESMO pedido.
      // Chave = codigo_pedido sem zeros à esquerda; fallback = numero_pedido normalizado + cliente.
      // Preferimos SEMPRE o registro do espelho Omie (tem a quantidade/itens corretos).
      const chaveVenda = (p) => {
        const cod = String(p.codigo_pedido || '').replace(/^0+/, '');
        if (cod) return `cod:${cod}`;
        const num = String(p.numero_pedido || '').replace(/^0+/, '');
        return `num:${num}|cli:${p.cliente_id || ''}`;
      };
      const dedupVendasMap = new Map();
      // Espelho Omie primeiro → fica como base; locais só entram se a chave ainda não existe.
      [...vendasEnriquecidas, ...vendasLocais].forEach(p => {
        const k = chaveVenda(p);
        if (!dedupVendasMap.has(k)) dedupVendasMap.set(k, p);
      });
      const todasVendas = Array.from(dedupVendasMap.values());

      // D1 disponíveis (sem itens ainda)
      const d1Todos = (todosPedidosLocais || []).filter(p =>
        String(p.modelo_nota || '').trim().toLowerCase() === 'd1'
      );

      const d1Disponiveis = d1Todos.filter(p => p.status === 'liberado' && !p.carga_id && !idsInternosEmCarga.has(String(p.id)));

      // Trocas disponíveis (sem itens ainda)
      const trocasDisponiveis = (trocasAprovadas || []).filter(t => !t.carga_id && !idsTrocasEmCarga.has(String(t.id)));

      // Usar mapa global de clientes (já carregado no Batch 1 — sem chamadas individuais)
      const trocaClientesMap = clientesMapGlobal;

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
      console.log(`[DEBUG CONTAGEM] FASE 1 → vendas: ${todasVendas.length} | d1SemItens: ${d1SemItens.length} | trocasSemItens: ${trocasSemItens.length} | total Fase 1: ${pedidosFase1.length}`);
      // ANTI-FLICKER: a Fase 1 traz produtos[] vazios (pacotes = 0). Só repintamos a tela
      // com ela se ainda NÃO houver pedidos exibidos (primeira carga / tela vazia). No
      // auto-refresh de 60s, mantemos a lista atual (com pacotes) e deixamos a Fase 2
      // substituir de uma vez — assim os pacotes não caem a 0 e voltam.
      if (!temPedidosRef.current) {
        setPedidos(pedidosFase1);
      }
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

      if (temD1 || temTrocas || temNf55Local || vendasEnriquecidas.length > 0) {
        setCarregandoItens(true);

        // BLINDAGEM: toda a Fase 2 fica dentro de um try/catch. Se QUALQUER coisa falhar
        // (timeout, erro no backend, erro no enriquecimento), os pedidos da Fase 1 — que já
        // incluem os D1 SEM itens — permanecem na tela. Nenhum D1 some por falha na Fase 2.
        try {
        // Usar mapa global de clientes (já carregado no Batch 1 — sem chamadas individuais)
        const clientesMap = clientesMapGlobal;

        // Buscar TODOS os itens em 1 única chamada backend
        let itensPedido = {};
        let itensTroca = {};

        // Pedidos de venda vindos do espelho Omie que chegaram SEM produtos[] (espelho
        // ainda não preenchido pelo webhook) — precisam ter os itens locais buscados,
        // senão a coluna "Pacotes" fica zerada mesmo o pedido tendo itens no banco.
        const vendasOmieSemProdutos = vendasEnriquecidas.filter(
          p => p.pedido_id && (!p.produtos || p.produtos.length === 0)
        );

        // Incluir pedido_ids dos D1 + NF55 locais + vendas Omie sem produtos (todos usam PedidoItem)
        const todosIdsPedidos = [
          ...d1SemItens.map(p => p.pedido_id),
          ...vendasLocais.map(p => p.pedido_id),
          ...vendasOmieSemProdutos.map(p => p.pedido_id)
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

        // Enriquecer vendas Omie com bairro/endereço do cliente
        // E, quando o espelho veio SEM produtos[], preencher os pacotes com os itens
        // locais do pedido (buscados acima) — corrige a coluna "Pacotes" zerada.
        const vendasOmieEnriquecidas = vendasEnriquecidas.map(p => {
          const cliente = p.cliente_id ? clientesMap.get(p.cliente_id) : null;
          const semProdutos = !p.produtos || p.produtos.length === 0;
          const itensLocais = (semProdutos && p.pedido_id) ? (itensPedido[p.pedido_id] || []) : [];
          return {
            ...p,
            bairro: cliente?.bairro || '',
            endereco: cliente?.endereco || '',
            produtos: itensLocais.length > 0
              ? itensLocais.map(i => montarItemProduto(i, 'pedido'))
              : p.produtos
          };
        });

        // Mesma deduplicação da Fase 1 (espelho Omie tem prioridade sobre o NF55 local)
        const dedupVendasItensMap = new Map();
        [...vendasOmieEnriquecidas, ...(temNf55Local ? vendasLocaisComItens : vendasLocais)].forEach(p => {
          const k = chaveVenda(p);
          if (!dedupVendasItensMap.has(k)) dedupVendasItensMap.set(k, p);
        });
        const todasVendasComItens = Array.from(dedupVendasItensMap.values());

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
            bairro: cliente?.bairro || '',
            endereco: cliente?.endereco || '',
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
            bairro: cliente?.bairro || '',
            endereco: cliente?.endereco || '',
            rota_nome: rotaNome, rota_cliente: rotaNome,
            quantidade_itens: itens.length,
            produtos: itens.map(i => montarItemProduto(i, 'troca'))
          };
        });

        // Atualizar pedidos com itens completos
        const pedidosFinal = [...todasVendasComItens, ...d1Completos, ...trocasCompletas];
        console.log(`[DEBUG CONTAGEM] FASE 2 → vendasComItens: ${todasVendasComItens.length} | d1Completos: ${d1Completos.length} | trocasCompletas: ${trocasCompletas.length} | total Fase 2: ${pedidosFinal.length}`);
        setPedidos(pedidosFinal);
        temPedidosRef.current = pedidosFinal.length > 0;
        setCarregandoItens(false);

        // Cachear dados completos
        setCache({
          pedidos: pedidosFinal,
          motoristas: motoristasAtivos,
          veiculos: veiculosAtivos,
          cargas: carP
        });
        } catch (fase2Err) {
          // Fase 2 falhou — manter os pedidos da Fase 1 (já com os D1 sem itens). Nunca somem.
          console.warn('[MontagemCarga] Fase 2 falhou, mantendo lista da Fase 1 (D1 preservados):', fase2Err?.message);
          setCarregandoItens(false);
          // Cachear a Fase 1 para que o próximo load não sirva um snapshot antigo sem os D1.
          setCache({
            pedidos: pedidosFase1,
            motoristas: motoristasAtivos,
            veiculos: veiculosAtivos,
            cargas: carP
          });
        }
      } else {
        // Sem D1/Trocas/NF55local — a lista final É a Fase 1. Se a tela estava com dados
        // antigos (auto-refresh) e a Fase 1 não foi pintada acima, aplicá-la agora de uma
        // vez (já é a versão definitiva neste caminho, sem etapa de itens pendente).
        if (temPedidosRef.current) {
          setPedidos(pedidosFase1);
        }
        temPedidosRef.current = pedidosFase1.length > 0;
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
        if (cached?.data?.pedidos?.length > 0) {
          setPedidos(cached.data.pedidos);
          temPedidosRef.current = true;
          setMotoristas(cached.data.motoristas || []);
          setVeiculos(cached.data.veiculos || []);
          setCargas(cached.data.cargas || []);
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
    localStorage.removeItem(CACHE_KEY + '_' + getUserCacheKey());
    setLoading(true);
    // Aguardar reconciliação do espelho ANTES de carregar dados,
    // para que pedidos que mudaram de etapa 10→20 no Omie apareçam imediatamente.
    try {
      await base44.functions.invoke('sincronizarLiberadosOmieRapido', { origem: 'manual', forcar_sem_cache: true });
    } catch (e) {
      console.warn('[useDadosMontagem] sync Omie falhou:', e?.message);
    }
    await carregar();
  }, [carregar]);

  // Re-fetch LOCAL: limpa cache e relê as entidades do Base44, SEM chamar o Omie.
  // Usado no auto-refresh para trazer pedidos recém-liberados sem custo de API externa.
  const recarregarLocal = useCallback(async () => {
    localStorage.removeItem(CACHE_KEY + '_' + getUserCacheKey());
    await carregar(true);
  }, [carregar]);

  useEffect(() => {
    carregar();
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [carregar]);

  // Auto-refresh leve: a cada 60s relê as entidades locais (sem Omie) para que
  // pedidos liberados entrem na lista sozinhos, sem o logístico clicar em Atualizar.
  useEffect(() => {
    const intervalo = setInterval(() => {
      recarregarLocal();
    }, 60000);
    return () => clearInterval(intervalo);
  }, [recarregarLocal]);

  return { loading, pedidos, motoristas, veiculos, cargas, recarregar, carregandoItens };
}