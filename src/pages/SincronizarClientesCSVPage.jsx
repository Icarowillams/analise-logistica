import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  RefreshCw, Search, Loader2, CheckCircle, AlertTriangle,
  ArrowUpDown, Upload, Trash2, Plus, Play, XCircle
} from 'lucide-react';
import ResumoComparacao from '@/components/sincronizarCSV/ResumoComparacao';
import ProgressoSincronizacao from '@/components/sincronizarCSV/ProgressoSincronizacao';
import ComparacaoLadoALado from '@/components/sincronizarCSV/ComparacaoLadoALado';
import ListaClientesFaltantes from '@/components/sincronizarCSV/ListaClientesFaltantes';

const BATCH_SIZE = 20;

export default function SincronizarClientesCSVPage() {
  const [etapa, setEtapa] = useState('idle'); // idle, verificando, resultado, executando, concluido
  const [comparacao, setComparacao] = useState(null);
  const [erroMsg, setErroMsg] = useState('');
  const [busca, setBusca] = useState('');
  const cancelRef = useRef(false);

  // Progresso por ação
  const [progressoUpsert, setProgressoUpsert] = useState({ total: 0, atual: 0, ok: 0, erros: 0 });
  const [progressoExcluir, setProgressoExcluir] = useState({ total: 0, atual: 0, ok: 0, erros: 0 });
  const [errosUpsert, setErrosUpsert] = useState([]);
  const [errosExcluir, setErrosExcluir] = useState([]);
  const [executandoUpsert, setExecutandoUpsert] = useState(false);
  const [executandoExcluir, setExecutandoExcluir] = useState(false);

  const handleVerificar = async () => {
    setEtapa('verificando');
    setComparacao(null);
    setErroMsg('');
    try {
      const res = await base44.functions.invoke('consultarClientesOmie', { acao: 'comparar' });
      setComparacao(res.data);
      setEtapa('resultado');
    } catch (err) {
      setErroMsg(err?.response?.data?.error || err.message);
      setEtapa('idle');
    }
  };

  const executarUpsert = async (ids) => {
    setExecutandoUpsert(true);
    setProgressoUpsert({ total: ids.length, atual: 0, ok: 0, erros: 0 });
    setErrosUpsert([]);
    let ok = 0, erros = 0, allErros = [];

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      if (cancelRef.current) break;
      const lote = ids.slice(i, i + BATCH_SIZE);
      try {
        const res = await base44.functions.invoke('sincronizacaoCompletaOmie', {
          acao: 'upsert', ids: lote
        });
        ok += res.data.enviados || 0;
        erros += res.data.erros || 0;
        if (res.data.erros_detalhes) allErros = [...allErros, ...res.data.erros_detalhes];
      } catch (e) {
        erros += lote.length;
        allErros.push(e.message);
      }
      setProgressoUpsert({ total: ids.length, atual: Math.min(i + BATCH_SIZE, ids.length), ok, erros });
      setErrosUpsert([...allErros]);
    }
    setExecutandoUpsert(false);
  };

  const executarExcluir = async (clientes) => {
    setExecutandoExcluir(true);
    setProgressoExcluir({ total: clientes.length, atual: 0, ok: 0, erros: 0 });
    setErrosExcluir([]);
    let ok = 0, erros = 0, allErros = [];

    for (let i = 0; i < clientes.length; i += BATCH_SIZE) {
      if (cancelRef.current) break;
      const lote = clientes.slice(i, i + BATCH_SIZE);
      try {
        const res = await base44.functions.invoke('sincronizacaoCompletaOmie', {
          acao: 'excluir', clientes: lote
        });
        ok += res.data.excluidos || 0;
        erros += res.data.erros || 0;
        if (res.data.erros_detalhes) allErros = [...allErros, ...res.data.erros_detalhes];
      } catch (e) {
        erros += lote.length;
        allErros.push(e.message);
      }
      setProgressoExcluir({ total: clientes.length, atual: Math.min(i + BATCH_SIZE, clientes.length), ok, erros });
      setErrosExcluir([...allErros]);
    }
    setExecutandoExcluir(false);
  };

  const handleExecutarTudo = async () => {
    cancelRef.current = false;
    setEtapa('executando');

    // Upsert: diferentes + só no Base44
    const idsUpsert = [
      ...(comparacao.lista_diferentes || []).map(d => d.id),
      ...(comparacao.lista_so_base44 || []).map(d => d.id),
    ];

    // Excluir: só no Omie
    const clientesExcluir = (comparacao.lista_so_omie || []).map(c => ({
      codigo_integracao: c.codigo_integracao,
      codigo_omie: c.codigo_omie,
      razao_social: c.razao_social,
    }));

    if (idsUpsert.length > 0) await executarUpsert(idsUpsert);
    if (clientesExcluir.length > 0 && !cancelRef.current) await executarExcluir(clientesExcluir);

    setEtapa('concluido');
  };

  const handleCancelar = () => {
    cancelRef.current = true;
  };

  const handleReset = () => {
    setEtapa('idle');
    setComparacao(null);
    setErroMsg('');
    setProgressoUpsert({ total: 0, atual: 0, ok: 0, erros: 0 });
    setProgressoExcluir({ total: 0, atual: 0, ok: 0, erros: 0 });
    setErrosUpsert([]);
    setErrosExcluir([]);
  };

  const temAcoes = comparacao && (comparacao.diferentes > 0 || comparacao.so_no_base44 > 0 || comparacao.so_no_omie > 0);

  return (
    <div>
      <PageHeader
        title="Sincronizar Base44 → Omie (Completa)"
        subtitle="Compare e sincronize clientes entre Base44 e Omie"
        icon={ArrowUpDown}
      />

      <div className="max-w-5xl mx-auto space-y-4">
        {/* IDLE */}
        {etapa === 'idle' && (
          <Card>
            <CardContent className="py-8 text-center space-y-4">
              <ArrowUpDown className="w-12 h-12 mx-auto text-amber-500" />
              <h3 className="text-lg font-semibold">Sincronização Completa Base44 → Omie</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                Compara todos os clientes do Base44 com o Omie e identifica diferenças,
                faltantes e excedentes para manter os dois sistemas idênticos.
              </p>
              {erroMsg && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                  {erroMsg}
                </div>
              )}
              <Button onClick={handleVerificar} className="bg-amber-500 hover:bg-amber-600 text-white">
                <Search className="w-4 h-4 mr-2" /> Verificar Agora
              </Button>
            </CardContent>
          </Card>
        )}

        {/* VERIFICANDO */}
        {etapa === 'verificando' && (
          <Card>
            <CardContent className="py-12 text-center space-y-4">
              <Loader2 className="w-10 h-10 mx-auto text-amber-500 animate-spin" />
              <p className="text-sm text-slate-600">Buscando e comparando clientes entre Base44 e Omie...</p>
              <p className="text-xs text-slate-400">Isso pode levar alguns minutos dependendo da quantidade de clientes.</p>
            </CardContent>
          </Card>
        )}

        {/* RESULTADO */}
        {etapa === 'resultado' && comparacao && (
          <>
            <ResumoComparacao comparacao={comparacao} />

            {/* Busca */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Filtrar por nome, código..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Diferentes */}
            {comparacao.lista_diferentes && comparacao.lista_diferentes.length > 0 && (
              <ComparacaoLadoALado items={comparacao.lista_diferentes} busca={busca} />
            )}

            {/* Só no Base44 */}
            {comparacao.lista_so_base44 && comparacao.lista_so_base44.length > 0 && (
              <ListaClientesFaltantes
                titulo="Só no Base44 (criar no Omie)"
                items={comparacao.lista_so_base44}
                cor="purple"
                icon={<Plus className="w-4 h-4 text-purple-500" />}
              />
            )}

            {/* Só no Omie */}
            {comparacao.lista_so_omie && comparacao.lista_so_omie.length > 0 && (
              <ListaClientesFaltantes
                titulo="Só no Omie (excluir do Omie)"
                items={comparacao.lista_so_omie}
                cor="orange"
                icon={<Trash2 className="w-4 h-4 text-orange-500" />}
              />
            )}

            {/* Ações */}
            <div className="flex flex-wrap gap-3 justify-center pt-4">
              <Button variant="outline" onClick={handleReset}>Voltar</Button>
              <Button variant="outline" onClick={handleVerificar}>
                <RefreshCw className="w-4 h-4 mr-2" /> Reverificar
              </Button>
              {temAcoes && (
                <Button onClick={handleExecutarTudo} className="bg-amber-500 hover:bg-amber-600 text-white">
                  <Play className="w-4 h-4 mr-2" /> Executar Sincronização Completa
                </Button>
              )}
              {!temAcoes && (
                <Badge className="bg-green-100 text-green-700 text-sm py-2 px-4">
                  <CheckCircle className="w-4 h-4 mr-1" /> Tudo sincronizado!
                </Badge>
              )}
            </div>
          </>
        )}

        {/* EXECUTANDO */}
        {(etapa === 'executando' || etapa === 'concluido') && (
          <>
            <ProgressoSincronizacao
              titulo="Upsert (Criar/Atualizar no Omie)"
              icon={<Upload className="w-4 h-4 text-blue-500" />}
              progresso={progressoUpsert}
              erros={errosUpsert}
              executando={executandoUpsert}
              corBorda="blue"
            />
            <ProgressoSincronizacao
              titulo="Excluir do Omie"
              icon={<Trash2 className="w-4 h-4 text-red-500" />}
              progresso={progressoExcluir}
              erros={errosExcluir}
              executando={executandoExcluir}
              corBorda="red"
            />

            <div className="flex gap-3 justify-center pt-4">
              {etapa === 'executando' && (
                <Button variant="destructive" onClick={handleCancelar}>
                  <XCircle className="w-4 h-4 mr-2" /> Cancelar
                </Button>
              )}
              {etapa === 'concluido' && (
                <>
                  <Button variant="outline" onClick={handleReset}>Voltar</Button>
                  <Button onClick={handleVerificar} className="bg-amber-500 hover:bg-amber-600 text-white">
                    <RefreshCw className="w-4 h-4 mr-2" /> Reverificar
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}