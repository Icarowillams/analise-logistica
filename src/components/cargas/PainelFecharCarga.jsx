import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, LockKeyhole, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency, qtdPacotesPedido } from './montagemUtils';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';

const LIMITE_AVISO_CARGA = 25;

// Gera o próximo número de carga a partir de uma sequência PERSISTENTE (ContadorCarga).
// Importante: nunca decrementa, mesmo se a última carga for cancelada ou excluída.
// Fallback: se o contador ainda não existir, inicializa a partir do maior número já usado nas cargas.
async function gerarNumeroCarga(cargas) {
  const contadores = await base44.entities.ContadorCarga.filter({ chave: 'global' }, '-created_date', 1);
  let contador = contadores?.[0];

  if (!contador) {
    const numeros = (cargas || [])
      .map(c => parseInt((c.numero_carga || '').replace(/\D/g, ''), 10))
      .filter(n => !isNaN(n) && n < 10000);
    const base = numeros.length ? Math.max(...numeros) : 0;
    contador = await base44.entities.ContadorCarga.create({ chave: 'global', ultimo_numero: base });
  }

  const proximo = (contador.ultimo_numero || 0) + 1;
  await base44.entities.ContadorCarga.update(contador.id, { ultimo_numero: proximo });
  return String(proximo).padStart(3, '0');
}

