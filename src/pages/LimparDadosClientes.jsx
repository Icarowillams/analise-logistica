import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Trash2, Loader2, CheckCircle, AlertCircle, StopCircle } from 'lucide-react';

export default function LimparDadosClientes() {
  const [status, setStatus] = useState('idle');
  const [progresso, setProgresso] = useState({ total: 0, processados: 0, erros: 0 });
  const [log, setLog] = useState([]);
  const cancelRef = useRef(false);
  const logEndRef = useRef(null);

  const addLog = (msg) => {
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  const atualizarCliente = async (id) => {
    for (let t = 1; t <= 5; t++) {
      try {
        await base44.entities.Cliente.update(id, {
          inscricao_estadual: '',
          estado: ''
        });
        return true;
      } catch (err) {
        if (t === 5) return false;
        // Delay crescente: 2s, 4s, 8s, 16s, 32s
        await delay(2000 * Math.pow(2, t - 1));
      }
    }
    return false;
  };

  const iniciarLimpeza = async () => {
    cancelRef.current = false;
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

    let totalOk = 0;
    let totalErros = 0;
    const idsComErro = [];

    // Processar UM cliente por vez direto do frontend
    for (let i = 0; i < comDados.length; i++) {
      if (cancelRef.current) {
        addLog('⛔ Processo cancelado pelo usuário.');
        break;
      }

      const cliente = comDados[i];
      const ok = await atualizarCliente(cliente.id);
      
      if (ok) {
        totalOk++;
      } else {
        totalErros++;
        idsComErro.push(cliente.id);
        addLog(`❌ Falha: ${cliente.razao_social || cliente.codigo || cliente.id}`);
      }

      setProgresso({ total: comDados.length, processados: i + 1, erros: totalErros });

      // Log a cada 50 clientes
      if ((i + 1) % 50 === 0) {
        addLog(`Progresso: ${i + 1}/${comDados.length} (${totalOk} ok, ${totalErros} erros)`);
      }

      // Delay de 500ms entre cada cliente
      await delay(500);
    }

    // Reprocessar os que falharam
    if (idsComErro.length > 0 && !cancelRef.current) {
      addLog(`\nReprocessando ${idsComErro.length} clientes que falharam...`);
      await delay(10000); // esperar 10s antes de reprocessar

      for (let i = 0; i < idsComErro.length; i++) {
        if (cancelRef.current) break;
        
        const ok = await atualizarCliente(idsComErro[i]);
        if (ok) {
          totalOk++;
          totalErros--;
          setProgresso(prev => ({ ...prev, erros: prev.erros - 1 }));
        }
        await delay(2000); // 2s entre cada no reprocessamento
      }
    }

    addLog(`\n========== RESULTADO FINAL ==========`);
    addLog(`Total: ${comDados.length}`);
    addLog(`Limpos com sucesso: ${totalOk}`);
    addLog(`Erros persistentes: ${totalErros}`);

    setStatus('done');
  };

  const pct = progresso.total > 0 ? Math.round((progresso.processados / progresso.total) * 100) : 0;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white rounded-xl p-6 shadow-sm border">
        <h1 className="text-xl font-bold mb-2">Limpar Inscrição Estadual e Estado</h1>
        <p className="text-slate-500 mb-6">
          Remove os dados de "Inscrição Estadual" e "Estado" de todos os clientes. Os campos continuam existindo, apenas os valores são apagados.
        </p>

        {status === 'idle' && (
          <Button onClick={iniciarLimpeza} className="bg-red-600 hover:bg-red-700 text-white">
            <Trash2 className="w-4 h-4 mr-2" />
            Iniciar Limpeza
          </Button>
        )}

        {status === 'loading' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-amber-600" />
              <span className="font-medium text-amber-600">
                Processando... {progresso.processados}/{progresso.total} ({pct}%)
              </span>
              <Button 
                variant="outline" 
                size="sm" 
                className="ml-auto text-red-600 border-red-200"
                onClick={() => cancelRef.current = true}
              >
                <StopCircle className="w-4 h-4 mr-1" /> Parar
              </Button>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-3">
              <div 
                className="bg-amber-500 h-3 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-slate-400">
              Estimativa: ~{Math.ceil((progresso.total - progresso.processados) * 0.5 / 60)} min restantes
            </p>
          </div>
        )}

        {status === 'done' && (
          <div className="flex items-center gap-2 text-green-600 mb-4">
            <CheckCircle className="w-5 h-5" />
            <span className="font-medium">Processo concluído!</span>
          </div>
        )}

        {progresso.erros > 0 && status === 'done' && (
          <div className="flex items-center gap-2 text-red-600 mt-2">
            <AlertCircle className="w-5 h-5" />
            <span>{progresso.erros} cliente(s) com erro persistente</span>
          </div>
        )}

        {log.length > 0 && (
          <div className="mt-6 bg-slate-900 rounded-lg p-4 max-h-80 overflow-y-auto">
            {log.map((msg, i) => (
              <div key={i} className="text-green-400 text-xs font-mono">{msg}</div>
            ))}
            <div ref={logEndRef} />
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