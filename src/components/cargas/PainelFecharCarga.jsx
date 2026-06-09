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

  const fecharCarga = async () => {
    if (pedidosSel.length === 0) { toast.error('Selecione ao menos 1 pedido'); return; }
    if (!motoristaId || !veiculoId || !dataSaida) {
      toast.error('Motorista, Veículo e Data de Saída são obrigatórios');
      return;
    }

    setSalvando(true);
    try {
      const motorista = motoristas.find(m => m.id === motoristaId);
      const veiculo = veiculos.find(v => v.id === veiculoId);

      const pedidosOmieFmt = vendas.map(v => ({
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

      const pedidosD1Fmt = pedidosD1.map(p => ({
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

      const pedidosTrocaFmt = trocas.map(t => ({
        pedido_troca_id: t.pedido_troca_id,
        pedido_id: t.pedido_id || '',
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

      const clientesUnicos = new Set(pedidosSel.map(p => p.cliente_id || p.codigo_cliente));
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
          valor_total: valorTotal,
          valor_total_carga: valorTotal,
          quantidade_pedidos: pedidosSel.length,
          quantidade_clientes: clientesUnicos.size,
          quantidade_total_pacotes: qtdPacotesTotal,
          notas_fiscais: pedidosSel.map(p => p.numero_pedido).filter(Boolean),
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

      for (const p of [...vendas, ...pedidosD1]) {
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

      for (const t of trocas) {
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
      if (vendas.length > 0) {
        try {
          const itensFila = vendas.map(v => ({
            carga_id: carga.id,
            numero_carga: numero,
            pedido_id: v.pedido_id || '',
            codigo_pedido_omie: v.codigo_pedido ? String(v.codigo_pedido) : '',
            codigo_pedido_integracao: v.codigo_pedido_integracao || '',
            numero_pedido: v.numero_pedido || '',
            data_previsao: dataSaida,
            operacao: 'faturar',
            etapa_destino: '50',
            status: 'pendente',
            tentativas: 0
          }));
          await base44.entities.FilaCargaOmie.bulkCreate(itensFila);
          await base44.entities.Carga.update(carga.id, {
            processamento_omie_status: 'nao_iniciado',
            processamento_omie_total: itensFila.length
          });
        } catch (e) {
          console.warn('Falha ao enfileirar processamento Omie:', e.message);
          // Garante que a carga não fique exibindo "Aguardando fila" sem itens na fila.
          await base44.entities.Carga.update(carga.id, {
            processamento_omie_status: 'nao_iniciado',
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
      } else if (vendas.length > 0) {
        toast.success(`Carga fechada com sucesso. ${vendas.length} pedidos serão processados em fila na Omie. Acompanhe o progresso na tela de Cargas.`, { duration: 8000 });
      } else {
        toast.success(`Carga ${numero} criada com ${pedidosSel.length} pedidos`);
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