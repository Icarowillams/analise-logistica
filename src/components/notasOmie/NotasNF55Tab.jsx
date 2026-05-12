import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Search, Eye, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import DataTable from '@/components/ui/DataTable';
import NfCompletaDialog from '@/components/notasOmie/NfCompletaDialog';

/**
 * Aba de Notas Fiscais Nota 55 (NF-e Omie) — conteúdo histórico da página NotasOmie.
 */
export default function NotasNF55Tab({ cargaFiltro }) {
  const hoje = new Date().toISOString().slice(0, 10);
  const primeiroDia = hoje.slice(0, 8) + '01';
  const formatarData = (d) => {
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };

  const [filtros, setFiltros] = useState({
    data_inicial: formatarData(primeiroDia),
    data_final: formatarData(hoje),
    nome_cliente: '',
    cnpj_cliente: ''
  });
  const [pagina, setPagina] = useState(1);
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [loadingDetalhe, setLoadingDetalhe] = useState(null);
  const [detalheCompleto, setDetalheCompleto] = useState(null);

  const getNotasCarga = (carga) => new Set([
    ...(carga?.notas_fiscais || []),
    ...(carga?.pedidos_omie || []).flatMap(p => [p.numero_nf, p.numero_nota_fiscal, p.nf, p.nota_fiscal])
  ].filter(Boolean).map(n => String(n).replace(/\D/g, '')));

  const filtrarNfsPorCarga = (nfs, carga) => {
    const notasCarga = getNotasCarga(carga);
    if (!carga || notasCarga.size === 0) return nfs;
    return (nfs || []).filter(nf => notasCarga.has(String(nf.cNumero || '').replace(/\D/g, '')));
  };

  const buscar = async (pg = 1, carga = cargaFiltro, filtrosBusca = filtros) => {
    setLoading(true);
    try {
      const { data } = await base44.functions.invoke('listarNfsOmie', {
        ...filtrosBusca,
        pagina: pg,
        registros_por_pagina: 50
      });
      if (data?.sucesso) {
        const nfsFiltradas = filtrarNfsPorCarga(data.nfs || [], carga);
        setResultado(carga ? { ...data, nfs: nfsFiltradas, total_de_registros: nfsFiltradas.length, total_de_paginas: 1 } : data);
        setPagina(pg);
      } else {
        toast.error(data?.error || 'Erro ao consultar NFs');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setLoading(false);
  };

  const extrairCompleto = async (nf) => {
    setLoadingDetalhe(nf.nIdNF || nf.nCodNF || nf.cNumero);
    try {
      const { data } = await base44.functions.invoke('consultarDetalheNotaOmie', {
        nIdNF: nf.nIdNF || nf.nCodNF,
        nCodNF: nf.nCodNF || nf.nIdNF,
        nNF: nf.cNumero,
        nIdPedido: nf.nIdPedido
      });
      if (data?.sucesso) setDetalheCompleto(data);
      else toast.error(data?.error || 'Não foi possível extrair a NF-e');
    } catch (e) {
      toast.error(e.message);
    }
    setLoadingDetalhe(null);
  };

  // Ao receber cargaFiltro pela URL, ajusta datas e dispara busca
  useEffect(() => {
    if (!cargaFiltro) return;
    let filtrosCarga = filtros;
    if (cargaFiltro.data_carga) {
      const [y, m, d] = cargaFiltro.data_carga.split('-');
      filtrosCarga = { ...filtros, data_inicial: `${d}/${m}/${y}`, data_final: `${d}/${m}/${y}` };
      setFiltros(filtrosCarga);
    }
    setTimeout(() => buscar(1, cargaFiltro, filtrosCarga), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargaFiltro]);

  const columns = [
    { key: 'cNumero', label: 'Nº NF', width: '100px', sortable: true },
    { key: 'cSerie', label: 'Série', width: '70px' },
    { key: 'dEmiNF', label: 'Emissão', width: '110px', sortable: true },
    { key: 'cRazao', label: 'Cliente' },
    { key: 'cCPFCNPJDest', label: 'CNPJ/CPF', width: '160px' },
    {
      key: 'nValorNF',
      label: 'Valor',
      width: '120px',
      sortable: true,
      render: (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    },
    {
      key: 'cStatus',
      label: 'Status',
      width: '100px',
      render: (v) => {
        const status = !v || v === 'F' ? 'Faturado' : v === 'A' ? 'Autorizada' : v === 'C' ? 'Cancelada' : v;
        const cor = status === 'Faturado' || status === 'Autorizada' ? 'bg-green-100 text-green-800' : status === 'Cancelada' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800';
        return <Badge className={cor}>{status}</Badge>;
      }
    },
    {
      key: 'acoes',
      label: 'Extrair',
      width: '110px',
      render: (_, row) => (
        <Button
          size="sm"
          variant="outline"
          onClick={() => extrairCompleto(row)}
          disabled={loadingDetalhe === (row.nIdNF || row.nCodNF || row.cNumero)}
        >
          {loadingDetalhe === (row.nIdNF || row.nCodNF || row.cNumero) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4 mr-1" />}
          Ver
        </Button>
      )
    }
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros — Nota 55 (NF-e Omie)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <Label>Data inicial (DD/MM/AAAA)</Label>
              <Input
                value={filtros.data_inicial}
                onChange={(e) => setFiltros({ ...filtros, data_inicial: e.target.value })}
                placeholder="01/04/2026"
              />
            </div>
            <div>
              <Label>Data final (DD/MM/AAAA)</Label>
              <Input
                value={filtros.data_final}
                onChange={(e) => setFiltros({ ...filtros, data_final: e.target.value })}
                placeholder="20/04/2026"
              />
            </div>
            <div>
              <Label>Nome cliente</Label>
              <Input
                value={filtros.nome_cliente}
                onChange={(e) => setFiltros({ ...filtros, nome_cliente: e.target.value })}
              />
            </div>
            <div>
              <Label>CNPJ/CPF</Label>
              <Input
                value={filtros.cnpj_cliente}
                onChange={(e) => setFiltros({ ...filtros, cnpj_cliente: e.target.value })}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={() => buscar(1)} disabled={loading} className="w-full">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                Buscar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {resultado && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>{resultado.total_de_registros || 0} NFs encontradas</span>
              {resultado.total_de_paginas > 1 && (
                <div className="flex gap-2 items-center text-sm">
                  <Button size="sm" variant="outline" disabled={pagina <= 1 || loading} onClick={() => buscar(pagina - 1)}>
                    Anterior
                  </Button>
                  <span>Página {pagina} / {resultado.total_de_paginas}</span>
                  <Button size="sm" variant="outline" disabled={pagina >= resultado.total_de_paginas || loading} onClick={() => buscar(pagina + 1)}>
                    Próxima
                  </Button>
                </div>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              data={resultado.nfs || []}
              columns={columns}
              searchable
              searchFields={['cNumero', 'cRazao', 'cCPFCNPJDest', 'cChaveNFe']}
              pageSize={50}
              emptyMessage="Nenhuma NF encontrada"
            />
          </CardContent>
        </Card>
      )}

      <NfCompletaDialog
        open={!!detalheCompleto}
        onOpenChange={(open) => !open && setDetalheCompleto(null)}
        detalhe={detalheCompleto}
      />
    </div>
  );
}