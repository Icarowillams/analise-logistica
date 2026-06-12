import React, { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Printer, ArrowLeft, Loader2 } from 'lucide-react';

export default function PedidoAgrupado({ pedidoIds, onVoltar }) {
  const printRef = useRef();

  const { data: allItems = [], isFetching: carregandoItens } = useQuery({
    queryKey: ['pedidoItems-agrupado', [...pedidoIds].sort().join(',')],
    queryFn: async () => {
      const itens = [];
      // Busca em lotes de 40 pedidos para garantir que TODOS os itens venham
      for (let i = 0; i < pedidoIds.length; i += 40) {
        const chunk = pedidoIds.slice(i, i + 40);
        const res = await base44.entities.PedidoItem.filter({ pedido_id: { $in: chunk } }, '-created_date', 2000);
        itens.push(...res);
      }
      return itens;
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos-agrupado'],
    queryFn: () => base44.entities.Produto.list()
  });

  const { data: unidades = [] } = useQuery({
    queryKey: ['unidades-agrupado'],
    queryFn: () => base44.entities.UnidadeMedida.list()
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresa-agrupado'],
    queryFn: () => base44.entities.Empresa.list()
  });

  const empresa = empresas[0];

  // Filtrar itens dos pedidos selecionados
  const itensSelecionados = allItems.filter(i => pedidoIds.includes(i.pedido_id));

  // Agrupar por produto
  const produtosMap = {};
  produtos.forEach(p => { produtosMap[p.id] = p; });
  const unidadesMap = {};
  unidades.forEach(u => { unidadesMap[u.id] = u; });

  const agrupado = {};
  itensSelecionados.forEach(item => {
    const key = item.produto_id;
    if (!agrupado[key]) {
      const prod = produtosMap[key] || {};
      const un = prod.unidade_medida_id ? unidadesMap[prod.unidade_medida_id] : null;
      agrupado[key] = {
        codigo: prod.codigo || item.produto_codigo || '-',
        nome: item.produto_nome || prod.nome || '-',
        unidade: un?.nome || 'PCT',
        peso: prod.peso || 0,
        quantidade: 0,
        pesoBruto: 0,
      };
    }
    agrupado[key].quantidade += item.quantidade || 0;
    agrupado[key].pesoBruto += (item.quantidade || 0) * (agrupado[key].peso || 0);
  });

  const linhas = Object.values(agrupado).sort((a, b) => b.quantidade - a.quantidade);
  const totalQtd = linhas.reduce((s, l) => s + l.quantidade, 0);
  const totalPeso = linhas.reduce((s, l) => s + l.pesoBruto, 0);
  const agora = new Date();
  const dataRelatorio = agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const handlePrint = () => {
    const content = printRef.current;
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>Pedido_Agrupado_${dataRelatorio}</title><style>${printStyles}</style></head><body>${content.innerHTML}</body></html>`);
    win.document.close();
    win.print();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Button variant="outline" onClick={onVoltar}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Voltar
        </Button>
        <Button onClick={handlePrint} disabled={carregandoItens} className="bg-blue-600 hover:bg-blue-700">
          {carregandoItens ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />}
          {carregandoItens ? 'Carregando itens...' : 'Imprimir / Salvar PDF'}
        </Button>
      </div>

      <div ref={printRef} className="bg-white border rounded-xl shadow-sm max-w-4xl mx-auto" style={{ padding: '20px', fontFamily: 'Arial, sans-serif', fontSize: '11px', color: '#000' }}>
        {/* Header azul */}
        <div style={{ background: '#3B82F6', color: '#FFF', padding: '8px 12px', fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>
          Pedido Agrupado
        </div>

        {/* Dados empresa */}
        <div style={{ marginBottom: '12px', lineHeight: '1.6' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontWeight: 700 }}>Empresa: </span>{empresa?.razao_social || 'PAO E MEL INDUSTRIA DE PANIFICACAO LTDA ME'}
            </div>
            <div>
              <span style={{ fontWeight: 700 }}>Cnpj: </span>{empresa?.cnpj || '26.946.943/0001-03'}
              <span style={{ marginLeft: '20px', fontWeight: 700 }}>IE: </span>{empresa?.inscricao_estadual || '0704707077'}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div><span style={{ fontWeight: 700 }}>Telefone: </span>{empresa?.telefone || '(81)3454-7552'}</div>
            <div><span style={{ fontWeight: 700 }}>Dt. Relatório: </span>{dataRelatorio}</div>
          </div>
          <div>
            <span style={{ fontWeight: 700 }}>Pedidos: </span>{pedidoIds.length} selecionado(s)
            <span style={{ marginLeft: '20px', fontWeight: 700 }}>Com itens: </span>{new Set(itensSelecionados.map(i => i.pedido_id)).size}
          </div>
        </div>

        {/* Tabela */}
        <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #000' }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              <th style={thStyle}>Qtde</th>
              <th style={thStyle}>UN</th>
              <th style={{ ...thStyle, textAlign: 'left' }}>Produto</th>
              <th style={thStyle}>P. Bruto</th>
              <th style={thStyle}>Cod. Prod</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i}>
                <td style={{ ...tdStyle, fontWeight: 700, textAlign: 'right' }}>{l.quantidade.toFixed(2)}</td>
                <td style={tdStyle}>{l.unidade}</td>
                <td style={{ ...tdStyle, textAlign: 'left' }}>{l.nome}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{l.pesoBruto.toFixed(2)}</td>
                <td style={{ ...tdStyle, textAlign: 'right' }}>{l.codigo}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totais */}
        <div style={{ marginTop: '8px', borderTop: '2px dashed #000', paddingTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 700 }}>
          <div>Total Qtde: {totalQtd.toFixed(2)}</div>
          <div>Total Peso Bruto: {totalPeso.toFixed(2)}</div>
        </div>
      </div>
    </div>
  );
}

const thStyle = {
  border: '1px solid #000',
  padding: '4px 8px',
  fontSize: '10px',
  fontWeight: 700,
  textAlign: 'center',
};

const tdStyle = {
  border: '1px solid #ccc',
  padding: '3px 8px',
  fontSize: '10px',
  textAlign: 'center',
};

const printStyles = `
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; padding: 20px; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #000; padding: 4px 8px; font-size: 10px; }
th { background: #f0f0f0; font-weight: 700; }
`;