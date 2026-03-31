import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Upload, Loader2, CheckCircle, AlertTriangle, Search,
  FileSpreadsheet, Database, ArrowLeftRight, XCircle, Play
} from 'lucide-react';
import ComparacaoLadoALado from './ComparacaoLadoALado';
import ListaClientesFaltantes from './ListaClientesFaltantes';
import ResumoCSVBase44 from './ResumoCSVBase44';
import ProgressoCriacaoCSV from './ProgressoCriacaoCSV';

const BATCH_SIZE = 100;

export default function CompararCSVBase44() {
  const [etapa, setEtapa] = useState('idle');
  const [arquivo, setArquivo] = useState(null);
  const [csvUrl, setCsvUrl] = useState('');
  const [comparacao, setComparacao] = useState(null);
  const [erroMsg, setErroMsg] = useState('');
  const [busca, setBusca] = useState('');
  const [uploading, setUploading] = useState(false);

  // Progresso de criação/atualização/exclusão
  const [progressoAtualizar, setProgressoAtualizar] = useState({ total: 0, atual: 0, ok: 0, erros: 0 });
  const [progressoCriar, setProgressoCriar] = useState({ total: 0, atual: 0, ok: 0, erros: 0 });
  const [progressoExcluir, setProgressoExcluir] = useState({ total: 0, atual: 0, ok: 0, erros: 0 });
  const [errosExec, setErrosExec] = useState([]);
  const [executando, setExecutando] = useState(false);
  const cancelRef = useRef(false);

  const handleUploadEComparar = async () => {
    if (!arquivo) return;
    setErroMsg('');
    setUploading(true);
    setEtapa('verificando');
    try {
      // Upload do arquivo
      const { file_url } = await base44.integrations.Core.UploadFile({ file: arquivo });
      setCsvUrl(file_url);
      // Comparar
      const res = await base44.functions.invoke('compararCSVComBase44', {
        csv_url: file_url, etapa: 'analise'
      });
      setComparacao(res.data);
      setEtapa('resultado');
    } catch (err) {
      setErroMsg(err?.response?.data?.error || err.message);
      setEtapa('idle');
    } finally {
      setUploading(false);
    }
  };

  const executarSincronizacao = async () => {
    if (!csvUrl || !comparacao) return;
    cancelRef.current = false;
    setExecutando(true);
    setEtapa('executando');
    setErrosExec([]);

    const allErros = [];

    // 1. Atualizar diferentes
    if (comparacao.diferentes > 0) {
      setProgressoAtualizar({ total: comparacao.diferentes, atual: 0, ok: 0, erros: 0 });
      let ok = 0, erros = 0;
      let offset = 0;
      let concluido = false;
      while (!concluido && !cancelRef.current) {
        try {
          const res = await base44.functions.invoke('sincronizarClientesCSV', {
            csv_url: csvUrl, etapa: 'atualizar', offset, batch_size: BATCH_SIZE
          });
          const d = res.data;
          ok += d.processados || 0;
          erros += d.erros || 0;
          if (d.erros_detalhes) allErros.push(...d.erros_detalhes);
          offset = d.nextOffset || 0;
          concluido = d.concluido;
          setProgressoAtualizar({ total: d.total, atual: Math.min(offset, d.total), ok, erros });
        } catch (e) {
          allErros.push(e.message);
          concluido = true;
        }
      }
    }

    // 2. Criar novos
    if (comparacao.nao_encontrados > 0 && !cancelRef.current) {
      setProgressoCriar({ total: comparacao.nao_encontrados, atual: 0, ok: 0, erros: 0 });
      let ok = 0, erros = 0;
      let offset = 0;
      let concluido = false;
      while (!concluido && !cancelRef.current) {
        try {
          const res = await base44.functions.invoke('sincronizarClientesCSV', {
            csv_url: csvUrl, etapa: 'criar', offset, batch_size: BATCH_SIZE
          });
          const d = res.data;
          ok += d.processados || 0;
          erros += d.erros || 0;
          if (d.erros_detalhes) allErros.push(...d.erros_detalhes);
          offset = d.nextOffset || 0;
          concluido = d.concluido;
          setProgressoCriar({ total: d.total, atual: Math.min(offset, d.total), ok, erros });
        } catch (e) {
          allErros.push(e.message);
          concluido = true;
        }
      }
    }

    // 3. Excluir sobrantes (do Base44 que não estão no CSV)
    if (comparacao.so_no_base44 > 0 && !cancelRef.current) {
      setProgressoExcluir({ total: comparacao.so_no_base44, atual: 0, ok: 0, erros: 0 });
      let ok = 0, erros = 0;
      let offset = 0;
      let concluido = false;
      while (!concluido && !cancelRef.current) {
        try {
          const res = await base44.functions.invoke('sincronizarClientesCSV', {
            csv_url: csvUrl, etapa: 'excluir', offset, batch_size: 50
          });
          const d = res.data;
          ok += d.processados || 0;
          erros += d.erros || 0;
          if (d.erros_detalhes) allErros.push(...d.erros_detalhes);
          offset = d.nextOffset || 0;
          concluido = d.concluido;
          setProgressoExcluir({ total: d.total, atual: Math.min(offset, d.total), ok, erros });
        } catch (e) {
          allErros.push(e.message);
          concluido = true;
        }
      }
    }

    setErrosExec(allErros);
    setExecutando(false);
    setEtapa('concluido');
  };

  const handleReset = () => {
    setEtapa('idle');
    setArquivo(null);
    setCsvUrl('');
    setComparacao(null);
    setErroMsg('');
    setBusca('');
    setProgressoAtualizar({ total: 0, atual: 0, ok: 0, erros: 0 });
    setProgressoCriar({ total: 0, atual: 0, ok: 0, erros: 0 });
    setProgressoExcluir({ total: 0, atual: 0, ok: 0, erros: 0 });
    setErrosExec([]);
  };

  const temAcoes = comparacao && (comparacao.diferentes > 0 || comparacao.nao_encontrados > 0 || comparacao.so_no_base44 > 0);

  return (
    <div className="space-y-4">
      {/* IDLE - Upload */}
      {etapa === 'idle' && (
        <Card>
          <CardContent className="py-8 space-y-4">
            <div className="text-center">
              <FileSpreadsheet className="w-12 h-12 mx-auto text-blue-500 mb-2" />
              <h3 className="text-lg font-semibold">Comparar CSV × Base44</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto mt-1">
                Envie o CSV oficial e compare com os clientes cadastrados. 
                Identifica faltantes, divergentes e sobrantes automaticamente.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3 max-w-lg mx-auto">
              <Input
                type="file"
                accept=".csv"
                onChange={(e) => setArquivo(e.target.files?.[0] || null)}
                className="flex-1"
              />
              <Button
                onClick={handleUploadEComparar}
                disabled={!arquivo || uploading}
                className="bg-blue-600 hover:bg-blue-700 text-white whitespace-nowrap"
              >
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                Enviar e Comparar
              </Button>
            </div>

            {erroMsg && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 text-center max-w-lg mx-auto">
                {erroMsg}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* VERIFICANDO */}
      {etapa === 'verificando' && (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <Loader2 className="w-10 h-10 mx-auto text-blue-500 animate-spin" />
            <p className="text-sm text-slate-600">Enviando CSV e comparando com o Base44...</p>
            <p className="text-xs text-slate-400">Isso pode levar alguns segundos.</p>
          </CardContent>
        </Card>
      )}

      {/* RESULTADO */}
      {etapa === 'resultado' && comparacao && (
        <>
          <ResumoCSVBase44 comparacao={comparacao} />

          {/* Busca */}
          {(comparacao.diferentes > 0 || comparacao.nao_encontrados > 0 || comparacao.so_no_base44 > 0) && (
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
          )}

          {/* Diferentes */}
          {comparacao.lista_diferentes && comparacao.lista_diferentes.length > 0 && (
            <ComparacaoLadoALado items={comparacao.lista_diferentes} busca={busca} />
          )}

          {/* Não encontrados no Base44 (precisam ser criados) */}
          {comparacao.lista_nao_encontrados && comparacao.lista_nao_encontrados.length > 0 && (
            <ListaClientesFaltantes
              titulo="Não encontrados no Base44 (serão criados)"
              items={comparacao.lista_nao_encontrados}
              cor="purple"
              icon={<Database className="w-4 h-4 text-purple-500" />}
            />
          )}

          {/* Só no Base44 (não estão no CSV) */}
          {comparacao.lista_so_base44 && comparacao.lista_so_base44.length > 0 && (
            <ListaClientesFaltantes
              titulo="Só no Base44 (não estão no CSV)"
              items={comparacao.lista_so_base44}
              cor="orange"
              icon={<AlertTriangle className="w-4 h-4 text-orange-500" />}
            />
          )}

          {/* Ações */}
          <div className="flex flex-wrap gap-3 justify-center pt-4">
            <Button variant="outline" onClick={handleReset}>Voltar</Button>
            {temAcoes ? (
              <Button onClick={executarSincronizacao} className="bg-blue-600 hover:bg-blue-700 text-white">
                <Play className="w-4 h-4 mr-2" /> Sincronizar Base44 com CSV
              </Button>
            ) : (
              <Badge className="bg-green-100 text-green-700 text-sm py-2 px-4">
                <CheckCircle className="w-4 h-4 mr-1" /> Base44 100% idêntico ao CSV!
              </Badge>
            )}
          </div>
        </>
      )}

      {/* EXECUTANDO / CONCLUIDO */}
      {(etapa === 'executando' || etapa === 'concluido') && (
        <>
          <ProgressoCriacaoCSV
            progressoAtualizar={progressoAtualizar}
            progressoCriar={progressoCriar}
            progressoExcluir={progressoExcluir}
            erros={errosExec}
            executando={executando}
          />

          <div className="flex gap-3 justify-center pt-4">
            {etapa === 'executando' && (
              <Button variant="destructive" onClick={() => { cancelRef.current = true; }}>
                <XCircle className="w-4 h-4 mr-2" /> Cancelar
              </Button>
            )}
            {etapa === 'concluido' && (
              <>
                <Button variant="outline" onClick={handleReset}>Voltar</Button>
                <Button onClick={handleUploadEComparar} disabled={!csvUrl} className="bg-blue-600 hover:bg-blue-700 text-white">
                  <Search className="w-4 h-4 mr-2" /> Reverificar
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}