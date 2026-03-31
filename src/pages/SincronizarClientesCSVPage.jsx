import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Loader2, Play, CheckCircle, AlertTriangle, Trash2, RefreshCw, Plus } from 'lucide-react';

const CSV_URL = "https://media.base44.com/files/public/6926e3c1dcadc4e314506362/8de60fb07_Book13OFICIAL1.csv";
const BATCH_SIZE = 500;
const DELAY_ENTRE_LOTES = 3000;

export default function SincronizarClientesCSVPage() {
  const [status, setStatus] = useState('idle'); // idle, analisando, atualizando, criando, excluindo, concluido
  const [analise, setAnalise] = useState(null);
  const [progresso, setProgresso] = useState({ etapa: '', atual: 0, total: 0, erros: 0 });
  const [logs, setLogs] = useState([]);
  const [errosDetalhes, setErrosDetalhes] = useState([]);
  const cancelRef = useRef(false);
  const lastOffsetRef = useRef(0);

  const addLog = (msg) => setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const rodarAnalise = async () => {
    setStatus('analisando');
    setLogs([]);
    setErrosDetalhes([]);
    addLog('Iniciando análise...');
    const res = await base44.functions.invoke('sincronizarClientesCSV', { csv_url: CSV_URL, etapa: 'analise' });
    setAnalise(res.data);
    addLog(`Análise concluída: ${res.data.atualizar} atualizar, ${res.data.criar} criar, ${res.data.excluir} excluir`);
    setStatus('idle');
  };

  const rodarAtualizacao = async (startOffset = 0) => {
    cancelRef.current = false;
    setStatus('atualizando');
    if (startOffset === 0) setErrosDetalhes([]);
    let offset = startOffset;
    let totalProcessados = startOffset;
    let totalErros = 0;
    const total = analise?.atualizar || 0;
    setProgresso({ etapa: 'Atualizando clientes', atual: totalProcessados, total, erros: 0 });
    addLog(`Iniciando atualização de ${total} clientes (offset: ${startOffset})...`);

    while (offset < total && !cancelRef.current) {
      try {
        const res = await base44.functions.invoke('sincronizarClientesCSV', {
          csv_url: CSV_URL, etapa: 'atualizar', offset, batch_size: BATCH_SIZE
        });
        const d = res.data;
        totalProcessados += d.processados;
        totalErros += d.erros;
        if (d.erros_detalhes?.length) setErrosDetalhes(prev => [...prev, ...d.erros_detalhes]);
        setProgresso({ etapa: 'Atualizando clientes', atual: totalProcessados, total, erros: totalErros });
        addLog(`Lote ${offset}-${offset + BATCH_SIZE}: ${d.processados} ok, ${d.erros} erros`);
        lastOffsetRef.current = d.nextOffset || offset + BATCH_SIZE;

        if (d.concluido) break;
        offset = d.nextOffset;
      } catch (err) {
        addLog(`Erro no lote ${offset}: ${err.message}. Aguardando 10s e tentando novamente...`);
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }

      // Delay entre lotes para evitar rate limit
      await new Promise(r => setTimeout(r, DELAY_ENTRE_LOTES));
    }
    addLog(cancelRef.current ? `Pausado em offset ${offset}. Clique "Continuar" para retomar.` : `Atualização concluída: ${totalProcessados} ok, ${totalErros} erros`);
    setStatus('idle');
  };

  const rodarCriacao = async () => {
    cancelRef.current = false;
    setStatus('criando');
    setErrosDetalhes([]);
    let offset = 0;
    let totalProcessados = 0;
    let totalErros = 0;
    const total = analise?.criar || 0;
    setProgresso({ etapa: 'Criando clientes', atual: 0, total, erros: 0 });
    addLog(`Iniciando criação de ${total} clientes...`);

    while (offset < total && !cancelRef.current) {
      try {
        const res = await base44.functions.invoke('sincronizarClientesCSV', {
          csv_url: CSV_URL, etapa: 'criar', offset, batch_size: BATCH_SIZE
        });
        const d = res.data;
        totalProcessados += d.processados;
        totalErros += d.erros;
        if (d.erros_detalhes?.length) setErrosDetalhes(prev => [...prev, ...d.erros_detalhes]);
        setProgresso({ etapa: 'Criando clientes', atual: totalProcessados, total, erros: totalErros });
        addLog(`Lote criar ${offset}-${offset + BATCH_SIZE}: ${d.processados} ok, ${d.erros} erros`);

        if (d.concluido) break;
        offset = d.nextOffset;
      } catch (err) {
        addLog(`Erro no lote ${offset}: ${err.message}. Aguardando 10s...`);
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
      await new Promise(r => setTimeout(r, DELAY_ENTRE_LOTES));
    }
    addLog(cancelRef.current ? `Criação pausada em offset ${offset}.` : `Criação concluída: ${totalProcessados} ok, ${totalErros} erros`);
    setStatus('idle');
  };

  const rodarExclusao = async () => {
    cancelRef.current = false;
    setStatus('excluindo');
    let offset = 0;
    let totalProcessados = 0;
    let totalErros = 0;
    const total = analise?.excluir || 0;
    setProgresso({ etapa: 'Excluindo clientes', atual: 0, total, erros: 0 });
    addLog(`Iniciando exclusão de ${total} clientes...`);

    while (offset < total && !cancelRef.current) {
      try {
        const res = await base44.functions.invoke('sincronizarClientesCSV', {
          csv_url: CSV_URL, etapa: 'excluir', offset, batch_size: 50
        });
        const d = res.data;
        totalProcessados += d.processados;
        totalErros += d.erros;
        if (d.erros_detalhes?.length) setErrosDetalhes(prev => [...prev, ...d.erros_detalhes]);
        setProgresso({ etapa: 'Excluindo clientes', atual: totalProcessados + totalErros, total, erros: totalErros });
        addLog(`Lote excluir ${offset}-${offset + 50}: ${d.processados} ok, ${d.erros} erros`);

        if (d.concluido) break;
        offset = d.nextOffset;
      } catch (err) {
        addLog(`Erro no lote ${offset}: ${err.message}. Aguardando 10s...`);
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
      await new Promise(r => setTimeout(r, DELAY_ENTRE_LOTES));
    }
    addLog(`Exclusão concluída: ${totalProcessados} ok, ${totalErros} erros`);
    setStatus('idle');
  };

  const cancelar = () => { cancelRef.current = true; addLog('Cancelamento solicitado...'); };

  const running = status === 'atualizando' || status === 'criando' || status === 'excluindo' || status === 'analisando';
  const pct = progresso.total > 0 ? Math.round((progresso.atual / progresso.total) * 100) : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Sincronizar Clientes via CSV</h1>

      {/* Ações */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={rodarAnalise} disabled={running}>
          {status === 'analisando' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Analisar
        </Button>
        <Button onClick={() => rodarAtualizacao(0)} disabled={running || !analise} className="bg-blue-600 hover:bg-blue-700 text-white">
          {status === 'atualizando' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
          Atualizar ({analise?.atualizar || 0})
        </Button>
        <Button onClick={rodarCriacao} disabled={running || !analise || !(analise?.criar > 0)} className="bg-green-600 hover:bg-green-700 text-white">
          {status === 'criando' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
          Criar ({analise?.criar || 0})
        </Button>
        {lastOffsetRef.current > 0 && status === 'idle' && (
          <Button onClick={() => rodarAtualizacao(lastOffsetRef.current)} className="bg-amber-500 hover:bg-amber-600 text-white">
            <Play className="w-4 h-4 mr-2" />
            Continuar ({lastOffsetRef.current})
          </Button>
        )}
        <Button onClick={rodarExclusao} disabled={running || !analise} variant="destructive">
          {status === 'excluindo' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
          Excluir ({analise?.excluir || 0})
        </Button>
        {running && <Button variant="outline" onClick={cancelar}>Cancelar</Button>}
      </div>

      {/* Análise */}
      {analise && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Resultado da Análise</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
            <div><span className="text-slate-500">CSV:</span> <Badge variant="outline">{analise.csv_total}</Badge></div>
            <div><span className="text-slate-500">Sistema:</span> <Badge variant="outline">{analise.sistema_total}</Badge></div>
            <div><span className="text-slate-500">Atualizar:</span> <Badge className="bg-blue-500">{analise.atualizar}</Badge></div>
            <div><span className="text-slate-500">Criar:</span> <Badge className="bg-green-500">{analise.criar}</Badge></div>
            <div><span className="text-slate-500">Excluir:</span> <Badge className="bg-red-500 text-white">{analise.excluir}</Badge></div>
          </CardContent>
        </Card>
      )}

      {/* Progresso */}
      {(status === 'atualizando' || status === 'criando' || status === 'excluindo') && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>{progresso.etapa}</span>
              <span>{progresso.atual}/{progresso.total} ({pct}%) - {progresso.erros} erros</span>
            </div>
            <Progress value={pct} />
          </CardContent>
        </Card>
      )}

      {/* Logs */}
      {logs.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Logs</CardTitle></CardHeader>
          <CardContent>
            <div className="max-h-60 overflow-y-auto bg-slate-900 text-green-400 p-3 rounded text-xs font-mono space-y-0.5">
              {logs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Erros */}
      {errosDetalhes.length > 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1">
              <AlertTriangle className="w-4 h-4 text-red-500" /> Erros ({errosDetalhes.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-60 overflow-y-auto space-y-1">
              {errosDetalhes.map((e, i) => (
                <div key={i} className="text-xs bg-red-50 border border-red-200 rounded px-3 py-2 text-red-700">
                  {e}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}