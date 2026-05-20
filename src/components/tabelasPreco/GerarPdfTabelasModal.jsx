import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileDown, Search, Loader2, Filter, X } from 'lucide-react';
import { toast } from 'sonner';

const LOGO_PAO_MEL = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6926e3c1dcadc4e314506362/7c2bd1831_8297750cb_cropped-cropped-logo.png';

// Gera o HTML completo de todas as tabelas selecionadas no padrão da imagem do usuário:
// faixa vermelha + logo Pão&Mel à direita + título "NOME DA TABELA" + tabela com COD INTERNO / DESCRIÇÃO / VALOR UNITARIO.
// Mostra APENAS itens com preço > 0 (considera valor_acao se ação ativa, senão valor_unitario).
function buildHtml(tabelasComPrecos) {
  const blocos = tabelasComPrecos.map(({ tabela, precos }, idx) => {
    const linhas = precos.map(p => {
      const valor = p.ativacao_acao && p.valor_acao > 0 ? p.valor_acao : p.valor_unitario;
      const desc = (p.produto?.nome || '').toUpperCase();
      const cod = p.produto?.codigo_interno || p.produto?.codigo || '';
      return `
        <tr>
          <td class="cod">${cod}</td>
          <td class="desc">${desc}</td>
          <td class="val">${Number(valor).toFixed(2).replace('.', ',')}</td>
        </tr>`;
    }).join('');

    return `
      <section class="tabela-bloco ${idx > 0 ? 'page-break' : ''}">
        <header class="cabecalho">
          <div class="titulo">TABELA ${(tabela.nome || '').toUpperCase()}</div>
          <img class="logo" src="${LOGO_PAO_MEL}" alt="Pão & Mel" crossorigin="anonymous" />
        </header>
        <table class="precos">
          <thead>
            <tr>
              <th class="cod">COD INTERNO</th>
              <th class="desc">DESCRIÇÃO</th>
              <th class="val">VALOR UNITARIO</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </section>`;
  }).join('');

  return `
    <!doctype html>
    <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <title>Tabelas de Preço — Pão & Mel</title>
      <style>
        @page { size: A4 portrait; margin: 10mm; }
        * { box-sizing: border-box; }
        body { font-family: Arial, Helvetica, sans-serif; margin: 0; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .tabela-bloco { margin-bottom: 18px; page-break-inside: avoid; }
        .page-break { page-break-before: always; }

        .cabecalho {
          background: #e21f26;
          color: #fff;
          padding: 6px 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border: 1px solid #000;
          border-bottom: 0;
        }
        .cabecalho .titulo {
          font-weight: 900;
          font-size: 22px;
          letter-spacing: 0.5px;
          flex: 1;
          text-align: center;
          text-transform: uppercase;
        }
        .cabecalho .logo {
          height: 56px;
          width: auto;
          background: #ffd23f;
          border-radius: 50%;
          padding: 4px;
        }

        table.precos {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }
        table.precos thead th {
          background: #ffd23f;
          color: #000;
          border: 1px solid #000;
          padding: 6px 8px;
          text-align: left;
          font-weight: 900;
          font-size: 12px;
        }
        table.precos thead th.val { text-align: right; }
        table.precos tbody td {
          border: 1px solid #000;
          padding: 5px 8px;
          font-size: 12px;
        }
        table.precos tbody td.cod { width: 90px; font-weight: 700; }
        table.precos tbody td.val { width: 110px; text-align: right; font-weight: 700; }
        table.precos tbody tr:nth-child(even) td { background: #fafafa; }
      </style>
    </head>
    <body>
      ${blocos}
      <script>
        // Espera a logo carregar antes de abrir o diálogo de impressão
        window.addEventListener('load', function() {
          const imgs = Array.from(document.images || []);
          Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(r => { img.onload = img.onerror = r; })))
            .then(() => { setTimeout(() => window.print(), 200); });
        });
      </script>
    </body>
    </html>
  `;
}

