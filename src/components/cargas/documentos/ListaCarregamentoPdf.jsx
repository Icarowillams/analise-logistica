import React, { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { consolidarProdutos, fmtDateTime, fmtInt, imprimirElemento } from './printHelper';

/**
 * Lista de Carregamento — consolida produtos de uma lista de pedidos.
 * Aceita:
 *   - carga: objeto Carga (usa pedidos_omie, pedidos_internos, pedidos_troca)
 *   - pedidosManuais: array bruto (cada item com {produtos, ...}) — usado pela Montagem
 *   - meta: { numero_carga, motorista_nome, veiculo_placa, cidade_destino, observacao }
 */
export default function ListaCarregamentoPdf({ carga, pedidosManuais, meta = {} }) {
  const printRef = useRef();

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresa-lista-carregamento'],
    queryFn: () => base44.entities.Empresa.list()
  });
  const empresa = empresas[0] || {};

  const { listaPedidos, info } = useMemo(() => {
    if (carga) {
      const lista = [
        ...(carga.pedidos_omie || []),
        ...(carga.pedidos_internos || []),
        ...(carga.pedidos_troca || [])
      ];
      return {
        listaPedidos: lista,
        info: {
          numero_carga: carga.numero_carga || '',
          motorista_nome: carga.motorista_nome || '',
          veiculo_placa: carga.veiculo_placa || '',
          cidade_destino: meta.cidade_destino || '',
          observacao: carga.observacao || carga.observacoes || ''
        }
      };
    }
    return {
      listaPedidos: pedidosManuais || [],
      info: {
        numero_carga: meta.numero_carga || 'Prévia',
        motorista_nome: meta.motorista_nome || '',
        veiculo_placa: meta.veiculo_placa || '',
        cidade_destino: meta.cidade_destino || '',
        observacao: meta.observacao || ''
      }
    };
  }, [carga, pedidosManuais, meta]);

  const produtos = useMemo(() => consolidarProdutos(listaPedidos), [listaPedidos]);
  const totalCaixas = produtos.reduce((s, p) => s + Math.floor((p.quantidade || 0) / 10), 0);
  const dataRelatorio = fmtDateTime(new Date());

  const handlePrint = () => imprimirElemento(printRef.current, `Lista_Carregamento_${info.numero_carga}`);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={handlePrint} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Printer className="w-4 h-4 mr-2" /> Imprimir / PDF
        </Button>
      </div>

      <div ref={printRef} className="bg-white max-w-5xl mx-auto" style={{ padding: '16px', fontFamily: 'Arial, sans-serif', fontSize: '10px', color: '#000' }}>
        {/* CABEÇALHO */}
        <div style={{ background: '#2196F3', color: '#fff', padding: '6px 10px', fontWeight: 700, fontSize: '13px', marginBottom: '6px' }}>
          Lista de Carregamento
        </div>
        <table style={{ width: '100%', fontSize: '10px', marginBottom: '8px' }}>
          <tbody>
            <tr>
              <td style={{ paddingRight: '20px' }}>
                <strong>Empresa</strong> {empresa.razao_social || 'PAO E MEL INDUSTRIA DE PANIFICACAO LTDA ME'}
              </td>
              <td style={{ paddingRight: '20px' }}><strong>Cnpj:</strong> {empresa.cnpj || '-'}</td>
              <td style={{ paddingRight: '20px' }}><strong>IE:</strong> {empresa.inscricao_estadual || '-'}</td>
              <td><strong>Telefone:</strong> {empresa.telefone || '-'}</td>
            </tr>
            <tr>
              <td><strong>Núm. Carga:</strong> {info.numero_carga}</td>
              <td colSpan="2"><strong>Veículo:</strong> {info.veiculo_placa || '-'}</td>
              <td><strong>Dt. Relatório:</strong> {dataRelatorio}</td>
            </tr>
            <tr>
              <td><strong>Motorista:</strong> {info.motorista_nome || '-'}</td>
              <td colSpan="3"><strong>Cidade Destino:</strong> {info.cidade_destino || '-'}</td>
            </tr>
          </tbody>
        </table>

        {/* LINHAS DE PREENCHIMENTO */}
        <div style={{ fontSize: '9px', borderTop: '1px solid #ccc', paddingTop: '6px', marginBottom: '4px' }}>
          <span style={{ marginRight: '20px' }}>Data de carregamento: ___/___/_____</span>
          <span style={{ marginRight: '20px' }}>Data de descarregamento: ___/___/_____</span>
          <span style={{ marginRight: '20px' }}>Horário de partida: ____ : ____</span>
          <span>Horário de chegada: ____ : ____</span>
        </div>
        <div style={{ fontSize: '9px', marginBottom: '6px' }}>
          <span style={{ marginRight: '30px' }}>KM partida: __________</span>
          <span style={{ marginRight: '30px' }}>KM chegada: __________</span>
          <span>Total KM: __________</span>
        </div>
        <div style={{ fontSize: '9px', marginBottom: '8px' }}>
          <strong>Observação:</strong> {info.observacao || ''}
        </div>

        {/* TABELA DE PRODUTOS */}
        <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000' }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              <th style={{ border: '1px solid #999', padding: '4px', fontSize: '9px', width: '60px' }}>Qtde</th>
              <th style={{ border: '1px solid #999', padding: '4px', fontSize: '9px', width: '70px' }}>Qtde. Caixa</th>
              <th style={{ border: '1px solid #999', padding: '4px', fontSize: '9px', width: '60px' }}>Qtd. Un</th>
              <th style={{ border: '1px solid #999', padding: '4px', fontSize: '9px', textAlign: 'left' }}>Produto</th>
              <th style={{ border: '1px solid #999', padding: '4px', fontSize: '9px', width: '50px' }}>Cod.</th>
              <th style={{ border: '1px solid #999', padding: '4px', fontSize: '9px', width: '50px' }}>UN</th>
              <th style={{ border: '1px solid #999', padding: '4px', fontSize: '9px', width: '110px' }}>Cod. Barra</th>
            </tr>
          </thead>
          <tbody>
            {produtos.length === 0 ? (
              <tr><td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#888' }}>Nenhum produto encontrado</td></tr>
            ) : produtos.map((p, idx) => {
              const qtde = Number(p.quantidade || 0);
              const cx = Math.floor(qtde / 10);
              const un = qtde - cx * 10;
              return (
                <tr key={idx}>
                  <td style={{ border: '1px solid #999', padding: '3px 5px', fontSize: '9px', textAlign: 'right' }}>{qtde.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td style={{ border: '1px solid #999', padding: '3px 5px', fontSize: '9px', textAlign: 'right' }}>{cx}</td>
                  <td style={{ border: '1px solid #999', padding: '3px 5px', fontSize: '9px', textAlign: 'right' }}>{un}</td>
                  <td style={{ border: '1px solid #999', padding: '3px 5px', fontSize: '9px' }}>{p.descricao}</td>
                  <td style={{ border: '1px solid #999', padding: '3px 5px', fontSize: '9px', textAlign: 'center' }}>{p.codigo_produto}</td>
                  <td style={{ border: '1px solid #999', padding: '3px 5px', fontSize: '9px', textAlign: 'center' }}>{p.unidade || 'PCT'}</td>
                  <td style={{ border: '1px solid #999', padding: '3px 5px', fontSize: '9px', textAlign: 'center' }}>{p.codigo_barra || '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* RODAPÉ */}
        <div style={{ marginTop: '14px', fontSize: '9px' }}>
          <div style={{ marginBottom: '4px' }}>
            <strong>Valor aproximado de Caixas:</strong> {fmtInt(totalCaixas)}
            <span style={{ marginLeft: '30px' }}><strong>Vl. Total Caixas Saída:</strong> __________</span>
            <span style={{ marginLeft: '30px' }}><strong>Vl. Total Caixas Retorno:</strong> __________</span>
          </div>
          <div><strong>Valor Total de Caixas:</strong> __________</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: '40px', fontSize: '9px' }}>
          <div style={{ borderTop: '1px solid #000', paddingTop: '4px', minWidth: '200px', textAlign: 'center' }}>Conferente expedição</div>
          <div style={{ borderTop: '1px solid #000', paddingTop: '4px', minWidth: '200px', textAlign: 'center' }}>Responsável faturamento</div>
          <div style={{ borderTop: '1px solid #000', paddingTop: '4px', minWidth: '200px', textAlign: 'center' }}>Motorista</div>
        </div>
      </div>
    </div>
  );
}