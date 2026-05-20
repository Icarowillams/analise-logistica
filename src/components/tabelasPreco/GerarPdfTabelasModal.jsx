import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FileDown, Search, Loader2 } from 'lucide-react';
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

  // Conta produtos com preço > 0 por tabela
  const resumoPorTabela = useMemo(() => {
    const map = {};
    tabelas.forEach(t => {
      const precos = allPrecos
        .filter(p => p.tabela_id === t.id)
        .map(p => ({ ...p, produto: produtos.find(pr => pr.id === p.produto_id) }))
        .filter(p => p.produto)
        .filter(p => {
          const valor = p.ativacao_acao && p.valor_acao > 0 ? p.valor_acao : p.valor_unitario;
          return Number(valor) > 0;
        });
      map[t.id] = precos;
    });
    return map;
  }, [tabelas, allPrecos, produtos]);

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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="w-5 h-5 text-red-600" />
            Gerar PDF de Tabelas de Preço
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
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