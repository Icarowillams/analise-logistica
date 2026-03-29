import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Target, Package, UserPlus, DollarSign, FileText, ArrowLeftRight, TrendingUp, TrendingDown, Users } from 'lucide-react';

function StatCard({ title, icon: Icon, meta, realizado, invertido, formato }) {
  const percent = meta ? (realizado / meta) * 100 : 0;
  const atingiu = invertido ? realizado <= meta : percent >= 100;
  const bom = invertido ? realizado <= meta : percent >= 70;

  const formatVal = (v) => {
    if (formato === 'moeda') return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    return v.toLocaleString('pt-BR');
  };

  return (
    <Card className="border-0 shadow-md">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
            <Icon className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-700">{title}</span>
        </div>
        <div className="flex items-end justify-between mb-2">
          <div>
            <div className="text-xs text-slate-500">Meta</div>
            <div className="text-lg font-bold text-slate-800">{formatVal(meta)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Realizado</div>
            <div className="text-lg font-bold text-slate-800">{formatVal(realizado)}</div>
          </div>
        </div>
        <Progress value={Math.min(percent, 100)} className="h-2 mb-2" />
        <div className="flex items-center justify-between">
          <Badge className={atingiu ? 'bg-emerald-100 text-emerald-700' : bom ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}>
            {invertido
              ? (atingiu ? 'Dentro da Meta' : 'Acima da Meta')
              : `${percent.toFixed(0)}%`
            }
          </Badge>
          {!invertido && (
            percent >= 100
              ? <TrendingUp className="w-4 h-4 text-emerald-500" />
              : <TrendingDown className="w-4 h-4 text-red-400" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function CompiladoMetas() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [periodo, setPeriodo] = useState(currentMonth);
  const [vendedorId, setVendedorId] = useState('todos');

  const { data: metasProduto = [], isLoading: l1 } = useQuery({ queryKey: ['metasProduto'], queryFn: () => base44.entities.MetaProduto.list() });
  const { data: metasPositivacao = [], isLoading: l2 } = useQuery({ queryKey: ['metasPositivacao'], queryFn: () => base44.entities.MetaPositivacao.list() });
  const { data: metasPrecoMedio = [], isLoading: l3 } = useQuery({ queryKey: ['metasPrecoMedio'], queryFn: () => base44.entities.MetaPrecoMedio.list() });
  const { data: metasCadastro = [], isLoading: l4 } = useQuery({ queryKey: ['metasCadastro'], queryFn: () => base44.entities.MetaCadastro.list() });
  const { data: metasTroca = [], isLoading: l5 } = useQuery({ queryKey: ['metasTroca'], queryFn: () => base44.entities.MetaTroca.list() });

  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: vendas = [] } = useQuery({ queryKey: ['vendas'], queryFn: () => base44.entities.Venda.list('-data', 5000) });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: () => base44.entities.Cliente.list() });
  const { data: trocas = [] } = useQuery({ queryKey: ['trocas'], queryFn: () => base44.entities.Troca.list('-data', 2000) });

  const isLoading = l1 || l2 || l3 || l4 || l5;

  // Vendedores que possuem alguma meta no período
  const vendedoresComMeta = useMemo(() => {
    const ids = new Set();
    [...metasProduto, ...metasPositivacao, ...metasPrecoMedio, ...metasCadastro, ...metasTroca]
      .filter(m => m.periodo === periodo)
      .forEach(m => { if (m.vendedor_id) ids.add(m.vendedor_id); });
    return vendedores.filter(v => ids.has(v.id)).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [periodo, metasProduto, metasPositivacao, metasPrecoMedio, metasCadastro, metasTroca, vendedores]);

  // Compilado por vendedor
  const compiladoPorVendedor = useMemo(() => {
    const vendedoresFiltrar = vendedorId === 'todos' ? vendedoresComMeta : vendedoresComMeta.filter(v => v.id === vendedorId);

    return vendedoresFiltrar.map(vend => {
      // Produto
      const mpList = metasProduto.filter(m => m.periodo === periodo && m.vendedor_id === vend.id);
      const metaQtdProd = mpList.reduce((s, m) => s + (m.meta_quantidade || 0), 0);
      const metaValProd = mpList.reduce((s, m) => s + (m.meta_valor || 0), 0);
      const vendasVend = vendas.filter(v => v.vendedor_id === vend.id && v.data?.startsWith(periodo));
      
      let realizadoQtdProd = 0;
      let realizadoValProd = 0;
      mpList.forEach(m => {
        const vf = vendas.filter(v => v.produto_id === m.produto_id && v.vendedor_id === vend.id && v.data?.startsWith(periodo));
        realizadoQtdProd += vf.reduce((s, v) => s + (v.quantidade || 0), 0);
        realizadoValProd += vf.reduce((s, v) => s + (v.valor_total || 0), 0);
      });

      // Positivação
      const mposit = metasPositivacao.find(m => m.periodo === periodo && m.vendedor_id === vend.id);
      const metaPosit = mposit?.meta_novos_clientes || 0;
      const realizadoPosit = clientes.filter(c => c.vendedor_id === vend.id && c.data_primeiro_contato?.startsWith(periodo)).length;

      // Preço Médio
      const mpm = metasPrecoMedio.find(m => m.periodo === periodo && m.vendedor_id === vend.id);
      const metaPM = mpm?.preco_medio_minimo || 0;
      const ticketVendas = vendasVend.length > 0 ? vendasVend.reduce((s, v) => s + (v.valor_total || 0), 0) / vendasVend.length : 0;

      // Cadastro
      const mcad = metasCadastro.find(m => m.periodo === periodo && m.vendedor_id === vend.id);
      const metaCad = mcad?.meta_cadastros || 0;
      const realizadoCad = clientes.filter(c => c.vendedor_id === vend.id && c.data_primeiro_contato?.startsWith(periodo)).length;

      // Troca
      const mtroca = metasTroca.find(m => m.periodo === periodo && m.vendedor_id === vend.id);
      const metaTroca = mtroca?.meta_trocas || 0;
      const realizadoTroca = trocas.filter(t => t.vendedor_id === vend.id && t.data?.startsWith(periodo)).length;

      return {
        vendedor: vend,
        produto: { meta: metaQtdProd, realizado: realizadoQtdProd, metaValor: metaValProd, realizadoValor: realizadoValProd },
        positivacao: { meta: metaPosit, realizado: realizadoPosit },
        precoMedio: { meta: metaPM, realizado: ticketVendas },
        cadastro: { meta: metaCad, realizado: realizadoCad },
        troca: { meta: metaTroca, realizado: realizadoTroca }
      };
    });
  }, [periodo, vendedorId, vendedoresComMeta, metasProduto, metasPositivacao, metasPrecoMedio, metasCadastro, metasTroca, vendas, clientes, trocas]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <Label className="text-xs mb-1 block">Período</Label>
          <Input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} className="w-44" />
        </div>
        <div>
          <Label className="text-xs mb-1 block">Vendedor</Label>
          <Select value={vendedorId} onValueChange={setVendedorId}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {vendedoresComMeta.map(v => (
                <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {compiladoPorVendedor.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          <Target className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p className="text-lg font-medium">Nenhuma meta encontrada</p>
          <p className="text-sm">Não há metas cadastradas para o período selecionado.</p>
        </div>
      )}

      {compiladoPorVendedor.map(({ vendedor, produto, positivacao, precoMedio, cadastro, troca }) => (
        <Card key={vendedor.id} className="border-0 shadow-lg overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-slate-800 to-slate-700 text-white py-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-400 flex items-center justify-center text-slate-900 font-bold text-sm">
                {vendedor.nome?.charAt(0)}
              </div>
              <div>
                <CardTitle className="text-base text-white">{vendedor.nome}</CardTitle>
                <span className="text-xs text-slate-300">{periodo}</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
              {produto.meta > 0 && (
                <StatCard title="Produto (Qtd)" icon={Package} meta={produto.meta} realizado={produto.realizado} />
              )}
              {produto.metaValor > 0 && (
                <StatCard title="Produto (R$)" icon={DollarSign} meta={produto.metaValor} realizado={produto.realizadoValor} formato="moeda" />
              )}
              {positivacao.meta > 0 && (
                <StatCard title="Positivação" icon={UserPlus} meta={positivacao.meta} realizado={positivacao.realizado} />
              )}
              {precoMedio.meta > 0 && (
                <StatCard title="Preço Médio" icon={DollarSign} meta={precoMedio.meta} realizado={precoMedio.realizado} formato="moeda" />
              )}
              {cadastro.meta > 0 && (
                <StatCard title="Cadastro" icon={FileText} meta={cadastro.meta} realizado={cadastro.realizado} />
              )}
              {troca.meta > 0 && (
                <StatCard title="Troca (máx)" icon={ArrowLeftRight} meta={troca.meta} realizado={troca.realizado} invertido />
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}