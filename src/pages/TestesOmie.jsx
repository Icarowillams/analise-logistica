import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Play, RefreshCw, FlaskConical, Globe, AlertTriangle } from 'lucide-react';
import TestResultsList from '@/components/testes/TestResultsList';
import TestSummary from '@/components/testes/TestSummary';
import { buildSuiteLogicaPura } from '@/components/testes/suites/suiteLogicaPura';
import { buildSuiteIntegracaoOmie } from '@/components/testes/suites/suiteIntegracaoOmie';

export default function TestesOmie() {
  const [puraResults, setPuraResults] = useState([]);
  const [puraSummary, setPuraSummary] = useState(null);
  const [puraRunning, setPuraRunning] = useState(false);
  const [puraIndex, setPuraIndex] = useState(-1);

  const [integResults, setIntegResults] = useState([]);
  const [integSummary, setIntegSummary] = useState(null);
  const [integRunning, setIntegRunning] = useState(false);
  const [integIndex, setIntegIndex] = useState(-1);

  const rodarPura = async () => {
    setPuraRunning(true);
    setPuraResults([]);
    setPuraSummary(null);
    const suite = buildSuiteLogicaPura();
    const summary = await suite.run(({ index, current }) => {
      setPuraIndex(index);
      setPuraResults(prev => [...prev, current]);
    });
    setPuraSummary(summary);
    setPuraRunning(false);
    setPuraIndex(-1);
  };

  const rodarIntegracao = async () => {
    setIntegRunning(true);
    setIntegResults([]);
    setIntegSummary(null);
    const suite = buildSuiteIntegracaoOmie();
    const summary = await suite.run(({ index, current }) => {
      setIntegIndex(index);
      setIntegResults(prev => [...prev, current]);
    });
    setIntegSummary(summary);
    setIntegRunning(false);
    setIntegIndex(-1);
  };

  const totalPura = buildSuiteLogicaPura().count();
  const totalInteg = buildSuiteIntegracaoOmie().count();

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
            <FlaskConical className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900">Testes Omie</h1>
            <p className="text-sm text-neutral-500">
              Suíte completa de validação da integração — {totalPura} testes de lógica pura + {totalInteg} testes de integração real
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="pura" className="space-y-4">
        <TabsList className="grid grid-cols-2 w-full max-w-md">
          <TabsTrigger value="pura" className="gap-2">
            <FlaskConical className="w-4 h-4" /> Lógica Pura ({totalPura})
          </TabsTrigger>
          <TabsTrigger value="integracao" className="gap-2">
            <Globe className="w-4 h-4" /> Integração Real ({totalInteg})
          </TabsTrigger>
        </TabsList>

        {/* Lógica Pura */}
        <TabsContent value="pura" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FlaskConical className="w-5 h-5 text-violet-600" />
                  Lógica Pura
                </CardTitle>
                <p className="text-sm text-slate-500 mt-1">
                  Validações, normalizações, formatadores, regras de preço e bloqueio financeiro. Sem chamadas externas.
                </p>
              </div>
              <Button onClick={rodarPura} disabled={puraRunning} className="bg-violet-600 hover:bg-violet-700">
                {puraRunning ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                {puraRunning ? 'Executando…' : 'Executar testes'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {puraSummary && <TestSummary summary={puraSummary} />}
              <TestResultsList results={puraResults} running={puraRunning} currentIndex={puraIndex} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Integração Real */}
        <TabsContent value="integracao" className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 items-start text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-amber-900">
              <strong>Modo seguro:</strong> todos os testes desta aba são <strong>somente leitura</strong>.
              Nenhum cliente, produto ou pedido é criado, alterado ou excluído. A execução pode levar alguns minutos
              dependendo da resposta da API Omie.
            </div>
          </div>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="w-5 h-5 text-blue-600" />
                  Integração Real
                </CardTitle>
                <p className="text-sm text-slate-500 mt-1">
                  Chama as backend functions reais e valida payload, conexão Omie e respostas das listagens.
                </p>
              </div>
              <Button onClick={rodarIntegracao} disabled={integRunning} className="bg-blue-600 hover:bg-blue-700">
                {integRunning ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                {integRunning ? 'Executando…' : 'Executar testes'}
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {integSummary && <TestSummary summary={integSummary} />}
              <TestResultsList results={integResults} running={integRunning} currentIndex={integIndex} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}