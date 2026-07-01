import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Package, ChevronDown, ChevronRight, Users, Box } from 'lucide-react';
import { formatarMoeda, formatarNumero, arredondar2 } from './utilsAnalises';

// Normaliza string: lowercase + sem acento
const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().trim();

// Chave de identidade do cliente: nome com caixa alta, espaços colapsados.
// NÃO remove acentos nem pontuação — "NOVO ATACADO LTDA" ≠ "NOVO ATACADO S.A".
// Só junta cadastros cujo nome é IDÊNTICO após normalizar espaços/caixa.
const chaveCliente = (nome) => String(nome || '')
  .trim()
  .toUpperCase()
  .replace(/\s+/g, ' ');

const isVencido = (motivo) => norm(motivo).includes('vencid');

const ACENTO_VENCIDO = '#f59e0b'; // âmbar — único acento de cor da aba
const ACENTO_VENCIDO_FORTE = '#ea580c'; // laranja para destaque alto

export default function AnalisePorClienteTab({
  itensUnicos,
  filtradas,
  motivosTroca,
  incompleto,
  lotesFalhos,
  loadingItens
}) {
  const [sortKey, setSortKey] = useState('pacotes'); // 'pacotes' | 'valor' | 'pctVencido'
  const [clienteSelecionado, setClienteSelecionado] = useState(null); // chave de nome normalizada

  // Mapa motivo_troca_id → descrição (igual ao dashboard principal)
  const nomeMotivo = useMemo(
    () => new Map((motivosTroca || []).map(m => [m.id, m.descricao || m.nome])),
    [motivosTroca]
  );

  // pedido_id → { chave, cliente_nome } (resolvido das trocas filtradas).
  // A identidade do cliente é o NOME normalizado (vários cliente_id podem ter o mesmo nome/CNPJ).
  const pedidoParaCliente = useMemo(() => {
    const m = new Map();
    (filtradas || []).forEach(t => {
      const nome = t.cliente_nome || '(sem cliente)';
      m.set(t.id, { chave: chaveCliente(nome), cliente_nome: nome });
    });
    return m;
  }, [filtradas]);

  const idsValidos = useMemo(
    () => new Set((filtradas || []).map(t => t.id)),
    [filtradas]
  );

  // Itens filtrados (só dos pedidos no filtro atual) — dedup já feito no Map original
  const itensFiltrados = useMemo(() => {
    if (!itensUnicos || !itensUnicos.size) return [];
    const out = [];
    itensUnicos.forEach(it => {
      if (!it.pedido_id || !idsValidos.has(it.pedido_id)) return;
      out.push(it);
    });
    return out;
  }, [itensUnicos, idsValidos]);

  // Ranking por cliente
  const ranking = useMemo(() => {
    const map = new Map();
    itensFiltrados.forEach(it => {
      const cli = pedidoParaCliente.get(it.pedido_id);
      if (!cli) return;
      const chave = cli.chave;
      if (!map.has(chave)) {
        map.set(chave, {
          chave,
          cliente_nome: cli.cliente_nome,
          pacotes: 0,
          valor: 0,
          pacotesVencido: 0
        });
      }
      const r = map.get(chave);
      const qtd = Number(it.quantidade || 0);
      const valorItem = Number(it.valor_total) > 0
        ? Number(it.valor_total)
        : arredondar2((Number(it.valor_unitario || 0)) * qtd);
      r.pacotes += qtd;
      r.valor = arredondar2(r.valor + valorItem);
      const mot = it.motivo_troca_descricao || nomeMotivo.get(it.motivo_troca_id) || '';
      if (isVencido(mot)) r.pacotesVencido += qtd;
    });
    const arr = [...map.values()].map(r => ({
      ...r,
      pctVencido: r.pacotes > 0 ? arredondar2((r.pacotesVencido / r.pacotes) * 100) : 0
    }));
    const dir = { pacotes: 'pacotes', valor: 'valor', pctVencido: 'pctVencido' }[sortKey] || 'pacotes';
    arr.sort((a, b) => b[dir] - a[dir]);
    return arr;
  }, [itensFiltrados, pedidoParaCliente, nomeMotivo, sortKey]);

  // Top produtos geral
  const topProdutos = useMemo(() => {
    const map = new Map();
    itensFiltrados.forEach(it => {
      const nome = it.produto_nome || it.produto_codigo || '(sem nome)';
      const qtd = Number(it.quantidade || 0);
      if (!map.has(nome)) map.set(nome, { nome, pacotes: 0 });
      map.get(nome).pacotes += qtd;
    });
    return [...map.values()].sort((a, b) => b.pacotes - a.pacotes).slice(0, 10);
  }, [itensFiltrados]);

  // Drill-down: itens do cliente selecionado
  const detalheCliente = useMemo(() => {
    if (!clienteSelecionado) return null;
    const pedidosDoCliente = new Set(
      (filtradas || [])
        .filter(t => chaveCliente(t.cliente_nome || '(sem cliente)') === clienteSelecionado)
        .map(t => t.id)
    );
    if (pedidosDoCliente.size === 0) return null;

    const prods = new Map();
    const motivos = {}; // motivo → pacotes
    let pacotesTotal = 0;
    itensFiltrados.forEach(it => {
      if (!pedidosDoCliente.has(it.pedido_id)) return;
      const nome = it.produto_nome || it.produto_codigo || '(sem nome)';
      const qtd = Number(it.quantidade || 0);
      if (!prods.has(nome)) prods.set(nome, { nome, pacotes: 0 });
      prods.get(nome).pacotes += qtd;
      const mot = it.motivo_troca_descricao || nomeMotivo.get(it.motivo_troca_id) || '(sem motivo)';
      if (!motivos[mot]) motivos[mot] = 0;
      motivos[mot] += qtd;
      pacotesTotal += qtd;
    });
    const topProds = [...prods.values()].sort((a, b) => b.pacotes - a.pacotes).slice(0, 8);
    const motArr = Object.entries(motivos)
      .map(([motivo, pacotes]) => ({
        motivo,
        pacotes,
        pct: pacotesTotal > 0 ? arredondar2((pacotes / pacotesTotal) * 100) : 0
      }))
      .sort((a, b) => b.pacotes - a.pacotes);
    return { topProds, motArr, pacotesTotal };
  }, [clienteSelecionado, filtradas, itensFiltrados, nomeMotivo]);

  const totalPacotesRanking = useMemo(
    () => ranking.reduce((a, r) => a + r.pacotes, 0),
    [ranking]
  );
  const maxPacotes = ranking.length ? ranking[0].pacotes : 1;

  const toggleCliente = (cid) => setClienteSelecionado(prev => prev === cid ? null : cid);

  const SortHeader = ({ k, label, align = 'right' }) => (
    <th
      className={`p-2 cursor-pointer select-none hover:text-amber-600 transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
      onClick={() => setSortKey(k)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === k && <span className="text-amber-600">↓</span>}
      </span>
    </th>
  );

  return (
    <div className="space-y-4">
      {/* Aviso dados parciais (mesmo padrão da aba Visão Geral) */}
      {incompleto && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Ranking pode estar <strong>incompleto</strong> — {lotesFalhos} lote(s) de itens falharam após retries. Recarregue a página para tentar novamente.
          </span>
        </div>
      )}

      {loadingItens ? (
        <Card>
          <CardContent className="py-16 text-center text-slate-500">
            <Package className="w-8 h-8 animate-pulse inline mb-2 text-amber-500" />
            <div className="text-sm font-medium">Carregando itens das trocas...</div>
          </CardContent>
        </Card>
      ) : ranking.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-400 text-sm">
            Nenhuma troca com itens no filtro atual.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Ranking de clientes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-amber-500" />
                  Ranking de clientes por troca
                </span>
                <span className="text-xs font-normal text-slate-500">
                  {formatarNumero(ranking.length)} clientes • {formatarNumero(totalPacotesRanking)} pacotes
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm min-w-[680px]">
                <thead className="bg-slate-50">
                  <tr className="text-slate-600">
                    <th className="p-2 text-left w-8"></th>
                    <th className="p-2 text-left">Cliente</th>
                    <SortHeader k="pacotes" label="Pacotes" />
                    <SortHeader k="valor" label="Valor" />
                    <th className="p-2 text-left w-44">% Vencido</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.slice(0, 50).map((r) => {
                    const aberto = clienteSelecionado === r.chave;
                    const altoVenc = r.pctVencido >= 70;
                    return (
                      <React.Fragment key={r.chave}>
                        <tr
                          className={`border-t cursor-pointer transition-colors ${aberto ? 'bg-amber-50/60' : 'hover:bg-slate-50'}`}
                          onClick={() => toggleCliente(r.chave)}
                        >
                          <td className="p-2 text-slate-400">
                            {aberto ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </td>
                          <td className="p-2 font-medium max-w-[260px] truncate">{r.cliente_nome}</td>
                          <td className="p-2 text-right">
                            <span className="font-semibold">{formatarNumero(r.pacotes)}</span>
                            <span className="block h-1 mt-1 rounded-full bg-slate-100 overflow-hidden">
                              <span
                                className="block h-full rounded-full"
                                style={{ width: `${Math.max(2, (r.pacotes / maxPacotes) * 100)}%`, background: ACENTO_VENCIDO }}
                              />
                            </span>
                          </td>
                          <td className="p-2 text-right text-slate-700">{formatarMoeda(r.valor)}</td>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              <span className="block flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                                <span
                                  className="block h-full rounded-full transition-all"
                                  style={{
                                    width: `${r.pctVencido}%`,
                                    background: altoVenc ? ACENTO_VENCIDO_FORTE : ACENTO_VENCIDO
                                  }}
                                />
                              </span>
                              <span className={`text-xs font-semibold tabular-nums w-10 text-right ${altoVenc ? 'text-orange-600' : 'text-slate-600'}`}>
                                {r.pctVencido}%
                              </span>
                              {altoVenc && (
                                <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-orange-300 text-orange-700 bg-orange-50">
                                  alto
                                </Badge>
                              )}
                            </div>
                          </td>
                        </tr>
                        {aberto && detalheCliente && (
                          <tr className="bg-amber-50/40">
                            <td colSpan={5} className="p-3">
                              <div className="grid md:grid-cols-2 gap-4">
                                {/* Top produtos do cliente */}
                                <div>
                                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                                    <Box className="w-3 h-3" /> Top produtos trocados
                                  </div>
                                  <div className="space-y-1">
                                    {detalheCliente.topProds.map((p, i) => (
                                      <div key={i} className="flex items-center gap-2 text-sm">
                                        <span className="text-xs text-slate-400 w-4">{i + 1}.</span>
                                        <span className="flex-1 truncate">{p.nome}</span>
                                        <span className="font-medium tabular-nums">{formatarNumero(p.pacotes)}</span>
                                        <span className="block w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                          <span
                                            className="block h-full rounded-full"
                                            style={{ width: `${Math.max(3, (p.pacotes / detalheCliente.topProds[0].pacotes) * 100)}%`, background: ACENTO_VENCIDO }}
                                          />
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                {/* Motivos do cliente */}
                                <div>
                                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                                    Motivos de troca
                                  </div>
                                  <div className="space-y-1.5">
                                    {detalheCliente.motArr.map((m, i) => {
                                      const venc = isVencido(m.motivo);
                                      return (
                                        <div key={i} className="flex items-center gap-2 text-sm">
                                          <span className="flex-1 truncate">{m.motivo}</span>
                                          <span className="block flex-1 max-w-[100px] h-2 rounded-full bg-slate-100 overflow-hidden">
                                            <span
                                              className="block h-full rounded-full"
                                              style={{ width: `${m.pct}%`, background: venc ? ACENTO_VENCIDO : '#cbd5e1' }}
                                            />
                                          </span>
                                          <span className="text-xs tabular-nums w-12 text-right text-slate-600">{m.pct}%</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              {ranking.length > 50 && (
                <p className="text-xs text-slate-500 mt-2">
                  Exibindo top 50 de {ranking.length} clientes. Soma total: {formatarNumero(totalPacotesRanking)} pacotes.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Top produtos geral */}
          {topProdutos.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Box className="w-4 h-4 text-amber-500" />
                  Top produtos trocados (geral)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {topProdutos.map((p, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className="text-xs text-slate-400 w-5">{i + 1}.</span>
                      <span className="flex-1 truncate">{p.nome}</span>
                      <span className="font-semibold tabular-nums w-20 text-right">{formatarNumero(p.pacotes)}</span>
                      <span className="block w-32 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${Math.max(2, (p.pacotes / topProdutos[0].pacotes) * 100)}%`, background: ACENTO_VENCIDO }}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}