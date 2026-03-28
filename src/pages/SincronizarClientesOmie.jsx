import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { RefreshCw } from 'lucide-react';
import EtapaIdle from '@/components/sincronizarClientes/EtapaIdle';
import EtapaVerificando from '@/components/sincronizarClientes/EtapaVerificando';
import EtapaResultado from '@/components/sincronizarClientes/EtapaResultado';
import EtapaSincronizando from '@/components/sincronizarClientes/EtapaSincronizando';
import EtapaConcluido from '@/components/sincronizarClientes/EtapaConcluido';

export default function SincronizarClientesOmie() {
  const [etapa, setEtapa] = useState('idle');
  const [verificacao, setVerificacao] = useState(null);
  const [progresso, setProgresso] = useState(0);
  const [processado, setProcessado] = useState(0);
  const [sucessos, setSucessos] = useState(0);
  const [erros, setErros] = useState(0);
  const [todosResultados, setTodosResultados] = useState([]);
  const [erroMsg, setErroMsg] = useState('');
  const [progressoMsg, setProgressoMsg] = useState('');
  const cancelRef = useRef(false);

  const handleVerificar = async () => {
    setEtapa('verificando');
    setVerificacao(null);
    setErroMsg('');

    try {
      // PASSO 1: Buscar clientes Base44 diretamente via SDK (filtrando ativos)
      setProgressoMsg('Buscando clientes ativos no Base44...');
      let allClientes;
      try {
        allClientes = await base44.entities.Cliente.filter({ status: 'ativo' });
      } catch (_) {
        // Fallback: list all and filter locally
        const raw = await base44.entities.Cliente.list();
        allClientes = (raw || []).filter(c => (c.status || 'ativo') === 'ativo');
      }
      const clientesBase44 = (allClientes || []).map(c => ({
        id: c.id,
        razao_social: c.razao_social || '',
        nome_fantasia: c.nome_fantasia || '',
        cpf_cnpj: c.cpf_cnpj || ''
      }));
      const totalAtivos = clientesBase44.length;

      // PASSO 2: Buscar clientes do Omie (paginado)
      setProgressoMsg(`Base44: ${totalAtivos} ativos. Buscando clientes no Omie...`);
      const clientesOmie = [];
      let paginaAtual = 1;
      let totalPaginas = 1;

      while (paginaAtual <= totalPaginas) {
        setProgressoMsg(`Buscando Omie: página ${paginaAtual}${totalPaginas > 1 ? ` de ${totalPaginas}` : ''}...`);

        const resOmie = await base44.functions.invoke('sincronizarClientesOmie', {
          modo: 'listar_omie',
          pagina_omie: paginaAtual
        });
        const dataOmie = resOmie.data;

        clientesOmie.push(...dataOmie.clientes);
        totalPaginas = dataOmie.total_paginas;

        if (dataOmie.concluido) break;
        paginaAtual++;

        // small delay between pages
        await new Promise(r => setTimeout(r, 300));
      }

      // PASSO 3: Comparar
      setProgressoMsg(`Comparando ${totalAtivos} (Base44) x ${clientesOmie.length} (Omie)...`);
      const resComparar = await base44.functions.invoke('sincronizarClientesOmie', {
        modo: 'comparar',
        clientes_base44: clientesBase44,
        clientes_omie: clientesOmie
      });

      setVerificacao({
        ...resComparar.data,
        total_base44: totalAtivos
      });
      setEtapa('resultado');

    } catch (err) {
      setErroMsg(err?.response?.data?.error || err.message);
      setEtapa('idle');
    }
  };

  const handleSincronizar = async (ids) => {
    if (!ids || ids.length === 0) return;
    cancelRef.current = false;
    setEtapa('sincronizando');
    setProgresso(0);
    setProcessado(0);
    setSucessos(0);
    setErros(0);
    setTodosResultados([]);

    let loteAtual = 0;
    let accResultados = [];
    let accSucessos = 0;
    let accErros = 0;

    while (!cancelRef.current) {
      try {
        const res = await base44.functions.invoke('sincronizarClientesOmie', {
          modo: 'sincronizar',
          ids_para_enviar: ids,
          lote_inicio: loteAtual
        });
        const data = res.data;

        accResultados = [...accResultados, ...data.resultados];
        accSucessos += data.resumo.sucessos;
        accErros += data.resumo.erros;

        setTodosResultados([...accResultados]);
        setSucessos(accSucessos);
        setErros(accErros);
        setProcessado(accResultados.length);
        setProgresso(Math.round((accResultados.length / ids.length) * 100));

        if (data.concluido) {
          setEtapa('concluido');
          break;
        }
        loteAtual = data.proximo_lote;
      } catch (err) {
        setErroMsg(err?.response?.data?.error || err.message);
        setEtapa('concluido');
        break;
      }
    }

    if (cancelRef.current) {
      setEtapa('concluido');
    }
  };

  const handleCancelar = () => {
    cancelRef.current = true;
  };

  const handleReset = () => {
    setEtapa('idle');
    setVerificacao(null);
    setTodosResultados([]);
    setErroMsg('');
  };

  return (
    <div>
      <PageHeader
        title="Sincronizar Clientes → Omie"
        subtitle="Compare e envie clientes faltantes para o Omie"
        icon={RefreshCw}
      />

      <div className="max-w-4xl mx-auto">
        {etapa === 'idle' && (
          <EtapaIdle onVerificar={handleVerificar} erroMsg={erroMsg} />
        )}
        {etapa === 'verificando' && <EtapaVerificando progressoMsg={progressoMsg} />}
        {etapa === 'resultado' && verificacao && (
          <EtapaResultado
            verificacao={verificacao}
            onSincronizar={(ids) => handleSincronizar(ids)}
            onReverificar={handleVerificar}
            onVoltar={handleReset}
          />
        )}
        {etapa === 'sincronizando' && (
          <EtapaSincronizando
            processado={processado}
            total={verificacao?.faltando_no_omie || 0}
            progresso={progresso}
            sucessos={sucessos}
            erros={erros}
            resultados={todosResultados}
            onCancelar={handleCancelar}
          />
        )}
        {etapa === 'concluido' && (
          <EtapaConcluido
            processado={processado}
            sucessos={sucessos}
            erros={erros}
            resultados={todosResultados}
            erroMsg={erroMsg}
            onReverificar={handleVerificar}
            onVoltar={handleReset}
          />
        )}
      </div>
    </div>
  );
}