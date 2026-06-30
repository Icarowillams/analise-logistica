import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

const ENTIDADES = [
  // Cadastros base
  { nome: 'Cliente', label: 'Clientes' },
  { nome: 'Produto', label: 'Produtos' },
  { nome: 'Vendedor', label: 'Vendedores / Funcionários' },
  { nome: 'Rota', label: 'Rotas' },
  { nome: 'Veiculo', label: 'Veículos' },
  { nome: 'PlanoPagamento', label: 'Planos de Pagamento' },
  { nome: 'TabelaPreco', label: 'Tabelas de Preço' },
  { nome: 'PrecoProduto', label: 'Preços de Produto' },
  { nome: 'CenarioFiscalLocal', label: 'Cenários Fiscais Locais' },
  { nome: 'Segmento', label: 'Segmentos' },
  { nome: 'Rede', label: 'Redes' },
  // Pedidos
  { nome: 'Pedido', label: 'Pedidos' },
  { nome: 'PedidoItem', label: 'Itens de Pedido' },
  { nome: 'PedidoTroca', label: 'Pedidos de Troca' },
  { nome: 'ItemPedidoTroca', label: 'Itens de Troca' },
  // Operacional
  { nome: 'Carga', label: 'Cargas' },
  { nome: 'Retorno', label: 'Retornos' },
  { nome: 'AcertoCaixa', label: 'Acertos de Caixa' },
  { nome: 'Transferencia', label: 'Transferências' },
  // Espelhos / Logs Omie
  { nome: 'PedidoLiberadoOmie', label: 'Espelho Pedidos Omie' },
  { nome: 'LogEmissaoNF', label: 'Log Emissão NF' },
  { nome: 'LogIntegracaoOmie', label: 'Log Integração Omie' },
];

function toCSV(rows) {
  if (!rows || rows.length === 0) return '';
  const keys = Object.keys(rows[0]);
  const header = keys.join(';');
  const lines = rows.map(row =>
    keys.map(k => {
      const val = row[k];
      if (val === null || val === undefined) return '';
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      // Escapa aspas e envolve em aspas se necessário
      if (str.includes(';') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }).join(';')
  );
  return [header, ...lines].join('\n');
}

function downloadCSV(content, filename) {
  const BOM = '\uFEFF'; // UTF-8 BOM para Excel reconhecer acentos
  const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function buscarTodos(nomeEntidade) {
  const PAGE = 5000;
  const todos = [];
  let skip = 0;
  while (true) {
    const pagina = await base44.entities[nomeEntidade].list('-created_date', PAGE, skip);
    if (!pagina || pagina.length === 0) break;
    todos.push(...pagina);
    if (pagina.length < PAGE) break;
    skip += PAGE;
  }
  return todos;
}

export default function ExportarDados() {
  const [status, setStatus] = useState({}); // { [nome]: 'idle' | 'loading' | 'done' | 'error' }
  const [exportandoTodos, setExportandoTodos] = useState(false);

  const exportarUma = async (entidade) => {
    setStatus(s => ({ ...s, [entidade.nome]: 'loading' }));
    try {
      const dados = await buscarTodos(entidade.nome);
      const csv = toCSV(dados);
      const data = new Date().toISOString().slice(0, 10);
      downloadCSV(csv, `${entidade.nome}_${data}.csv`);
      setStatus(s => ({ ...s, [entidade.nome]: 'done' }));
    } catch (e) {
      console.error(e);
      setStatus(s => ({ ...s, [entidade.nome]: 'error' }));
    }
  };

  const exportarTodas = async () => {
    setExportandoTodos(true);
    for (const ent of ENTIDADES) {
      setStatus(s => ({ ...s, [ent.nome]: 'loading' }));
      try {
        const dados = await buscarTodos(ent.nome);
        const csv = toCSV(dados);
        const data = new Date().toISOString().slice(0, 10);
        downloadCSV(csv, `${ent.nome}_${data}.csv`);
        setStatus(s => ({ ...s, [ent.nome]: 'done' }));
      } catch (e) {
        console.error(e);
        setStatus(s => ({ ...s, [ent.nome]: 'error' }));
      }
    }
    setExportandoTodos(false);
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-neutral-800">Exportar Dados</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Baixe cada entidade como CSV (separador ponto-e-vírgula, UTF-8 com BOM para Excel).
        </p>
      </div>

      <div className="mb-4">
        <Button
          onClick={exportarTodas}
          disabled={exportandoTodos}
          className="bg-cyan-700 hover:bg-cyan-800 text-white"
        >
          {exportandoTodos
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Exportando todas...</>
            : <><Download className="w-4 h-4 mr-2" /> Exportar TODAS as entidades</>
          }
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden divide-y bg-white">
        {ENTIDADES.map(ent => {
          const st = status[ent.nome] || 'idle';
          return (
            <div key={ent.nome} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-medium text-sm text-neutral-800">{ent.label}</div>
                <div className="text-xs text-neutral-400">{ent.nome}</div>
              </div>
              <div className="flex items-center gap-2">
                {st === 'done' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                {st === 'error' && <AlertCircle className="w-4 h-4 text-red-500" />}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => exportarUma(ent)}
                  disabled={st === 'loading' || exportandoTodos}
                >
                  {st === 'loading'
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Download className="w-3 h-3 mr-1" />
                  }
                  {st === 'loading' ? 'Baixando...' : 'Exportar CSV'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}