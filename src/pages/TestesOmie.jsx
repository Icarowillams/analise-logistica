import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Play, RefreshCw, FlaskConical, Globe, AlertTriangle, Database, ShieldCheck, Truck, UserCheck, Rocket } from 'lucide-react';
import TestResultsList from '@/components/testes/TestResultsList';
import TestSummary from '@/components/testes/TestSummary';
import { buildSuiteLogicaPura } from '@/components/testes/suites/suiteLogicaPura';
import { buildSuiteIntegracaoOmie } from '@/components/testes/suites/suiteIntegracaoOmie';
import { buildSuiteFluxosUsuario } from '@/components/testes/suites/suiteFluxosUsuario';
import { buildSuiteEntidades } from '@/components/testes/suites/suiteEntidades';
import { buildSuiteValidacaoCadastros } from '@/components/testes/suites/suiteValidacaoCadastros';
import { buildSuiteCargasETransferencia } from '@/components/testes/suites/suiteCargasETransferencia';
import { buildSuitePermissoesEUI } from '@/components/testes/suites/suitePermissoesEUI';

const SUITES = [
  { key: 'pura', label: 'Lógica Pura', icon: FlaskConical, color: 'violet', build: buildSuiteLogicaPura, desc: 'Validações, normalizações e regras puras de negócio. Sem chamadas externas.' },
  { key: 'cadastros', label: 'Validação de Cadastros', icon: ShieldCheck, color: 'cyan', build: buildSuiteValidacaoCadastros, desc: 'CPF, CNPJ, CEP, UF, datas, truncamentos — o que o usuário digita errado.' },
  { key: 'fluxos', label: 'Fluxos do Usuário', icon: UserCheck, color: 'emerald', build: buildSuiteFluxosUsuario, desc: 'Jornadas ponta-a-ponta: vender, faturar, bloquear, montar carga, etc.' },
  { key: 'cargas', label: 'Cargas & Logística', icon: Truck, color: 'orange', build: buildSuiteCargasETransferencia, desc: 'Montagem, transferência, capacidade do veículo, fechamento.' },
  { key: 'entidades', label: 'Integridade de Dados', icon: Database, color: 'amber', build: buildSuiteEntidades, desc: 'Lê o banco e detecta órfãos, duplicatas e inconsistências reais.', requireBackend: true },
  { key: 'permissoes', label: 'Permissões & UI', icon: ShieldCheck, color: 'indigo', build: buildSuitePermissoesEUI, desc: 'Auth, roles, listagens e navegação.', requireBackend: true },
  { key: 'integracao', label: 'Integração Real Omie', icon: Globe, color: 'blue', build: buildSuiteIntegracaoOmie, desc: 'Chama as backend functions reais e a API Omie em modo somente-leitura.', requireBackend: true }
];

function SuiteCard({ suite, state, onRun }) {
  const Icon = suite.icon;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Icon className={`w-5 h-5 text-${suite.color}-600`} />
            {suite.label}
          </CardTitle>
          <p className="text-sm text-slate-500 mt-1">{suite.desc}</p>
        </div>
        <Button onClick={onRun} disabled={state.running} className={`bg-${suite.color}-600 hover:bg-${suite.color}-700`}>
          {state.running ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
          {state.running ? 'Executando…' : 'Executar'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {suite.requireBackend && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 items-start text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-amber-900">
              <strong>Modo seguro:</strong> testes somente-leitura. Nada é criado, alterado ou excluído.
            </div>
          </div>
        )}
        {state.summary && <TestSummary summary={state.summary} />}
        <TestResultsList results={state.results} running={state.running} currentIndex={state.index} />
      </CardContent>
    </Card>
  );
}

export default function TestesOmie() {
  const [states, setStates] = useState(() =>
    SUITES.reduce((acc, s) => ({ ...acc, [s.key]: { results: [], summary: null, running: false, index: -1 } }), {})
  );
  const [allRunning, setAllRunning] = useState(false);
  const [globalSummary, setGlobalSummary] = useState(null);

  const totals = useMemo(() => {
    return SUITES.map(s => ({ key: s.key, count: s.build().count() }));
  }, []);

  const totalGeral = totals.reduce((acc, t) => acc + t.count, 0);

  const updateSuite = (key, patch) => {
    setStates(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const runSuite = async (key) => {
    const cfg = SUITES.find(s => s.key === key);
    updateSuite(key, { running: true, results: [], summary: null, index: -1 });
    const suite = cfg.build();
    const summary = await suite.run(({ index, current }) => {
      setStates(prev => ({
        ...prev,
        [key]: { ...prev[key], index, results: [...prev[key].results, current] }
      }));
    });
    updateSuite(key, { running: false, summary, index: -1 });
    return summary;
  };

  const runAll = async () => {
    setAllRunning(true);
    setGlobalSummary(null);
    let totalPassed = 0;
    let totalFailed = 0;
    let totalCount = 0;
    for (const cfg of SUITES) {
      const summary = await runSuite(cfg.key);
      if (summary) {
        totalPassed += summary.passed;
        totalFailed += summary.failed;
        totalCount += summary.total;
      }
    }
    setGlobalSummary({ name: 'TODAS AS SUÍTES', total: totalCount, passed: totalPassed, failed: totalFailed, results: [] });
    setAllRunning(false);
  };

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 p-4 shadow-sm gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
            <FlaskConical className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Testes do Sistema</h1>
            <p className="text-sm text-neutral-500">
              {SUITES.length} suítes · {totalGeral} testes cobrindo cadastros, fluxos, integração Omie, cargas, dados e permissões
            </p>
          </div>
        </div>
        <Button
          onClick={runAll}
          disabled={allRunning}
          size="lg"
          className="bg-gradient-to-r from-violet-600 to-purple-700 hover:from-violet-700 hover:to-purple-800 text-white shadow-lg"
        >
          {allRunning ? <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> : <Rocket className="w-5 h-5 mr-2" />}
          {allRunning ? 'Rodando todas as suítes…' : `Executar TODOS (${totalGeral} testes)`}
        </Button>
      </div>

      {globalSummary && (
        <Card className="border-2 border-purple-300">
          <CardHeader>
            <CardTitle className="text-purple-900">Resumo Geral</CardTitle>
          </CardHeader>
          <CardContent>
            <TestSummary summary={globalSummary} />
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="pura" className="space-y-4">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 w-full h-auto">
          {SUITES.map(s => {
            const Icon = s.icon;
            const total = totals.find(t => t.key === s.key)?.count || 0;
            return (
              <TabsTrigger key={s.key} value={s.key} className="gap-1.5 text-xs flex-col py-2 h-auto">
                <Icon className="w-4 h-4" />
                <span>{s.label}</span>
                <span className="text-[10px] text-slate-500">({total})</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {SUITES.map(s => (
          <TabsContent key={s.key} value={s.key} className="space-y-4">
            <SuiteCard suite={s} state={states[s.key]} onRun={() => runSuite(s.key)} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}