export default function PainelFecharCarga({ pedidos, selecionados, motoristas, veiculos, cargas, onSuccess }) {
  const navigate = useNavigate();
  const hoje = new Date().toISOString().slice(0, 10);
  const [motoristaId, setMotoristaId] = useState('');
  const [veiculoId, setVeiculoId] = useState('');
  const [dataSaida, setDataSaida] = useState(hoje);
  const [obs, setObs] = useState('');
  const [salvando, setSalvando] = useState(false);

  const pedidosSel = useMemo(() => pedidos.filter(p => selecionados.includes(p.codigo_pedido)), [pedidos, selecionados]);
  const vendas = pedidosSel.filter(p => p.tipo !== 'troca' && p.tipo !== 'd1');
  const pedidosD1 = pedidosSel.filter(p => p.tipo === 'd1');
  const trocas = pedidosSel.filter(p => p.tipo === 'troca');
  const valorTotal = pedidosSel.reduce((s, p) => s + (p.valor_total_pedido || 0), 0);
  const qtdPacotesTotal = pedidosSel.reduce((s, p) => s + qtdPacotesPedido(p), 0);
  const produtosDistintos = new Set(pedidosSel.flatMap(p => (p.produtos || []).map(pr => pr.codigo_produto || pr.descricao))).size;

  // Preenche produtos vazios de pedidos de VENDA a partir de fontes LOCAIS
  // (espelho PedidoLiberadoOmie → PedidoItem). Retorna { vendas, semItens }.
  const preencherProdutosVendas = async (vendasSel) => {
    const vazios = vendasSel.filter(v => !(Array.isArray(v.produtos) && v.produtos.length > 0));
    if (vazios.length === 0) return { vendas: vendasSel, semItens: [] };

    // 1) Espelho por codigo_pedido
    const codigos = [...new Set(vazios.map(v => String(v.codigo_pedido || '')).filter(Boolean))];
    const espelhoPorCodigo = new Map();
    for (let i = 0; i < codigos.length; i += 40) {
      const chunk = codigos.slice(i, i + 40);
      const espelhos = await base44.entities.PedidoLiberadoOmie.filter({ codigo_pedido: { $in: chunk } }, '-created_date', 200);
      (espelhos || []).forEach(e => espelhoPorCodigo.set(String(e.codigo_pedido), e));
    }

    // 2) PedidoItem por pedido_id (só p/ quem o espelho não resolveu)
    const semItens = [];
    const vendasPreenchidas = [];
    for (const v of vendasSel) {
      if (Array.isArray(v.produtos) && v.produtos.length > 0) { vendasPreenchidas.push(v); continue; }

      const esp = espelhoPorCodigo.get(String(v.codigo_pedido || ''));
      let produtos = (esp?.produtos || []).map(pr => ({
        codigo_produto: pr.codigo_produto || '', codigo_produto_integracao: pr.codigo_produto_integracao || '',
        descricao: pr.descricao || '', quantidade: Number(pr.quantidade) || 0,
        valor_unitario: Number(pr.valor_unitario) || 0, valor_total: Number(pr.valor_total) || 0,
        unidade: pr.unidade || 'UN'
      }));

      if (produtos.length === 0 && v.pedido_id) {
        const itens = await base44.entities.PedidoItem.filter({ pedido_id: v.pedido_id }, '-created_date', 500);
        produtos = (itens || []).map(i => ({
          codigo_produto: i.produto_codigo || '', codigo_produto_integracao: '',
          descricao: i.produto_nome || '', quantidade: Number(i.quantidade) || 0,
          valor_unitario: Number(i.valor_unitario) || 0, valor_total: Number(i.valor_total) || 0,
          unidade: i.unidade_medida || 'UN'
        }));
      }

      if (produtos.length === 0) { semItens.push(v.numero_pedido || v.codigo_pedido); }
      vendasPreenchidas.push({ ...v, produtos, quantidade_itens: produtos.length || v.quantidade_itens || 0 });
    }
    return { vendas: vendasPreenchidas, semItens };
  };

  const fecharCarga = async () => {
    if (pedidosSel.length === 0) { toast.error('Selecione ao menos 1 pedido'); return; }
    if (!motoristaId || !veiculoId || !dataSaida) {
      toast.error('Motorista, Veículo e Data de Saída são obrigatórios');
      return;
    }

    // AVISO CARGA GIGANTE: cargas costumam ser por rota. Acima do limite, confirmar.
    if (pedidosSel.length > LIMITE_AVISO_CARGA) {
      const rotasDistintas = new Set(pedidosSel.map(p => p.rota_nome || 'Sem Rota')).size;
      const ok = window.confirm(
        `Você está fechando uma carga com ${pedidosSel.length} pedidos (${rotasDistintas} rota(s)), ${formatCurrency(valorTotal)}.\n\n` +
        `Isso é muito acima do normal — cargas costumam ser por rota. Deseja realmente fechar?`
      );
      if (!ok) return;
    }

    setSalvando(true);

    // BLINDAGEM CONTRA CARGA DUPLICADA: antes de fechar, verifica se algum pedido
    // selecionado já está vinculado a uma carga ATIVA (montagem/faturada/entregue).
    // Isso evita o bug de "duas cargas idênticas" quando a mesma seleção é fechada
    // duas vezes (re-render lento / clique repetido / carga montada em 2 momentos).
    try {
      const idsParaChecar = [...new Set(
        [...vendas, ...pedidosD1, ...trocas]
          .map(p => p.pedido_id || p.pedido_troca_id)
          .filter(Boolean)
      )];
      const jaVinculados = [];
      for (let i = 0; i < idsParaChecar.length; i += 40) {
        const chunk = idsParaChecar.slice(i, i + 40);
        const peds = await base44.entities.Pedido.filter({ id: { $in: chunk } }, '-updated_date', 80);
        (peds || []).forEach(p => {
          if (p.carga_id && !['cancelado', 'cancelado_pos_faturamento'].includes(p.status)) {
            jaVinculados.push(`Nº ${p.numero_pedido} (carga ${p.numero_carga || '?'})`);
          }
        });
      }
      if (jaVinculados.length > 0) {
        setSalvando(false);
        toast.error(
          `Estes pedidos já estão em outra carga: ${jaVinculados.slice(0, 6).join(', ')}` +
          (jaVinculados.length > 6 ? ` e mais ${jaVinculados.length - 6}` : '') +
          '. Solte-os da carga atual antes de fechar uma nova.',
          { duration: 10000 }
        );
        return;
      }
    } catch (e) {
      console.warn('Falha na verificação de carga duplicada:', e.message);
    }

    // BLINDAGEM CARGA EM BRANCO: garantir que todo pedido de VENDA tenha produtos.
    // Se algum continuar sem itens (espelho ainda não sincronizou), BLOQUEIA o fechamento.
    const { vendas: vendasComProdutos, semItens } = await preencherProdutosVendas(vendas);
    if (semItens.length > 0) {
      setSalvando(false);
      const lista = semItens.map(n => formatarNumeroPedido(n, 'venda')).join(', ');
      toast.error(
        `O(s) pedido(s) Nº ${lista} ainda não sincronizaram os itens — aguarde alguns segundos e tente de novo.`,
        { duration: 8000 }
      );
      return;
    }

    // SNAPSHOT dos dados ANTES de qualquer await — evita que re-renders
    // durante operações assíncronas esvaziem os arrays (bug cargas com 0 pedidos)
    const snapshotPedidos = [...pedidosSel];
    const snapshotVendas = [...vendasComProdutos];
    const snapshotD1 = [...pedidosD1];
    const snapshotTrocas = [...trocas];
    const snapshotValorTotal = valorTotal;
    const snapshotQtdPacotes = qtdPacotesTotal;

    if (snapshotPedidos.length === 0) { setSalvando(false); toast.error('Nenhum pedido selecionado (snapshot vazio)'); return; }

    try {
      const motorista = motoristas.find(m => m.id === motoristaId);
      const veiculo = veiculos.find(v => v.id === veiculoId);

      const pedidosOmieFmt = snapshotVendas.map(v => ({
        pedido_id: v.pedido_id || '',
        codigo_pedido: v.codigo_pedido,
        codigo_pedido_integracao: v.codigo_pedido_integracao || '',
        numero_pedido: v.numero_pedido,
        codigo_cliente: v.codigo_cliente,
        codigo_cliente_integracao: v.codigo_cliente_integracao || '',
        codigo_cliente_cod: v.codigo_cliente_cod || '',
        cnpj_cpf_cliente: v.cnpj_cpf_cliente || '',
        numero_nf: v.numero_nf || '',
        nome_cliente: v.nome_cliente,
        nome_fantasia: v.nome_fantasia,
        cidade: v.cidade,
        rota_cliente: v.rota_nome,
        valor_total_pedido: v.valor_total_pedido || 0,
        quantidade_itens: v.quantidade_itens || 0,
        tags_cliente: v.tags_cliente || [],
        tipo_operacao_fiscal: v.tipo_operacao_fiscal || v.tipo_operacao || v.cenario_local_tipo || 'venda',
        cenario_fiscal_nome: v.cenario_fiscal_nome || v.cenario_local_nome || '',
        produtos: v.produtos || []
      }));

      const pedidosD1Fmt = snapshotD1.map(p => ({
        pedido_id: p.pedido_id,
        numero_pedido: p.numero_pedido,
        modelo_nota: 'd1',
        cenario_fiscal_nome: p.cenario_fiscal_nome || p.cenario_local_nome || '',
        tipo_operacao_fiscal: p.tipo_operacao_fiscal || p.cenario_local_tipo || 'venda',
        cliente_id: p.cliente_id,
        nome_cliente: p.nome_cliente,
        nome_fantasia: p.nome_fantasia,
        cidade: p.cidade,
        rota_cliente: p.rota_nome,
        vendedor_nome: p.vendedor_nome || '',
        valor_total_pedido: p.valor_total_pedido || 0,
        quantidade_itens: p.quantidade_itens || 0,
        produtos: p.produtos || []
      }));

      const pedidosTrocaFmt = snapshotTrocas.map(t => ({
        pedido_troca_id: t.pedido_troca_id || t.pedido_id || '',
        pedido_id: t.pedido_id || t.pedido_troca_id || '',
        numero_pedido: t.numero_pedido,
        cliente_id: t.cliente_id,
        nome_cliente: t.nome_cliente,
        nome_fantasia: t.nome_fantasia,
        cidade: t.cidade,
        rota_cliente: t.rota_nome,
        valor_total_pedido: t.valor_total_pedido || 0,
        quantidade_itens: t.quantidade_itens || 0,
        produtos: t.produtos || []
      }));

      const clientesUnicos = new Set(snapshotPedidos.map(p => p.cliente_id || p.codigo_cliente));
      let carga = null;
      let numero = null;
      for (let tentativa = 0; tentativa < 10; tentativa++) {
        numero = await gerarNumeroCarga(cargas);
        const existentes = await base44.entities.Carga.filter({ numero_carga: numero }, '-created_date', 2);
        if (existentes.length > 0) continue;

        carga = await base44.entities.Carga.create({
          numero_carga: numero,
          data_carga: dataSaida,
          motorista_id: motoristaId,
          motorista_nome: motorista?.nome || '',
          veiculo_id: veiculoId,
          veiculo_placa: veiculo?.placa || '',
          status_carga: 'montagem',
          valor_total: snapshotValorTotal,
          valor_total_carga: snapshotValorTotal,
          quantidade_pedidos: snapshotPedidos.length,
          quantidade_clientes: clientesUnicos.size,
          quantidade_total_pacotes: snapshotQtdPacotes,
          notas_fiscais: snapshotPedidos.map(p => p.numero_pedido).filter(Boolean),
          pedidos_omie: pedidosOmieFmt,
          pedidos_internos: pedidosD1Fmt,
          pedidos_troca: pedidosTrocaFmt,
          observacao: obs,
          observacoes: obs
        });

        const duplicadas = await base44.entities.Carga.filter({ numero_carga: numero }, '-created_date', 10);
        if (duplicadas.length <= 1 || duplicadas[0]?.id === carga.id) break;
        await base44.entities.Carga.delete(carga.id).catch(() => {});
        carga = null;
      }

      if (!carga) {
        throw new Error('Não foi possível gerar número de carga único após 10 tentativas. Tente novamente.');
      }

      const falhasVinculo = [];

      for (const p of [...snapshotVendas, ...snapshotD1]) {
        try {
          let pedidoId = p.pedido_id;
          if (!pedidoId && p.codigo_pedido) {
            const locais = await base44.entities.Pedido.filter({ omie_codigo_pedido: String(p.codigo_pedido) }, '-created_date', 1);
            pedidoId = locais?.[0]?.id;
          }
          if (!pedidoId) {
            falhasVinculo.push(p.numero_pedido || p.codigo_pedido);
            continue;
          }
          await base44.entities.Pedido.update(pedidoId, {
            carga_id: carga.id,
            numero_carga: numero,
            status: 'montagem',
            status_logistico: 'em_carga',
            etapa: 'logistica'
          });
        } catch (e) {
          falhasVinculo.push(p.numero_pedido || p.codigo_pedido);
          console.warn('Falha vincular pedido à carga:', e.message);
        }
      }

      for (const t of snapshotTrocas) {
        try {
          if (t.pedido_troca_id) {
            await base44.entities.PedidoTroca.update(t.pedido_troca_id, {
              carga_id: carga.id,
              motorista_id: motoristaId,
              status: 'montagem'
            });
          }
          // Trocas criadas via emissão de pedidos (tipo='troca' em Pedido) também precisam ir para montagem
          let pedidoTrocaId = t.pedido_id;
          if (!pedidoTrocaId && t.numero_pedido) {
            const locais = await base44.entities.Pedido.filter({ numero_pedido: t.numero_pedido, tipo: 'troca' }, '-created_date', 1);
            pedidoTrocaId = locais?.[0]?.id;
          }
          if (pedidoTrocaId) {
            await base44.entities.Pedido.update(pedidoTrocaId, {
              carga_id: carga.id,
              numero_carga: numero,
              status: 'montagem',
              status_logistico: 'em_carga',
              etapa: 'logistica'
            });
          }
        } catch (e) {
          falhasVinculo.push(t.numero_pedido || t.pedido_troca_id);
          console.warn('Falha vincular troca:', e.message);
        }
      }

      // FECHAMENTO ASSÍNCRONO: em vez de chamar a Omie agora (o que bloqueava a API
      // com cargas grandes), enfileiramos 1 registro por pedido de venda. A função
      // scheduled processarFilaCargaOmie processa em background, espaçado e protegido.
      if (snapshotVendas.length > 0) {
        try {
          const itensFila = snapshotVendas.map(v => ({
            carga_id: carga.id,
            numero_carga: numero,
            pedido_id: v.pedido_id || '',
            codigo_pedido_omie: v.codigo_pedido ? String(v.codigo_pedido) : '',
            codigo_pedido_integracao: v.codigo_pedido_integracao || '',
            numero_pedido: v.numero_pedido || '',
            data_previsao: dataSaida,
            operacao: 'faturar',
            // ETAPA 50 = "Faturar". A NF (passo separado) é que leva 50→60.
            // NUNCA enfileirar destino 60 — o Omie recusa TrocarEtapaPedido para 60.
            etapa_destino: '50',
            status: 'pendente',
            tentativas: 0
          }));
          await base44.entities.FilaCargaOmie.bulkCreate(itensFila);
          await base44.entities.Carga.update(carga.id, {
            processamento_omie_status: 'em_andamento',
            processamento_omie_total: itensFila.length
          });
          // PROCESSAMENTO IMEDIATO: dispara a fila agora (fire-and-forget).
          // Se falhar, a automação scheduled de 5 min retenta automaticamente.
          base44.functions.invoke('processarFilaCargaOmie', {}).catch(() => {});
        } catch (e) {
          console.warn('Falha ao enfileirar processamento Omie:', e.message);
          // Garante que a carga não fique exibindo "Aguardando fila" sem itens na fila.
          await base44.entities.Carga.update(carga.id, {
            processamento_omie_status: 'erro',
            processamento_omie_total: 0
          }).catch(() => {});
          toast.error(
            `Carga ${numero} criada, mas falha ao enfileirar pedidos no Omie: ${e.message}. ` +
            'Reabra a carga em "Gerenciar Cargas" para reprocessar.'
          );
          onSuccess?.(carga);
          setSalvando(false);
          navigate('/Cargas');
          return;
        }
      }

      if (falhasVinculo.length > 0) {
        toast.error(`Carga ${numero} criada, mas ${falhasVinculo.length} pedido(s) não tiveram status local atualizado`);
      } else if (snapshotVendas.length > 0) {
        toast.success(`Carga fechada com sucesso. ${snapshotVendas.length} pedidos estão sendo processados na Omie. Acompanhe o progresso na tela de Cargas.`, { duration: 8000 });
      } else {
        toast.success(`Carga ${numero} criada com ${snapshotPedidos.length} pedidos`);
      }
      onSuccess?.(carga);
      navigate('/Cargas');
    } catch (e) {
      toast.error('Erro ao fechar carga: ' + e.message);
    }
    setSalvando(false);
  };

  return (
    <Card className="2xl:sticky 2xl:top-4 border-0 bg-white shadow-sm rounded-xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-900">Fechar carga</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-3 text-sm">
          <div><div className="text-xs text-slate-500">Pedidos</div><div className="font-bold text-slate-900">{pedidosSel.length}</div></div>
          <div><div className="text-xs text-slate-500">Pacotes</div><div className="font-bold text-slate-900">{qtdPacotesTotal.toLocaleString('pt-BR')}</div></div>
          <div><div className="text-xs text-slate-500">Produtos</div><div className="font-bold text-slate-900">{produtosDistintos}</div></div>
          <div><div className="text-xs text-slate-500">Valor</div><div className="font-bold text-slate-900">{formatCurrency(valorTotal)}</div></div>
        </div>

        <div>
          <Label>Motorista *</Label>
          <Select value={motoristaId} onValueChange={setMotoristaId}>
            <SelectTrigger className="border-slate-200 bg-slate-50"><SelectValue placeholder="Selecione o motorista" /></SelectTrigger>
            <SelectContent>{motoristas.map(m => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Veículo *</Label>
          <Select value={veiculoId} onValueChange={setVeiculoId}>
            <SelectTrigger className="border-slate-200 bg-slate-50"><SelectValue placeholder="Selecione o veículo" /></SelectTrigger>
            <SelectContent>{veiculos.map(v => <SelectItem key={v.id} value={v.id}>{v.placa} — {v.descricao || v.modelo || ''}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Data de saída *</Label>
          <Input className="border-slate-200 bg-slate-50" type="date" value={dataSaida} onChange={(e) => setDataSaida(e.target.value)} />
        </div>
        <div>
          <Label>Observações</Label>
          <Textarea className="border-slate-200 bg-slate-50" rows={3} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Instruções da carga, conferência ou rota" />
        </div>

        <div className="border-t border-slate-100 pt-3 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Vendas Omie</span><span className="font-medium">{vendas.length}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">D1 Interno</span><span className="font-medium">{pedidosD1.length}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Trocas</span><span className="font-medium">{trocas.length}</span></div>
        </div>

        <Button className="w-full bg-cyan-500 text-white hover:bg-cyan-600" disabled={salvando || pedidosSel.length === 0} onClick={fecharCarga}>
          {salvando ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Truck className="w-4 h-4 mr-2" />}
          Fechar carga ({pedidosSel.length})
        </Button>
      </CardContent>
    </Card>
  );
}