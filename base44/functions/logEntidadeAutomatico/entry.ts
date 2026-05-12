import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Função chamada automaticamente por automações de entidade (create/update/delete).
// Detecta os campos alterados e registra no LogGerencial.

// Campos a IGNORAR no diff (ruído ou auto-gerados)
const CAMPOS_IGNORAR = new Set([
  'id', 'created_date', 'updated_date', 'created_by', 'created_by_id',
  'sincronizado_em', 'omie_enviado', 'omie_codigo_pedido', 'omie_erro',
  'is_deleted', 'is_sample', 'deleted_date', 'environment', 'entity_name',
  'app_id', 'origem_sync'
]);

// Mapeamento entidade → tipo_acao padrão por evento
const MAPA_TIPO = {
  Pedido: { create: 'criacao', update: 'edicao', delete: 'exclusao' },
  Cliente: { create: 'criacao', update: 'edicao', delete: 'exclusao' },
  Carga: { create: 'criacao', update: 'edicao', delete: 'exclusao' },
  Transferencia: { create: 'transferencia', update: 'edicao', delete: 'exclusao' },
  LogCorte: { create: 'corte', update: 'edicao', delete: 'exclusao' },
  Permissao: { create: 'permissao', update: 'permissao', delete: 'permissao' },
  Produto: { create: 'criacao', update: 'edicao', delete: 'exclusao' },
  Vendedor: { create: 'criacao', update: 'edicao', delete: 'exclusao' },
  Veiculo: { create: 'criacao', update: 'edicao', delete: 'exclusao' },
  AcertoCaixa: { create: 'criacao', update: 'edicao', delete: 'exclusao' }
};

// Detecção especial de eventos a partir de campos alterados
function detectarTipoEspecial(entidade, oldData, data, changed) {
  if (entidade === 'Pedido') {
    const statusNovo = data?.status;
    const statusAntigo = oldData?.status;
    const statusMudou = changed.includes('status') && statusAntigo !== statusNovo;

    // Faturamento: só conta quando ENTRA no status faturado (não quando volta dele)
    if (statusMudou && statusNovo === 'faturado' && statusAntigo !== 'faturado') return 'faturamento';
    // Cancelamento: só ao entrar em cancelado
    if (statusMudou && statusNovo === 'cancelado' && statusAntigo !== 'cancelado') return 'cancelamento';
    // Liberação: só ao entrar em liberado vindo de pendente/enviado
    if (statusMudou && statusNovo === 'liberado' && (statusAntigo === 'pendente' || statusAntigo === 'enviado')) return 'liberacao';
    // Envio: só ao entrar em enviado vindo de pendente
    if (statusMudou && statusNovo === 'enviado' && statusAntigo === 'pendente') return 'envio';
    // Tornar pendente (reverter): qualquer status -> pendente
    if (statusMudou && statusNovo === 'pendente' && statusAntigo && statusAntigo !== 'pendente') return 'edicao';

    // Flag omie_enviado: só conta a primeira ativação
    if (changed.includes('omie_enviado') && !oldData?.omie_enviado && data?.omie_enviado) return 'envio';
    // NF emitida pela primeira vez
    if (changed.includes('numero_nota_fiscal') && !oldData?.numero_nota_fiscal && data?.numero_nota_fiscal) return 'faturamento';
  }
  if (entidade === 'Carga' && changed.includes('status_carga')
      && data?.status_carga === 'faturada' && oldData?.status_carga !== 'faturada') return 'faturamento';
  return null;
}

function descricaoEntidade(entidade, data) {
  if (!data) return '';
  if (entidade === 'Pedido') return `Pedido ${data.numero_pedido || data.id}`;
  if (entidade === 'Cliente') return `Cliente ${data.razao_social || data.nome_fantasia || ''}`.trim();
  if (entidade === 'Carga') return `Carga ${data.numero_carga || data.id}`;
  if (entidade === 'Transferencia') return `Transferência ${data.numero_pedido || data.id}`;
  if (entidade === 'LogCorte') return `Corte em ${data.numero_pedido || ''} / ${data.produto_descricao || ''}`;
  if (entidade === 'Permissao') return `Permissões de ${data.vendedor_nome || data.vendedor_id || ''}`;
  if (entidade === 'Produto') return `Produto ${data.descricao || data.codigo || ''}`;
  if (entidade === 'Vendedor') return `Funcionário ${data.nome || ''}`;
  return data.nome || data.descricao || data.id || '';
}

