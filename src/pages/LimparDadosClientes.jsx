import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Trash2, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

export default function LimparDadosClientes() {
  const [status, setStatus] = useState('idle'); // idle, loading, done
  const [progresso, setProgresso] = useState({ total: 0, processados: 0, erros: 0 });
  const [log, setLog] = useState([]);

  const addLog = (msg) => setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const iniciarLimpeza = async () => {
    setStatus('loading');
    setLog([]);
    
    addLog('Buscando clientes com inscrição estadual ou estado preenchidos...');
    
    const todos = await base44.entities.Cliente.list('-created_date', 10000);
    const comDados = todos.filter(c => 
      (c.inscricao_estadual && c.inscricao_estadual.trim() !== '') || 
      (c.estado && c.estado.trim() !== '')
    );

    addLog(`Total de clientes: ${todos.length}`);
    addLog(`Clientes com dados para limpar: ${comDados.length}`);

    if (comDados.length === 0) {
      addLog('Nenhum cliente para processar. Todos já estão limpos!');
      setStatus('done');
      return;
    }

    setProgresso({ total: comDados.length, processados: 0, erros: 0 });

    // Enviar em lotes de 10 IDs por vez ao backend
    const LOTE = 10;
    let totalOk = 0;
    let totalErros = 0;
    const totalLotes = Math.ceil(comDados.length / LOTE);

    for (let i = 0; i < comDados.length; i += LOTE) {
      const lote = comDados.slice(i, i + LOTE);
      const loteNum = Math.floor(i / LOTE) + 1;
      const ids = lote.map(c => c.id);

      addLog(`Lote ${loteNum}/${totalLotes} - Enviando ${ids.length} clientes...`);

      let tentativa = 0;
      let response;
      while (tentativa < 3) {
        try {
          response = await base44.functions.invoke('limparCamposClientes', { clienteIds: ids });
          break;
        } catch (err) {
          tentativa++;
          if (tentativa >= 3) {
            addLog(`❌ Lote ${loteNum} falhou após 3 tentativas: ${err.message}`);
            totalErros += ids.length;
            setProgresso(prev => ({ ...prev, processados: prev.processados + ids.length, erros: prev.erros + ids.length }));
            response = null;
            break;
          }
          addLog(`⚠️ Lote ${loteNum} retry ${tentativa}/3...`);
          await new Promise(r => setTimeout(r, 10000));
        }
      }

      if (response?.data) {
        const data = response.data;
        totalOk += data.atualizados || 0;
        totalErros += data.erros || 0;
        setProgresso(prev => ({
          ...prev,
          processados: prev.processados + (data.atualizados || 0) + (data.erros || 0),
          erros: prev.erros + (data.erros || 0)
        }));
        addLog(`✅ Lote ${loteNum}: ${data.atualizados} ok, ${data.erros} erros`);
      }

      // Delay de 5 segundos entre lotes
      if (i + LOTE < comDados.length) {
        addLog(`Aguardando 5s antes do próximo lote...`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    addLog(`\n========== RESULTADO FINAL ==========`);
    addLog(`Total processados: ${totalOk + totalErros}`);
    addLog(`Atualizados com sucesso: ${totalOk}`);
    addLog(`Erros: ${totalErros}`);

    setStatus('done');
  };

  const pct = progresso.total > 0 ? Math.round((progresso.processados / progresso.total) * 100) : 0;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h1 className="text-xl font-bold mb-2">Limpar Inscrição Estadual e Estado</h1>
        <p className="text-slate-500 mb-6">
          Esta operação vai limpar os campos "Inscrição Estadual" e "Estado" de TODOS os clientes que possuem esses dados preenchidos.
        </p>

        {status === 'idle' && (
          <Button onClick={iniciarLimpeza} className="bg-red-600 hover:bg-red-700 text-white">
            <Trash2 className="w-4 h-4 mr-2" />
            Iniciar Limpeza
          </Button>
        )}

        {status === 'loading' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="font-medium">Processando... {progresso.processados}/{progresso.total} ({pct}%)</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-3">
              <div 
                className="bg-amber-500 h-3 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {status === 'done' && (
          <div className="flex items-center gap-2 text-green-600 mb-4">
            <CheckCircle className="w-5 h-5" />
            <span className="font-medium">Processo concluído!</span>
          </div>
        )}

        {progresso.erros > 0 && (
          <div className="flex items-center gap-2 text-red-600 mt-2">
            <AlertCircle className="w-5 h-5" />
            <span>{progresso.erros} cliente(s) com erro</span>
          </div>
        )}

        {log.length > 0 && (
          <div className="mt-6 bg-slate-900 rounded-lg p-4 max-h-96 overflow-y-auto">
            {log.map((msg, i) => (
              <div key={i} className="text-green-400 text-xs font-mono">{msg}</div>
            ))}
          </div>
        )}

        {status === 'done' && (
          <Button onClick={() => { setStatus('idle'); setLog([]); setProgresso({ total: 0, processados: 0, erros: 0 }); }} variant="outline" className="mt-4">
            Executar Novamente
          </Button>
        )}
      </div>
    </div>
  );
}