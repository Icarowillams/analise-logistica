import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Receipt, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import ListaTitulosCarga from '@/components/boletos/ListaTitulosCarga';
import ResultadoGeracaoBoletos from '@/components/boletos/ResultadoGeracaoBoletos';
import { useModalidadeBoleto } from '@/components/boletos/useModalidadeBoleto';

const somenteNumeros = (valor) => String(valor || '').replace(/\D/g, '');

const formatarDataBr = (data) => `${String(data.getDate()).padStart(2, '0')}/${String(data.getMonth() + 1).padStart(2, '0')}/${data.getFullYear()}`;

export default function EmissaoBoletosTab() {
  const queryClient = useQueryClient();
  const [cargaId, setCargaId] = useState('');
  const [filtroNumeroCarga, setFiltroNumeroCarga] = useState('');
  const [filtroCliente, setFiltroCliente] = useState('');
  const [selecionados, setSelecionados] = useState(new Set());
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [progressoBoletos, setProgressoBoletos] = useState({ atual: 0, total: 0 });

  const { clientesBoletoMap: clientesBoleto, loadingClientes } = useModalidadeBoleto();

  const { data: cargas = [], isLoading: loadingCargas } = useQuery({
    queryKey: ['cargas-emissao-boletos-tab'],
    queryFn: () => base44.entities.Carga.list('-created_date', 200),
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

  const encontrarClienteBoleto = (titulo, pedido) => {
    const codigos = [titulo.codigo_cliente, pedido?.codigo_cliente, pedido?.codigo_cliente_cod];
    for (const codigo of codigos) {
      const cliente = clientesBoleto.porCodigoOmie?.get(String(codigo || '').trim());
      if (cliente) return cliente;
    }
    const cnpjs = [titulo.cnpj_cpf, pedido?.cnpj_cpf_cliente];
    for (const cnpj of cnpjs) {
      const cliente = clientesBoleto.porCnpj?.get(somenteNumeros(cnpj));
      if (cliente) return cliente;
    }
    return null;
  };

  const encontrarPedidoDaCarga = (titulo, pedidos) => {
    const codTitulo = String(titulo.codigo_cliente || '').trim();
    const cnpjTitulo = somenteNumeros(titulo.cnpj_cpf);
    const docTitulo = somenteNumeros(titulo.numero_documento);
    const numPedVinculado = String(titulo.numero_pedido_vinculado || '').trim();

    let pedidoMatch = null;

    // Prioridade 1: match exato por numero_pedido_vinculado
    if (numPedVinculado) {
      pedidoMatch = pedidos.find(p =>
        String(p.numero_pedido || '').trim() === numPedVinculado ||
        String(p.codigo_pedido || '').trim() === numPedVinculado
      );
    }

    // Prioridade 2: match por número da NF
    if (!pedidoMatch && docTitulo) {
      pedidoMatch = pedidos.find(p => somenteNumeros(p.numero_nf) === docTitulo);
    }

    // Prioridade 3: match por codigo_cliente ou CNPJ — só se NF do título bate com alguma NF da carga
    if (!pedidoMatch && docTitulo) {
      const nfsDaCarga = new Set(pedidos.map(p => somenteNumeros(p.numero_nf)).filter(Boolean));
      if (nfsDaCarga.has(docTitulo)) {
        pedidoMatch = pedidos.find(p => {
          const porCodigo = codTitulo && (
            String(p.codigo_cliente || '').trim() === codTitulo ||
            String(p.codigo_cliente_cod || '').trim() === codTitulo
          );
          const porCnpj = cnpjTitulo && somenteNumeros(p.cnpj_cpf_cliente) === cnpjTitulo;
          return porCodigo || porCnpj;
        });
      }
    }

    if (!pedidoMatch) return null;

    // Filtro: rejeitar pedidos que não são venda (bonificação, troca, devolução)
    const tipo = (pedidoMatch.tipo_operacao || pedidoMatch.tipo_nota || 'venda').toLowerCase();
    if (tipo !== 'venda') return null;

    return pedidoMatch;
  };

  const { data: consultaTitulos, isLoading: loadingTitulos, refetch: refetchTitulos } = useQuery({
    queryKey: ['titulos-emissao-boletos-carga', cargaId],
    queryFn: async () => {
      if (!cargaSelecionada) return { titulos: [], totalCarga: 0, ocultosComBoleto: 0, ocultosSemModalidade: 0 };

      const pedidos = cargaSelecionada.pedidos_omie || [];
      if (pedidos.length === 0) return { titulos: [], totalCarga: 0, ocultosComBoleto: 0, ocultosSemModalidade: 0 };

      const hoje = new Date();
      const inicio = new Date(hoje.getTime() - 365 * 86400000);
      const futuro = new Date(hoje.getTime() + 90 * 86400000);
      let acumulados = [];

      const cnpjsUnicos = [...new Set(
        pedidos
          .map(p => String(p.cnpj_cpf_cliente || '').replace(/\D/g, ''))
          .filter(c => c.length >= 11)
      )];

      if (cnpjsUnicos.length > 0) {
        for (const cnpj of cnpjsUnicos) {
          for (let pagina = 1; pagina <= 5; pagina++) {
            const { data } = await base44.functions.invoke('listarContasReceberOmie', {
              data_de: formatarDataBr(inicio),
              data_ate: formatarDataBr(futuro),
              filtrar_por_data: 'V',
              cnpj_cpf: cnpj,
              apenas_pendentes: true,
              pagina,
              registros_por_pagina: 100
            });
            if (!data?.sucesso) break;
            acumulados = acumulados.concat(data.titulos || []);
            if (pagina >= (data.total_de_paginas || 1)) break;
          }
        }
      } else {
        for (let pagina = 1; pagina <= 10; pagina++) {
          const { data } = await base44.functions.invoke('listarContasReceberOmie', {
            data_de: formatarDataBr(inicio),
            data_ate: formatarDataBr(futuro),
            filtrar_por_data: 'V',
            apenas_pendentes: true,
            pagina,
            registros_por_pagina: 100
          });
          if (!data?.sucesso) throw new Error(data?.error || 'Falha ao consultar títulos no Omie');
          acumulados = acumulados.concat(data.titulos || []);
          if (pagina >= (data.total_de_paginas || 1)) break;
        }
      }

      acumulados = acumulados.filter((t, idx, arr) =>
        arr.findIndex(x => x.codigo_lancamento === t.codigo_lancamento) === idx
      );

      let ocultosComBoleto = 0;
      let ocultosSemModalidade = 0;
      const clientesSemModalidade = new Set();
      const titulosDaCarga = [];

      acumulados.forEach(titulo => {
        const pedido = encontrarPedidoDaCarga(titulo, pedidos);
        if (!pedido) return;

        const jaTemBoleto = !!(titulo.numero_boleto || titulo.url_boleto || titulo.codigo_barras || titulo.boleto_gerado);
        if (jaTemBoleto) {
          ocultosComBoleto += 1;
        }

        const clienteBoleto = encontrarClienteBoleto(titulo, pedido);
        if (!clienteBoleto) {
          ocultosSemModalidade += 1;
          clientesSemModalidade.add(titulo.nome_cliente || pedido?.nome_cliente || titulo.cnpj_cpf || 'desconhecido');
          return;
        }

        titulosDaCarga.push({
          ...titulo,
          nome_fantasia: clienteBoleto.nome_fantasia || pedido.nome_fantasia || '',
          nome_cliente: titulo.nome_cliente || pedido.nome_cliente || clienteBoleto.nome_fantasia || clienteBoleto.razao_social,
          cnpj_cpf: titulo.cnpj_cpf || pedido.cnpj_cpf_cliente,
          modalidade_pagamento_nome: 'BOLETO BANCARIO',
          ja_tem_boleto: jaTemBoleto
        });
      });

      const semBoleto = titulosDaCarga.filter(t => !t.ja_tem_boleto).length;
      const comBoleto = titulosDaCarga.filter(t => t.ja_tem_boleto).length;
      return {
        titulos: titulosDaCarga,
        totalCarga: titulosDaCarga.length + ocultosSemModalidade,
        ocultosComBoleto: comBoleto,
        ocultosSemModalidade,
        clientesSemModalidade: [...clientesSemModalidade],
        semBoleto
      };
    },
    enabled: !!cargaSelecionada && !loadingClientes,
    refetchOnWindowFocus: false
  });

  const titulos = useMemo(() => {
    const termo = filtroCliente.trim().toLowerCase();
    return (consultaTitulos?.titulos || []).filter(t => !termo || String(t.nome_cliente || '').toLowerCase().includes(termo));
  }, [consultaTitulos, filtroCliente]);

  const handleSelecionarCarga = (id) => {
    setCargaId(id);
    setSelecionados(new Set());
    setResultado(null);
  };

  const gerarBoletos = async () => {
    const codigos = Array.from(selecionados);
    if (codigos.length === 0) {
      toast.warning('Selecione ao menos um título para emitir boleto.');
      return;
    }
    if (!confirm(`Emitir ${codigos.length} boleto(s) no Omie?`)) return;

    const LOTE_FRONTEND = 5; // máx por chamada ao backend (evita timeout)
    const lotes = [];
    for (let i = 0; i < codigos.length; i += LOTE_FRONTEND) {
      lotes.push(codigos.slice(i, i + LOTE_FRONTEND));
    }

    setGerando(true);
    setResultado(null);
    setProgressoBoletos({ atual: 0, total: codigos.length });

    const todosResultados = [];
    let totalSucessos = 0;
    let totalErros = 0;
    let totalSkips = 0;
    let processados = 0;

    for (let i = 0; i < lotes.length; i++) {
      const lote = lotes[i];
      try {
        const { data } = await base44.functions.invoke('gerarBoletosOmie', { titulos: lote });
        if (data?.sucesso) {
          todosResultados.push(...(data.resultados || []));
          totalSucessos += data.sucessos || 0;
          totalErros += data.erros || 0;
          totalSkips += data.skips || 0;
        } else {
          // marca todos do lote como erro
          lote.forEach(cod => todosResultados.push({ codigo_lancamento: cod, sucesso: false, mensagem: data?.error || 'Erro desconhecido' }));
          totalErros += lote.length;
        }
      } catch (e) {
        lote.forEach(cod => todosResultados.push({ codigo_lancamento: cod, sucesso: false, mensagem: e.message }));
        totalErros += lote.length;
      }
      processados += lote.length;
      setProgressoBoletos({ atual: processados, total: codigos.length });
    }

    const resultadoFinal = {
      sucesso: true,
      total: codigos.length,
      processados: codigos.length,
      sucessos: totalSucessos,
      erros: totalErros,
      skips: totalSkips,
      resultados: todosResultados
    };

    setResultado(resultadoFinal);
    if (totalSucessos > 0) toast.success(`${totalSucessos} boleto(s) emitido(s) com sucesso`);
    if (totalErros > 0) toast.error(`${totalErros} boleto(s) falharam — veja o detalhe abaixo`);

    if (totalSucessos > 0) {
      const codigosSucesso = new Set(
        todosResultados.filter(r => r.sucesso).map(r => String(r.codigo_lancamento))
      );
      setSelecionados(prev => {
        const novo = new Set(prev);
        codigosSucesso.forEach(c => novo.delete(c));
        return novo;
      });
    }
    queryClient.invalidateQueries({ queryKey: ['titulos-emissao-boletos-carga', cargaId] });
    setGerando(false);
    setProgressoBoletos({ atual: 0, total: 0 });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Selecione a carga faturada</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div>
              <Label>Filtrar por nº da carga</Label>
              <Input placeholder="Ex: 019" value={filtroNumeroCarga} onChange={(e) => setFiltroNumeroCarga(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label>Carga</Label>
              <Select value={cargaId} onValueChange={handleSelecionarCarga} disabled={loadingCargas}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingCargas ? 'Carregando...' : 'Escolha uma carga faturada'} />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {cargasFiltradas.map(carga => (
                    <SelectItem key={carga.id} value={carga.id}>
                      Carga {carga.numero_carga} — {carga.data_carga} — {carga.motorista_nome || 'sem motorista'} ({carga.quantidade_pedidos || 0} pedidos)
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
            <CardTitle className="text-base">2. Títulos disponíveis para emissão</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <Label>Cliente</Label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input className="pl-8" placeholder="Buscar por nome..." value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)} />
                </div>
              </div>
              <div className="md:col-span-2 flex flex-wrap gap-2">
                <Badge className="bg-amber-100 text-amber-800">{titulos.length} pronto(s) para boleto</Badge>
                {(consultaTitulos?.ocultosComBoleto || 0) > 0 && <Badge variant="outline">{consultaTitulos.ocultosComBoleto} já tinham boleto</Badge>}
                {(consultaTitulos?.ocultosSemModalidade || 0) > 0 && (
                  <details className="inline-block">
                    <summary className="cursor-pointer">
                      <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50">{consultaTitulos.ocultosSemModalidade} sem modalidade boleto</Badge>
                    </summary>
                    <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm space-y-1 max-h-40 overflow-y-auto">
                      {(consultaTitulos.clientesSemModalidade || []).map((nome, i) => (
                        <div key={i} className="text-red-800">• {nome}</div>
                      ))}
                      <p className="text-xs text-red-600 mt-2 pt-2 border-t border-red-200">Corrija em Clientes → campo Modalidade de pagamento</p>
                    </div>
                  </details>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <div className="flex flex-col items-end gap-1">
                <Button onClick={gerarBoletos} disabled={gerando || selecionados.size === 0} className="bg-amber-600 hover:bg-amber-700 text-white">
                  {gerando
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Emitindo {progressoBoletos.atual}/{progressoBoletos.total}...</>
                    : <><Receipt className="w-4 h-4 mr-2" /> Emitir {selecionados.size} boleto(s)</>}
                </Button>
                {gerando && progressoBoletos.total > 0 && (
                  <div className="w-48 bg-slate-200 rounded-full h-1.5">
                    <div
                      className="bg-amber-500 h-1.5 rounded-full transition-all"
                      style={{ width: `${(progressoBoletos.atual / progressoBoletos.total) * 100}%` }}
                    />
                  </div>
                )}
              </div>
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

      {resultado && <ResultadoGeracaoBoletos resultado={resultado} />}
    </div>
  );
}