export default function GerarPdfTabelasModal({ open, onOpenChange, tabelas, allPrecos, produtos }) {
  const [selecionadas, setSelecionadas] = useState([]);
  const [busca, setBusca] = useState('');
  const [gerando, setGerando] = useState(false);

  // Filtros de produto
  const [filtroCategoria, setFiltroCategoria] = useState('all');
  const [filtroSubCategoria, setFiltroSubCategoria] = useState('all');
  const [produtosSelecionados, setProdutosSelecionados] = useState([]);
  const [buscaProduto, setBuscaProduto] = useState('');

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => base44.entities.Categoria.list()
  });

  const { data: subCategorias = [] } = useQuery({
    queryKey: ['subCategorias'],
    queryFn: () => base44.entities.SubCategoria.list()
  });

  const subCategoriasFiltradas = useMemo(() => {
    if (filtroCategoria === 'all') return subCategorias;
    return subCategorias.filter(sc => sc.categoria_id === filtroCategoria);
  }, [subCategorias, filtroCategoria]);

  // Conjunto de IDs de produtos que passam pelos filtros (categoria/subcategoria/seleção manual)
  const produtosPermitidosIds = useMemo(() => {
    let lista = produtos;
    if (filtroCategoria !== 'all') lista = lista.filter(p => p.categoria_id === filtroCategoria);
    if (filtroSubCategoria !== 'all') lista = lista.filter(p => p.sub_categoria_id === filtroSubCategoria);
    if (produtosSelecionados.length > 0) {
      const sel = new Set(produtosSelecionados);
      lista = lista.filter(p => sel.has(p.id));
    }
    return new Set(lista.map(p => p.id));
  }, [produtos, filtroCategoria, filtroSubCategoria, produtosSelecionados]);

  const temFiltroProduto = filtroCategoria !== 'all' || filtroSubCategoria !== 'all' || produtosSelecionados.length > 0;

  const produtosBusca = useMemo(() => {
    const termo = buscaProduto.trim().toLowerCase();
    if (!termo) return [];
    return produtos.filter(p =>
      (p.nome || '').toLowerCase().includes(termo) ||
      (p.codigo || '').toLowerCase().includes(termo) ||
      (p.codigo_interno || '').toLowerCase().includes(termo)
    ).slice(0, 15);
  }, [produtos, buscaProduto]);

  // Conta produtos com preço > 0 por tabela, aplicando filtros de categoria/subcategoria/produtos
  const resumoPorTabela = useMemo(() => {
    const map = {};
    tabelas.forEach(t => {
      const precos = allPrecos
        .filter(p => p.tabela_id === t.id)
        .map(p => ({ ...p, produto: produtos.find(pr => pr.id === p.produto_id) }))
        .filter(p => p.produto)
        .filter(p => produtosPermitidosIds.has(p.produto.id))
        .filter(p => {
          const valor = p.ativacao_acao && p.valor_acao > 0 ? p.valor_acao : p.valor_unitario;
          return Number(valor) > 0;
        });
      map[t.id] = precos;
    });
    return map;
  }, [tabelas, allPrecos, produtos, produtosPermitidosIds]);

  const limparFiltros = () => {
    setFiltroCategoria('all');
    setFiltroSubCategoria('all');
    setProdutosSelecionados([]);
    setBuscaProduto('');
  };

  const toggleProduto = (id) => {
    setProdutosSelecionados(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const tabelasFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return tabelas
      .filter(t => t.status !== 'inativo')
      .filter(t => !termo || (t.nome || '').toLowerCase().includes(termo));
  }, [tabelas, busca]);

  const toggle = (id) => setSelecionadas(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleTodas = () => {
    const ids = tabelasFiltradas.map(t => t.id);
    setSelecionadas(prev => prev.length === ids.length ? [] : ids);
  };

  const gerar = () => {
    const alvos = tabelas.filter(t => selecionadas.includes(t.id));
    if (alvos.length === 0) {
      toast.error('Selecione ao menos uma tabela');
      return;
    }

    setGerando(true);
    const tabelasComPrecos = alvos
      .map(tabela => ({
        tabela,
        precos: (resumoPorTabela[tabela.id] || []).sort((a, b) =>
          (a.produto?.codigo_interno || a.produto?.codigo || '').localeCompare(
            b.produto?.codigo_interno || b.produto?.codigo || '',
            'pt-BR', { numeric: true }
          )
        )
      }))
      .filter(b => b.precos.length > 0);

    if (tabelasComPrecos.length === 0) {
      toast.error('Nenhuma das tabelas selecionadas tem produtos com preço > 0');
      setGerando(false);
      return;
    }

    const html = buildHtml(tabelasComPrecos);
    const win = window.open('', '_blank');
    if (!win) {
      toast.error('Habilite popups para gerar o PDF');
      setGerando(false);
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    setGerando(false);
    toast.success(`PDF de ${tabelasComPrecos.length} tabela(s) aberto em nova aba`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="w-5 h-5 text-red-600" />
            Gerar PDF de Tabelas de Preço
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Filtros de produto */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Filter className="w-4 h-4" /> Filtros de produtos
              </div>
              {temFiltroProduto && (
                <button onClick={limparFiltros} className="text-xs text-red-600 hover:underline flex items-center gap-1">
                  <X className="w-3 h-3" /> Limpar filtros
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Categoria</Label>
                <Select value={filtroCategoria} onValueChange={(v) => { setFiltroCategoria(v); setFiltroSubCategoria('all'); }}>
                  <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as Categorias</SelectItem>
                    {categorias.filter(c => c.status === 'ativo').map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Subcategoria</Label>
                <Select value={filtroSubCategoria} onValueChange={setFiltroSubCategoria}>
                  <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as Subcategorias</SelectItem>
                    {subCategoriasFiltradas.filter(sc => sc.status === 'ativo').map(sc => (
                      <SelectItem key={sc.id} value={sc.id}>{sc.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Produtos específicos (opcional)</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Buscar produto por nome ou código…"
                  value={buscaProduto}
                  onChange={(e) => setBuscaProduto(e.target.value)}
                  className="pl-9"
                />
                {buscaProduto.trim() && produtosBusca.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {produtosBusca.map(p => (
                      <div
                        key={p.id}
                        onClick={() => { toggleProduto(p.id); setBuscaProduto(''); }}
                        className="p-2 hover:bg-amber-50 cursor-pointer flex justify-between items-center border-b last:border-b-0 text-sm"
                      >
                        <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">{p.codigo_interno || p.codigo}</span>
                        <span className="flex-1 ml-2 truncate">{p.nome}</span>
                        {produtosSelecionados.includes(p.id) && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">selecionado</Badge>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {produtosSelecionados.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {produtosSelecionados.map(id => {
                    const p = produtos.find(x => x.id === id);
                    if (!p) return null;
                    return (
                      <Badge key={id} className="bg-blue-100 text-blue-700 gap-1 pr-1">
                        {p.nome}
                        <button onClick={() => toggleProduto(id)} className="hover:bg-blue-200 rounded px-1">
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Buscar tabela…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex items-center justify-between text-sm">
            <button onClick={toggleTodas} className="text-blue-600 hover:underline">
              {selecionadas.length === tabelasFiltradas.length && tabelasFiltradas.length > 0
                ? 'Desmarcar todas'
                : 'Selecionar todas'}
            </button>
            <span className="text-slate-500">{selecionadas.length} selecionada(s)</span>
          </div>

          <div className="max-h-[420px] overflow-y-auto border border-slate-200 rounded-lg divide-y">
            {tabelasFiltradas.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">Nenhuma tabela</div>
            ) : tabelasFiltradas.map(t => {
              const qtd = (resumoPorTabela[t.id] || []).length;
              const semPreco = qtd === 0;
              return (
                <label
                  key={t.id}
                  className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-50 ${semPreco ? 'opacity-50' : ''}`}
                >
                  <Checkbox
                    checked={selecionadas.includes(t.id)}
                    onCheckedChange={() => toggle(t.id)}
                    disabled={semPreco}
                  />
                  <div className="flex-1">
                    <div className="font-medium text-slate-800">{t.nome}</div>
                  </div>
                  <Badge className={qtd > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}>
                    {qtd} produto(s) com preço
                  </Badge>
                </label>
              );
            })}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={gerar}
            disabled={gerando || selecionadas.length === 0}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {gerando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />}
            Gerar PDF ({selecionadas.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}