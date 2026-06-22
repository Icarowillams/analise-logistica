import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Trophy, Calculator, Settings2, Loader2, FlaskConical } from 'lucide-react';
import { toast } from 'sonner';
import PageHeader from '@/components/ui/PageHeader';
import { Award } from 'lucide-react';
import PainelVendedor from '@/components/comissionamento/PainelVendedor';
import RankingEquipe from '@/components/comissionamento/RankingEquipe';
import GerenciarMetas from '@/components/comissionamento/GerenciarMetas';
import GerenciarMapeamentoTrocas from '@/components/comissionamento/GerenciarMapeamentoTrocas';
import RegimeExperimentalPainel from '@/components/comissionamento/RegimeExperimentalPainel';
import { agruparPorUsuario, competenciaAtual, competenciaLabel, brl } from '@/components/comissionamento/scorecardUtils';

function ultimasCompetencias(n = 6) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(new Date(d.getFullYear(), d.getMonth() - i, 1).toISOString().slice(0, 7));
  }
  return out;
}

export default function Comissionamento() {
  const qc = useQueryClient();
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [calculando, setCalculando] = useState(false);
  const [iniciandoRegime, setIniciandoRegime] = useState(false);

  const { data: currentUser } = useQuery({ queryKey: ['me-comissao'], queryFn: () => base44.auth.me() });
  const isAdmin = currentUser?.role === 'admin';

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores-comissao'],
    queryFn: () => base44.entities.Vendedor.list('-created_date', 5000)
  });

  const { data: apuracoes = [], isLoading } = useQuery({
    queryKey: ['scorecard', competencia],
    queryFn: () => base44.entities.ScorecardApuracao.filter({ competencia }, '-pontos_ranking', 50000)
  });

  const { data: regimes = [] } = useQuery({
    queryKey: ['regime-experimental'],
    queryFn: () => base44.entities.RegimeExperimental.list('-created_date', 50)
  });

  const usuarios = useMemo(() => agruparPorUsuario(apuracoes), [apuracoes]);
  const ranking = useMemo(() => [...usuarios].sort((a, b) => b.pontos - a.pontos), [usuarios]);

  const funcionarioAtual = useMemo(() => {
    if (!currentUser) return null;
    return vendedores.find(v => v.email?.toLowerCase() === currentUser.email?.toLowerCase());
  }, [vendedores, currentUser]);

  const meuScorecard = funcionarioAtual ? usuarios.find(u => u.usuario_id === funcionarioAtual.id) : null;
  const minhaPosicao = meuScorecard ? ranking.findIndex(u => u.usuario_id === meuScorecard.usuario_id) + 1 : 0;

  const totalOficial = usuarios.reduce((s, u) => s + u.comissao_oficial, 0);
  const totalExperimental = usuarios.reduce((s, u) => s + u.comissao_experimental, 0);

  const recalcular = async () => {
    setCalculando(true);
    try {
      const r = await base44.functions.invoke('calcularScorecard', { competencia });
      if (r.data?.error) throw new Error(r.data.error);
      toast.success(`Apuração concluída: ${r.data.vendedores_apurados} avaliados`);
      qc.invalidateQueries({ queryKey: ['scorecard', competencia] });
    } catch (e) {
      toast.error('Falha ao calcular: ' + e.message);
    } finally {
      setCalculando(false);
    }
  };

  const iniciarRegime = async () => {
    setIniciandoRegime(true);
    try {
      const r = await base44.functions.invoke('iniciarRegimeExperimental', {});
      if (r.data?.error) throw new Error(r.data.error);
      toast.success(`Regime iniciado (${r.data.criados} parâmetro(s))`);
      qc.invalidateQueries({ queryKey: ['regime-experimental'] });
    } catch (e) {
      toast.error('Falha: ' + e.message);
    } finally {
      setIniciandoRegime(false);
    }
  };

  const seletorCompetencia = (
    <div className="flex items-center gap-2">
      <Select value={competencia} onValueChange={setCompetencia}>
        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          {ultimasCompetencias().map(c => <SelectItem key={c} value={c}>{competenciaLabel(c)}</SelectItem>)}
        </SelectContent>
      </Select>
      {isAdmin && (
        <Button onClick={recalcular} disabled={calculando}>
          {calculando ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Calculator className="w-4 h-4 mr-1" />}
          Recalcular
        </Button>
      )}
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <PageHeader
          icon={Award}
          title="Comissionamento & Gamificação"
          subtitle="Scorecard por desempenho"
        />
        {seletorCompetencia}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-7 h-7 animate-spin text-slate-300" /></div>
      ) : (
        <Tabs defaultValue={isAdmin ? 'gestao' : 'meu'} className="space-y-4">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="meu"><Trophy className="w-4 h-4 mr-1" /> Meu Scorecard</TabsTrigger>
            {isAdmin && <TabsTrigger value="gestao"><Trophy className="w-4 h-4 mr-1" /> Equipe & Ranking</TabsTrigger>}
            {isAdmin && <TabsTrigger value="regime"><FlaskConical className="w-4 h-4 mr-1" /> Regime Experimental</TabsTrigger>}
            {isAdmin && <TabsTrigger value="config"><Settings2 className="w-4 h-4 mr-1" /> Parâmetros</TabsTrigger>}
          </TabsList>

          <TabsContent value="meu">
            <PainelVendedor usuario={meuScorecard} posicaoRanking={minhaPosicao} />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="gestao" className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card className="border-emerald-200 bg-emerald-50/50"><CardContent className="p-4">
                  <p className="text-xs font-semibold uppercase text-emerald-700">Comissão Oficial (total)</p>
                  <p className="text-2xl font-bold text-emerald-700">{brl(totalOficial)}</p>
                </CardContent></Card>
                <Card className="border-amber-200 bg-amber-50/50"><CardContent className="p-4">
                  <p className="text-xs font-semibold uppercase text-amber-700">Experimental (total)</p>
                  <p className="text-2xl font-bold text-amber-700">{brl(totalExperimental)}</p>
                </CardContent></Card>
                <Card><CardContent className="p-4">
                  <p className="text-xs font-semibold uppercase text-slate-500">Avaliados</p>
                  <p className="text-2xl font-bold text-slate-700">{usuarios.length}</p>
                </CardContent></Card>
              </div>
              <RankingEquipe usuarios={usuarios} titulo="Ranking de Comissão" />
            </TabsContent>
          )}

          {isAdmin && (
            <TabsContent value="regime">
              <RegimeExperimentalPainel regimes={regimes} onIniciar={iniciarRegime} iniciando={iniciandoRegime} />
            </TabsContent>
          )}

          {isAdmin && (
            <TabsContent value="config" className="space-y-4">
              <GerenciarMetas />
              <GerenciarMapeamentoTrocas />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}