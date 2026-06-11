import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Receipt, Loader2, Search, RefreshCw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import ListaTitulosCarga from '@/components/boletos/ListaTitulosCarga';
import ResultadoGeracaoBoletos from '@/components/boletos/ResultadoGeracaoBoletos';
import PendenciasVinculoCarga from '@/components/boletos/PendenciasVinculoCarga';
import { useModalidadeBoleto } from '@/components/boletos/useModalidadeBoleto';

const somenteNumeros = (v) => String(v || '').replace(/\D/g, '');

const fmt = (d) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

export default function EmissaoBoletos() {
  const queryClient = useQueryClient();
  const [cargaId, setCargaId] = useState('');
  const [filtroNumeroCarga, setFiltroNumeroCarga] = useState('');
  const [selecionados, setSelecionados] = useState(new Set());
  const [gerando, setGerando] = useState(false);
  const [progresso, setProgresso] = useState({ atual: 0, total: 0 });
  const [resultado, setResultado] = useState(null);
  const [filtroCliente, setFiltroCliente] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos');

  const { data: cargas = [], isLoading: loadingCargas } = useQuery({
    queryKey: ['cargas-emissao-boletos'],
    queryFn: () => base44.entities.Carga.list('-created_date', 200),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  const cargasFiltradas = useMemo(() => {
    const termo = filtroNumeroCarga.trim().toLowerCase();
    return cargas
      .filter(c => c.status_carga === 'faturada')
      .filter(c => !termo || String(c.numero_carga || '').toLowerCase().includes(termo));
  }, [cargas, filtroNumeroCarga]);

  const cargaSelecionada = useMemo(
    () => cargas.find(c => c.id === cargaId) || null,
    [cargas, cargaId]
  );

  // Clientes carregados sob demanda — apenas os da carga selecionada
  const contextoClientes = useMemo(() => {
    const pedidos = cargaSelecionada?.pedidos_omie || [];
    return {
      cnpjs: pedidos.map(p => p.cnpj_cpf_cliente),
      codigos: pedidos.flatMap(p => [p.codigo_cliente, p.codigo_cliente_cod])
    };
  }, [cargaSelecionada]);

  const { isClienteBoleto, loadingClientes } = useModalidadeBoleto(contextoClientes);

  // Busca títulos filtrando por CNPJ de cada pedido sequencialmente (evita rate-limit Omie)
  const { data: titulosResp, isLoading: loadingTitulos, refetch: refetchTitulos } = useQuery({
    queryKey: ['titulos-carga', cargaId],
    queryFn: async () => {
      if (!cargaSelecionada) return { titulos: [], ocultosNaoBoleto: 0, nfSemTitulo: [], semNf: [] };
      const pedidos = cargaSelecionada.pedidos_omie || [];
      if (pedidos.length === 0) return { titulos: [], ocultosNaoBoleto: 0, nfSemTitulo: [], semNf: [] };

      const hoje = new Date();
      const inicio = new Date(hoje.getTime() - 365 * 86400000);
      const fim = new Date(hoje.getTime() + 90 * 86400000);
      const dataDeStr = fmt(inicio);
      const dataAteStr = fmt(fim);

      // Busca sequencial por CNPJ — evita erro 8020 / rate limit do Omie
      const cnpjsUnicos = [...new Set(
        pedidos.map(p => somenteNumeros(p.cnpj_cpf_cliente)).filter(c => c.length >= 11)
      )];

      let acumulados = [];
      for (const cnpj of cnpjsUnicos) {
        const { data } = await base44.functions.invoke('listarContasReceberOmie', {
          data_de: dataDeStr,
          data_ate: dataAteStr,
          filtrar_por_data: 'V',
          cnpj_cpf: cnpj,
          apenas_pendentes: false,
          registros_por_pagina: 100
        });
        if (data?.sucesso && data.titulos?.length > 0) {
          acumulados = acumulados.concat(data.titulos);
        }
      }

      // Dedup
      acumulados = acumulados.filter((t, i, arr) =>
        arr.findIndex(x => x.codigo_lancamento === t.codigo_lancamento) === i
      );

      const nfsCarga = new Set(pedidos.map(p => somenteNumeros(p.numero_nf)).filter(Boolean));
      const codigosClienteCarga = new Set(pedidos.map(p => String(p.codigo_cliente || '').trim()).filter(Boolean));
      const cnpjsCarga = new Set(pedidos.map(p => somenteNumeros(p.cnpj_cpf_cliente)).filter(Boolean));

      const tituloCasaCarga = (t) => {
        const numPedVinc = String(t.numero_pedido_vinculado || '').trim();
        if (numPedVinc) {
          const match = pedidos.find(p =>
            String(p.numero_pedido || '').trim() === numPedVinc ||
            String(p.codigo_pedido || '').trim() === numPedVinc
          );
          if (match) {
            const tipo = match.tipo_operacao || match.tipo_nota || 'venda';
            return tipo === 'venda';
          }
        }
        const docT = somenteNumeros(t.numero_documento);
        if (docT && nfsCarga.has(docT)) {
          const pedidoNf = pedidos.find(p => somenteNumeros(p.numero_nf) === docT);
          if (pedidoNf && (pedidoNf.tipo_operacao || pedidoNf.tipo_nota || 'venda') !== 'venda') return false;
          return true;
        }
        // fallback por cliente apenas se documento da carga confere
        const codT = String(t.codigo_cliente || '').trim();
        const cnpjT = somenteNumeros(t.cnpj_cpf);
        const clienteCasa = (codT && codigosClienteCarga.has(codT)) || (cnpjT && cnpjsCarga.has(cnpjT));
        if (clienteCasa && docT && nfsCarga.has(docT)) return true;
        return false;
      };

      let ocultosNaoBoleto = 0;
      const titulos = acumulados.filter(t => {
        if (!tituloCasaCarga(t)) return false;
        if (!isClienteBoleto(t)) { ocultosNaoBoleto++; return false; }
        return true;
      });

      // Pendências de vínculo
      const docsTitulos = new Set(acumulados.map(t => somenteNumeros(t.numero_documento)).filter(Boolean));
      const nfSemTitulo = [];
      const semNf = [];
      pedidos.forEach(p => {
        if (p.tipo_nota === 'D1') return;
        const nf = somenteNumeros(p.numero_nf);
        if (nf) { if (!docsTitulos.has(nf)) nfSemTitulo.push(p); }
        else { semNf.push(p); }
      });

      return { titulos, ocultosNaoBoleto, nfSemTitulo, semNf };
    },
    enabled: !!cargaSelecionada && !loadingClientes,
    refetchOnWindowFocus: false
  });

  const titulosTodos = titulosResp?.titulos || [];
  const ocultosNaoBoleto = titulosResp?.ocultosNaoBoleto || 0;
  const nfSemTitulo = titulosResp?.nfSemTitulo || [];
  const semNf = titulosResp?.semNf || [];

  const titulos = useMemo(() => {
    const termo = filtroCliente.trim().toLowerCase();
    return titulosTodos.filter(t => {
      if (termo && !String(t.nome_cliente || '').toLowerCase().includes(termo)) return false;
      if (filtroStatus !== 'todos') {
        const st = String(t.status_titulo || '').toUpperCase();
        if (filtroStatus === 'aberto' && st !== 'ABERTO') return false;
        if (filtroStatus === 'atrasado' && st !== 'ATRASADO' && st !== 'VENCIDO') return false;
        if (filtroStatus === 'recebido' && st !== 'RECEBIDO') return false;
      }
      return true;
    });
  }, [titulosTodos, filtroCliente, filtroStatus]);

  const handleSelecionarCarga = (id) => {
    setCargaId(id);
    setSelecionados(new Set());
    setResultado(null);
  };

  const gerarBoletos = async () => {
    const codigos = Array.from(selecionados);
    if (codigos.length === 0) { toast.warning('Selecione ao menos um título para gerar boleto.'); return; }
    if (!confirm(`Gerar ${codigos.length} boleto(s) no Omie?`)) return;

    // Processa em lotes de 5 (backend é sequencial, mas split evita timeout)
    const LOTE = 5;
    const lotes = [];
    for (let i = 0; i < codigos.length; i += LOTE) lotes.push(codigos.slice(i, i + LOTE));

    setGerando(true);
    setResultado(null);
    setProgresso({ atual: 0, total: codigos.length });

    const todosResultados = [];
    let totalSucessos = 0, totalErros = 0, totalSkips = 0, processados = 0;

    for (const lote of lotes) {
      try {
        const { data } = await base44.functions.invoke('gerarBoletosOmie', { titulos: lote });
        if (data?.sucesso) {
          todosResultados.push(...(data.resultados || []));
          totalSucessos += data.sucessos || 0;
          totalErros += data.erros || 0;
          totalSkips += data.skips || 0;
        } else {
          lote.forEach(cod => todosResultados.push({ codigo_lancamento: cod, sucesso: false, mensagem: data?.error || 'Erro' }));
          totalErros += lote.length;
        }
      } catch (e) {
        lote.forEach(cod => todosResultados.push({ codigo_lancamento: cod, sucesso: false, mensagem: e.message }));
        totalErros += lote.length;
      }
      processados += lote.length;
      setProgresso({ atual: processados, total: codigos.length });
    }

    setResultado({ sucesso: true, total: codigos.length, processados: codigos.length, sucessos: totalSucessos, erros: totalErros, skips: totalSkips, resultados: todosResultados });
    if (totalSucessos > 0) toast.success(`${totalSucessos} boleto(s) gerado(s)`);
    if (totalErros > 0) toast.error(`${totalErros} boleto(s) falharam`);
    setSelecionados(new Set());
    queryClient.invalidateQueries({ queryKey: ['titulos-carga', cargaId] });
    setGerando(false);
    setProgresso({ atual: 0, total: 0 });
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <Receipt className="w-8 h-8 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold">Emissão de Boletos</h1>
          <p className="text-sm text-slate-500">Selecione uma carga, escolha os títulos e gere os boletos no Omie</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">1. Selecione a Carga</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <Label>Filtrar por nº</Label>
              <Input placeholder="Ex: 019" value={filtroNumeroCarga} onChange={(e) => setFiltroNumeroCarga(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label>Carga</Label>
              <Select value={cargaId} onValueChange={handleSelecionarCarga} disabled={loadingCargas}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingCargas ? 'Carregando...' : 'Escolha uma carga faturada'} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {cargasFiltradas.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      Carga {c.numero_carga} — {c.data_carga} — {c.motorista_nome || 'sem motorista'} ({c.quantidade_pedidos || 0} pedidos)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {cargaSelecionada && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline" className="font-mono">Nº {cargaSelecionada.numero_carga}</Badge>
              <Badge variant="outline">{cargaSelecionada.status_carga}</Badge>
              <Badge variant="outline">{cargaSelecionada.quantidade_pedidos || 0} pedidos Omie</Badge>
              <Button size="sm" variant="ghost" onClick={() => refetchTitulos()} disabled={loadingTitulos}>
                <RefreshCw className={`w-4 h-4 mr-1 ${loadingTitulos ? 'animate-spin' : ''}`} /> Recarregar títulos
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {cargaSelecionada && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex flex-wrap items-center justify-between gap-3">
              <span>
                2. Títulos da carga
                {titulos.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    ({titulos.length} encontrado{titulos.length > 1 ? 's' : ''}
                    {selecionados.size > 0 && `, ${selecionados.size} selecionado${selecionados.size > 1 ? 's' : ''}`})
                  </span>
                )}
              </span>
              <div className="flex flex-col items-end gap-1">
                <Button
                  onClick={gerarBoletos}
                  disabled={gerando || selecionados.size === 0}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {gerando
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Gerando {progresso.atual}/{progresso.total}...</>
                    : <><Receipt className="w-4 h-4 mr-2" /> Gerar {selecionados.size} boleto(s)</>}
                </Button>
                {gerando && progresso.total > 0 && (
                  <div className="w-48 bg-slate-200 rounded-full h-1.5">
                    <div className="bg-amber-500 h-1.5 rounded-full transition-all" style={{ width: `${(progresso.atual / progresso.total) * 100}%` }} />
                  </div>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 mb-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <Label>Filtrar cliente</Label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input className="pl-8" placeholder="Buscar por nome..." value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)} />
                </div>
              </div>
              <div className="w-48">
                <Label>Status</Label>
                <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="aberto">Em aberto</SelectItem>
                    <SelectItem value="atrasado">Atrasados</SelectItem>
                    <SelectItem value="recebido">Recebidos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {ocultosNaoBoleto > 0 && (
                <Badge className="bg-orange-100 text-orange-800 text-xs">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {ocultosNaoBoleto} sem modalidade Boleto Bancário
                </Badge>
              )}
            </div>
            <ListaTitulosCarga
              titulos={titulos}
              loading={loadingTitulos || loadingClientes}
              selecionados={selecionados}
              setSelecionados={setSelecionados}
            />
          </CardContent>
        </Card>
      )}

      {cargaSelecionada && !loadingTitulos && (
        <PendenciasVinculoCarga nfSemTitulo={nfSemTitulo} semNf={semNf} />
      )}

      {resultado && <ResultadoGeracaoBoletos resultado={resultado} />}
    </div>
  );
}