import React, { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import { consolidarProdutos, fmtDateTime, fmtInt, abrirImpressao } from './printHelper';

/**
 * Lista de Carregamento — orientação paisagem (landscape) A4.
 * Cabeçalho com dados da empresa (CNPJ, IE, Telefone),
 * cálculo de caixas usando fator_caixa do cadastro de produto,
 * e bloco de assinaturas fixado no rodapé da folha.
 */
export default function ListaCarregamentoPdf({ carga, pedidosManuais, meta = {} }) {
  const printRef = useRef();

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresa-lista-carregamento'],
    queryFn: () => base44.entities.Empresa.list()
  });
  const empresa = empresas[0] || {};

  const { data: produtosBase = [] } = useQuery({
    queryKey: ['produtos-lista-carregamento'],
    queryFn: () => base44.entities.Produto.list('-created_date', 5000)
  });

  // Mapa de fator_caixa por código de produto
  const fatorCaixaMap = useMemo(() => {
    const m = new Map();
    produtosBase.forEach(p => {
      const fator = Number(p.fator_caixa) || 1;
      [p.codigo, p.codigo_omie, p.codigo_integracao].filter(Boolean).forEach(c => {
        m.set(String(c).trim(), fator);
      });
    });
    return m;
  }, [produtosBase]);

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

  // Calcular caixas usando fator_caixa do cadastro (fallback = 1)
  const produtosCalculados = useMemo(() => {
    return produtos.map(p => {
      const fator = fatorCaixaMap.get(String(p.codigo_produto).trim()) || 1;
      const qtde = Number(p.quantidade || 0);
      const caixas = fator > 1 ? Math.floor(qtde / fator) : 0;
      const unidades = fator > 1 ? qtde - caixas * fator : qtde;
      return { ...p, fator_caixa: fator, qtde_caixas: caixas, qtde_unidades: unidades };
    });
  }, [produtos, fatorCaixaMap]);

  const totalCaixas = produtosCalculados.reduce((s, p) => s + (p.qtde_caixas || 0), 0);
  const dataRelatorio = fmtDateTime(new Date());

  const handlePrint = () => {
    if (!printRef.current) return;
    // CSS específico para landscape + footer fixo no rodapé
    const styles = `
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        @media print {
          html, body { width: 297mm; height: 200mm; margin: 0; padding: 0; }
        }
        body { font-family: Arial, sans-serif; font-size: 10px; color: #000; margin: 0; padding: 0; }
        .doc-page { width: 277mm; min-height: 190mm; margin: 0 auto; position: relative; padding-bottom: 70px; box-sizing: border-box; }
        .assinaturas { position: absolute; bottom: 10px; left: 0; right: 0; display: flex; justify-content: space-around; font-size: 10px; }
        .assinaturas > div { border-top: 1px solid #000; padding-top: 4px; min-width: 240px; text-align: center; }
        table { border-collapse: collapse; }
      </style>
    `;
    abrirImpressao(styles + printRef.current.innerHTML, `Lista_Carregamento_${info.numero_carga}`);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={handlePrint} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Printer className="w-4 h-4 mr-2" /> Imprimir / PDF
        </Button>
      </div>

      <div ref={printRef} className="bg-white mx-auto shadow border" style={{ width: '1080px', maxWidth: '100%', padding: '16px', fontFamily: 'Arial, sans-serif', fontSize: '10px', color: '#000' }}>
        <div className="doc-page" style={{ position: 'relative', paddingBottom: '70px' }}>
          {/* CABEÇALHO AZUL */}
          <div style={{ background: '#2196F3', color: '#fff', padding: '8px 12px', fontWeight: 700, fontSize: '14px', marginBottom: '8px' }}>
            Lista de Carregamento
          </div>

          {/* DADOS DA EMPRESA + CARGA */}
          <table style={{ width: '100%', fontSize: '10px', marginBottom: '8px' }}>
            <tbody>
              <tr>
                <td style={{ paddingRight: '20px', width: '40%' }}>
                  <strong>Empresa:</strong> {empresa.razao_social || empresa.nome || 'PAO E MEL INDUSTRIA DE PANIFICACAO LTDA ME'}
                </td>
                <td style={{ paddingRight: '20px' }}><strong>CNPJ:</strong> {empresa.cnpj || empresa.cnpj_cpf || '-'}</td>
                <td style={{ paddingRight: '20px' }}><strong>IE:</strong> {empresa.inscricao_estadual || empresa.ie || '-'}</td>
                <td><strong>Telefone:</strong> {empresa.telefone || '-'}</td>
              </tr>
              <tr>
                <td><strong>Núm. Carga:</strong> {info.numero_carga}</td>
                <td><strong>Veículo:</strong> {info.veiculo_placa || '-'}</td>
                <td colSpan="2"><strong>Dt. Relatório:</strong> {dataRelatorio}</td>
              </tr>
              <tr>
                <td><strong>Motorista:</strong> {info.motorista_nome || '-'}</td>
                <td colSpan="3"><strong>Cidade Destino:</strong> {info.cidade_destino || '-'}</td>
              </tr>
            </tbody>
          </table>

          {/* LINHAS DE PREENCHIMENTO */}
          <div style={{ fontSize: '9.5px', borderTop: '1px solid #ccc', paddingTop: '6px', marginBottom: '4px' }}>
            <span style={{ marginRight: '30px' }}>Data de carregamento: ___/___/_____</span>
            <span style={{ marginRight: '30px' }}>Data de descarregamento: ___/___/_____</span>
            <span style={{ marginRight: '30px' }}>Horário de partida: ____ : ____</span>
            <span>Horário de chegada: ____ : ____</span>
          </div>
          <div style={{ fontSize: '9.5px', marginBottom: '6px' }}>
            <span style={{ marginRight: '40px' }}>KM partida: __________</span>
            <span style={{ marginRight: '40px' }}>KM chegada: __________</span>
            <span>Total KM: __________</span>
          </div>
          <div style={{ fontSize: '9.5px', marginBottom: '8px' }}>
            <strong>Observação:</strong> {info.observacao || ''}
          </div>

          {/* TABELA DE PRODUTOS */}
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000' }}>
            <thead>
              <tr style={{ background: '#f0f0f0' }}>
                <th style={{ border: '1px solid #999', padding: '5px', fontSize: '9.5px', width: '70px' }}>Qtde</th>
                <th style={{ border: '1px solid #999', padding: '5px', fontSize: '9.5px', width: '80px' }}>Qtde. Caixa</th>
                <th style={{ border: '1px solid #999', padding: '5px', fontSize: '9.5px', width: '70px' }}>Qtd. Un</th>
                <th style={{ border: '1px solid #999', padding: '5px', fontSize: '9.5px', textAlign: 'left' }}>Produto</th>
                <th style={{ border: '1px solid #999', padding: '5px', fontSize: '9.5px', width: '70px' }}>Cod.</th>
                <th style={{ border: '1px solid #999', padding: '5px', fontSize: '9.5px', width: '60px' }}>UN</th>
                <th style={{ border: '1px solid #999', padding: '5px', fontSize: '9.5px', width: '140px' }}>Cod. Barra</th>
              </tr>
            </thead>
            <tbody>
              {produtosCalculados.length === 0 ? (
                <tr><td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#888' }}>Nenhum produto encontrado</td></tr>
              ) : produtosCalculados.map((p, idx) => (
                <tr key={idx}>
                  <td style={{ border: '1px solid #999', padding: '4px 6px', fontSize: '9.5px', textAlign: 'right' }}>{Number(p.quantidade).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td style={{ border: '1px solid #999', padding: '4px 6px', fontSize: '9.5px', textAlign: 'right' }}>{p.qtde_caixas}</td>
                  <td style={{ border: '1px solid #999', padding: '4px 6px', fontSize: '9.5px', textAlign: 'right' }}>{p.qtde_unidades}</td>
                  <td style={{ border: '1px solid #999', padding: '4px 6px', fontSize: '9.5px' }}>{p.descricao}</td>
                  <td style={{ border: '1px solid #999', padding: '4px 6px', fontSize: '9.5px', textAlign: 'center' }}>{p.codigo_produto}</td>
                  <td style={{ border: '1px solid #999', padding: '4px 6px', fontSize: '9.5px', textAlign: 'center' }}>{p.unidade || 'UN'}</td>
                  <td style={{ border: '1px solid #999', padding: '4px 6px', fontSize: '9.5px', textAlign: 'center' }}>{p.codigo_barra || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* RODAPÉ DE TOTAIS */}
          <div style={{ marginTop: '14px', fontSize: '9.5px' }}>
            <div style={{ marginBottom: '4px' }}>
              <strong>Valor aproximado de Caixas:</strong> {fmtInt(totalCaixas)}
              <span style={{ marginLeft: '30px' }}><strong>Vl. Total Caixas Saída:</strong> __________</span>
              <span style={{ marginLeft: '30px' }}><strong>Vl. Total Caixas Retorno:</strong> __________</span>
            </div>
            <div><strong>Valor Total de Caixas:</strong> __________</div>
          </div>

          {/* ASSINATURAS — fixadas no rodapé da página */}
          <div className="assinaturas" style={{ position: 'absolute', bottom: '0', left: '0', right: '0', display: 'flex', justifyContent: 'space-around', fontSize: '10px' }}>
            <div style={{ borderTop: '1px solid #000', paddingTop: '4px', minWidth: '240px', textAlign: 'center' }}>Conferente expedição</div>
            <div style={{ borderTop: '1px solid #000', paddingTop: '4px', minWidth: '240px', textAlign: 'center' }}>Responsável faturamento</div>
            <div style={{ borderTop: '1px solid #000', paddingTop: '4px', minWidth: '240px', textAlign: 'center' }}>Motorista</div>
          </div>
        </div>
      </div>
    </div>
  );
}