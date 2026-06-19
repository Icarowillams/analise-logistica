import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import KpiCard from '@/components/analises/KpiCard';
import {
  AlertTriangle, TrendingDown, Gift, Trophy, Search, Package, Factory, Info
} from 'lucide-react';

const fmtBRL = (v) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v) => Math.round(v || 0).toLocaleString('pt-BR');

// período padrão: mês corrente
function periodoPadrao() {
  const hoje = new Date();
  const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { inicio: fmt(ini), fim: fmt(hoje) };
}

export default function MetasTrocaVencido() {
  const pad = periodoPadrao();
  const [inicio, setInicio] = useState(pad.inicio);
  const [fim, setFim] = useState(pad.fim);
  const [tetoPerc, setTetoPerc] = useState(5);
  const [custoPacote, setCustoPacote] = useState('');
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const calcular = async () => {
    setCarregando(true);
    setErro('');
    try {
      const payload = { inicio, fim, teto_perc: Number(tetoPerc) || 5 };
      if (Number(custoPacote) > 0) payload.custo_pacote = Number(custoPacote);
      const resp = await base44.functions.invoke('metasTrocaVencido', payload);
      if (resp.data?.error) throw new Error(resp.data.error);
      setDados(resp.data);
    } catch (e) {
      setErro(e.message || 'Erro ao calcular');
    } finally {
      setCarregando(false);
    }
  };

  const totais = dados?.totais;
  const params = dados?.parametros;

  return (
    <div className="space-y-5">
      {/* Cabeçalho explicativo */}
      <Card className="border-0 shadow-md overflow-hidden">
        <div className="bg-gradient-to-r from-rose-600 to-orange-600 p-5 text-white">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-8 h-8" />
            <div>
              <h2 className="text-xl font-bold">Meta de Troca — Vencido</h2>
              <p className="text-sm text-rose-50/90 mt-0.5">
                Hoje a comissão é só pelo faturamento — o vencido fica por conta da empresa.
                Aqui o vendedor que controlar o vencido abaixo do teto transforma a economia em bonificação.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Parâmetros */}
      <Card className="border-slate-200">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
            <div>
              <Label className="text-xs">Início</Label>
              <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Fim</Label>
              <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Teto de vencido (%)</Label>
              <Input type="number" step="0.5" value={tetoPerc} onChange={(e) => setTetoPerc(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Custo do pacote (R$)</Label>
              <Input
                type="number" step="0.01" placeholder="auto"
                value={custoPacote} onChange={(e) => setCustoPacote(e.target.value)}
              />
            </div>
            <Button onClick={calcular} disabled={carregando} className="bg-rose-600 hover:bg-rose-700">
              <Search className="w-4 h-4 mr-1" />
              {carregando ? 'Calculando...' : 'Calcular'}
            </Button>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 flex items-center gap-1">
            <Info className="w-3 h-3" />
            O % de vencido é calculado por <strong>pacotes de vencido ÷ pacotes vendidos</strong>.
            Deixe o custo do pacote em "auto" para usar o preço médio real das trocas
            {params ? ` (${fmtBRL(params.preco_medio_troca)})` : ''}.
          </p>
        </CardContent>
      </Card>

      {erro && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{erro}</div>
      )}

      {totais && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard titulo="Vencido (pacotes)" valor={fmtNum(totais.vencido_pacotes)} sub={`${fmtBRL(totais.vencido_valor)} no período`} icon={Package} cor="red" />
            <KpiCard titulo="% Vencido geral" valor={`${totais.perc_vencido}%`} sub={`teto: ${params.teto_perc}%`} icon={TrendingDown} cor={totais.perc_vencido <= params.teto_perc ? 'emerald' : 'red'} />
            <KpiCard titulo="Economia / Bonificação" valor={fmtBRL(totais.economia_valor)} sub="quem ficou abaixo do teto" icon={Gift} cor="emerald" />
            <KpiCard titulo="Dentro da meta" valor={`${totais.dentro_meta}`} sub={`${totais.acima_meta} acima do teto`} icon={Trophy} cor="indigo" />
          </div>

          {/* Distribuição da bonificação */}
          <Card className="border-emerald-200 bg-emerald-50/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2 text-emerald-800">
                <Gift className="w-4 h-4" /> Bolo de economia: {fmtBRL(totais.economia_valor)}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-slate-600 mb-3">
                Valor que deixou de virar troca por quem ficou abaixo do teto. Sugestão de rateio
                (ajustável conforme a política da empresa):
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { lbl: 'Vendedor', perc: 0.40, icon: Trophy },
                  { lbl: 'Supervisor', perc: 0.15, icon: Trophy },
                  { lbl: 'Equipe', perc: 0.15, icon: Package },
                  { lbl: 'Fábrica', perc: 0.30, icon: Factory },
                ].map((r) => (
                  <div key={r.lbl} className="bg-white rounded-lg border border-emerald-200 p-3 text-center">
                    <r.icon className="w-5 h-5 mx-auto text-emerald-600 mb-1" />
                    <p className="text-xs text-slate-500">{r.lbl} ({Math.round(r.perc * 100)}%)</p>
                    <p className="text-lg font-bold text-emerald-700">{fmtBRL(totais.economia_valor * r.perc)}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Ranking por vendedor */}
          <Card className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-500" /> Ranking por vendedor (menor % de vencido primeiro)
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b">
                    <th className="py-2 pr-2">#</th>
                    <th className="py-2 pr-2">Vendedor</th>
                    <th className="py-2 px-2 text-right">Vendidos (pct)</th>
                    <th className="py-2 px-2 text-right">Vencido (pct)</th>
                    <th className="py-2 px-2 text-right">% Vencido</th>
                    <th className="py-2 px-2 text-right">Vencido R$</th>
                    <th className="py-2 px-2 text-center">Meta</th>
                    <th className="py-2 pl-2 text-right">Bonificação</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.por_vendedor.filter(v => v.pacotes_vendidos > 0 || v.vencido_pacotes > 0).map((v, i) => (
                    <tr key={v.vendedor_nome} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="py-2 pr-2 text-slate-400">{i + 1}</td>
                      <td className="py-2 pr-2 font-medium">{v.vendedor_nome}</td>
                      <td className="py-2 px-2 text-right">{fmtNum(v.pacotes_vendidos)}</td>
                      <td className="py-2 px-2 text-right">{fmtNum(v.vencido_pacotes)}</td>
                      <td className={`py-2 px-2 text-right font-semibold ${v.perc_vencido > v.teto_perc ? 'text-red-600' : 'text-emerald-600'}`}>
                        {v.perc_vencido}%
                      </td>
                      <td className="py-2 px-2 text-right text-slate-600">{fmtBRL(v.vencido_valor)}</td>
                      <td className="py-2 px-2 text-center">
                        {v.dentro_meta
                          ? <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">OK</Badge>
                          : <Badge className="bg-red-100 text-red-800 border-red-300">Acima</Badge>}
                      </td>
                      <td className={`py-2 pl-2 text-right font-semibold ${v.economia_valor > 0 ? 'text-emerald-700' : 'text-slate-300'}`}>
                        {v.economia_valor > 0 ? fmtBRL(v.economia_valor) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {!totais && !carregando && (
        <div className="text-center py-12 text-slate-400">
          <AlertTriangle className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p>Defina o período e o teto de vencido, depois clique em <strong>Calcular</strong>.</p>
        </div>
      )}
    </div>
  );
}