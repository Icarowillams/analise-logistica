import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Search, Loader2, AlertTriangle, CalendarIcon, X, Truck } from 'lucide-react';
import { format, subDays, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { useModalidadeBoleto } from '@/components/boletos/useModalidadeBoleto';
import { buscarTitulosCarga } from '@/lib/buscarTitulosCarga';

const somenteNumeros = (valor) => String(valor || '').replace(/\D/g, '');

const dateToBR = (d) => {
  if (!d) return '';
  return format(d, 'dd/MM/yyyy');
};

export default function FiltrosBoletos({ onResultado }) {
  const [dataDe, setDataDe] = useState(() => subDays(new Date(), 30));
  const [dataAte, setDataAte] = useState(() => addDays(new Date(), 90));
  const [filtrarPor, setFiltrarPor] = useState('E');
  const [cnpj, setCnpj] = useState('');
  const [apenasComBoleto, setApenasComBoleto] = useState(true);
  const [loading, setLoading] = useState(false);
  const [cargaFiltro, setCargaFiltro] = useState(null);
  const [cargaBusca, setCargaBusca] = useState('');
  const [cargaLoading, setCargaLoading] = useState(false);
  const [ocultosNaoBoleto, setOcultosNaoBoleto] = useState(0);
  const [apenasClientesBoleto, setApenasClientesBoleto] = useState(false);
  const [nfFiltro, setNfFiltro] = useState('');
  const [openDe, setOpenDe] = useState(false);
  const [openAte, setOpenAte] = useState(false);

  const contextoClientes = useMemo(() => {
    const pedidos = cargaFiltro?.pedidos_omie || [];
    return {
      cnpjs: pedidos.map(p => p.cnpj_cpf_cliente),
      codigos: pedidos.flatMap(p => [p.codigo_cliente, p.codigo_cliente_cod])
    };
  }, [cargaFiltro]);

  const { isClienteBoleto } = useModalidadeBoleto(contextoClientes);

  // Extrai CNPJs dos clientes da carga (para filtrar a busca Omie por cliente)
  const documentosCarga = (carga) => new Set([
    ...(carga?.pedidos_omie || []).flatMap(p => [p.cnpj_cpf_cliente, p.cpf_cnpj_cliente]),
    ...(carga?.pedidos_internos || []).map(p => p.cnpj_cpf_cliente),
    ...(carga?.pedidos_troca || []).map(p => p.cnpj_cpf_cliente)
  ].filter(Boolean).map(doc => String(doc).replace(/\D/g, '')));

  // Extrai números de pedido, códigos de pedido, NFs e códigos de cliente da carga
  // (mesma lógica usada em EmissaoBoletos que funciona corretamente)
  const dadosCargaParaMatch = (carga) => {
    if (!carga) return { numPedidos: new Set(), codPedidos: new Set(), nfs: new Set(), codClientes: new Set() };
    const numPedidos = new Set();
    const codPedidos = new Set();
    const nfs = new Set();
    const codClientes = new Set();
    (carga.pedidos_omie || []).forEach(p => {
      if (p.numero_pedido) numPedidos.add(String(p.numero_pedido).trim());
      if (p.codigo_pedido) codPedidos.add(String(p.codigo_pedido).trim());
      const nf = String(p.numero_nf || '').replace(/\D/g, '');
      if (nf) nfs.add(nf);
      const cod = String(p.codigo_cliente || '').trim();
      if (cod) codClientes.add(cod);
    });
    (carga.pedidos_internos || []).forEach(p => {
      if (p.numero_pedido) numPedidos.add(String(p.numero_pedido).trim());
    });
    (carga.pedidos_troca || []).forEach(p => {
      if (p.numero_pedido) numPedidos.add(String(p.numero_pedido).trim());
    });
    return { numPedidos, codPedidos, nfs, codClientes };
  };

  const filtrarTitulosPorCarga = (titulos, carga) => {
    if (!carga) return titulos;

    const { numPedidos, codPedidos, nfs } = dadosCargaParaMatch(carga);

    // Match estrito: apenas por pedido vinculado ou NF. SEM fallback por cliente/CNPJ.
    const resultado = [];
    let excluidos = 0;

    (titulos || []).forEach(t => {
      const docT = String(t.numero_documento || '').replace(/\D/g, '');
      const numPedVinc = String(t.numero_pedido_vinculado || '').trim();

      // Prioridade 1: match exato por numero_pedido_vinculado
      if (numPedVinc) {
        if (numPedidos.has(numPedVinc) || codPedidos.has(numPedVinc)) {
          resultado.push(t);
        } else {
          excluidos++;
        }
        return;
      }
      // Prioridade 2: match por NF (numero_documento normalizado)
      if (docT) {
        if (nfs.has(docT) || numPedidos.has(docT)) {
          resultado.push(t);
        } else {
          excluidos++;
        }
        return;
      }
      // Sem pedido vinculado e sem documento → excluir (sem fallback por cliente)
      excluidos++;
    });

    return resultado;
  };

  const buscar = useCallback(async (carga = cargaFiltro, filtrosBusca = {}) => {
    setLoading(true);
    try {
      let acumulados = [];

      let houveFalhaOmie = false;
      if (carga) {
        // ✅ Helper UNIFICADO (mesmo da aba Emissão): boletos já emitidos do LOCAL
        // (instantâneo) + títulos sem boleto buscados no Omie EM PARALELO. Já vem filtrado
        // pelos pedidos da carga e deduplicado por codigo_lancamento.
        const resp = await buscarTitulosCarga(carga);
        acumulados = resp.titulos;
        houveFalhaOmie = resp.houveFalhaOmie;
      } else {
        // BUSCA GENÉRICA (sem carga): mantém comportamento original
        const dataDeStr = filtrosBusca.dataDe || dateToBR(dataDe) || undefined;
        const dataAteStr = filtrosBusca.dataAte || dateToBR(dataAte) || undefined;

        const { data } = await base44.functions.invoke('listarContasReceberOmie', {
          data_de: dataDeStr,
          data_ate: dataAteStr,
          filtrar_por_data: filtrosBusca.filtrarPor || filtrarPor,
          cnpj_cpf: cnpj || undefined,
          apenas_pendentes: false,
          registros_por_pagina: 200,
          bypassCache: true
        });
        if (!data?.sucesso) {
          toast.error(data?.error || 'Erro ao buscar');
          setLoading(false);
          return;
        }
        acumulados = data.titulos || [];
      }

      // Quando há carga, buscarTitulosCarga já filtrou pelos pedidos da carga.
      let titulosFiltrados = carga ? acumulados : filtrarTitulosPorCarga(acumulados, carga);
      if (apenasComBoleto) {
        titulosFiltrados = titulosFiltrados.filter(t =>
          t.boleto_gerado ||
          (t.numero_boleto && String(t.numero_boleto).trim()) ||
          (t.url_boleto && String(t.url_boleto).trim()) ||
          (t.codigo_barras && String(t.codigo_barras).trim())
        );
      }
      if (nfFiltro.trim()) {
        const nfBusca = nfFiltro.trim().replace(/\D/g, '');
        titulosFiltrados = titulosFiltrados.filter(t => {
          const doc = String(t.numero_documento || '').replace(/\D/g, '');
          return doc.includes(nfBusca);
        });
      }
      if (apenasClientesBoleto) {
        const antes = titulosFiltrados.length;
        titulosFiltrados = titulosFiltrados.filter(isClienteBoleto);
        setOcultosNaoBoleto(antes - titulosFiltrados.length);
      } else {
        setOcultosNaoBoleto(0);
      }
      onResultado(titulosFiltrados, filtrosBusca.filtrarPor || filtrarPor);
      // Só avisa "Omie limitou" se REALMENTE faltar boleto: pedidos de venda com NF E
      // modalidade Boleto Bancário (à vista não gera boleto). Se houve falha mas todos os
      // pedidos-boleto já foram resolvidos (local+Omie), não assusta.
      const pedidosEsperados = (carga?.pedidos_omie || []).filter(p => {
        const tipo = p.tipo_operacao || p.tipo_nota || 'venda';
        if (tipo !== 'venda' || !somenteNumeros(p.numero_nf)) return false;
        return isClienteBoleto({
          cnpj_cpf: p.cnpj_cpf_cliente,
          codigo_cliente: p.codigo_cliente,
          codigo_cliente_cod: p.codigo_cliente_cod
        });
      }).length;
      const faltamTitulos = houveFalhaOmie && pedidosEsperados > acumulados.length;
      if (carga && faltamTitulos) {
        toast.warning(`Omie limitou o ritmo — alguns títulos da carga ${carga.numero_carga} podem não ter sido verificados. Tente Buscar novamente em instantes.`);
      } else if (carga && titulosFiltrados.length === 0) {
        toast.warning(`Nenhum boleto encontrado para os pedidos da carga ${carga.numero_carga}. Os títulos do cliente existem no Omie, mas não correspondem aos pedidos desta carga.`);
      } else if (carga) {
        toast.success(`${titulosFiltrados.length} boleto(s) da carga ${carga.numero_carga}`);
      } else {
        toast.success(`${titulosFiltrados.length} boleto(s) encontrado(s)`);
      }
    } catch (e) {
      toast.error(e.message);
    }
    setLoading(false);
  }, [cargaFiltro, dataDe, dataAte, filtrarPor, cnpj, apenasComBoleto, apenasClientesBoleto]);

  const buscarCarga = async () => {
    if (!cargaBusca.trim()) return;
    setCargaLoading(true);
    try {
      const cargas = await base44.entities.Carga.filter({ numero_carga: cargaBusca.trim().padStart(3, '0') }, '-created_date', 1);
      const carga = cargas?.[0];
      if (!carga) {
        toast.error(`Carga ${cargaBusca} não encontrada`);
        setCargaLoading(false);
        return;
      }
      setCargaFiltro(carga);
      setCnpj('');
      toast.success(`Carga ${carga.numero_carga} selecionada — ${carga.quantidade_pedidos || 0} pedido(s)`);
    } catch (e) {
      toast.error(e.message);
    }
    setCargaLoading(false);
  };

  const limparCarga = () => {
    setCargaFiltro(null);
    setCargaBusca('');
  };

  useEffect(() => {
    const cargaId = new URLSearchParams(window.location.search).get('carga_id');
    if (!cargaId) return;
    const carregarCarga = async () => {
      const cargas = await base44.entities.Carga.filter({ id: cargaId }, '-created_date', 1);
      const carga = cargas?.[0];
      if (!carga) return;
      setCargaFiltro(carga);
      setCargaBusca(carga.numero_carga || '');
      if (carga.data_carga) {
        const [y, m, d] = carga.data_carga.split('-');
        const dataObj = new Date(Number(y), Number(m) - 1, Number(d));
        setDataDe(dataObj);
        setDataAte(dataObj);
        setFiltrarPor('E');
        const dataBr = `${d}/${m}/${y}`;
        setTimeout(() => buscar(carga, { dataDe: dataBr, dataAte: dataBr, filtrarPor: 'E' }), 0);
      } else {
        setTimeout(() => buscar(carga), 0);
      }
    };
    carregarCarga();
  }, []);

  const qtdPedidosCarga = cargaFiltro
    ? (cargaFiltro.pedidos_omie?.length || 0) + (cargaFiltro.pedidos_internos?.length || 0) + (cargaFiltro.pedidos_troca?.length || 0)
    : 0;

  return (
    <>
      {cargaFiltro && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-blue-800">
              <Truck className="w-4 h-4" />
              <span>Filtrando pela carga <b>{cargaFiltro.numero_carga}</b> — {qtdPedidosCarga} pedido(s), {cargaFiltro.quantidade_clientes || 0} cliente(s)</span>
              {cargaFiltro.data_carga && (
                <Badge variant="outline" className="text-blue-700 border-blue-300 ml-1">
                  {format(new Date(cargaFiltro.data_carga + 'T12:00:00'), 'dd/MM/yyyy')}
                </Badge>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={limparCarga} className="text-blue-600 hover:text-blue-800 hover:bg-blue-100">
              <X className="w-4 h-4 mr-1" /> Limpar
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-7 gap-3">
            <div>
              <Label>Filtrar por</Label>
              <Select value={filtrarPor} onValueChange={setFiltrarPor}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="E">Emissão</SelectItem>
                  <SelectItem value="V">Vencimento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Data de</Label>
              <Popover open={openDe} onOpenChange={setOpenDe}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal h-9">
                    <CalendarIcon className="w-4 h-4 mr-2 text-muted-foreground" />
                    {dataDe ? format(dataDe, 'dd/MM/yyyy') : 'Selecionar'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dataDe}
                    onSelect={(d) => { setDataDe(d); setOpenDe(false); }}
                    locale={ptBR}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Data até</Label>
              <Popover open={openAte} onOpenChange={setOpenAte}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal h-9">
                    <CalendarIcon className="w-4 h-4 mr-2 text-muted-foreground" />
                    {dataAte ? format(dataAte, 'dd/MM/yyyy') : 'Selecionar'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dataAte}
                    onSelect={(d) => { setDataAte(d); setOpenAte(false); }}
                    locale={ptBR}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Nº Carga</Label>
              <div className="flex gap-1">
                <Input
                  value={cargaBusca}
                  onChange={(e) => setCargaBusca(e.target.value)}
                  placeholder="Ex: 067"
                  onKeyDown={(e) => e.key === 'Enter' && buscarCarga()}
                  disabled={!!cargaFiltro}
                />
                {!cargaFiltro && (
                  <Button variant="outline" size="icon" onClick={buscarCarga} disabled={cargaLoading || !cargaBusca.trim()} className="shrink-0">
                    {cargaLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
                  </Button>
                )}
              </div>
            </div>
            <div>
              <Label>Nº NF</Label>
              <Input
                value={nfFiltro}
                onChange={(e) => setNfFiltro(e.target.value)}
                placeholder="Ex: 12345"
                onKeyDown={(e) => e.key === 'Enter' && buscar()}
              />
            </div>
            <div>
              <Label>CNPJ/CPF</Label>
              <Input
                value={cnpj}
                onChange={(e) => setCnpj(e.target.value)}
                placeholder="Opcional"
                disabled={!!cargaFiltro}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={() => buscar()} disabled={loading} className="w-full">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                Buscar
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={apenasComBoleto}
                onChange={(e) => setApenasComBoleto(e.target.checked)}
                className="w-4 h-4"
              />
              Apenas títulos com boleto emitido
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={apenasClientesBoleto}
                onChange={(e) => setApenasClientesBoleto(e.target.checked)}
                className="w-4 h-4"
              />
              Apenas clientes com modalidade Boleto Bancário
            </label>
            {ocultosNaoBoleto > 0 && (
              <Badge className="bg-orange-100 text-orange-800 text-xs">
                <AlertTriangle className="w-3 h-3 mr-1" />
                {ocultosNaoBoleto} oculto(s) — outra modalidade
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}