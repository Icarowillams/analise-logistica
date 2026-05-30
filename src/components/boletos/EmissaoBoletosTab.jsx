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

const normalizar = (valor) => String(valor || '').trim().toUpperCase();
const somenteNumeros = (valor) => String(valor || '').replace(/\D/g, '');
const BOLETO_BANCARIO_ID_FALLBACK = '69ff70445fbcb49b659710df';

const formatarDataBr = (data) => `${String(data.getDate()).padStart(2, '0')}/${String(data.getMonth() + 1).padStart(2, '0')}/${data.getFullYear()}`;

export default function EmissaoBoletosTab() {
  const queryClient = useQueryClient();
  const [cargaId, setCargaId] = useState('');
  const [filtroNumeroCarga, setFiltroNumeroCarga] = useState('');
  const [filtroCliente, setFiltroCliente] = useState('');
  const [selecionados, setSelecionados] = useState(new Set());
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const { data: cargas = [], isLoading: loadingCargas } = useQuery({
    queryKey: ['cargas-emissao-boletos-tab'],
    queryFn: () => base44.entities.Carga.list('-created_date', 200),
    refetchOnWindowFocus: false
  });

  const { data: modalidades = [] } = useQuery({
    queryKey: ['modalidades-pagamento-boletos'],
    queryFn: () => base44.entities.ModalidadePagamento.list(),
    refetchOnWindowFocus: false
  });

  const { data: clientes = [], isLoading: loadingClientes } = useQuery({
    queryKey: ['clientes-modalidade-boletos'],
    queryFn: () => base44.entities.Cliente.list('-updated_date', 5000),
    refetchOnWindowFocus: false
  });

  const modalidadeBoletoIds = useMemo(() => {
    const ids = new Set([BOLETO_BANCARIO_ID_FALLBACK]);
    modalidades.forEach(m => {
      const nome = normalizar(m.nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (nome.includes('BOLETO') && nome.includes('BANCARIO')) ids.add(m.id);
    });
    return ids;
  }, [modalidades]);

  const clientesBoleto = useMemo(() => {
    const porCodigoOmie = new Map();
    const porCnpj = new Map();
    clientes.forEach(cliente => {
      if (!modalidadeBoletoIds.has(cliente.modalidade_pagamento_id)) return;
      [cliente.codigo_omie, cliente.codigo_cliente_omie].forEach(codigo => {
        const key = String(codigo || '').trim();
        if (key) porCodigoOmie.set(key, cliente);
      });
      const cnpj = somenteNumeros(cliente.cnpj_cpf);
      if (cnpj) porCnpj.set(cnpj, cliente);
    });
    return { porCodigoOmie, porCnpj };
  }, [clientes, modalidadeBoletoIds]);

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
      const cliente = clientesBoleto.porCodigoOmie.get(String(codigo || '').trim());
      if (cliente) return cliente;
    }
    const cnpjs = [titulo.cnpj_cpf, pedido?.cnpj_cpf_cliente];
    for (const cnpj of cnpjs) {
      const cliente = clientesBoleto.porCnpj.get(somenteNumeros(cnpj));
      if (cliente) return cliente;
    }
    return null;
  };

  const encontrarPedidoDaCarga = (titulo, pedidos) => {
    const codTitulo = String(titulo.codigo_cliente || '').trim();
    const cnpjTitulo = somenteNumeros(titulo.cnpj_cpf);
    const docTitulo = somenteNumeros(titulo.numero_documento);

    return pedidos.find(p => {
      const porCodigo = codTitulo && String(p.codigo_cliente || '').trim() === codTitulo;
      const porCnpj = cnpjTitulo && somenteNumeros(p.cnpj_cpf_cliente) === cnpjTitulo;
      const porNf = docTitulo && somenteNumeros(p.numero_nf) === docTitulo;
      return porCodigo || porCnpj || porNf;
    });
  };

  const { data: consultaTitulos, isLoading: loadingTitulos, refetch: refetchTitulos } = useQuery({
    queryKey: ['titulos-emissao-boletos-carga', cargaId, clientes.length, modalidades.length],
    queryFn: async () => {
      if (!cargaSelecionada) return { titulos: [], totalCarga: 0, ocultosComBoleto: 0, ocultosSemModalidade: 0 };

      const pedidos = cargaSelecionada.pedidos_omie || [];
      if (pedidos.length === 0) return { titulos: [], totalCarga: 0, ocultosComBoleto: 0, ocultosSemModalidade: 0 };

      const hoje = new Date();
      const inicio = new Date(hoje.getTime() - 90 * 86400000);
      let acumulados = [];

      for (let pagina = 1; pagina <= 10; pagina++) {
        const { data } = await base44.functions.invoke('listarContasReceberOmie', {
          data_de: formatarDataBr(inicio),
          data_ate: formatarDataBr(hoje),
          filtrar_por_data: 'E',
          apenas_pendentes: true,
          pagina,
          registros_por_pagina: 100
        });
        if (!data?.sucesso) throw new Error(data?.error || 'Falha ao consultar títulos no Omie');
        acumulados = acumulados.concat(data.titulos || []);
        if (pagina >= (data.total_de_paginas || 1)) break;
      }

      let ocultosComBoleto = 0;
      let ocultosSemModalidade = 0;
      const titulosDaCarga = [];

      acumulados.forEach(titulo => {
        const pedido = encontrarPedidoDaCarga(titulo, pedidos);
        if (!pedido) return;

        const jaTemBoleto = !!(titulo.numero_boleto || titulo.url_boleto || titulo.codigo_barras || titulo.boleto_gerado);
        if (jaTemBoleto) {
          ocultosComBoleto += 1;
          return;
        }

        const clienteBoleto = encontrarClienteBoleto(titulo, pedido);
        if (!clienteBoleto) {
          ocultosSemModalidade += 1;
          return;
        }

        titulosDaCarga.push({
          ...titulo,
          nome_cliente: titulo.nome_cliente || pedido.nome_cliente || clienteBoleto.nome_fantasia || clienteBoleto.razao_social,
          cnpj_cpf: titulo.cnpj_cpf || pedido.cnpj_cpf_cliente,
          modalidade_pagamento_nome: 'BOLETO BANCARIO'
        });
      });

      return {
        titulos: titulosDaCarga,
        totalCarga: titulosDaCarga.length + ocultosComBoleto + ocultosSemModalidade,
        ocultosComBoleto,
        ocultosSemModalidade
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

    setGerando(true);
    setResultado(null);
    try {
      const { data } = await base44.functions.invoke('gerarBoletosOmie', { titulos: codigos });
      if (data?.sucesso) {
        setResultado(data);
        if ((data.sucessos || 0) > 0) toast.success(`${data.sucessos} boleto(s) emitido(s) com sucesso`);
        if ((data.erros || 0) > 0) toast.error(`${data.erros} boleto(s) falharam — veja o detalhe abaixo`);
        setSelecionados(new Set());
        queryClient.invalidateQueries({ queryKey: ['titulos-emissao-boletos-carga', cargaId] });
      } else {
        toast.error(data?.error || 'Erro ao emitir boletos');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setGerando(false);
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
                {(consultaTitulos?.ocultosSemModalidade || 0) > 0 && <Badge variant="outline">{consultaTitulos.ocultosSemModalidade} sem modalidade boleto</Badge>}
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={gerarBoletos} disabled={gerando || selecionados.size === 0} className="bg-amber-600 hover:bg-amber-700 text-white">
                {gerando
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Emitindo...</>
                  : <><Receipt className="w-4 h-4 mr-2" /> Emitir {selecionados.size} boleto(s)</>}
              </Button>
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