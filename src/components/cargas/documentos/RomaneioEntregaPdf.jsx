import React, { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { fmtMoney, fmtDateTime, imprimirElemento } from './printHelper';

// Tipo de Nota Descrição = Venda / Bonificação / Troca
function tipoNotaLabel(item, origem) {
  // origem: 'omie' | 'interno' | 'troca'
  if (origem === 'troca') return 'TROCA';
  const cenario = (item.cenario_fiscal_nome || item.cenario_local_nome || '').toLowerCase();
  if (cenario.includes('bonif')) return 'BONIFICAÇÃO';
  if (cenario.includes('troca')) return 'TROCA';
  if (cenario.includes('devol')) return 'DEVOLUÇÃO';
  return 'VENDA';
}

export default function RomaneioEntregaPdf({ carga }) {
  const printRef = useRef();

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresa-romaneio'],
    queryFn: () => base44.entities.Empresa.list()
  });
  const empresa = empresas[0] || {};

  const linhas = useMemo(() => {
    if (!carga) return [];
    const out = [];
    (carga.pedidos_omie || []).forEach(p => out.push({
      ...p,
      _origem: 'omie',
      _tipo: tipoNotaLabel(p, 'omie'),
      codigo_cliente_display: p.codigo_cliente_cod || p.codigo_cliente_integracao || p.codigo_cliente || '-'
    }));
    (carga.pedidos_internos || []).forEach(p => out.push({
      ...p,
      _origem: 'interno',
      _tipo: tipoNotaLabel(p, 'interno'),
      codigo_cliente_display: p.codigo_cliente_cod || p.cliente_id || '-'
    }));
    (carga.pedidos_troca || []).forEach(p => out.push({
      ...p,
      _origem: 'troca',
      _tipo: 'TROCA',
      codigo_cliente_display: p.codigo_cliente_cod || p.cliente_id || '-'
    }));
    return out;
  }, [carga]);

  const totais = useMemo(() => {
    const qtdNfs = linhas.length;
    const valor = linhas.reduce((s, l) => s + Number(l.valor_total_pedido || 0), 0);
    const clientesUnicos = new Set(linhas.map(l => l.codigo_cliente_display)).size;
    return { qtdNfs, valor, qtdEntregas: clientesUnicos };
  }, [linhas]);

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
            1 - {empresa.razao_social || 'PAO E MEL INDUSTRIA DE PANIFICACAO LTDA ME'}
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

        {/* LISTAGEM POR CLIENTE */}
        <div style={{ borderTop: '1px solid #000' }}>
          {linhas.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#888' }}>Nenhum pedido na carga</div>
          ) : linhas.map((l, idx) => {
            const dtEmissao = l.data_previsao || carga.data_carga;
            const dtVenc = l.data_vencimento || dtEmissao;
            return (
              <div key={idx} style={{ borderBottom: '1px solid #000', paddingBottom: '6px', marginBottom: '6px' }}>
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
                    <tr style={{ fontWeight: 700 }}>
                      <td colSpan="10" style={{ padding: '3px 4px' }}>
                        {l.codigo_cliente_display}- {l.nome_cliente || ''}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan="10" style={{ padding: '0 4px', fontSize: '8.5px' }}>
                        Fantasia: {l.nome_fantasia || '-'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '2px 4px' }}></td>
                      <td style={{ padding: '2px 4px' }}>{l.numero_pedido || '-'}</td>
                      <td style={{ padding: '2px 4px' }}>{l.numero_nf || '-'}</td>
                      <td style={{ padding: '2px 4px', fontWeight: 700 }}>{l._tipo}</td>
                      <td style={{ padding: '2px 4px' }}>1</td>
                      <td style={{ padding: '2px 4px' }}>{(l.cobranca || '').toString().slice(0, 4) || '-'}</td>
                      <td style={{ padding: '2px 4px' }}>{dtEmissao || '-'}</td>
                      <td style={{ padding: '2px 4px' }}>{dtVenc || '-'}</td>
                      <td style={{ padding: '2px 4px', textAlign: 'right' }}>{fmtMoney(l.valor_total_pedido)}</td>
                      <td style={{ padding: '2px 4px' }}>{l.vendedor_nome || '-'}</td>
                    </tr>
                  </tbody>
                </table>
                <div style={{ fontSize: '8.5px', marginTop: '2px', paddingLeft: '4px' }}>
                  <strong>OBSERVAÇÃO:</strong>
                  <span style={{ marginLeft: '40px' }}>Ass.:_______________________</span>
                  <span style={{ marginLeft: '20px' }}>RG.:_______________</span>
                  <span style={{ marginLeft: '20px' }}>Data:___/___/____</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* RESUMO */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px', marginTop: '10px', fontSize: '10px' }}>
          <div>
            <div style={{ fontWeight: 700, borderBottom: '1px solid #000', marginBottom: '4px' }}>Resumo do Carregamento</div>
            <div>Qtde NFs: <strong>{totais.qtdNfs}</strong></div>
            <div>Peso Total: ____________</div>
            <div>Volume Total: 0,00</div>
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
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. Bonif/Trocas</td>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. Dev. Total</td>
                </tr>
                <tr>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. em Moedas</td>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. em Duplicatas</td>
                  <td style={{ border: '1px solid #000', padding: '3px' }}>Vl. em Despesas</td>
                </tr>
                <tr>
                  <td colSpan="3" style={{ border: '1px solid #000', padding: '3px', textAlign: 'right', fontWeight: 700 }}>
                    Total Recebido: ________________
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