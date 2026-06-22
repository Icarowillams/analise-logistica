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
import GerarBoletosFaltantesPrazo from '@/components/boletos/GerarBoletosFaltantesPrazo';
import { buscarTitulosCarga } from '@/lib/buscarTitulosCarga';

const somenteNumeros = (v) => String(v || '').replace(/\D/g, '');

export default function EmissaoBoletosConteudo({ ativa = true }) {
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
    refetchOnWindowFocus: false,
    enabled: ativa
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

  // Constrói um título sintético a partir de um pedido da carga (que tem NF) — para emitir
  // boleto direto pelo pedido quando a busca de título falhou ou não retornou. O backend
  // gerarBoletosOmie resolve o título/boleto a partir do nCodPedido.
  const tituloDoPedido = (p, pendenteVerificacao = false) => ({
    codigo_lancamento: '',                          // não temos o nCodTitulo — backend resolve via pedido
    codigo_pedido_omie: String(p.codigo_pedido || ''),
    numero_pedido_vinculado: String(p.numero_pedido || ''),
    numero_documento: somenteNumeros(p.numero_nf) || '',
    numero_parcela: '',
    data_emissao: '',
    data_vencimento: '',
    valor_documento: p.valor_total_pedido || 0,
    status_titulo: 'ABERTO',
    cnpj_cpf: p.cnpj_cpf_cliente || '',
    nome_cliente: p.nome_cliente || '',
    nome_fantasia: p.nome_fantasia || '',
    boleto_gerado: false,
    numero_boleto: '',
    url_boleto: '',
    _origem: 'pedido',
    _pendenteVerificacao: pendenteVerificacao       // true = busca falhou (Omie limitou)
  });

  // Busca títulos filtrando por CNPJ de cada pedido sequencialmente (evita rate-limit Omie)
  const { data: titulosResp, isLoading: loadingTitulos, refetch: refetchTitulos } = useQuery({
    queryKey: ['titulos-carga', cargaId],
    queryFn: async () => {
      const vazio = { titulos: [], ocultosNaoBoleto: 0, nfSemTitulo: [], semNf: [], naoVerificados: 0 };
      if (!cargaSelecionada) return vazio;
      const pedidos = cargaSelecionada.pedidos_omie || [];
      if (pedidos.length === 0) return vazio;

      // ✅ Helper UNIFICADO: boletos já emitidos do LOCAL (instantâneo) + títulos sem boleto
      // buscados no Omie EM PARALELO (runPool, ±7 dias emissão, 1 página/CNPJ).
      // Retorna { titulos, cnpjsComFalha, houveFalhaOmie } — falha de busca ≠ título inexistente.
      const { titulos: acumulados, cnpjsComFalha } = await buscarTitulosCarga(cargaSelecionada);

      // Encontra o pedido da carga que corresponde a um título.
      // Vínculo CONFIÁVEL: nCodPedido (codigo_pedido_omie) === codigo_pedido do pedido (nCodPed Omie).
      // Fallback: numero_pedido_vinculado === numero_pedido. NÃO usa numero_documento/CNPJ
      // (pedidos sem CNPJ e numero_documento ausente no payload geravam pendência falsa).
      const codPedido = (p) => String(p.codigo_pedido || '').trim();
      const numPedido = (p) => String(p.numero_pedido || '').trim();

      const pedidoDoTitulo = (t) => {
        const codT = String(t.codigo_pedido_omie || '').trim();
        if (codT) {
          const m = pedidos.find(p => codPedido(p) === codT);
          if (m) return m;
        }
        const numT = String(t.numero_pedido_vinculado || '').trim();
        if (numT) {
          const m = pedidos.find(p => numPedido(p) === numT);
          if (m) return m;
        }
        return null;
      };

      const tituloCasaCarga = (t) => {
        const m = pedidoDoTitulo(t);
        if (!m) return false;
        const tipo = m.tipo_operacao || m.tipo_nota || 'venda';
        return tipo === 'venda';
      };

      let ocultosNaoBoleto = 0;
      const titulos = acumulados.filter(t => {
        if (!tituloCasaCarga(t)) return false;
        // Boleto JÁ emitido (origem local ou com nº de boleto) é comprovadamente boleto → sempre passa.
        const jaEmitido = t._origem === 'local' || t.boleto_gerado || (t.numero_boleto && String(t.numero_boleto).trim());
        if (jaEmitido) return true;
        if (!isClienteBoleto(t)) { ocultosNaoBoleto++; return false; }
        return true;
      });

      // Normaliza nº de pedido (remove zero-padding) p/ casar com boleto local.
      const numLimpo = (v) => String(v || '').trim().replace(/^0+/, '');

      // Códigos/números já cobertos por algum título confirmado da consulta.
      const codsTitulos = new Set(acumulados.map(t => String(t.codigo_pedido_omie || '').trim()).filter(Boolean));
      const numsTitulos = new Set(acumulados.map(t => String(t.numero_pedido_vinculado || '').trim()).filter(Boolean));
      const cnpjFalhou = (p) => cnpjsComFalha.has(somenteNumeros(p.cnpj_cpf_cliente));

      // Boletos JÁ no LogEmissaoBoleto (origem 'local', status 'gerado') — cruzar por
      // numero_pedido E por NF. Um pedido com boleto local NUNCA é "NF sem título".
      const pedidosComBoletoLocal = new Set(
        acumulados.filter(t => t._origem === 'local')
          .map(t => numLimpo(t.numero_pedido_vinculado)).filter(Boolean)
      );
      const nfsComBoletoLocal = new Set(
        acumulados.filter(t => t._origem === 'local')
          .map(t => somenteNumeros(t.numero_documento)).filter(Boolean)
      );
      const temBoletoLocal = (p) =>
        pedidosComBoletoLocal.has(numLimpo(p.numero_pedido)) ||
        (somenteNumeros(p.numero_nf) && nfsComBoletoLocal.has(somenteNumeros(p.numero_nf)));

      // Classifica cada pedido SEM título confirmado:
      //  - tem NF + busca FALHOU (rate limit) → linha selecionável "pendente de verificação"
      //    (NÃO vai pra Pendências) — o usuário ainda consegue emitir pelo pedido.
      //  - tem NF + busca OK e vazia → Pendências reais (NF sem título no Omie).
      //  - sem NF → "Pedidos sem NF emitida".
      const nfSemTitulo = [];
      const semNf = [];
      let naoVerificados = 0;
      pedidos.forEach(p => {
        if (p.tipo_nota === 'D1') return;
        const tipo = p.tipo_operacao || p.tipo_nota || 'venda';
        if (tipo !== 'venda') return;
        const temTitulo = (codPedido(p) && codsTitulos.has(codPedido(p))) ||
                          (numPedido(p) && numsTitulos.has(numPedido(p)));
        if (temTitulo) return;
        const nf = somenteNumeros(p.numero_nf);
        if (!nf) { semNf.push(p); return; }
        // Pendência FALSA: já existe boleto local (LogEmissaoBoleto) para este pedido/NF.
        if (temBoletoLocal(p)) return;
        if (cnpjFalhou(p)) {
          // Busca não confirmou (Omie limitou) → trata como emitível, NÃO como pendência.
          if (!isClienteBoleto(tituloDoPedido(p))) { ocultosNaoBoleto++; return; }
          titulos.push(tituloDoPedido(p, true));
          naoVerificados++;
        } else {
          // Busca foi bem-sucedida e realmente não há título → pendência real.
          nfSemTitulo.push(p);
        }
      });

      return { titulos, ocultosNaoBoleto, nfSemTitulo, semNf, naoVerificados };
    },
    enabled: ativa && !!cargaSelecionada && !loadingClientes,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false
  });

  const titulosTodos = (titulosResp?.titulos || []).map(t => ({
    ...t,
    _chave: String(t.codigo_lancamento || (t.codigo_pedido_omie ? `pedido:${t.codigo_pedido_omie}` : ''))
  }));
  const ocultosNaoBoleto = titulosResp?.ocultosNaoBoleto || 0;
  const nfSemTitulo = titulosResp?.nfSemTitulo || [];
  const semNf = titulosResp?.semNf || [];
  const naoVerificados = titulosResp?.naoVerificados || 0;

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

    // Envia o OBJETO completo de cada título selecionado (não só o código) — assim o backend
    // grava o LogEmissaoBoleto com numero_pedido, cliente, valor, NF (write-through completo).
    // Chave de seleção = _chave (codigo_lancamento, ou pedido:<cod> quando emitível pelo pedido).
    const chaveDe = (t) => String(t._chave || t.codigo_lancamento || (t.codigo_pedido_omie ? `pedido:${t.codigo_pedido_omie}` : ''));
    const porChave = new Map(titulosTodos.map(t => [chaveDe(t), t]));
    const objetos = codigos.map(c => porChave.get(String(c)) || { codigo_lancamento: c });

    // Processa em lotes de 5 (backend é sequencial, mas split evita timeout)
    const LOTE = 5;
    const lotes = [];
    for (let i = 0; i < objetos.length; i += LOTE) lotes.push(objetos.slice(i, i + LOTE));

    setGerando(true);
    setResultado(null);
    setProgresso({ atual: 0, total: codigos.length });

    const todosResultados = [];
    let totalSucessos = 0, totalErros = 0, totalSkips = 0, processados = 0;

    // Detecta rate-limit / bloqueio temporário do Omie (425/429/"consumo indevido"/"bloqueada").
    const isRateLimit = (msg) => {
      const m = String(msg || '').toLowerCase();
      return m.includes('425') || m.includes('429') || m.includes('consumo indevido') ||
             m.includes('bloqueada') || m.includes('bloqueio') || m.includes('aguarde') || m.includes('cota');
    };

    const DELAY_ENTRE_LOTES_MS = 2500;

    for (let li = 0; li < lotes.length; li++) {
      const lote = lotes[li];
      // Backoff/retry no 425/429: espera e re-tenta o MESMO lote (não marca erro).
      let tentativa = 0;
      const maxTentativas = 4;
      while (true) {
        let bloqueou = false;
        try {
          const { data } = await base44.functions.invoke('gerarBoletosOmie', {
            titulos: lote,
            numero_carga: cargaSelecionada?.numero_carga || '',
            carga_id: cargaSelecionada?.id || ''
          });
          if (data?.sucesso) {
            // Se algum resultado do lote indicou rate-limit, re-tenta o lote inteiro.
            const algumBloqueio = (data.resultados || []).some(r => !r.sucesso && !r.skip && isRateLimit(r.mensagem));
            if (algumBloqueio && tentativa < maxTentativas) { bloqueou = true; }
            else {
              todosResultados.push(...(data.resultados || []));
              totalSucessos += data.sucessos || 0;
              totalErros += data.erros || 0;
              totalSkips += data.skips || 0;
            }
          } else if (isRateLimit(data?.error) && tentativa < maxTentativas) {
            bloqueou = true;
          } else {
            lote.forEach(t => todosResultados.push({ codigo_lancamento: t.codigo_lancamento, sucesso: false, mensagem: data?.error || 'Erro' }));
            totalErros += lote.length;
          }
        } catch (e) {
          if (isRateLimit(e.message) && tentativa < maxTentativas) {
            bloqueou = true;
          } else {
            lote.forEach(t => todosResultados.push({ codigo_lancamento: t.codigo_lancamento, sucesso: false, mensagem: e.message }));
            totalErros += lote.length;
          }
        }

        if (bloqueou) {
          tentativa++;
          const espera = 30000 * tentativa; // 30s, 60s, 90s... (425 bloqueia por dezenas/centenas de s)
          toast.info(`Omie limitou o ritmo — aguardando ${espera / 1000}s antes de re-tentar (tentativa ${tentativa})...`);
          await new Promise(r => setTimeout(r, espera));
          continue;
        }
        break;
      }

      processados += lote.length;
      setProgresso({ atual: processados, total: codigos.length });
      // Pausa entre lotes para não estourar o rate-limit do Omie (425).
      if (li < lotes.length - 1) await new Promise(r => setTimeout(r, DELAY_ENTRE_LOTES_MS));
    }

    setResultado({ sucesso: true, total: codigos.length, processados: codigos.length, sucessos: totalSucessos, erros: totalErros, skips: totalSkips, resultados: todosResultados });
    const partes = [`${totalSucessos} gerado(s)`];
    if (totalSkips > 0) partes.push(`${totalSkips} já existente(s)`);
    if (totalErros > 0) partes.push(`${totalErros} com erro`);
    if (totalSucessos > 0) toast.success(partes.join(', '));
    else if (totalErros > 0) toast.error(partes.join(', '));
    else toast.info(partes.join(', '));
    setSelecionados(new Set());
    queryClient.invalidateQueries({ queryKey: ['titulos-carga', cargaId] });
    setGerando(false);
    setProgresso({ atual: 0, total: 0 });
  };

  return (
    <div className="space-y-4">
      <GerarBoletosFaltantesPrazo />

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

      {cargaSelecionada && naoVerificados > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Omie limitou o ritmo — {naoVerificados} título(s) não verificado(s). Eles aparecem como "A verificar" e podem ser emitidos pelo pedido; ou recarregue para confirmar.
          </span>
          <Button size="sm" variant="outline" className="shrink-0 border-amber-400 text-amber-800 hover:bg-amber-100" onClick={() => refetchTitulos()} disabled={loadingTitulos}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loadingTitulos ? 'animate-spin' : ''}`} /> Recarregar títulos
          </Button>
        </div>
      )}

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
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Gerando {progresso.atual} de {progresso.total} boleto(s)...</>
                    : <><Receipt className="w-4 h-4 mr-2" /> Gerar {selecionados.size} boleto(s)</>}
                </Button>
                {gerando && progresso.total > 0 && (
                  <>
                    <div className="w-48 bg-slate-200 rounded-full h-1.5">
                      <div className="bg-amber-500 h-1.5 rounded-full transition-all" style={{ width: `${(progresso.atual / progresso.total) * 100}%` }} />
                    </div>
                    <span className="text-xs text-slate-500">{progresso.atual} de {progresso.total} processado(s)</span>
                  </>
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