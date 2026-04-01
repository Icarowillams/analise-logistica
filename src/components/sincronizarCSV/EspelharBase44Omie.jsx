import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Cloud, Loader2, CheckCircle, Play, XCircle, Search,
  Upload, Trash2, AlertTriangle
} from 'lucide-react';

export default function EspelharBase44Omie() {
  const [etapa, setEtapa] = useState('idle'); // idle, analisando, pronto, enviando, excluindo, concluido
  const [totalBase44, setTotalBase44] = useState(0);
  const [excedentesOmie, setExcedentesOmie] = useState([]);
  const [erroMsg, setErroMsg] = useState('');

  // Progresso envio
  const [progressoEnvio, setProgressoEnvio] = useState({ total: 0, atual: 0, ok: 0, erros: 0 });
  const [errosEnvio, setErrosEnvio] = useState([]);

  // Progresso exclusão
  const [progressoExcluir, setProgressoExcluir] = useState({ total: 0, atual: 0, ok: 0, erros: 0 });
  const [errosExcluir, setErrosExcluir] = useState([]);

  const [executando, setExecutando] = useState(false);
  const cancelRef = useRef(false);

  // PASSO 1: Analisar quantos clientes existem no Base44
  const handleAnalisar = async () => {
    setEtapa('analisando');
    setErroMsg('');
    try {
      const res = await base44.functions.invoke('espelharBase44Omie', { etapa: 'analise' });
      setTotalBase44(res.data.total);
      setEtapa('pronto');
    } catch (err) {
      setErroMsg(err?.response?.data?.error || err.message);
      setEtapa('idle');
    }
  };

  // PASSO 2: Enviar todos para Omie via UpsertCliente + identificar excedentes + excluir
  const handleExecutar = async () => {
    cancelRef.current = false;
    setExecutando(true);
    setEtapa('enviando');
    setErrosEnvio([]);
    setErrosExcluir([]);
    setExcedentesOmie([]);

    const allErrosEnvio = [];

    // Fase 1: Enviar todos os clientes do Base44 para o Omie
    setProgressoEnvio({ total: totalBase44, atual: 0, ok: 0, erros: 0 });
    let ok = 0, erros = 0, offset = 0, concluido = false;

    while (!concluido && !cancelRef.current) {
      try {
        const res = await base44.functions.invoke('espelharBase44Omie', {
          etapa: 'enviar_omie', offset, batch_size: 20
        });
        const d = res.data;
        ok += d.processados || 0;
        erros += d.erros || 0;
        if (d.erros_detalhes) allErrosEnvio.push(...d.erros_detalhes);
        offset = d.nextOffset || 0;
        concluido = d.concluido;
        setProgressoEnvio({ total: d.total, atual: Math.min(offset, d.total), ok, erros });
        setErrosEnvio([...allErrosEnvio]);
      } catch (e) {
        allErrosEnvio.push(e.message);
        concluido = true;
      }
    }

    // Fase 2: Listar todos do Omie e identificar excedentes
    if (!cancelRef.current) {
      setEtapa('excluindo');
      try {
        // Buscar IDs do Base44
        const resAnalise = await base44.functions.invoke('espelharBase44Omie', { etapa: 'analise' });
        // Buscar todos os clientes do Omie
        const todosOmie = [];
        let pagina = 1, totalPags = 1;
        while (pagina <= totalPags && !cancelRef.current) {
          const resOmie = await base44.functions.invoke('espelharBase44Omie', {
            etapa: 'listar_omie', pagina_omie: pagina
          });
          todosOmie.push(...resOmie.data.clientes);
          totalPags = resOmie.data.total_paginas;
          pagina++;
        }

        // Buscar IDs do Base44 para comparar
        const clientesBase44 = await base44.entities.Cliente.list('-created_date', 10000);
        const base44Ids = new Set(clientesBase44.map(c => c.id));

        // Identificar excedentes
        const excedentes = todosOmie.filter(c =>
          c.codigo_integracao && !base44Ids.has(c.codigo_integracao)
        );
        setExcedentesOmie(excedentes);

        // Fase 3: Excluir excedentes do Omie em lotes
        if (excedentes.length > 0 && !cancelRef.current) {
          setProgressoExcluir({ total: excedentes.length, atual: 0, ok: 0, erros: 0 });
          const allErrosExcl = [];
          let okExcl = 0, errosExcl = 0;

          for (let i = 0; i < excedentes.length && !cancelRef.current; i += 20) {
            const lote = excedentes.slice(i, i + 20);
            try {
              const res = await base44.functions.invoke('espelharBase44Omie', {
                etapa: 'excluir_omie',
                ids_excluir: lote.map(c => ({
                  codigo_integracao: c.codigo_integracao,
                  razao_social: c.razao_social
                }))
              });
              okExcl += res.data.processados || 0;
              errosExcl += res.data.erros || 0;
              if (res.data.erros_detalhes) allErrosExcl.push(...res.data.erros_detalhes);
            } catch (e) {
              errosExcl += lote.length;
              allErrosExcl.push(e.message);
            }
            setProgressoExcluir({ total: excedentes.length, atual: Math.min(i + 20, excedentes.length), ok: okExcl, erros: errosExcl });
            setErrosExcluir([...allErrosExcl]);
          }
        }
      } catch (e) {
        console.error('Erro ao listar/excluir Omie:', e);
      }
    }

    setExecutando(false);
    setEtapa('concluido');
  };

  const handleReset = () => {
    setEtapa('idle');
    setTotalBase44(0);
    setExcedentesOmie([]);
    setErroMsg('');
    setProgressoEnvio({ total: 0, atual: 0, ok: 0, erros: 0 });
    setProgressoExcluir({ total: 0, atual: 0, ok: 0, erros: 0 });
    setErrosEnvio([]);
    setErrosExcluir([]);
  };

  const BarraProgresso = ({ titulo, icon, progresso, erros, cor }) => {
    if (progresso.total === 0) return null;
    const pct = progresso.total > 0 ? Math.round((progresso.atual / progresso.total) * 100) : 0;
    const concluido = progresso.atual >= progresso.total;

    return (
      <Card className="border-slate-200">
        <CardContent className="py-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 font-medium">
              {icon} {titulo}
            </div>
            <span className="text-slate-500">
              {progresso.atual}/{progresso.total} — {progresso.ok} ok, {progresso.erros} erros
            </span>
          </div>
          <Progress value={pct} className="h-2" />
          {concluido && progresso.erros === 0 && (
            <div className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle className="w-3 h-3" /> Concluído com sucesso
            </div>
          )}
          {erros.length > 0 && (
            <div className="max-h-32 overflow-y-auto text-xs text-red-600 space-y-1 mt-2">
              {erros.map((e, i) => <div key={i}>• {e}</div>)}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* IDLE */}
      {etapa === 'idle' && (
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <Cloud className="w-12 h-12 mx-auto text-amber-500" />
            <h3 className="text-lg font-semibold">Espelhar Base44 → Omie</h3>
            <p className="text-sm text-slate-500 max-w-lg mx-auto">
              Envia <strong>todos</strong> os clientes do Base44 para o Omie via UpsertCliente
              (cria novos ou atualiza existentes), e depois exclui do Omie qualquer cliente
              que não exista no Base44. Resultado: Omie 100% idêntico ao Base44.
            </p>
            {erroMsg && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                {erroMsg}
              </div>
            )}
            <Button onClick={handleAnalisar} className="bg-amber-500 hover:bg-amber-600 text-white">
              <Search className="w-4 h-4 mr-2" /> Analisar e Preparar
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ANALISANDO */}
      {etapa === 'analisando' && (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <Loader2 className="w-10 h-10 mx-auto text-amber-500 animate-spin" />
            <p className="text-sm text-slate-600">Contando clientes no Base44...</p>
          </CardContent>
        </Card>
      )}

      {/* PRONTO */}
      {etapa === 'pronto' && (
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <Cloud className="w-12 h-12 mx-auto text-amber-500" />
            <h3 className="text-lg font-semibold">Pronto para espelhar</h3>
            <p className="text-sm text-slate-500">
              Serão enviados <strong className="text-amber-600">{totalBase44.toLocaleString()}</strong> clientes
              do Base44 para o Omie via UpsertCliente.
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700 max-w-lg mx-auto">
              <AlertTriangle className="w-4 h-4 inline mr-1" />
              Após o envio, clientes que existem no Omie mas <strong>não</strong> no Base44 serão excluídos do Omie.
            </div>
            <div className="flex gap-3 justify-center pt-2">
              <Button variant="outline" onClick={handleReset}>Voltar</Button>
              <Button onClick={handleExecutar} className="bg-amber-500 hover:bg-amber-600 text-white">
                <Play className="w-4 h-4 mr-2" /> Executar Espelhamento Completo
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ENVIANDO / EXCLUINDO / CONCLUIDO */}
      {(etapa === 'enviando' || etapa === 'excluindo' || etapa === 'concluido') && (
        <>
          <BarraProgresso
            titulo="Enviar para Omie (UpsertCliente)"
            icon={<Upload className="w-4 h-4 text-blue-500" />}
            progresso={progressoEnvio}
            erros={errosEnvio}
          />
          <BarraProgresso
            titulo="Excluir excedentes do Omie"
            icon={<Trash2 className="w-4 h-4 text-red-500" />}
            progresso={progressoExcluir}
            erros={errosExcluir}
          />

          <div className="flex gap-3 justify-center pt-4">
            {executando && (
              <Button variant="destructive" onClick={() => { cancelRef.current = true; }}>
                <XCircle className="w-4 h-4 mr-2" /> Cancelar
              </Button>
            )}
            {etapa === 'concluido' && (
              <>
                <Button variant="outline" onClick={handleReset}>Voltar</Button>
                {progressoEnvio.erros === 0 && progressoExcluir.erros === 0 ? (
                  <Badge className="bg-green-100 text-green-700 text-sm py-2 px-4">
                    <CheckCircle className="w-4 h-4 mr-1" /> Omie 100% espelhado!
                  </Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-700 text-sm py-2 px-4">
                    <AlertTriangle className="w-4 h-4 mr-1" /> Concluído com {progressoEnvio.erros + progressoExcluir.erros} erro(s)
                  </Badge>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}