import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Recalcula o status de cobertura por cliente e por papel, com base na sequência
// de agendas consecutivas NAO_REALIZADA (AgendaComercial), e gera alertas em cascata.
// Regra: 1 falha = atencao→Supervisor; 2 = atrasado→Coordenador; 3+ = critico→Gerência.

function statusPorFalhas(f) {
  if (f <= 0) return 'em_dia';
  if (f === 1) return 'atencao';
  if (f === 2) return 'atrasado';
  return 'critico';
}
function escalonamento(f) {
  if (f === 1) return { nivel: 'atencao', destino_papel: 'supervisor' };
  if (f === 2) return { nivel: 'alerta', destino_papel: 'coordenador' };
  if (f >= 3) return { nivel: 'critico', destino_papel: 'gerencia' };
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const db = base44.asServiceRole.entities;

    // Carrega agendas (passadas até hoje), clientes, funcionários
    const hoje = new Date().toISOString().slice(0, 10);
    const [agendas, vendedores, coberturasExistentes, alertasAbertos] = await Promise.all([
      db.AgendaComercial.list('-data_prevista', 5000),
      db.Vendedor.list('', 2000),
      db.CoberturaStatus.list('', 5000),
      db.Alerta.filter({ status: 'aberto', tipo: 'agenda_nao_cumprida' }, '', 5000),
    ]);

    const vendedorPorId = Object.fromEntries(vendedores.map((v) => [v.id, v]));
    const temPapel = (v, p) => Array.isArray(v?.papeis) && v.papeis.includes(p);
    const acharPorPapel = (papel) => vendedores.find((v) => temPapel(v, papel));
    const gerencia = acharPorPapel('gerente') || acharPorPapel('gerencia');
    const coordenador = acharPorPapel('coordenador');

    // Agrupa agendas por (cliente_id|papel) ordenadas por data
    const grupos = {};
    for (const a of agendas) {
      if (a.data_prevista > hoje) continue; // ignora futuras
      const k = `${a.cliente_id}|${a.papel}`;
      (grupos[k] = grupos[k] || []).push(a);
    }

    const coberturaPorChave = {};
    for (const c of coberturasExistentes) coberturaPorChave[`${c.cliente_id}|${c.papel}`] = c;

    let atualizadas = 0;
    let alertasCriados = 0;
    let alertasAtualizados = 0;

    for (const [chave, lista] of Object.entries(grupos)) {
      lista.sort((a, b) => (a.data_prevista < b.data_prevista ? -1 : 1));
      const [cliente_id, papel] = chave.split('|');

      // conta falhas consecutivas a partir do fim, parando na 1ª realizada
      let falhas = 0;
      let ultimaVisita = null;
      for (let i = lista.length - 1; i >= 0; i--) {
        const a = lista[i];
        if (a.status_visita === 'realizada') { ultimaVisita = a.data_prevista; break; }
        if (a.status_visita === 'nao_realizada') falhas++;
        // pendentes no passado contam como falha (data já passou)
        else if (a.status_visita === 'pendente') falhas++;
      }

      const status = statusPorFalhas(falhas);
      const ref = lista[lista.length - 1];
      const responsavel = vendedorPorId[ref.usuario_id];
      const supervisorId = responsavel?.supervisor_id || (responsavel?.supervisor_ids || [])[0] || null;

      const dados = {
        cliente_id,
        cliente_nome: ref.cliente_nome,
        papel,
        responsavel_id: ref.usuario_id,
        responsavel_nome: ref.usuario_nome,
        supervisor_id: supervisorId,
        falhas_consecutivas: falhas,
        status_cobertura: status,
        ultima_visita_em: ultimaVisita,
        atualizado_em: new Date().toISOString(),
      };

      const existente = coberturaPorChave[chave];
      if (existente) await db.CoberturaStatus.update(existente.id, dados);
      else await db.CoberturaStatus.create(dados);
      atualizadas++;

      // Alertas em cascata
      const esc = escalonamento(falhas);
      if (esc) {
        let destinatario = null;
        if (esc.destino_papel === 'supervisor' && supervisorId) destinatario = vendedorPorId[supervisorId];
        else if (esc.destino_papel === 'coordenador') destinatario = coordenador;
        else if (esc.destino_papel === 'gerencia') destinatario = gerencia;

        // Não duplicar: se já há alerta aberto mesmo cliente+papel+nivel, só atualiza timestamp
        const jaAberto = alertasAbertos.find(
          (al) => al.cliente_id === cliente_id && al.papel_origem === papel && al.nivel === esc.nivel
        );
        const msg = `${ref.cliente_nome || 'Cliente'} — ${falhas} agenda(s) de ${papel} não cumprida(s)`;
        if (jaAberto) {
          await db.Alerta.update(jaAberto.id, { criado_em: new Date().toISOString() });
          alertasAtualizados++;
        } else {
          await db.Alerta.create({
            tipo: 'agenda_nao_cumprida',
            cliente_id,
            cliente_nome: ref.cliente_nome,
            papel_origem: papel,
            responsavel_id: ref.usuario_id,
            responsavel_nome: ref.usuario_nome,
            destinatario_id: destinatario?.id || null,
            destinatario_nome: destinatario?.nome || null,
            nivel: esc.nivel,
            status: 'aberto',
            mensagem: msg,
            criado_em: new Date().toISOString(),
          });
          alertasCriados++;
        }
      }
    }

    return Response.json({
      ok: true,
      coberturas_atualizadas: atualizadas,
      alertas_criados: alertasCriados,
      alertas_atualizados: alertasAtualizados,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});