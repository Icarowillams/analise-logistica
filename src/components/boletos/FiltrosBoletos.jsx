import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function FiltrosBoletos({ onResultado }) {
  const hoje = new Date();
  const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const daqui30 = new Date(hoje.getTime() + 30 * 86400000);

  const [dataDe, setDataDe] = useState(fmt(hoje));
  const [dataAte, setDataAte] = useState(fmt(daqui30));
  const [filtrarPor, setFiltrarPor] = useState('V');
  const [cnpj, setCnpj] = useState('');
  const [loading, setLoading] = useState(false);
  const [cargaFiltro, setCargaFiltro] = useState(null);

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
        data_de: filtrosBusca.dataDe || dataDe,
        data_ate: filtrosBusca.dataAte || dataAte,
        filtrar_por_data: filtrosBusca.filtrarPor || filtrarPor,
        cnpj_cpf: cnpj || undefined,
        apenas_pendentes: true,
        registros_por_pagina: 200
      });
      if (data?.sucesso) {
        const titulosFiltrados = filtrarTitulosPorCarga(data.titulos || [], carga);
        onResultado(titulosFiltrados);
        toast.success(`${titulosFiltrados.length} títulos em aberto`);
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
                <SelectItem value="V">Vencimento</SelectItem>
                <SelectItem value="E">Emissão</SelectItem>
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
      </CardContent>
      </Card>
    </>
  );
}