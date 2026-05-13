import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Search, Eye, Loader2, Printer, Layers } from 'lucide-react';
import { toast } from 'sonner';
import NfCompletaDialog from '@/components/notasOmie/NfCompletaDialog';
import NfsImpressaoDialog from '@/components/notasOmie/NfsImpressaoDialog';

/**
 * Aba de Notas Fiscais Nota 55 (NF-e Omie).
 * - Seleção múltipla (checkbox por linha + "selecionar todas").
 * - Botões: Imprimir (separado) | Imprimir Agrupado (PDF único mesclado).
 * - Botão "Ver" continua extraindo o detalhe completo da NF.
 */
export default function NotasNF55Tab({ cargaFiltro, ativa = true }) {
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
    cnpj_cliente: '',
    numero_carga: ''
  });
  const [pagina, setPagina] = useState(1);
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [loadingDetalhe, setLoadingDetalhe] = useState(null);
  const [detalheCompleto, setDetalheCompleto] = useState(null);
  const [busca, setBusca] = useState('');

  // Seleção e impressão
  const [selecionadas, setSelecionadas] = useState(new Set()); // chaves: nIdNF || nCodNF || cNumero
  const [impressaoOpen, setImpressaoOpen] = useState(false);
  const [impressaoModo, setImpressaoModo] = useState('individual'); // 'individual' | 'agrupado'
  const [nfsParaImprimir, setNfsParaImprimir] = useState([]);

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
    setSelecionadas(new Set());
    try {
      let cargaParaFiltrar = carga;
      if (!cargaParaFiltrar && filtrosBusca.numero_carga?.trim()) {
        const numeroBusca = filtrosBusca.numero_carga.trim();
        const cargas = await base44.entities.Carga.filter({ numero_carga: numeroBusca });
        if (cargas?.length > 0) {
          cargaParaFiltrar = cargas[0];
        } else {
          toast.warning(`Carga "${numeroBusca}" não encontrada`);
          setResultado({ nfs: [], total_de_registros: 0, total_de_paginas: 1 });
          setLoading(false);
          return;
        }
      }
      const { data } = await base44.functions.invoke('listarNfsOmie', {
        ...filtrosBusca,
        pagina: pg,
        registros_por_pagina: 50
      });
      if (data?.sucesso) {
        const nfsFiltradas = filtrarNfsPorCarga(data.nfs || [], cargaParaFiltrar);
        setResultado(cargaParaFiltrar ? { ...data, nfs: nfsFiltradas, total_de_registros: nfsFiltradas.length, total_de_paginas: 1 } : data);
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

  // Ao receber cargaFiltro pela URL, zera o período e dispara busca pela carga
  useEffect(() => {
    if (!cargaFiltro || !ativa) return;
    const filtrosCarga = { ...filtros, data_inicial: '', data_final: '' };
    setFiltros(filtrosCarga);
    const timer = setTimeout(() => buscar(1, cargaFiltro, filtrosCarga), 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargaFiltro, ativa]);

  const nfs = resultado?.nfs || [];
  const keyOf = (nf) => String(nf.nIdNF || nf.nCodNF || nf.cNumero);

  const nfsFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return nfs;
    return nfs.filter(nf =>
      String(nf.cNumero || '').toLowerCase().includes(termo) ||
      String(nf.cRazao || '').toLowerCase().includes(termo) ||
      String(nf.cCPFCNPJDest || '').toLowerCase().includes(termo) ||
      String(nf.cChaveNFe || '').toLowerCase().includes(termo)
    );
  }, [nfs, busca]);

  const todasMarcadas = nfsFiltradas.length > 0 && nfsFiltradas.every(nf => selecionadas.has(keyOf(nf)));
  const algumasMarcadas = nfsFiltradas.some(nf => selecionadas.has(keyOf(nf)));

  const toggleTodas = () => {
    const novo = new Set(selecionadas);
    if (todasMarcadas) {
      nfsFiltradas.forEach(nf => novo.delete(keyOf(nf)));
    } else {
      nfsFiltradas.forEach(nf => novo.add(keyOf(nf)));
    }
    setSelecionadas(novo);
  };

  const toggleLinha = (nf) => {
    const novo = new Set(selecionadas);
    const k = keyOf(nf);
    if (novo.has(k)) novo.delete(k); else novo.add(k);
    setSelecionadas(novo);
  };

  const abrirImpressao = (modo) => {
    const sel = nfs.filter(nf => selecionadas.has(keyOf(nf)));
    if (sel.length === 0) {
      toast.warning('Selecione ao menos uma NF.');
      return;
    }
    setNfsParaImprimir(sel);
    setImpressaoModo(modo);
    setImpressaoOpen(true);
  };

  const formatarValor = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const statusBadge = (v) => {
    const status = !v || v === 'F' ? 'Faturado' : v === 'A' ? 'Autorizada' : v === 'C' ? 'Cancelada' : v;
    const cor = status === 'Faturado' || status === 'Autorizada' ? 'bg-green-100 text-green-800' : status === 'Cancelada' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800';
    return <Badge className={cor}>{status}</Badge>;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros — Nota 55 (NF-e Omie)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div>
              <Label>Data inicial (DD/MM/AAAA)</Label>
              <Input value={filtros.data_inicial} onChange={(e) => setFiltros({ ...filtros, data_inicial: e.target.value })} placeholder="01/04/2026" />
            </div>
            <div>
              <Label>Data final (DD/MM/AAAA)</Label>
              <Input value={filtros.data_final} onChange={(e) => setFiltros({ ...filtros, data_final: e.target.value })} placeholder="20/04/2026" />
            </div>
            <div>
              <Label>Nome cliente</Label>
              <Input value={filtros.nome_cliente} onChange={(e) => setFiltros({ ...filtros, nome_cliente: e.target.value })} />
            </div>
            <div>
              <Label>CNPJ/CPF</Label>
              <Input value={filtros.cnpj_cliente} onChange={(e) => setFiltros({ ...filtros, cnpj_cliente: e.target.value })} />
            </div>
            <div>
              <Label>Nº Carga</Label>
              <Input placeholder="Ex: 009" value={filtros.numero_carga} onChange={(e) => setFiltros({ ...filtros, numero_carga: e.target.value })} />
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
            <CardTitle className="text-base flex flex-wrap items-center justify-between gap-3">
              <span>
                {resultado.total_de_registros || 0} NFs encontradas
                {selecionadas.size > 0 && (
                  <span className="ml-2 text-sm font-normal text-cyan-700">({selecionadas.size} selecionada{selecionadas.size > 1 ? 's' : ''})</span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => abrirImpressao('individual')}
                  disabled={selecionadas.size === 0}
                >
                  <Printer className="w-4 h-4 mr-2" />
                  Imprimir
                </Button>
                <Button
                  size="sm"
                  className="bg-cyan-600 hover:bg-cyan-700 text-white"
                  onClick={() => abrirImpressao('agrupado')}
                  disabled={selecionadas.size === 0}
                >
                  <Layers className="w-4 h-4 mr-2" />
                  Imprimir Agrupado
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative max-w-sm mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input placeholder="Buscar..." value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-9" />
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50/80 text-slate-700">
                  <tr>
                    <th className="p-2 w-10 text-center">
                      <Checkbox checked={todasMarcadas} onCheckedChange={toggleTodas} aria-label="Selecionar todas" />
                    </th>
                    <th className="p-2 text-left font-semibold">Nº NF</th>
                    <th className="p-2 text-left font-semibold">Série</th>
                    <th className="p-2 text-left font-semibold">Emissão</th>
                    <th className="p-2 text-left font-semibold">Cliente</th>
                    <th className="p-2 text-left font-semibold">CNPJ/CPF</th>
                    <th className="p-2 text-right font-semibold">Valor</th>
                    <th className="p-2 text-left font-semibold">Status</th>
                    <th className="p-2 text-left font-semibold">Extrair</th>
                  </tr>
                </thead>
                <tbody>
                  {nfsFiltradas.length === 0 ? (
                    <tr>
                      <td colSpan="9" className="text-center py-12 text-slate-500">Nenhuma NF encontrada</td>
                    </tr>
                  ) : nfsFiltradas.map((nf) => {
                    const k = keyOf(nf);
                    const marcada = selecionadas.has(k);
                    return (
                      <tr key={k} className={`border-t hover:bg-slate-50/50 transition-colors ${marcada ? 'bg-cyan-50/40' : ''}`}>
                        <td className="p-2 text-center">
                          <Checkbox checked={marcada} onCheckedChange={() => toggleLinha(nf)} aria-label={`Selecionar NF ${nf.cNumero}`} />
                        </td>
                        <td className="p-2">{nf.cNumero}</td>
                        <td className="p-2">{nf.cSerie}</td>
                        <td className="p-2">{nf.dEmiNF}</td>
                        <td className="p-2">{nf.cRazao}</td>
                        <td className="p-2">{nf.cCPFCNPJDest}</td>
                        <td className="p-2 text-right">{formatarValor(nf.nValorNF)}</td>
                        <td className="p-2">{statusBadge(nf.cStatus)}</td>
                        <td className="p-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => extrairCompleto(nf)}
                            disabled={loadingDetalhe === (nf.nIdNF || nf.nCodNF || nf.cNumero)}
                          >
                            {loadingDetalhe === (nf.nIdNF || nf.nCodNF || nf.cNumero)
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <><Eye className="w-4 h-4 mr-1" />Ver</>}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {resultado.total_de_paginas > 1 && (
              <div className="flex justify-end gap-2 items-center text-sm mt-3">
                <Button size="sm" variant="outline" disabled={pagina <= 1 || loading} onClick={() => buscar(pagina - 1)}>Anterior</Button>
                <span>Página {pagina} / {resultado.total_de_paginas}</span>
                <Button size="sm" variant="outline" disabled={pagina >= resultado.total_de_paginas || loading} onClick={() => buscar(pagina + 1)}>Próxima</Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <NfCompletaDialog
        open={!!detalheCompleto}
        onOpenChange={(open) => !open && setDetalheCompleto(null)}
        detalhe={detalheCompleto}
      />

      <NfsImpressaoDialog
        open={impressaoOpen}
        onOpenChange={setImpressaoOpen}
        nfs={nfsParaImprimir}
        modo={impressaoModo}
      />
    </div>
  );
}