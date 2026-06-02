import React, { useEffect, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

const normalizar = (valor) => String(valor || '').trim().toUpperCase();
const somenteNumeros = (valor) => String(valor || '').replace(/\D/g, '');
const BOLETO_BANCARIO_ID_FALLBACK = '69ff70445fbcb49b659710df';

// Gera data padrão DD/MM/AAAA (últimos 30 dias)
const defaultDataDe = () => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
};
const defaultDataAte = () => {
  const d = new Date();
  d.setDate(d.getDate() + 90); // 90 dias futuro para pegar A VENCER
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
};

export default function FiltrosBoletos({ onResultado }) {
  const [dataDe, setDataDe] = useState(defaultDataDe());
  const [dataAte, setDataAte] = useState(defaultDataAte());
  const [filtrarPor, setFiltrarPor] = useState('E');
  const [cnpj, setCnpj] = useState('');
  const [apenasComBoleto, setApenasComBoleto] = useState(true);
  const [loading, setLoading] = useState(false);
  const [cargaFiltro, setCargaFiltro] = useState(null);
  const [ocultosNaoBoleto, setOcultosNaoBoleto] = useState(0);
  const [apenasClientesBoleto, setApenasClientesBoleto] = useState(false);

  const { data: modalidades = [] } = useQuery({
    queryKey: ['modalidades-pagamento-filtro-boletos'],
    queryFn: () => base44.entities.ModalidadePagamento.list(),
    refetchOnWindowFocus: false
  });

  const { data: clientesBase = [] } = useQuery({
    queryKey: ['clientes-modalidade-filtro-boletos'],
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

  const clientesBoletoMap = useMemo(() => {
    const porCodigoOmie = new Map();
    const porCnpj = new Map();
    clientesBase.forEach(cliente => {
      if (!modalidadeBoletoIds.has(cliente.modalidade_pagamento_id)) return;
      [cliente.codigo_omie, cliente.codigo_cliente_omie].forEach(codigo => {
        const key = String(codigo || '').trim();
        if (key) porCodigoOmie.set(key, cliente);
      });
      const cn = somenteNumeros(cliente.cnpj_cpf);
      if (cn) porCnpj.set(cn, cliente);
    });
    return { porCodigoOmie, porCnpj };
  }, [clientesBase, modalidadeBoletoIds]);

  const isClienteBoleto = (titulo) => {
    if (clientesBoletoMap.porCodigoOmie.has(String(titulo.codigo_cliente || '').trim())) return true;
    if (clientesBoletoMap.porCnpj.has(somenteNumeros(titulo.cnpj_cpf))) return true;
    return false;
  };

  const documentosCarga = (carga) => new Set([
    ...(carga?.pedidos_omie || []).flatMap(p => [p.cnpj_cpf_cliente, p.cpf_cnpj_cliente]),
    ...(carga?.pedidos_internos || []).map(p => p.cnpj_cpf_cliente),
    ...(carga?.pedidos_troca || []).map(p => p.cnpj_cpf_cliente)
  ].filter(Boolean).map(doc => String(doc).replace(/\D/g, '')));

  const filtrarTitulosPorCarga = (titulos, carga) => {
    const docs = documentosCarga(carga);
    if (!carga || docs.size === 0) return titulos;
    return (titulos || []).filter(t => docs.has(String(t.cnpj_cpf || '').replace(/\D/g, '')));
  };

  const buscar = async (carga = cargaFiltro, filtrosBusca = {}) => {
    setLoading(true);
    try {
      const { data } = await base44.functions.invoke('listarContasReceberOmie', {
        data_de: filtrosBusca.dataDe || dataDe || undefined,
        data_ate: filtrosBusca.dataAte || dataAte || undefined,
        filtrar_por_data: filtrosBusca.filtrarPor || filtrarPor,
        cnpj_cpf: cnpj || undefined,
        apenas_pendentes: false,
        registros_por_pagina: 200
      });
      if (data?.sucesso) {
        let titulosFiltrados = filtrarTitulosPorCarga(data.titulos || [], carga);
        if (apenasComBoleto) {
          titulosFiltrados = titulosFiltrados.filter(t =>
            t.boleto_gerado ||
            (t.numero_boleto && String(t.numero_boleto).trim()) ||
            (t.url_boleto && String(t.url_boleto).trim()) ||
            (t.codigo_barras && String(t.codigo_barras).trim())
          );
        }
        // Filtro de modalidade: só clientes com BOLETO BANCÁRIO
        if (apenasClientesBoleto) {
          const antes = titulosFiltrados.length;
          titulosFiltrados = titulosFiltrados.filter(isClienteBoleto);
          setOcultosNaoBoleto(antes - titulosFiltrados.length);
        } else {
          setOcultosNaoBoleto(0);
        }
        onResultado(titulosFiltrados);
        toast.success(`${titulosFiltrados.length} boleto(s) encontrado(s)`);
      } else {
        toast.error(data?.error || 'Erro ao buscar');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    const cargaId = new URLSearchParams(window.location.search).get('carga_id');
    if (!cargaId) return;

    const carregarCarga = async () => {
      const cargas = await base44.entities.Carga.filter({ id: cargaId }, '-created_date', 1);
      const carga = cargas?.[0];
      if (!carga) return;
      setCargaFiltro(carga);
      let filtrosCarga = {};
      if (carga.data_carga) {
        const [y, m, d] = carga.data_carga.split('-');
        const dataBr = `${d}/${m}/${y}`;
        filtrosCarga = { dataDe: dataBr, dataAte: dataBr, filtrarPor: 'E' };
        setDataDe(dataBr);
        setDataAte(dataBr);
        setFiltrarPor('E');
      }
      setTimeout(() => buscar(carga, filtrosCarga), 0);
    };

    carregarCarga();
  }, []);

  return (
    <>
      {cargaFiltro && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-3 text-sm text-blue-800">
            Exibindo boletos filtrados pela carga <b>{cargaFiltro.numero_carga}</b>.
          </CardContent>
        </Card>
      )}
      <Card>
      <CardContent className="pt-4">
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
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
            <Label>Data de (DD/MM/AAAA)</Label>
            <Input value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
          </div>
          <div>
            <Label>Data até (DD/MM/AAAA)</Label>
            <Input value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
          </div>
          <div>
            <Label>CNPJ/CPF (opcional)</Label>
            <Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button onClick={() => buscar()} disabled={loading} className="w-full">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
              Buscar
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-3 text-sm">
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