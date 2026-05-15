import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Download, FileText, Printer, BarChart3, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function ExportarTabelasTab() {
  const [gerando, setGerando] = useState(false);

  const { data: tabelas = [] } = useQuery({
    queryKey: ['tabelasPreco'],
    queryFn: () => base44.entities.TabelaPreco.list()
  });

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtos'],
    queryFn: () => base44.entities.Produto.list()
  });

  const { data: allPrecos = [] } = useQuery({
    queryKey: ['todosPrecos'],
    queryFn: () => base44.entities.PrecoProduto.list()
  });

  // Calcular preço médio por tabela (soma de preços / qtd produtos precificados, ignora preços <= 0)
  const relatorioMedio = useMemo(() => {
    return tabelas.map(t => {
      const precos = allPrecos.filter(p => p.tabela_id === t.id);
      // Considera preço ação se ativada e > 0, senão preço unitário. Só conta se > 0.
      const precosValidos = precos
        .map(p => {
          const valor = p.ativacao_acao && p.valor_acao > 0 ? p.valor_acao : p.valor_unitario;
          return valor || 0;
        })
        .filter(v => v > 0);

      const soma = precosValidos.reduce((acc, v) => acc + v, 0);
      const qtd = precosValidos.length;
      const media = qtd > 0 ? soma / qtd : 0;

      return {
        tabela: t,
        qtd_produtos_precificados: qtd,
        soma_precos: soma,
        preco_medio: media
      };
    }).sort((a, b) => (a.tabela.nome || '').localeCompare(b.tabela.nome || ''));
  }, [tabelas, allPrecos]);

  const totalGeral = useMemo(() => {
    const tabelasComPreco = relatorioMedio.filter(r => r.qtd_produtos_precificados > 0);
    if (tabelasComPreco.length === 0) return 0;
    const somaMedias = tabelasComPreco.reduce((acc, r) => acc + r.preco_medio, 0);
    return somaMedias / tabelasComPreco.length;
  }, [relatorioMedio]);

  // === EXPORT 1: Tabela / Produto / Preço (detalhado) ===
  const exportarDetalhado = () => {
    setGerando(true);
    try {
      const linhas = ['TABELA;COD PRODUTO;PRODUTO;VALOR UNITARIO;VALOR ACAO;ACAO ATIVA;VALOR ATUAL'];

      tabelas.forEach(tabela => {
        const precos = allPrecos
          .filter(p => p.tabela_id === tabela.id)
          .map(preco => {
            const produto = produtos.find(prod => prod.id === preco.produto_id);
            return { ...preco, produto };
          })
          .filter(p => p.produto)
          .sort((a, b) => (a.produto?.codigo || '').localeCompare(b.produto?.codigo || ''));

        precos.forEach(p => {
          const valorAtual = p.ativacao_acao && p.valor_acao > 0 ? p.valor_acao : p.valor_unitario;
          linhas.push([
            (tabela.nome || '').replace(/;/g, ','),
            p.produto?.codigo || '',
            (p.produto?.nome || '').replace(/;/g, ','),
            (p.valor_unitario || 0).toFixed(2).replace('.', ','),
            (p.valor_acao || 0).toFixed(2).replace('.', ','),
            p.ativacao_acao ? 'SIM' : 'NAO',
            (valorAtual || 0).toFixed(2).replace('.', ',')
          ].join(';'));
        });
      });

      const blob = new Blob(['\uFEFF' + linhas.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tabelas_detalhado_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('✅ CSV detalhado exportado!');
    } catch (e) {
      toast.error('❌ Erro ao exportar: ' + e.message);
    } finally {
      setGerando(false);
    }
  };

  // === EXPORT 2: Relatório de Preço Médio (CSV) ===
  const exportarMedioCSV = () => {
    setGerando(true);
    try {
      const linhas = ['TABELA;PRODUTOS PRECIFICADOS;SOMA DOS PRECOS;PRECO MEDIO'];

      relatorioMedio.forEach(r => {
        linhas.push([
          (r.tabela.nome || '').replace(/;/g, ','),
          r.qtd_produtos_precificados,
          r.soma_precos.toFixed(2).replace('.', ','),
          r.preco_medio.toFixed(2).replace('.', ',')
        ].join(';'));
      });

      const blob = new Blob(['\uFEFF' + linhas.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio_preco_medio_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('✅ CSV de preço médio exportado!');
    } catch (e) {
      toast.error('❌ Erro ao exportar: ' + e.message);
    } finally {
      setGerando(false);
    }
  };

  // === EXPORT 3: Relatório de Preço Médio (Imprimir) ===
  const imprimirRelatorioMedio = () => {
    const dataAtual = new Date().toLocaleDateString('pt-BR');

    let html = `
      <html>
      <head>
        <title>Relatório de Preço Médio - Tabelas</title>
        <style>
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
          body { font-family: Arial, sans-serif; margin: 20px; color: #1a1a1a; }
          .header {
            text-align: center;
            margin-bottom: 24px;
            border-bottom: 2px solid #dc2626;
            padding-bottom: 12px;
          }
          .header h1 { margin: 0; color: #dc2626; font-size: 20px; }
          .header p { margin: 4px 0 0; color: #666; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
          th {
            background: #fef08a;
            color: #1a1a1a;
            padding: 10px 8px;
            border: 1px solid #000;
            font-weight: bold;
            text-align: left;
            font-size: 13px;
          }
          th.num, td.num { text-align: right; }
          td { padding: 8px; border: 1px solid #000; font-size: 12px; }
          tr:nth-child(even) td { background: #fefce8; }
          tfoot td {
            background: #dc2626;
            color: white;
            font-weight: bold;
            font-size: 13px;
          }
          .obs {
            margin-top: 16px;
            padding: 12px;
            background: #f1f5f9;
            border-left: 4px solid #dc2626;
            font-size: 11px;
            color: #475569;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Relatório de Preço Médio por Tabela</h1>
          <p>Gerado em ${dataAtual} • Pão & Mel</p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Tabela</th>
              <th class="num">Produtos Precificados</th>
              <th class="num">Soma dos Preços</th>
              <th class="num">Preço Médio</th>
            </tr>
          </thead>
          <tbody>
    `;

    relatorioMedio.forEach(r => {
      html += `
        <tr>
          <td>${r.tabela.nome || '-'}</td>
          <td class="num">${r.qtd_produtos_precificados}</td>
          <td class="num">R$ ${r.soma_precos.toFixed(2).replace('.', ',')}</td>
          <td class="num"><strong>R$ ${r.preco_medio.toFixed(2).replace('.', ',')}</strong></td>
        </tr>
      `;
    });

    html += `
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3">MÉDIA GERAL (entre tabelas com preços)</td>
              <td class="num">R$ ${totalGeral.toFixed(2).replace('.', ',')}</td>
            </tr>
          </tfoot>
        </table>
        <div class="obs">
          <strong>Critério de cálculo:</strong> O preço médio é calculado pela soma dos preços unitários
          dividida pela quantidade de produtos precificados. Produtos sem preço (R$ 0,00) não entram no cálculo.
          Quando uma ação promocional está ativa, considera-se o valor de ação.
        </div>
      </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 300);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card Exportação Detalhada */}
        <Card className="border-emerald-200">
          <CardHeader className="bg-emerald-50">
            <CardTitle className="flex items-center gap-2 text-emerald-800 text-base">
              <FileSpreadsheet className="w-5 h-5" />
              Exportação Detalhada (CSV)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <p className="text-sm text-slate-600">
              CSV com <strong>uma linha por preço</strong>: Tabela, Código do Produto, Nome,
              Valor Unitário, Valor de Ação e Valor Atual.
            </p>
            <p className="text-xs text-slate-500">
              Ideal para conferência completa ou importação em outros sistemas.
            </p>
            <Button
              onClick={exportarDetalhado}
              disabled={gerando}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Download className="w-4 h-4 mr-2" />
              Baixar CSV Detalhado
            </Button>
          </CardContent>
        </Card>

        {/* Card Relatório de Preço Médio */}
        <Card className="border-amber-200">
          <CardHeader className="bg-amber-50">
            <CardTitle className="flex items-center gap-2 text-amber-800 text-base">
              <BarChart3 className="w-5 h-5" />
              Relatório de Preço Médio
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            <p className="text-sm text-slate-600">
              Resumo com <strong>Nome da Tabela</strong> e <strong>Preço Médio</strong> (soma dos
              preços unitários ÷ quantidade de produtos precificados).
            </p>
            <p className="text-xs text-slate-500">
              Produtos sem preço (R$ 0,00) <strong>não entram</strong> no cálculo.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={exportarMedioCSV}
                disabled={gerando}
                variant="outline"
                className="flex-1 border-amber-400 text-amber-700 hover:bg-amber-50"
              >
                <Download className="w-4 h-4 mr-2" />
                CSV
              </Button>
              <Button
                onClick={imprimirRelatorioMedio}
                className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
              >
                <Printer className="w-4 h-4 mr-2" />
                Imprimir
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Prévia do Relatório de Preço Médio */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-slate-600" />
              Prévia — Preço Médio por Tabela
            </span>
            <Badge className="bg-slate-100 text-slate-700">
              Média Geral: R$ {totalGeral.toFixed(2).replace('.', ',')}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full">
              <thead className="bg-amber-100">
                <tr>
                  <th className="p-2 text-left text-sm font-bold border-b border-slate-300">Tabela</th>
                  <th className="p-2 text-right text-sm font-bold border-b border-slate-300">Produtos Precificados</th>
                  <th className="p-2 text-right text-sm font-bold border-b border-slate-300">Soma dos Preços</th>
                  <th className="p-2 text-right text-sm font-bold border-b border-slate-300">Preço Médio</th>
                </tr>
              </thead>
              <tbody>
                {relatorioMedio.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-4 text-center text-slate-500">
                      Nenhuma tabela cadastrada.
                    </td>
                  </tr>
                ) : (
                  relatorioMedio.map((r, idx) => (
                    <tr key={r.tabela.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="p-2 text-sm border-b border-slate-200 font-medium">
                        {r.tabela.nome}
                      </td>
                      <td className="p-2 text-sm border-b border-slate-200 text-right">
                        {r.qtd_produtos_precificados}
                      </td>
                      <td className="p-2 text-sm border-b border-slate-200 text-right">
                        R$ {r.soma_precos.toFixed(2).replace('.', ',')}
                      </td>
                      <td className="p-2 text-sm border-b border-slate-200 text-right font-bold text-amber-700">
                        R$ {r.preco_medio.toFixed(2).replace('.', ',')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}