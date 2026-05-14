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

  // TODOS os pedidos vinculados a esta carga (para identificar cancelados E refrescar itens D1/troca)
  const { data: pedidosCarga = [] } = useQuery({
    queryKey: ['pedidos-carga-lista', carga?.id],
    queryFn: () => carga?.id
      ? base44.entities.Pedido.filter({ carga_id: carga.id })
      : Promise.resolve([]),
    enabled: !!carga?.id
  });

  const cancelados = useMemo(() => {
    const omieSet = new Set();
    const idSet = new Set();
    pedidosCarga.filter(p => p.status === 'cancelado').forEach(p => {
      if (p.omie_codigo_pedido) omieSet.add(String(p.omie_codigo_pedido));
      if (p.id) idSet.add(String(p.id));
    });
    return { omieSet, idSet };
  }, [pedidosCarga]);

  // IDs dos pedidos internos/troca NÃO cancelados → buscar itens atuais (snapshot pode estar desatualizado)
  const idsInternosAtivos = useMemo(() =>
    pedidosCarga
      .filter(p => p.status !== 'cancelado' && (String(p.modelo_nota || '').toLowerCase() === 'd1' || p.tipo === 'troca'))
      .map(p => p.id),
    [pedidosCarga]
  );

  const { data: itensInternosAtuais = [] } = useQuery({
    queryKey: ['pedido-itens-lista-carregamento', carga?.id, idsInternosAtivos.join(',')],
    queryFn: async () => {
      if (idsInternosAtivos.length === 0) return [];
      const results = await Promise.all(
        idsInternosAtivos.map(id => base44.entities.PedidoItem.filter({ pedido_id: id }))
      );
      return results.flat();
    },
    enabled: !!carga?.id && idsInternosAtivos.length > 0
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

  // Mapa: qualquer código (omie/integracao/interno) -> código interno do app (Produto.codigo)
  const codigoInternoMap = useMemo(() => {
    const m = new Map();
    produtosBase.forEach(p => {
      const interno = p.codigo || '';
      if (!interno) return;
      [p.codigo, p.codigo_omie, p.codigo_integracao].filter(Boolean).forEach(c => {
        m.set(String(c).trim(), String(interno));
      });
    });
    return m;
  }, [produtosBase]);

  const { listaPedidos, info } = useMemo(() => {
    if (carga) {
      // Pedidos OMIE: usar snapshot da carga (fonte de verdade vem do Omie)
      const lista = [
        ...(carga.pedidos_omie || []).filter(p => !cancelados.omieSet.has(String(p.codigo_pedido)))
      ];

      // Pedidos INTERNOS (D1) e TROCAS: reconstruir a partir dos PedidoItem ATUAIS
      // (snapshot da carga pode estar desatualizado após cortes/edições)
      const itensPorPedido = new Map();
      itensInternosAtuais.forEach(item => {
        if (!itensPorPedido.has(item.pedido_id)) itensPorPedido.set(item.pedido_id, []);
        itensPorPedido.get(item.pedido_id).push(item);
      });

      pedidosCarga
        .filter(p => p.status !== 'cancelado' && (String(p.modelo_nota || '').toLowerCase() === 'd1' || p.tipo === 'troca'))
        .forEach(p => {
          const itens = itensPorPedido.get(p.id) || [];
          lista.push({
            pedido_id: p.id,
            numero_pedido: p.numero_pedido,
            produtos: itens.map(i => ({
              codigo_produto: i.produto_codigo || '',
              descricao: i.produto_nome || '',
              quantidade: Number(i.quantidade || 0),
              unidade: i.unidade_medida || 'UN'
            }))
          });
        });

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
  }, [carga, pedidosManuais, meta, cancelados, pedidosCarga, itensInternosAtuais]);

  const produtos = useMemo(() => consolidarProdutos(listaPedidos, codigoInternoMap), [listaPedidos, codigoInternoMap]);

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
  const totalPacotes = produtosCalculados.reduce((s, p) => s + Number(p.quantidade || 0), 0);
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
          {/* CABEÇALHO CORPORATIVO */}
          <div style={{ borderBottom: '2px solid #000', paddingBottom: '8px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: '9px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase' }}>Documento Operacional</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#000', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Lista de Carregamento</div>
            </div>
            <div style={{ fontSize: '9.5px', color: '#333', textAlign: 'right' }}>
              <div><strong>Nº Carga:</strong> {info.numero_carga}</div>
              <div><strong>Emissão:</strong> {dataRelatorio}</div>
            </div>
          </div>

          {/* DADOS DA EMPRESA */}
          <table style={{ width: '100%', fontSize: '10px', marginBottom: '8px', border: '1px solid #000', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ padding: '5px 8px', borderBottom: '1px solid #000', borderRight: '1px solid #000', width: '50%' }}>
                  <span style={{ color: '#555', fontSize: '8.5px', textTransform: 'uppercase' }}>Razão Social</span><br />
                  <strong>{empresa.razao_social || empresa.nome || 'PAO E MEL INDUSTRIA DE PANIFICACAO LTDA ME'}</strong>
                </td>
                <td style={{ padding: '5px 8px', borderBottom: '1px solid #000', borderRight: '1px solid #000' }}>
                  <span style={{ color: '#555', fontSize: '8.5px', textTransform: 'uppercase' }}>CNPJ</span><br />
                  <strong>{empresa.cnpj || empresa.cnpj_cpf || '-'}</strong>
                </td>
                <td style={{ padding: '5px 8px', borderBottom: '1px solid #000', borderRight: '1px solid #000' }}>
                  <span style={{ color: '#555', fontSize: '8.5px', textTransform: 'uppercase' }}>Insc. Estadual</span><br />
                  <strong>{empresa.inscricao_estadual || empresa.ie || '-'}</strong>
                </td>
                <td style={{ padding: '5px 8px', borderBottom: '1px solid #000' }}>
                  <span style={{ color: '#555', fontSize: '8.5px', textTransform: 'uppercase' }}>Telefone</span><br />
                  <strong>{empresa.telefone || '-'}</strong>
                </td>
              </tr>
              <tr>
                <td style={{ padding: '5px 8px', borderRight: '1px solid #000' }}>
                  <span style={{ color: '#555', fontSize: '8.5px', textTransform: 'uppercase' }}>Motorista</span><br />
                  <strong>{info.motorista_nome || '-'}</strong>
                </td>
                <td style={{ padding: '5px 8px', borderRight: '1px solid #000' }}>
                  <span style={{ color: '#555', fontSize: '8.5px', textTransform: 'uppercase' }}>Veículo / Placa</span><br />
                  <strong>{info.veiculo_placa || '-'}</strong>
                </td>
                <td colSpan="2" style={{ padding: '5px 8px' }}>
                  <span style={{ color: '#555', fontSize: '8.5px', textTransform: 'uppercase' }}>Cidade Destino</span><br />
                  <strong>{info.cidade_destino || '-'}</strong>
                </td>
              </tr>
            </tbody>
          </table>

          {/* LINHAS DE PREENCHIMENTO */}
          <table style={{ width: '100%', fontSize: '9.5px', marginBottom: '8px', border: '1px solid #000', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <td style={{ padding: '5px 8px', borderBottom: '1px solid #000', borderRight: '1px solid #000', width: '25%' }}>Data carreg.: ___/___/_____</td>
                <td style={{ padding: '5px 8px', borderBottom: '1px solid #000', borderRight: '1px solid #000', width: '25%' }}>Data descarreg.: ___/___/_____</td>
                <td style={{ padding: '5px 8px', borderBottom: '1px solid #000', borderRight: '1px solid #000', width: '25%' }}>Partida: ____ : ____</td>
                <td style={{ padding: '5px 8px', borderBottom: '1px solid #000', width: '25%' }}>Chegada: ____ : ____</td>
              </tr>
              <tr>
                <td style={{ padding: '5px 8px', borderRight: '1px solid #000' }}>KM partida: __________</td>
                <td style={{ padding: '5px 8px', borderRight: '1px solid #000' }}>KM chegada: __________</td>
                <td colSpan="2" style={{ padding: '5px 8px' }}>Total KM: __________</td>
              </tr>
            </tbody>
          </table>

          {/* OBSERVAÇÃO */}
          {info.observacao && (
            <div style={{ border: '1px solid #000', padding: '5px 8px', marginBottom: '8px', fontSize: '9.5px' }}>
              <span style={{ color: '#555', fontSize: '8.5px', textTransform: 'uppercase' }}>Observação:</span> {info.observacao}
            </div>
          )}

          {/* TABELA DE PRODUTOS */}
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000' }}>
            <thead>
              <tr style={{ background: '#000', color: '#fff' }}>
                <th style={{ padding: '6px', fontSize: '9.5px', width: '70px', fontWeight: 700, borderRight: '1px solid #333', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Qtde</th>
                <th style={{ padding: '6px', fontSize: '9.5px', width: '80px', fontWeight: 700, borderRight: '1px solid #333', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Qtde. Caixa</th>
                <th style={{ padding: '6px', fontSize: '9.5px', width: '70px', fontWeight: 700, borderRight: '1px solid #333', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Qtd. Un</th>
                <th style={{ padding: '6px', fontSize: '9.5px', textAlign: 'left', fontWeight: 700, borderRight: '1px solid #333', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Produto</th>
                <th style={{ padding: '6px', fontSize: '9.5px', width: '70px', fontWeight: 700, borderRight: '1px solid #333', textTransform: 'uppercase', letterSpacing: '0.3px' }}>Cod.</th>
                <th style={{ padding: '6px', fontSize: '9.5px', width: '60px', fontWeight: 700, borderRight: '1px solid #333', textTransform: 'uppercase', letterSpacing: '0.3px' }}>UN</th>
                <th style={{ padding: '6px', fontSize: '9.5px', width: '140px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3px' }}>Cod. Barra</th>
              </tr>
            </thead>
            <tbody>
              {produtosCalculados.length === 0 ? (
                <tr><td colSpan="7" style={{ padding: '16px', textAlign: 'center', color: '#666', border: '1px solid #ccc' }}>Nenhum produto encontrado</td></tr>
              ) : produtosCalculados.map((p, idx) => (
                <tr key={idx} style={{ background: idx % 2 === 1 ? '#f5f5f5' : '#fff' }}>
                  <td style={{ borderBottom: '1px solid #ccc', borderRight: '1px solid #ccc', padding: '5px 8px', fontSize: '10px', textAlign: 'right', fontWeight: 600 }}>{Number(p.quantidade).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td style={{ borderBottom: '1px solid #ccc', borderRight: '1px solid #ccc', padding: '5px 8px', fontSize: '10px', textAlign: 'right', fontWeight: 700 }}>{p.qtde_caixas}</td>
                  <td style={{ borderBottom: '1px solid #ccc', borderRight: '1px solid #ccc', padding: '5px 8px', fontSize: '10px', textAlign: 'right' }}>{p.qtde_unidades}</td>
                  <td style={{ borderBottom: '1px solid #ccc', borderRight: '1px solid #ccc', padding: '5px 8px', fontSize: '10px' }}>{p.descricao}</td>
                  <td style={{ borderBottom: '1px solid #ccc', borderRight: '1px solid #ccc', padding: '5px 8px', fontSize: '10px', textAlign: 'center' }}>{codigoInternoMap.get(String(p.codigo_produto).trim()) || p.codigo_produto}</td>
                  <td style={{ borderBottom: '1px solid #ccc', borderRight: '1px solid #ccc', padding: '5px 8px', fontSize: '10px', textAlign: 'center' }}>{p.unidade || 'UN'}</td>
                  <td style={{ borderBottom: '1px solid #ccc', padding: '5px 8px', fontSize: '10px', textAlign: 'center' }}>{p.codigo_barra || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* RODAPÉ DE TOTAIS */}
          <table style={{ width: '100%', marginTop: '8px', border: '1px solid #000', borderCollapse: 'collapse', fontSize: '10px' }}>
            <tbody>
              <tr>
                <td style={{ padding: '6px 10px', borderRight: '1px solid #000', borderBottom: '1px solid #000', width: '20%' }}>
                  <span style={{ color: '#555', fontSize: '8.5px', textTransform: 'uppercase' }}>Total de Pacotes</span><br />
                  <strong style={{ fontSize: '12px' }}>{fmtInt(totalPacotes)}</strong>
                </td>
                <td style={{ padding: '6px 10px', borderRight: '1px solid #000', borderBottom: '1px solid #000', width: '20%' }}>
                  <span style={{ color: '#555', fontSize: '8.5px', textTransform: 'uppercase' }}>Total Caixas (aprox.)</span><br />
                  <strong style={{ fontSize: '12px' }}>{fmtInt(totalCaixas)}</strong>
                </td>
                <td style={{ padding: '6px 10px', borderRight: '1px solid #000', borderBottom: '1px solid #000', width: '20%' }}>
                  <span style={{ color: '#555', fontSize: '8.5px', textTransform: 'uppercase' }}>Vl. Total Caixas Saída</span><br />
                  __________
                </td>
                <td style={{ padding: '6px 10px', borderRight: '1px solid #000', borderBottom: '1px solid #000', width: '20%' }}>
                  <span style={{ color: '#555', fontSize: '8.5px', textTransform: 'uppercase' }}>Vl. Total Caixas Retorno</span><br />
                  __________
                </td>
                <td style={{ padding: '6px 10px', borderBottom: '1px solid #000', width: '20%' }}>
                  <span style={{ color: '#555', fontSize: '8.5px', textTransform: 'uppercase' }}>Valor Total de Caixas</span><br />
                  __________
                </td>
              </tr>
            </tbody>
          </table>

          {/* ASSINATURAS — fixadas no rodapé da página */}
          <div className="assinaturas" style={{ position: 'absolute', bottom: '16px', left: '20px', right: '20px', display: 'flex', justifyContent: 'space-around', fontSize: '9.5px' }}>
            <div style={{ borderTop: '1px solid #000', paddingTop: '4px', minWidth: '240px', textAlign: 'center', fontWeight: 600, color: '#000', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Conferente Expedição</div>
            <div style={{ borderTop: '1px solid #000', paddingTop: '4px', minWidth: '240px', textAlign: 'center', fontWeight: 600, color: '#000', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Responsável Faturamento</div>
            <div style={{ borderTop: '1px solid #000', paddingTop: '4px', minWidth: '240px', textAlign: 'center', fontWeight: 600, color: '#000', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Motorista</div>
          </div>
        </div>
      </div>
    </div>
  );
}