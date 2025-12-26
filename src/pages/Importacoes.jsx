import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { 
  Download, Database, CheckCircle, Clock, TrendingUp, 
  Package, ArrowLeftRight, Eye, Info, Loader2, AlertCircle
} from 'lucide-react';
import StatsCard from '@/components/ui/StatsCard';

export default function Importacoes() {
  const [testando, setTestando] = useState(false);
  const [resultadoTeste, setResultadoTeste] = useState(null);
  const [progresso, setProgresso] = useState(0);
  const [statusAtual, setStatusAtual] = useState('');
  const [removendoDuplicatas, setRemovendoDuplicatas] = useState(false);
  const queryClient = useQueryClient();

  const { data: configs = [] } = useQuery({
    queryKey: ['configuracoes'],
    queryFn: () => base44.entities.ConfiguracaoImportacao.list()
  });

  const { data: visitas = [] } = useQuery({
    queryKey: ['relatorioVisitas'],
    queryFn: () => base44.entities.RelatorioVisita.list('-data_visita', 100)
  });

  const { data: estoques = [] } = useQuery({
    queryKey: ['relatorioEstoques'],
    queryFn: () => base44.entities.RelatorioEstoque.list('-data_registro', 100)
  });

  const { data: trocas = [] } = useQuery({
    queryKey: ['relatorioTrocas'],
    queryFn: () => base44.entities.RelatorioTroca.list('-data_registro', 100)
  });

  const importarAgora = async () => {
    setTestando(true);
    setResultadoTeste(null);
    setProgresso(0);
    setStatusAtual('Iniciando importação...');

    // Simular progresso enquanto importa
    const interval = setInterval(() => {
      setProgresso(prev => {
        if (prev >= 95) return prev;
        return prev + 5;
      });
    }, 2000);

    // Status simulado
    setTimeout(() => setStatusAtual('Buscando visitas do Gestor Visita...'), 1000);
    setTimeout(() => setStatusAtual('Buscando estoques e trocas...'), 8000);
    setTimeout(() => setStatusAtual('Processando dados de visitas...'), 15000);
    setTimeout(() => setStatusAtual('Importando estoques em lotes...'), 30000);
    setTimeout(() => setStatusAtual('Importando trocas em lotes...'), 50000);
    setTimeout(() => setStatusAtual('Finalizando importação...'), 70000);

    try {
      const response = await base44.functions.invoke('importarVisitasGestorVisita', {});
      clearInterval(interval);
      setProgresso(100);
      setStatusAtual('Importação concluída!');
      setResultadoTeste({
        success: true,
        data: response.data
      });
    } catch (error) {
      clearInterval(interval);
      setProgresso(0);
      setStatusAtual('Erro na importação');
      setResultadoTeste({
        success: false,
        error: error.message
      });
    } finally {
      setTestando(false);
    }
  };

  const configAtiva = configs.find(c => c.status === 'ativo') || configs[0];

  const removerDuplicatasGestorVisita = async () => {
    if (!confirm('Deseja identificar e remover registros duplicados do Gestor Visita?\n\nSerá mantida apenas a primeira ocorrência de cada registro.\n\nCritério: origem_app_id + origem_visita_id/estoque_id/troca_id')) {
      return;
    }

    setRemovendoDuplicatas(true);
    try {
      let totalRemovido = 0;

      // 1. Remover duplicatas de Visitas
      const todasVisitas = await base44.entities.RelatorioVisita.list('-created_date', 10000);
      const visitasMap = new Map();
      const visitasParaRemover = [];
      
      todasVisitas.forEach(visita => {
        const chave = `${visita.origem_app_id}|${visita.origem_visita_id}`;
        if (visitasMap.has(chave)) {
          visitasParaRemover.push(visita.id);
        } else {
          visitasMap.set(chave, visita.id);
        }
      });

      // 2. Remover duplicatas de Estoques
      const todosEstoques = await base44.entities.RelatorioEstoque.list('-created_date', 10000);
      const estoquesMap = new Map();
      const estoquesParaRemover = [];
      
      todosEstoques.forEach(estoque => {
        const chave = `${estoque.origem_app_id}|${estoque.origem_estoque_id}`;
        if (estoquesMap.has(chave)) {
          estoquesParaRemover.push(estoque.id);
        } else {
          estoquesMap.set(chave, estoque.id);
        }
      });

      // 3. Remover duplicatas de Trocas
      const todasTrocas = await base44.entities.RelatorioTroca.list('-created_date', 10000);
      const trocasMap = new Map();
      const trocasParaRemover = [];
      
      todasTrocas.forEach(troca => {
        const chave = `${troca.origem_app_id}|${troca.origem_troca_id}`;
        if (trocasMap.has(chave)) {
          trocasParaRemover.push(troca.id);
        } else {
          trocasMap.set(chave, troca.id);
        }
      });

      const totalDuplicatas = visitasParaRemover.length + estoquesParaRemover.length + trocasParaRemover.length;

      if (totalDuplicatas === 0) {
        alert('✅ Nenhuma duplicata encontrada!');
        setRemovendoDuplicatas(false);
        return;
      }

      if (!confirm(`Encontradas ${totalDuplicatas} duplicatas:\n• ${visitasParaRemover.length} visitas\n• ${estoquesParaRemover.length} estoques\n• ${trocasParaRemover.length} trocas\n\nDeseja realmente excluir?`)) {
        setRemovendoDuplicatas(false);
        return;
      }

      // Remover em lotes
      const BATCH_SIZE = 50;
      const removerEmLotes = async (ids, entidade) => {
        for (let i = 0; i < ids.length; i += BATCH_SIZE) {
          const batch = ids.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(id => base44.entities[entidade].delete(id)));
          totalRemovido += batch.length;
          if (i + BATCH_SIZE < ids.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      };

      await removerEmLotes(visitasParaRemover, 'RelatorioVisita');
      await removerEmLotes(estoquesParaRemover, 'RelatorioEstoque');
      await removerEmLotes(trocasParaRemover, 'RelatorioTroca');

      queryClient.invalidateQueries(['relatorioVisitas']);
      queryClient.invalidateQueries(['relatorioEstoques']);
      queryClient.invalidateQueries(['relatorioTrocas']);
      queryClient.invalidateQueries(['configuracoes']);

      alert(`✅ Limpeza concluída!\n\n${totalRemovido} registros duplicados removidos:\n• ${visitasParaRemover.length} visitas\n• ${estoquesParaRemover.length} estoques\n• ${trocasParaRemover.length} trocas`);
    } catch (error) {
      alert('Erro ao remover duplicatas: ' + error.message);
    } finally {
      setRemovendoDuplicatas(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
          <Database className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Importações Gestor Visita</h1>
          <p className="text-slate-500">Recebimento e análise de dados de visitas</p>
        </div>
      </div>

      {/* Alerta de Duplicatas */}
      <Alert className="bg-red-50 border-red-200">
        <AlertCircle className="h-4 w-4 text-red-600" />
        <AlertDescription className="flex items-center justify-between">
          <span className="text-red-800">
            <strong>Duplicatas?</strong> Remover registros duplicados do Gestor Visita automaticamente
          </span>
          <Button 
            onClick={removerDuplicatasGestorVisita}
            disabled={removendoDuplicatas}
            size="sm"
            className="bg-red-600 hover:bg-red-700"
          >
            {removendoDuplicatas ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processando...
              </>
            ) : (
              'Remover Duplicatas'
            )}
          </Button>
        </AlertDescription>
      </Alert>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatsCard
          title="Visitas Importadas"
          value={configAtiva?.total_visitas_importadas || 0}
          subtitle="total acumulado"
          icon={Eye}
          gradient="from-blue-500 to-indigo-600"
        />
        <StatsCard
          title="Estoques Registrados"
          value={configAtiva?.total_estoques_importados || 0}
          subtitle="total acumulado"
          icon={Package}
          gradient="from-emerald-500 to-teal-600"
        />
        <StatsCard
          title="Trocas Importadas"
          value={configAtiva?.total_trocas_importadas || 0}
          subtitle="total acumulado"
          icon={ArrowLeftRight}
          gradient="from-orange-500 to-red-600"
        />
      </div>

      {/* Info e Teste de Conexão */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="w-5 h-5" />
              Informações da API
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm font-medium text-slate-700">Modo:</p>
              <Badge className="mt-1 bg-blue-100 text-blue-700">
                Busca Automática no Gestor Visita
              </Badge>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">Status:</p>
              <Badge className={configAtiva?.status === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'}>
                {configAtiva?.status || 'Não configurado'}
              </Badge>
            </div>
            {configAtiva?.ultima_importacao && (
              <div>
                <p className="text-sm font-medium text-slate-700">Última importação:</p>
                <p className="text-sm text-slate-600 mt-1">
                  {new Date(configAtiva.ultima_importacao).toLocaleString('pt-BR')}
                </p>
              </div>
            )}
            <Button 
              onClick={importarAgora} 
              disabled={testando}
              className="w-full mt-4 bg-gradient-to-r from-blue-500 to-indigo-600"
            >
              {testando ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importando...
                </>
              ) : 'Importar Agora'}
            </Button>
            
            {testando && (
              <div className="mt-4 space-y-3">
                <Progress value={progresso} className="h-2" />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{statusAtual}</span>
                  <span className="font-semibold text-blue-600">{progresso}%</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle>Dados Recentes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-blue-900">Visitas</p>
                <p className="text-xs text-blue-700">Últimas 24h</p>
              </div>
              <span className="text-2xl font-bold text-blue-600">{visitas.length}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-emerald-900">Estoques</p>
                <p className="text-xs text-emerald-700">Últimas 24h</p>
              </div>
              <span className="text-2xl font-bold text-emerald-600">{estoques.length}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-orange-900">Trocas</p>
                <p className="text-xs text-orange-700">Últimas 24h</p>
              </div>
              <span className="text-2xl font-bold text-orange-600">{trocas.length}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Resultado do Teste */}
      {resultadoTeste && (
        <Alert className={resultadoTeste.success ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}>
          <div className="flex items-start gap-3">
            {resultadoTeste.success ? (
              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
            ) : (
              <Clock className="w-5 h-5 text-red-600 mt-0.5" />
            )}
            <AlertDescription>
              {resultadoTeste.success ? (
                <div className="space-y-3">
                  <p className="font-semibold text-green-800">✅ Importação concluída com sucesso!</p>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="bg-white p-3 rounded border border-green-200">
                      <p className="text-xs text-slate-600">Visitas Buscadas</p>
                      <p className="text-lg font-bold text-blue-600">{resultadoTeste.data?.total_visitas_buscadas || 0}</p>
                      <p className="text-xs text-green-700">Importadas: {resultadoTeste.data?.visitas_importadas || 0}</p>
                    </div>
                    <div className="bg-white p-3 rounded border border-green-200">
                      <p className="text-xs text-slate-600">Estoques Buscados</p>
                      <p className="text-lg font-bold text-emerald-600">{resultadoTeste.data?.total_estoques_buscados || 0}</p>
                      <p className="text-xs text-green-700">Importados: {resultadoTeste.data?.estoques_importados || 0}</p>
                    </div>
                    <div className="bg-white p-3 rounded border border-green-200">
                      <p className="text-xs text-slate-600">Trocas Buscadas</p>
                      <p className="text-lg font-bold text-orange-600">{resultadoTeste.data?.total_trocas_buscadas || 0}</p>
                      <p className="text-xs text-green-700">Importadas: {resultadoTeste.data?.trocas_importadas || 0}</p>
                    </div>
                  </div>
                  {resultadoTeste.data?.erros && resultadoTeste.data.erros.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer font-medium text-orange-700">
                        {resultadoTeste.data.erros.length} erro(s) encontrado(s) - clique para ver
                      </summary>
                      <pre className="mt-2 bg-white p-2 rounded border border-orange-200 overflow-auto max-h-40">
                        {JSON.stringify(resultadoTeste.data.erros, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-red-800">Erro ao importar dados</p>
                  <p className="text-sm text-red-700 mt-1">{resultadoTeste.error}</p>
                </div>
              )}
            </AlertDescription>
          </div>
        </Alert>
      )}

      {/* Últimas Visitas */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle>Últimas Visitas Importadas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left p-3 text-sm font-semibold text-slate-700">Cliente</th>
                  <th className="text-left p-3 text-sm font-semibold text-slate-700">Promotor</th>
                  <th className="text-left p-3 text-sm font-semibold text-slate-700">Data</th>
                  <th className="text-center p-3 text-sm font-semibold text-slate-700">Status</th>
                  <th className="text-center p-3 text-sm font-semibold text-slate-700">Pedido</th>
                </tr>
              </thead>
              <tbody>
                {visitas.slice(0, 10).map((visita, idx) => (
                  <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-3 text-sm">
                      <div className="font-medium text-slate-900">{visita.cliente_nome}</div>
                      <div className="text-xs text-slate-500">{visita.cliente_codigo}</div>
                    </td>
                    <td className="p-3 text-sm text-slate-700">
                      {visita.promotor_nome || 'N/A'}
                    </td>
                    <td className="p-3 text-sm text-slate-700">
                      {new Date(visita.data_visita).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="p-3 text-center">
                      <Badge className={
                        visita.status === 'realizada' ? 'bg-green-100 text-green-700' :
                        visita.status === 'nao_realizada' ? 'bg-red-100 text-red-700' :
                        'bg-yellow-100 text-yellow-700'
                      }>
                        {visita.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-center">
                      {visita.pedido_solicitado ? (
                        <CheckCircle className="w-5 h-5 text-green-600 mx-auto" />
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}