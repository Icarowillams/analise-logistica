import React, { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { fmtMoney, fmtDateTime, fmtInt, imprimirElemento } from './printHelper';
import { formatarNumeroPedido } from '@/lib/formatarNumeroPedido';

// Tipo de Nota: Venda / Bonificação / Troca / Devolução
// Prioridade: tipo_operacao_fiscal (campo oficial do Pedido) > cenario_local_tipo > nome do cenário
function tipoNotaLabel(item, origem) {
  if (origem === 'troca') return 'TROCA';
  const tipoFiscal = String(item.tipo_operacao_fiscal || item.cenario_local_tipo || item.tipo || '').toLowerCase();
  if (tipoFiscal === 'troca') return 'TROCA';
  if (tipoFiscal === 'bonificacao' || tipoFiscal === 'bonificação') return 'BONIFICAÇÃO';
  if (tipoFiscal === 'devolucao' || tipoFiscal === 'devolução') return 'DEVOLUÇÃO';
  if (tipoFiscal === 'venda') return 'VENDA';
  // Fallback: derivar do nome do cenário
  const cenario = (item.cenario_fiscal_nome || item.cenario_local_nome || '').toLowerCase();
  if (cenario.includes('troca')) return 'TROCA';
  if (cenario.includes('bonif')) return 'BONIFICAÇÃO';
  if (cenario.includes('devol')) return 'DEVOLUÇÃO';
  return 'VENDA';
}

// Extrai código do cliente do Base44 — preferindo o código interno (não o id de integração)
function getCodigoClienteBase(item, clienteResolvido) {
  return (
    clienteResolvido?.codigo_interno ||
    clienteResolvido?.codigo ||
    item.codigo_cliente_cod ||
    item.codigo_cliente ||
    '-'
  );
}

export default function RomaneioEntregaPdf({ carga }) {
  const printRef = useRef();

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresa-romaneio'],
    queryFn: () => base44.entities.Empresa.list()
  });
  const empresa = empresas[0] || {};

  // Carrega clientes para resolver código interno a partir do cliente_id
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes-romaneio'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 10000)
  });

  // Carrega modalidades de pagamento para resolver a cobrança a partir do cliente
  const { data: modalidades = [] } = useQuery({
    queryKey: ['modalidades-romaneio'],
    queryFn: () => base44.entities.ModalidadePagamento.list()
  });

  // Carrega vendedores para resolver o nome a partir do vendedor_id do cliente
  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores-romaneio'],
    queryFn: () => base44.entities.Vendedor.list('-created_date', 5000)
  });

  // Carrega pedidos cancelados desta carga (NF rejeitada → cancelado) para EXCLUIR
  const { data: pedidosCanceladosCarga = [] } = useQuery({
    queryKey: ['pedidos-cancelados-romaneio', carga?.id],
    queryFn: () => carga?.id
      ? base44.entities.Pedido.filter({ carga_id: carga.id, status: 'cancelado' })
      : Promise.resolve([]),
    enabled: !!carga?.id
  });

  // Carrega TODOS os pedidos da carga (faturados) para pegar numero_nota_fiscal atualizado
  const { data: pedidosCarga = [] } = useQuery({
    queryKey: ['pedidos-carga-romaneio', carga?.id],
    queryFn: () => carga?.id
      ? base44.entities.Pedido.filter({ carga_id: carga.id })
      : Promise.resolve([]),
    enabled: !!carga?.id
  });

  // Espelho local de pedidos Omie — tem numero_nf real
  const { data: liberadosOmie = [] } = useQuery({
    queryKey: ['liberados-omie-romaneio', carga?.id],
    queryFn: () => base44.entities.PedidoLiberadoOmie.list('-sincronizado_em', 5000),
    enabled: !!carga?.id
  });

  // Logs de emissão de NF — carrega todos os status para tratar rejeitadas/pendentes
  const { data: logsEmissaoNF = [] } = useQuery({
    queryKey: ['logs-emissao-nf-romaneio', carga?.id],
    queryFn: () => carga?.id
      ? base44.entities.LogEmissaoNF.filter({ carga_id: carga.id }, '-created_date', 1000)
      : Promise.resolve([]),
    enabled: !!carga?.id
  });

  // Index NF por codigo_pedido (Omie) e por id do Pedido interno, incluindo status/etapa
  const nfPorCodigoOmie = useMemo(() => {
    const m = new Map();

    logsEmissaoNF.forEach(log => {
      if (log.codigo_pedido && !m.has(String(log.codigo_pedido))) {
        m.set(String(log.codigo_pedido), {
          numero_nf: log.numero_nf || '',
          status: log.status || '',
          etapa: '',
          label: log.status === 'rejeitada' ? 'NF Rejeitada' : log.status === 'pendente' ? 'NF Pendente' : log.status === 'erro' ? 'Erro NF' : ''
        });
      }
    });

    liberadosOmie.forEach(lo => {
      if (!lo.codigo_pedido) return;
      const key = String(lo.codigo_pedido);
      const atual = m.get(key) || {};
      m.set(key, {
        ...atual,
        numero_nf: atual.numero_nf || lo.numero_nf || '',
        status: atual.status || lo.status_real || '',
        etapa: lo.etapa || atual.etapa || '',
        label: atual.label || lo.status_label || ''
      });
    });

    pedidosCarga.forEach(p => {
      const info = p.numero_nota_fiscal ? { numero_nf: p.numero_nota_fiscal, status: 'autorizada', etapa: p.etapa || '' } : null;
      if (!info) return;
      if (p.omie_codigo_pedido && !m.has(String(p.omie_codigo_pedido))) m.set(String(p.omie_codigo_pedido), info);
      if (p.id && !m.has(String(p.id))) m.set(String(p.id), info);
    });

    return m;
  }, [liberadosOmie, pedidosCarga, logsEmissaoNF]);

  const cancelados = useMemo(() => {
    const omieSet = new Set();
    const idSet = new Set();
    pedidosCanceladosCarga.forEach(p => {
      if (p.omie_codigo_pedido) omieSet.add(String(p.omie_codigo_pedido));
      if (p.id) idSet.add(String(p.id));
    });
    return { omieSet, idSet };
  }, [pedidosCanceladosCarga]);

  const clientesMap = useMemo(() => {
    const m = new Map();
    clientes.forEach(c => m.set(c.id, c));
    return m;
  }, [clientes]);

  // Index adicional por código interno para resolver pedidos Omie sem cliente_id
  const clientesPorCodigo = useMemo(() => {
    const m = new Map();
    clientes.forEach(c => {
      const cod = String(c.codigo_interno || c.codigo || '').trim();
      if (cod) m.set(cod, c);
    });
    return m;
  }, [clientes]);

  const resolverCliente = (p) => {
    if (p.cliente_id && clientesMap.has(p.cliente_id)) return clientesMap.get(p.cliente_id);
    const cod = String(p.codigo_cliente_cod || p.codigo_cliente_integracao || '').trim();
    if (cod && clientesPorCodigo.has(cod)) return clientesPorCodigo.get(cod);
    return null;
  };

  const modalidadesMap = useMemo(() => {
    const m = new Map();
    modalidades.forEach(mp => m.set(mp.id, mp));
    return m;
  }, [modalidades]);

  const vendedoresMap = useMemo(() => {
    const m = new Map();
    vendedores.forEach(v => m.set(v.id, v));
    return m;
  }, [vendedores]);

  const linhas = useMemo(() => {
    if (!carga) return [];
    const out = [];
    const resolverExtras = (p, cliente) => {
      const tipoFiscal = String(p.tipo_operacao_fiscal || p.cenario_local_tipo || '').toLowerCase();
      if (tipoFiscal === 'bonificacao' || tipoFiscal === 'bonificação') {
        const vendedorCliente = cliente?.vendedor_id ? vendedoresMap.get(cliente.vendedor_id) : null;
        return { cidade_cliente: cliente?.cidade || p.cidade || '', cobranca_nome: 'BONIFICAÇÃO', vendedor_nome_cliente: vendedorCliente?.nome || '' };
      }
      if (tipoFiscal === 'troca') {
        const vendedorCliente = cliente?.vendedor_id ? vendedoresMap.get(cliente.vendedor_id) : null;
        return { cidade_cliente: cliente?.cidade || p.cidade || '', cobranca_nome: 'TROCA', vendedor_nome_cliente: vendedorCliente?.nome || '' };
      }
      const modalidade = cliente?.modalidade_pagamento_id ? modalidadesMap.get(cliente.modalidade_pagamento_id) : null;
      const vendedorCliente = cliente?.vendedor_id ? vendedoresMap.get(cliente.vendedor_id) : null;
      return {
        cidade_cliente: cliente?.cidade || p.cidade || '',
        cobranca_nome: modalidade?.nome || p.cobranca || '',
        vendedor_nome_cliente: vendedorCliente?.nome || ''
      };
    };
    const resolverInfoNF = (p, origem) => {
      const key = origem === 'omie' && p.codigo_pedido ? p.codigo_pedido : (p.pedido_id || p.pedido_troca_id);
      const info = key ? nfPorCodigoOmie.get(String(key)) : null;
      if (!info) return { numero_nf: p.numero_nf || '', deveExibir: true };

      if (info.status === 'rejeitada') {
        const voltouEtapa50 = String(info.etapa || p.etapa || '') === '50';
        return voltouEtapa50
          ? { numero_nf: info.label || 'NF Rejeitada', deveExibir: true }
          : { numero_nf: '', deveExibir: false };
      }

      return {
        numero_nf: info.numero_nf || info.label || p.numero_nf || '',
        deveExibir: true
      };
    };
    (carga.pedidos_omie || []).forEach(p => {
      if (cancelados.omieSet.has(String(p.codigo_pedido))) return;
      const nfInfo = resolverInfoNF(p, 'omie');
      if (!nfInfo.deveExibir) return;
      const cliente = resolverCliente(p);
      out.push({
        ...p,
        _origem: 'omie',
        _tipo: tipoNotaLabel(p, 'omie'),
        numero_nf: nfInfo.numero_nf,
        codigo_cliente_display: getCodigoClienteBase(p, cliente),
        ...resolverExtras(p, cliente)
      });
    });
    (carga.pedidos_internos || []).forEach(p => {
      if (cancelados.idSet.has(String(p.pedido_id))) return;
      const nfInfo = resolverInfoNF(p, 'interno');
      if (!nfInfo.deveExibir) return;
      const cliente = resolverCliente(p);
      out.push({
        ...p,
        _origem: 'interno',
        _tipo: tipoNotaLabel(p, 'interno'),
        numero_nf: nfInfo.numero_nf,
        codigo_cliente_display: getCodigoClienteBase(p, cliente),
        ...resolverExtras(p, cliente)
      });
    });
    (carga.pedidos_troca || []).forEach(p => {
      if (cancelados.idSet.has(String(p.pedido_troca_id))) return;
      const nfInfo = resolverInfoNF(p, 'troca');
      if (!nfInfo.deveExibir) return;
      const cliente = resolverCliente(p);
      out.push({
        ...p,
        _origem: 'troca',
        _tipo: 'TROCA',
        numero_nf: nfInfo.numero_nf,
        codigo_cliente_display: getCodigoClienteBase(p, cliente),
        ...resolverExtras(p, cliente)
      });
    });
    return out;
  }, [carga, clientesMap, clientesPorCodigo, modalidadesMap, vendedoresMap, cancelados, nfPorCodigoOmie]);

  // Agrupar por cliente (mesmo cliente → 1 bloco com várias linhas de pedido)
  // Chave priorizada: código do cliente (consistente entre Venda/Troca/Bonificação)
  const gruposCliente = useMemo(() => {
    const mapa = new Map();
    linhas.forEach(l => {
      const codigoNorm = String(l.codigo_cliente_display || '').trim();
      const cnpjNorm = String(l.cnpj_cpf_cliente || '').replace(/\D/g, '');
      const key = (codigoNorm && codigoNorm !== '-' ? `cod:${codigoNorm}` : null)
        || (cnpjNorm ? `doc:${cnpjNorm}` : null)
        || (l.cliente_id ? `id:${l.cliente_id}` : null)
        || `nome:${l.nome_cliente || 'sem-cliente'}`;
      if (!mapa.has(key)) {
        mapa.set(key, {
          chave: key,
          codigo_cliente_display: l.codigo_cliente_display,
          nome_cliente: l.nome_cliente || '',
          nome_fantasia: l.nome_fantasia || '',
          cidade_cliente: l.cidade_cliente || '',
          pedidos: []
        });
      }
      mapa.get(key).pedidos.push(l);
    });
    // Ordena pedidos dentro de cada grupo: VENDA → BONIFICAÇÃO → TROCA → DEVOLUÇÃO
    const ordemTipo = { 'VENDA': 1, 'BONIFICAÇÃO': 2, 'TROCA': 3, 'DEVOLUÇÃO': 4 };
    mapa.forEach(g => {
      g.pedidos.sort((a, b) => (ordemTipo[a._tipo] || 99) - (ordemTipo[b._tipo] || 99));
    });
    return Array.from(mapa.values());
  }, [linhas]);

  // Totais
  const totais = useMemo(() => {
    const qtdNfs = linhas.length;
    const valor = linhas.reduce((s, l) => s + Number(l.valor_total_pedido || 0), 0);
    // Volume Total = soma das quantidades de produtos de todos os pedidos
    const volumeTotal = linhas.reduce((sLin, l) => {
      const qtdProdutos = (l.produtos || []).reduce((s, p) => s + Number(p.quantidade || 0), 0);
      return sLin + qtdProdutos;
    }, 0);
    // Valor de Bonificação/Trocas
    const valorBonifTrocas = linhas
      .filter(l => l._tipo === 'BONIFICAÇÃO' || l._tipo === 'TROCA')
      .reduce((s, l) => s + Number(l.valor_total_pedido || 0), 0);
    return {
      qtdNfs,
      valor,
      qtdEntregas: gruposCliente.length,
      volumeTotal,
      valorBonifTrocas
    };
  }, [linhas, gruposCliente]);

  const cidadeDestino = useMemo(() => {
    const cidades = [...new Set(linhas.map(l => l.cidade).filter(Boolean))];
    return cidades.length === 1 ? cidades[0] : (cidades[0] || '-');
  }, [linhas]);

  const handlePrint = () => imprimirElemento(printRef.current, `Romaneio_${carga?.numero_carga || ''}`);

  if (!carga) return null;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={handlePrint} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Printer className="w-4 h-4 mr-2" /> Imprimir / PDF
        </Button>
      </div>

      <div ref={printRef} className="bg-white max-w-5xl mx-auto" style={{ padding: '20px', fontFamily: 'Arial, sans-serif', fontSize: '10px', color: '#000' }}>
        {/* CABEÇALHO */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
          <div style={{ fontWeight: 700, fontSize: '11px' }}>
            1 - {empresa.razao_social || empresa.nome || 'PAO E MEL INDUSTRIA DE PANIFICACAO LTDA ME'}
          </div>
          <div style={{ fontSize: '9px', textAlign: 'right' }}>
            Dt Emissão: {fmtDateTime(new Date())}<br />
            Pág. 1
          </div>
        </div>
        <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '6px' }}>Romaneio de Entrega - Resumido</div>

        <table style={{ width: '100%', fontSize: '11px', marginBottom: '10px' }}>
          <tbody>
            <tr>
              <td style={{ width: '40%' }}><strong>Carregamento:</strong> {carga.numero_carga || '-'}</td>
              <td style={{ width: '30%' }}><strong>Veículo:</strong> {carga.veiculo_placa || '-'}</td>
              <td><strong>Motorista:</strong> {carga.motorista_nome || '-'}</td>
            </tr>
            <tr>
              <td><strong>Destino:</strong> {cidadeDestino}</td>
              <td colSpan="2"></td>
            </tr>
          </tbody>
        </table>

        {/* LISTAGEM AGRUPADA POR CLIENTE */}
        <div style={{ borderTop: '1px solid #000' }}>
          {gruposCliente.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#888' }}>Nenhum pedido na carga</div>
          ) : gruposCliente.map((grupo, idx) => (
            <div key={idx} style={{ borderBottom: '1px solid #000', paddingBottom: '8px', marginBottom: '8px' }}>
              <table style={{ width: '100%', fontSize: '8.5px', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f0f0f0' }}>
                    <th style={{ textAlign: 'left', padding: '2px 4px' }}>Código Cliente</th>
                    <th style={{ textAlign: 'left', padding: '2px 4px' }}>Pedido</th>
                    <th style={{ textAlign: 'left', padding: '2px 4px' }}>NF</th>
                    <th style={{ textAlign: 'left', padding: '2px 4px' }}>Tipo</th>
                    <th style={{ textAlign: 'left', padding: '2px 4px' }}>Pr.</th>
                    <th style={{ textAlign: 'left', padding: '2px 4px' }}>Cob.</th>
                    <th style={{ textAlign: 'left', padding: '2px 4px' }}>Dt. Emissão</th>
                    <th style={{ textAlign: 'left', padding: '2px 4px' }}>Dt. Vencto</th>
                    <th style={{ textAlign: 'right', padding: '2px 4px' }}>Valor</th>
                    <th style={{ textAlign: 'left', padding: '2px 4px' }}>Vendedor</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ fontWeight: 700, background: '#fafafa' }}>
                    <td colSpan="10" style={{ padding: '3px 4px' }}>
                      {grupo.codigo_cliente_display} - {grupo.nome_fantasia || grupo.nome_cliente}
                      {grupo.nome_fantasia && grupo.nome_cliente && grupo.nome_fantasia !== grupo.nome_cliente ? <span style={{ fontWeight: 400, fontSize: '8.5px', color: '#555' }}> &nbsp;|&nbsp; Razão: {grupo.nome_cliente}</span> : null}
                      {grupo.cidade_cliente ? <span style={{ fontWeight: 400, fontSize: '8.5px', color: '#555' }}> &nbsp;|&nbsp; Cidade: {grupo.cidade_cliente}</span> : null}
                    </td>
                  </tr>
                  {grupo.pedidos.map((l, i) => {
                    const dtEmissao = l.data_previsao || carga.data_carga;
                    const dtVenc = l.data_vencimento || dtEmissao;
                    return (
                      <React.Fragment key={i}>
                        <tr>
                          <td style={{ padding: '2px 4px' }}></td>
                          <td style={{ padding: '2px 4px' }}>{formatarNumeroPedido({ ...l, tipo: l._tipo === 'TROCA' ? 'troca' : l.tipo }) || '-'}</td>
                          <td style={{ padding: '2px 4px' }}>{l.numero_nf || '-'}</td>
                          <td style={{ padding: '2px 4px', fontWeight: 700 }}>{l._tipo}</td>
                          <td style={{ padding: '2px 4px' }}>1</td>
                          <td style={{ padding: '2px 4px' }}>{l.cobranca_nome || l.cobranca || '-'}</td>
                          <td style={{ padding: '2px 4px' }}>{dtEmissao || '-'}</td>
                          <td style={{ padding: '2px 4px' }}>{dtVenc || '-'}</td>
                          <td style={{ padding: '2px 4px', textAlign: 'right' }}>{fmtMoney(l.valor_total_pedido)}</td>
                          <td style={{ padding: '2px 4px' }}>{l.vendedor_nome_cliente || '-'}</td>
                        </tr>
                        <tr>
                          <td colSpan="10" style={{ padding: '2px 4px 6px 14px', fontSize: '8.5px', borderBottom: '1px dashed #999' }}>
                            <strong>Ped. {formatarNumeroPedido({ ...l, tipo: l._tipo === 'TROCA' ? 'troca' : l.tipo }) || '-'}:</strong>
                            <span style={{ marginLeft: '20px' }}>Ass.:_______________________</span>
                            <span style={{ marginLeft: '14px' }}>RG.:_______________</span>
                            <span style={{ marginLeft: '14px' }}>Data:___/___/____</span>
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* RESUMO */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px', marginTop: '10px', fontSize: '10px' }}>
          <div>
            <div style={{ fontWeight: 700, borderBottom: '1px solid #000', marginBottom: '4px' }}>Resumo do Carregamento</div>
            <div>Qtde NFs: <strong>{totais.qtdNfs}</strong></div>
            <div>Peso Total: ____________</div>
            <div>Volume Total: <strong>{fmtInt(totais.volumeTotal)}</strong></div>
            <div>Qtde de Entregas: <strong>{totais.qtdEntregas}</strong></div>
            <div>Valor Total da Carga: <strong>{fmtMoney(totais.valor)}</strong></div>
          </div>
          <div>
            <div style={{ fontWeight: 700, borderBottom: '1px solid #000', marginBottom: '4px' }}>Resumo do Acerto</div>
            <table style={{ width: '100%', fontSize: '9px', borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. em Cheque</td>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. em Boletos</td>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. em Desconto</td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. CH a Vista</td>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. Outras</td>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. Dev. Parcial</td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. em Dinheiro</td>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. Bonif/Trocas: <strong>{fmtMoney(totais.valorBonifTrocas)}</strong></td>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. Dev. Total</td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. em Moedas</td>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. em Duplicatas</td>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. em Despesas</td>
                </tr>
                <tr>
                  <td colSpan="3" style={{ border: '1px solid #000', padding: '3px', textAlign: 'right', fontWeight: 700 }}>
                    Total da Carga: {fmtMoney(totais.valor)} &nbsp;&nbsp; Total Recebido: ________________
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginTop: '20px', fontSize: '9px' }}>
          <div>Data Saída p/ Rota: ___/___/____ &nbsp;&nbsp; Data Chegada da Rota: ___/___/____</div>
          <div style={{ marginTop: '4px' }}>Autorizado: __________________ &nbsp;&nbsp; Data/Hora do Acerto: ___/___/____ &nbsp; Ass.: ___________________</div>
        </div>
      </div>
    </div>
  );
}