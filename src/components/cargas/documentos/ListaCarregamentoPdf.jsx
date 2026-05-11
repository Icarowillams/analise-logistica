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
    // CSS específico para landscape + footer fixo no rodapé + preservar cores
    const styles = `
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
        @media print {
          html, body { width: 297mm; height: 200mm; margin: 0; padding: 0; }
        }
        body { font-family: Arial, sans-serif; font-size: 10px; color: #1e293b; margin: 0; padding: 0; background: #fff; }
        .doc-page { width: 277mm; min-height: 190mm; margin: 0 auto; position: relative; padding-bottom: 80px; box-sizing: border-box; }
        .assinaturas { position: absolute; bottom: 10px; left: 0; right: 0; display: flex; justify-content: space-around; font-size: 10px; }
        .assinaturas > div { border-top: 2px solid #1e293b; padding-top: 6px; min-width: 240px; text-align: center; font-weight: 600; color: #475569; }
        table { border-collapse: collapse; }
        tr.zebra { background: #f8fafc; }
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

      <div ref={printRef} className="bg-white mx-auto shadow-lg border border-slate-200 rounded-lg overflow-hidden" style={{ width: '1080px', maxWidth: '100%', fontFamily: 'Arial, sans-serif', fontSize: '10px', color: '#1e293b' }}>
        <div className="doc-page" style={{ position: 'relative', paddingBottom: '80px', padding: '16px 20px 80px' }}>
          {/* CABEÇALHO COM GRADIENTE */}
          <div style={{ background: 'linear-gradient(90deg, #1e88e5 0%, #1976d2 50%, #1565c0 100%)', color: '#fff', padding: '12px 18px', fontWeight: 700, fontSize: '15px', marginBottom: '12px', borderRadius: '6px', letterSpacing: '0.5px', boxShadow: '0 2px 4px rgba(25,118,210,0.25)' }}>
            📋 Lista de Carregamento
          </div>

          {/* DADOS DA EMPRESA — bloco colorido */}
          <div style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '10px 14px', marginBottom: '10px' }}>
            <table style={{ width: '100%', fontSize: '10px' }}>
              <tbody>
                <tr>
                  <td style={{ paddingRight: '20px', width: '40%', paddingBottom: '4px' }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Empresa:</span> <span style={{ color: '#0f172a', fontWeight: 600 }}>{empresa.razao_social || empresa.nome || 'PAO E MEL INDUSTRIA DE PANIFICACAO LTDA ME'}</span>
                  </td>
                  <td style={{ paddingRight: '20px', paddingBottom: '4px' }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>CNPJ:</span> <span style={{ color: '#0f172a' }}>{empresa.cnpj || empresa.cnpj_cpf || '-'}</span>
                  </td>
                  <td style={{ paddingRight: '20px', paddingBottom: '4px' }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>IE:</span> <span style={{ color: '#0f172a' }}>{empresa.inscricao_estadual || empresa.ie || '-'}</span>
                  </td>
                  <td style={{ paddingBottom: '4px' }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Telefone:</span> <span style={{ color: '#0f172a' }}>{empresa.telefone || '-'}</span>
                  </td>
                </tr>
                <tr>
                  <td style={{ paddingBottom: '4px' }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Núm. Carga:</span>
                    <span style={{ background: '#1976d2', color: '#fff', padding: '2px 8px', borderRadius: '4px', marginLeft: '6px', fontWeight: 700 }}>{info.numero_carga}</span>
                  </td>
                  <td style={{ paddingBottom: '4px' }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Veículo:</span>
                    <span style={{ background: '#0f766e', color: '#fff', padding: '2px 8px', borderRadius: '4px', marginLeft: '6px', fontWeight: 700 }}>{info.veiculo_placa || '-'}</span>
                  </td>
                  <td colSpan="2" style={{ paddingBottom: '4px' }}>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Dt. Relatório:</span> <span style={{ color: '#0f172a' }}>{dataRelatorio}</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Motorista:</span> <span style={{ color: '#0f172a', fontWeight: 600 }}>{info.motorista_nome || '-'}</span>
                  </td>
                  <td colSpan="3">
                    <span style={{ color: '#64748b', fontWeight: 600 }}>Cidade Destino:</span> <span style={{ color: '#0f172a', fontWeight: 600 }}>{info.cidade_destino || '-'}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* LINHAS DE PREENCHIMENTO */}
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '8px 12px', marginBottom: '10px', fontSize: '9.5px', color: '#78350f' }}>
            <div style={{ marginBottom: '4px' }}>
              <span style={{ marginRight: '30px' }}>📅 Data carreg.: ___/___/_____</span>
              <span style={{ marginRight: '30px' }}>Data descarreg.: ___/___/_____</span>
              <span style={{ marginRight: '30px' }}>⏰ Partida: ____ : ____</span>
              <span>Chegada: ____ : ____</span>
            </div>
            <div>
              <span style={{ marginRight: '40px' }}>🛣️ KM partida: __________</span>
              <span style={{ marginRight: '40px' }}>KM chegada: __________</span>
              <span>Total KM: __________</span>
            </div>
          </div>

          {/* OBSERVAÇÃO */}
          {info.observacao && (
            <div style={{ background: '#eff6ff', borderLeft: '3px solid #3b82f6', padding: '6px 12px', marginBottom: '10px', fontSize: '9.5px', borderRadius: '0 4px 4px 0' }}>
              <strong style={{ color: '#1e40af' }}>Observação:</strong> <span style={{ color: '#1e3a8a' }}>{info.observacao}</span>
            </div>
          )}

          {/* TABELA DE PRODUTOS — header azul */}
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #cbd5e1', borderRadius: '6px', overflow: 'hidden' }}>
            <thead>
              <tr style={{ background: 'linear-gradient(90deg, #1e88e5 0%, #1976d2 100%)', color: '#fff' }}>
                <th style={{ padding: '8px 6px', fontSize: '10px', width: '70px', fontWeight: 700, borderRight: '1px solid rgba(255,255,255,0.2)' }}>Qtde</th>
                <th style={{ padding: '8px 6px', fontSize: '10px', width: '80px', fontWeight: 700, borderRight: '1px solid rgba(255,255,255,0.2)' }}>Qtde. Caixa</th>
                <th style={{ padding: '8px 6px', fontSize: '10px', width: '70px', fontWeight: 700, borderRight: '1px solid rgba(255,255,255,0.2)' }}>Qtd. Un</th>
                <th style={{ padding: '8px 6px', fontSize: '10px', textAlign: 'left', fontWeight: 700, borderRight: '1px solid rgba(255,255,255,0.2)' }}>Produto</th>
                <th style={{ padding: '8px 6px', fontSize: '10px', width: '70px', fontWeight: 700, borderRight: '1px solid rgba(255,255,255,0.2)' }}>Cod.</th>
                <th style={{ padding: '8px 6px', fontSize: '10px', width: '60px', fontWeight: 700, borderRight: '1px solid rgba(255,255,255,0.2)' }}>UN</th>
                <th style={{ padding: '8px 6px', fontSize: '10px', width: '140px', fontWeight: 700 }}>Cod. Barra</th>
              </tr>
            </thead>
            <tbody>
              {produtosCalculados.length === 0 ? (
                <tr><td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>Nenhum produto encontrado</td></tr>
              ) : produtosCalculados.map((p, idx) => (
                <tr key={idx} className={idx % 2 === 1 ? 'zebra' : ''} style={{ background: idx % 2 === 1 ? '#f8fafc' : '#fff' }}>
                  <td style={{ borderBottom: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '10px', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>{Number(p.quantidade).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td style={{ borderBottom: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '10px', textAlign: 'right', color: '#1e40af', fontWeight: 700 }}>{p.qtde_caixas}</td>
                  <td style={{ borderBottom: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '10px', textAlign: 'right', color: '#475569' }}>{p.qtde_unidades}</td>
                  <td style={{ borderBottom: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '10px', color: '#0f172a' }}>{p.descricao}</td>
                  <td style={{ borderBottom: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '10px', textAlign: 'center', color: '#64748b' }}>{p.codigo_produto}</td>
                  <td style={{ borderBottom: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '10px', textAlign: 'center', color: '#64748b' }}>{p.unidade || 'UN'}</td>
                  <td style={{ borderBottom: '1px solid #e2e8f0', padding: '6px 8px', fontSize: '10px', textAlign: 'center', color: '#64748b' }}>{p.codigo_barra || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* RODAPÉ DE TOTAIS — card destacado */}
          <div style={{ marginTop: '14px', background: '#ecfdf5', border: '1px solid #86efac', borderRadius: '6px', padding: '10px 14px', fontSize: '10px' }}>
            <div style={{ marginBottom: '4px', color: '#065f46' }}>
              <strong>📦 Valor aproximado de Caixas:</strong>
              <span style={{ background: '#10b981', color: '#fff', padding: '2px 10px', borderRadius: '4px', marginLeft: '6px', fontWeight: 700 }}>{fmtInt(totalCaixas)}</span>
              <span style={{ marginLeft: '30px' }}><strong>Vl. Total Caixas Saída:</strong> __________</span>
              <span style={{ marginLeft: '30px' }}><strong>Vl. Total Caixas Retorno:</strong> __________</span>
            </div>
            <div style={{ color: '#065f46' }}><strong>Valor Total de Caixas:</strong> __________</div>
          </div>

          {/* ASSINATURAS — fixadas no rodapé da página */}
          <div className="assinaturas" style={{ position: 'absolute', bottom: '16px', left: '20px', right: '20px', display: 'flex', justifyContent: 'space-around', fontSize: '10px' }}>
            <div style={{ borderTop: '2px solid #1e293b', paddingTop: '6px', minWidth: '240px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>Conferente expedição</div>
            <div style={{ borderTop: '2px solid #1e293b', paddingTop: '6px', minWidth: '240px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>Responsável faturamento</div>
            <div style={{ borderTop: '2px solid #1e293b', paddingTop: '6px', minWidth: '240px', textAlign: 'center', fontWeight: 600, color: '#475569' }}>Motorista</div>
          </div>
        </div>
      </div>
    </div>
  );
}