function formatarValor(v) {
  if (v === null || v === undefined) return '(vazio)';
  if (typeof v === 'object') {
    try { return JSON.stringify(v).slice(0, 200); } catch { return '(objeto)'; }
  }
  return String(v).slice(0, 300);
}

// Mapeia valores internos para rótulos amigáveis ao usuário no log
function rotuloCampo(entidade, campo, valor) {
  if (valor === null || valor === undefined || valor === '') return '(vazio)';
  if (entidade === 'Pedido' && campo === 'status') {
    const mapa = {
      pendente: 'pendente',
      enviado: 'pendente',   // pós-envio o pedido segue "pendente" no Gerenciar Pedidos
      liberado: 'liberado',
      montagem: 'em montagem',
      faturado: 'faturado',
      cancelado: 'cancelado'
    };
    return mapa[valor] || valor;
  }
  return formatarValor(valor);
}

function calcularDiff(entidade, oldData, newData) {
  const diffs = [];
  if (!oldData || !newData) return diffs;
  const keys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  for (const k of keys) {
    if (CAMPOS_IGNORAR.has(k)) continue;
    const a = oldData[k];
    const b = newData[k];
    const aStr = formatarValor(a);
    const bStr = formatarValor(b);
    if (aStr !== bStr) {
      diffs.push({
        campo: k,
        valor_anterior: rotuloCampo(entidade, k, a),
        valor_novo: rotuloCampo(entidade, k, b)
      });
    }
  }
  return diffs.slice(0, 50);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { event, data, old_data } = payload;
    if (!event) return Response.json({ ignored: true });

    const entidade = event.entity_name;
    const tipoEvento = event.type; // create | update | delete
    const dadosAtuais = data || old_data || {};

    const changedFields = (() => {
      if (tipoEvento !== 'update') return [];
      const keys = new Set([...Object.keys(old_data || {}), ...Object.keys(data || {})]);
      return [...keys].filter(k => !CAMPOS_IGNORAR.has(k) && formatarValor((old_data || {})[k]) !== formatarValor((data || {})[k]));
    })();

    // Se for update sem mudança relevante, ignora
    if (tipoEvento === 'update' && changedFields.length === 0) {
      return Response.json({ ignored: true, reason: 'no_relevant_changes' });
    }

    const tipoAcao = detectarTipoEspecial(entidade, old_data, data, changedFields)
      || (MAPA_TIPO[entidade]?.[tipoEvento])
      || 'outro';

    const alteracoes = tipoEvento === 'update' ? calcularDiff(entidade, old_data, data) : [];

    const descEntidade = descricaoEntidade(entidade, dadosAtuais);
    const usuarioEmail = dadosAtuais.created_by || 'sistema';

    // Descrição leg\u00edvel
    let descricao = '';
    if (tipoAcao === 'envio') descricao = `Enviou ${descEntidade} para Omie`;
    else if (tipoAcao === 'faturamento') descricao = `Faturou ${descEntidade}`;
    else if (tipoAcao === 'cancelamento') descricao = `Cancelou ${descEntidade}`;
    else if (tipoAcao === 'liberacao') descricao = `Liberou ${descEntidade}`;
    else if (tipoAcao === 'transferencia') descricao = `Transferiu ${descEntidade}`;
    else if (tipoAcao === 'corte') descricao = `Realizou corte em ${descEntidade}`;
    else if (tipoAcao === 'permissao') descricao = `Atualizou ${descEntidade}`;
    else if (tipoEvento === 'create') descricao = `Criou ${descEntidade}`;
    else if (tipoEvento === 'delete') descricao = `Excluiu ${descEntidade}`;
    else if (tipoEvento === 'update') descricao = `Alterou ${descEntidade} (${alteracoes.length} campo${alteracoes.length === 1 ? '' : 's'})`;

    const registro = {
      tipo_acao: tipoAcao,
      entidade_tipo: entidade,
      entidade_id: event.entity_id,
      entidade_descricao: descEntidade,
      usuario_email: usuarioEmail,
      usuario_nome: usuarioEmail,
      descricao,
      alteracoes,
      origem: 'automation',
      observacao: ''
    };

    await base44.asServiceRole.entities.LogGerencial.create(registro);
    return Response.json({ sucesso: true });
  } catch (error) {
    console.error('logEntidadeAutomatico erro:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});