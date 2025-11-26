import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend
} from 'recharts';
import { Target, Users, TrendingUp, Award, Medal } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

export default function PainelRodrigosM() {
  const [periodo, setPeriodo] = useState(new Date().toISOString().slice(0, 7));

  const { data: vendedores = [], isLoading: lV } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });
  const { data: vendas = [], isLoading: lVe } = useQuery({ queryKey: ['vendas'], queryFn: () => base44.entities.Venda.list('-data', 5000) });
  const { data: trocas = [], isLoading: lT } = useQuery({ queryKey: ['trocas'], queryFn: () => base44.entities.Troca.list('-data', 2000) });
  const { data: clientes = [], isLoading: lC } = useQuery({ queryKey: ['clientes'], queryFn: () => base44.entities.Cliente.list() });
  const { data: metasProduto = [] } = useQuery({ queryKey: ['metasProduto'], queryFn: () => base44.entities.MetaProduto.list() });
  const { data: metasPositivacao = [] } = useQuery({ queryKey: ['metasPositivacao'], queryFn: () => base44.entities.MetaPositivacao.list() });
  const { data: metasPrecoMedio = [] } = useQuery({ queryKey: ['metasPrecoMedio'], queryFn: () => base44.entities.MetaPrecoMedio.list() });
  const { data: metasCadastro = [] } = useQuery({ queryKey: ['metasCadastro'], queryFn: () => base44.entities.MetaCadastro.list() });
  const { data: metasTroca = [] } = useQuery({ queryKey: ['metasTroca'], queryFn: () => base44.entities.MetaTroca.list() });

  const isLoading = lV || lVe || lT || lC;

  const vendedoresAtivos = vendedores.filter(v => v.status === 'ativo');

  // Calcular métricas por vendedor
  const calcularMetricas = (vendedorId) => {
    const vendasVendedor = vendas.filter(v => v.vendedor_id === vendedorId && v.data?.startsWith(periodo));
    const trocasVendedor = trocas.filter(t => t.vendedor_id === vendedorId && t.data?.startsWith(periodo));
    const novosClientes = clientes.filter(c => c.data_primeiro_contato?.startsWith(periodo)).length;
    
    const totalVendas = vendasVendedor.reduce((sum, v) => sum + (v.valor_total || 0), 0);
    const ticketMedio = vendasVendedor.length > 0 ? totalVendas / vendasVendedor.length : 0;
    
    // Metas do vendedor para o período
    const metaProd = metasProduto.find(m => m.vendedor_id === vendedorId && m.periodo === periodo);
    const metaPos = metasPositivacao.find(m => m.vendedor_id === vendedorId && m.periodo === periodo);
    const metaPM = metasPrecoMedio.find(m => m.vendedor_id === vendedorId && m.periodo === periodo);
    const metaCad = metasCadastro.find(m => m.vendedor_id === vendedorId && m.periodo === periodo);
    const metaTr = metasTroca.find(m => m.vendedor_id === vendedorId && m.periodo === periodo);

    return {
      totalVendas,
      qtdVendas: vendasVendedor.length,
      ticketMedio,
      trocas: trocasVendedor.length,
      novosClientes,
      atingimentoProduto: metaProd && metaProd.meta_valor ? Math.min((totalVendas / metaProd.meta_valor) * 100, 150) : 0,
      atingimentoPositivacao: metaPos && metaPos.meta_novos_clientes ? Math.min((novosClientes / metaPos.meta_novos_clientes) * 100, 150) : 0,
      atingimentoPrecoMedio: metaPM && metaPM.preco_medio_minimo ? Math.min((ticketMedio / metaPM.preco_medio_minimo) * 100, 150) : 0,
      atingimentoCadastro: metaCad && metaCad.meta_cadastros ? Math.min((novosClientes / metaCad.meta_cadastros) * 100, 150) : 0,
      atingimentoTroca: metaTr && metaTr.meta_trocas ? (trocasVendedor.length <= metaTr.meta_trocas ? 100 : Math.max(0, 100 - ((trocasVendedor.length - metaTr.meta_trocas) * 10))) : 100
    };
  };

  const dadosVendedores = vendedoresAtivos.map(v => ({
    ...v,
    metricas: calcularMetricas(v.id)
  }));

  // Ranking por total de vendas
  const ranking = [...dadosVendedores].sort((a, b) => b.metricas.totalVendas - a.metricas.totalVendas);

  // Dados para gráfico de barras
  const dadosBarras = ranking.slice(0, 10).map(v => ({
    nome: v.nome?.split(' ')[0] || 'N/A',
    vendas: v.metricas.totalVendas,
    ticket: v.metricas.ticketMedio
  }));

  // Dados para radar (média da equipe)
  const mediaEquipe = {
    produto: dadosVendedores.reduce((sum, v) => sum + v.metricas.atingimentoProduto, 0) / Math.max(dadosVendedores.length, 1),
    positivacao: dadosVendedores.reduce((sum, v) => sum + v.metricas.atingimentoPositivacao, 0) / Math.max(dadosVendedores.length, 1),
    precoMedio: dadosVendedores.reduce((sum, v) => sum + v.metricas.atingimentoPrecoMedio, 0) / Math.max(dadosVendedores.length, 1),
    cadastro: dadosVendedores.reduce((sum, v) => sum + v.metricas.atingimentoCadastro, 0) / Math.max(dadosVendedores.length, 1),
    troca: dadosVendedores.reduce((sum, v) => sum + v.metricas.atingimentoTroca, 0) / Math.max(dadosVendedores.length, 1)
  };

  const dadosRadar = [
    { metrica: 'Produto', valor: mediaEquipe.produto, fullMark: 100 },
    { metrica: 'Positivação', valor: mediaEquipe.positivacao, fullMark: 100 },
    { metrica: 'Preço Médio', valor: mediaEquipe.precoMedio, fullMark: 100 },
    { metrica: 'Cadastro', valor: mediaEquipe.cadastro, fullMark: 100 },
    { metrica: 'Troca', valor: mediaEquipe.troca, fullMark: 100 }
  ];

  const periodos = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    periodos.push(d.toISOString().slice(0, 7));
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg">
            <Award className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Painel Rodrigos</h1>
            <p className="text-slate-500">Visão consolidada de todas as metas</p>
          </div>
        </div>
        <Select value={periodo} onValueChange={setPeriodo}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periodos.map(p => (
              <SelectItem key={p} value={p}>
                {new Date(p + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPIs Gerais */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white border-0">
          <CardContent className="p-6">
            <p className="text-sm text-white/80">Total Vendido</p>
            <p className="text-3xl font-bold mt-2">
              R$ {dadosVendedores.reduce((sum, v) => sum + v.metricas.totalVendas, 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-500 to-indigo-600 text-white border-0">
          <CardContent className="p-6">
            <p className="text-sm text-white/80">Vendas no Período</p>
            <p className="text-3xl font-bold mt-2">
              {dadosVendedores.reduce((sum, v) => sum + v.metricas.qtdVendas, 0)}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-500 to-pink-600 text-white border-0">
          <CardContent className="p-6">
            <p className="text-sm text-white/80">Ticket Médio Geral</p>
            <p className="text-3xl font-bold mt-2">
              R$ {(dadosVendedores.reduce((sum, v) => sum + v.metricas.ticketMedio, 0) / Math.max(dadosVendedores.length, 1)).toFixed(2)}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-500 to-amber-500 text-white border-0">
          <CardContent className="p-6">
            <p className="text-sm text-white/80">Trocas no Período</p>
            <p className="text-3xl font-bold mt-2">
              {dadosVendedores.reduce((sum, v) => sum + v.metricas.trocas, 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle>Vendas por Vendedor</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={dadosBarras}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="nome" tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 12 }} tickFormatter={(v) => `R$${(v/1000).toFixed(0)}k`} />
                <Tooltip 
                  formatter={(value) => [`R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, 'Vendas']}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }}
                />
                <Bar dataKey="vendas" fill="#6366f1" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle>Atingimento Médio da Equipe</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={dadosRadar}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="metrica" tick={{ fill: '#64748b', fontSize: 11 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 10 }} />
                <Radar name="Atingimento %" dataKey="valor" stroke="#6366f1" fill="#6366f1" fillOpacity={0.5} />
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Ranking Detalhado */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Medal className="w-5 h-5 text-amber-500" />
            Ranking de Vendedores
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {ranking.map((v, idx) => {
              const scoreGeral = (v.metricas.atingimentoProduto + v.metricas.atingimentoPositivacao + v.metricas.atingimentoPrecoMedio + v.metricas.atingimentoCadastro + v.metricas.atingimentoTroca) / 5;
              return (
                <div key={v.id} className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl">
                  <div className={`
                    w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white
                    ${idx === 0 ? 'bg-gradient-to-br from-yellow-400 to-orange-500' : 
                      idx === 1 ? 'bg-gradient-to-br from-slate-400 to-slate-500' :
                      idx === 2 ? 'bg-gradient-to-br from-amber-600 to-amber-700' :
                      'bg-gradient-to-br from-slate-300 to-slate-400'}
                  `}>
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-semibold text-slate-800">{v.nome}</span>
                      <span className="font-bold text-lg text-slate-900">
                        R$ {v.metricas.totalVendas.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      <div className="text-center">
                        <p className="text-xs text-slate-500 mb-1">Produto</p>
                        <Badge className={v.metricas.atingimentoProduto >= 100 ? 'bg-emerald-100 text-emerald-700' : v.metricas.atingimentoProduto >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}>
                          {v.metricas.atingimentoProduto.toFixed(0)}%
                        </Badge>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-slate-500 mb-1">Positivação</p>
                        <Badge className={v.metricas.atingimentoPositivacao >= 100 ? 'bg-emerald-100 text-emerald-700' : v.metricas.atingimentoPositivacao >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}>
                          {v.metricas.atingimentoPositivacao.toFixed(0)}%
                        </Badge>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-slate-500 mb-1">Preço Médio</p>
                        <Badge className={v.metricas.atingimentoPrecoMedio >= 100 ? 'bg-emerald-100 text-emerald-700' : v.metricas.atingimentoPrecoMedio >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}>
                          {v.metricas.atingimentoPrecoMedio.toFixed(0)}%
                        </Badge>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-slate-500 mb-1">Cadastro</p>
                        <Badge className={v.metricas.atingimentoCadastro >= 100 ? 'bg-emerald-100 text-emerald-700' : v.metricas.atingimentoCadastro >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}>
                          {v.metricas.atingimentoCadastro.toFixed(0)}%
                        </Badge>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-slate-500 mb-1">Troca</p>
                        <Badge className={v.metricas.atingimentoTroca >= 100 ? 'bg-emerald-100 text-emerald-700' : v.metricas.atingimentoTroca >= 70 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}>
                          {v.metricas.atingimentoTroca.toFixed(0)}%
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {ranking.length === 0 && (
              <p className="text-center text-slate-500 py-8">Nenhum vendedor ativo encontrado</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}