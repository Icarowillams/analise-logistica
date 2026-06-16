import React, { useEffect, useMemo, useRef, useState } from 'react';
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ehBloqueioOmie = (msg) => /consumo indevido|consumo redundante|redundante|bloqueada|bloqueado|c[óo]digo 6|1880|aguarde|429|cota|rate/i.test(msg || '');

// Chama listarNfsOmie com 1 retry espaçado quando o Omie responde "consumo redundante" (CÓDIGO 6).
const listarNfsComRetry = async (payload) => {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const { data } = await base44.functions.invoke('listarNfsOmie', payload);
    const bloqueado = !data?.sucesso && ehBloqueioOmie(data?.error);
    if (bloqueado && tentativa === 0) {
      await sleep(3000); // aguarda e tenta mais 1 vez antes de desistir
      continue;
    }
    return data;
  }
};

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
  const [cargasPorNf, setCargasPorNf] = useState({}); // cNumero(normalizado) → numero_carga

  // Índice codigo_pedido → numero_carga cacheado em memória com TTL de 5 min.
  // Evita rebaixar todas as cargas a cada busca (eram ~2 MB / chamada).
  const indiceCargasRef = useRef({ dados: null, expira: 0 });
  const TTL_INDICE = 5 * 60 * 1000;

  // Índice PRIMÁRIO: nIdPedido (=Pedido.omie_codigo_pedido) → Pedido.numero_carga.
  // Pedido é a fonte da verdade do nº de carga; cacheado com o mesmo TTL de 5 min.
  const indicePedidosRef = useRef({ dados: null, expira: 0 });

  const getIndicePedidos = async () => {
    const agora = Date.now();
    if (indicePedidosRef.current.dados && indicePedidosRef.current.expira > agora) {
      return indicePedidosRef.current.dados;
    }
    // Monta o índice via BACKEND (service-role) — Pedido.list no frontend volta vazio por RLS de created_by.
    const { data } = await base44.functions.invoke('indiceCargasPorPedido', {});
    const indice = data?.indice || {}; // omie_codigo_pedido(=nIdPedido) → numero_carga
    indicePedidosRef.current = { dados: indice, expira: agora + TTL_INDICE };
    return indice;
  };

  const getIndiceCargas = async () => {
    const agora = Date.now();
    if (indiceCargasRef.current.dados && indiceCargasRef.current.expira > agora) {
      return indiceCargasRef.current.dados;
    }
    // Projeção de campos: traz só numero_carga, pedidos_omie e notas_fiscais (corta ~94% do payload).
    const cargas = await base44.entities.Carga.list('-created_date', 1000, ['numero_carga', 'pedidos_omie', 'notas_fiscais']);
    const indice = {}; // codigo_pedido → numero_carga  |  'nf:'+numNF → numero_carga
    cargas.forEach(c => {
      if (!c.numero_carga) return;
      (c.pedidos_omie || []).forEach(p => {
        const cod = String(p.codigo_pedido || '');
        if (cod && !indice[cod]) indice[cod] = c.numero_carga;
      });
      // Fallback por número de NF real (notas_fiscais), já que o ListarNF do Omie
      // raramente devolve nIdPedido no resumo.
      (c.notas_fiscais || []).forEach(nf => {
        const num = String(nf || '').replace(/\D/g, '');
        if (num) {
          const chave = 'nf:' + num;
          if (!indice[chave]) indice[chave] = c.numero_carga;
        }
      });
    });
    indiceCargasRef.current = { dados: indice, expira: agora + TTL_INDICE };
    return indice;
  };

  // Filtra NFs pela carga cruzando por DOIS critérios (qualquer um casa):
  //  1. nIdPedido da NF == codigo_pedido do pedido na carga (caminho normal)
  //  2. nNF normalizado da NF == numero_nf do pedido na carga (fallback quando o
  //     ListarNF do Omie não devolve nIdPedido — comum para NFs antigas ou
  //     emitidas via outros canais)
  const filtrarNfsPorCarga = (nfs, carga) => {
    if (!carga) return nfs;
    const pedidos = carga.pedidos_omie || [];
    const codigosPedido = new Set(
      pedidos.map(p => p.codigo_pedido && String(p.codigo_pedido)).filter(Boolean)
    );
    const numerosNf = new Set(
      pedidos
        .map(p => p.numero_nf && String(p.numero_nf).replace(/\D/g, ''))
        .filter(Boolean)
    );
    if (codigosPedido.size === 0 && numerosNf.size === 0) return [];
    return (nfs || []).filter(nf => {
      const idPedido = String(nf.nIdPedido || '');
      const numNf = String(nf.cNumero || '').replace(/\D/g, '');
      return (idPedido && codigosPedido.has(idPedido)) ||
             (numNf && numerosNf.has(numNf));
    });
  };

  // Mapeia NF (cNumero normalizado) → numero_carga usando nIdPedido (omie_codigo_pedido)
  // Estratégia: varre TODAS as cargas e indexa codigo_pedido → numero_carga;
  // depois para cada NF procura no índice pelo nIdPedido (que é o omie_codigo_pedido).
  const buscarCargasDasNfs = async (nfs) => {
    const mapa = {}; // cNumero(normalizado) → numero_carga
    if (!nfs || nfs.length === 0) return mapa;

    try {
      const [idxPedido, indice] = await Promise.all([
        getIndicePedidos(), // FONTE PRIMÁRIA: nIdPedido → numero_carga (via Pedido)
        getIndiceCargas()   // FALLBACK: cargas (pedidos_omie / notas_fiscais)
      ]);

      nfs.forEach(nf => {
        const num = String(nf.cNumero || '').replace(/\D/g, '');
        if (!num) return;
        const codPed = String(nf.nIdPedido || '');
        // 1) FONTE PRIMÁRIA: nIdPedido → Pedido.numero_carga
        if (codPed && idxPedido[codPed] != null) {
          mapa[num] = idxPedido[codPed];
          return;
        }
        // 2) fallback: cruza nIdPedido → codigo_pedido da carga
        if (codPed && indice[codPed]) {
          mapa[num] = indice[codPed];
          return;
        }
        // 3) fallback: cruza pelo número real da NF (notas_fiscais da carga)
        if (indice['nf:' + num]) mapa[num] = indice['nf:' + num];
      });
    } catch (e) { console.error('[NF55-DEBUG] buscarCargasDasNfs ERRO:', e); }

    return mapa;
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
      // Quando filtra por CARGA, precisamos varrer TODAS as páginas do período
      // (uma NF da carga pode estar em qualquer página). Caso contrário, só busca a página pg.
      let nfsAcumuladas = [];
      let dataFinalResp = null;
      if (cargaParaFiltrar) {
        // Estreita a janela de datas para o período da carga (± 7 dias) — menos páginas, menos chamadas.
        let filtrosCargaBusca = { ...filtrosBusca };
        if (cargaParaFiltrar.data_carga) {
          const base = new Date(cargaParaFiltrar.data_carga + 'T12:00:00');
          const ini = new Date(base); ini.setDate(ini.getDate() - 7);
          const fim = new Date(base); fim.setDate(fim.getDate() + 7);
          const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
          filtrosCargaBusca = { ...filtrosCargaBusca, data_inicial: fmt(ini), data_final: fmt(fim) };
        }

        // Quantas NFs esperamos desta carga? Para interromper assim que todas forem encontradas.
        const nfsEsperadas = (cargaParaFiltrar.pedidos_omie || [])
          .map(p => String(p.numero_nf || '').replace(/\D/g, ''))
          .filter(Boolean).length;

        let pagAtual = 1;
        const MAX_PAG = 20; // limite de segurança
        while (pagAtual <= MAX_PAG) {
          let data;
          try {
            data = await listarNfsComRetry({
              ...filtrosCargaBusca,
              pagina: pagAtual,
              registros_por_pagina: 200
            });
          } catch (e) {
            if (ehBloqueioOmie(e.message)) {
              toast.error('Omie temporariamente indisponível. Aguarde ~1 min e tente novamente.');
              setLoading(false);
              return;
            }
            throw e;
          }
          if (!data?.sucesso) {
            if (ehBloqueioOmie(data?.error)) {
              toast.error('Omie temporariamente indisponível. Aguarde ~1 min e tente novamente.');
            } else {
              toast.error(data?.error || 'Erro ao consultar NFs');
            }
            setLoading(false);
            return;
          }
          dataFinalResp = data;
          nfsAcumuladas = nfsAcumuladas.concat(data.nfs || []);

          // Parada antecipada: já encontrou todas as NFs esperadas da carga?
          if (nfsEsperadas > 0) {
            const encontradas = filtrarNfsPorCarga(
              nfsAcumuladas.filter(nf => nf.cStatus === 'autorizada'),
              cargaParaFiltrar
            ).length;
            if (encontradas >= nfsEsperadas) break;
          }

          const totalPag = Number(data.total_de_paginas || 1);
          if (pagAtual >= totalPag) break;
          pagAtual++;
          await sleep(1800); // espaça as chamadas (Omie pede ~18s p/ redundância — folga real evita CÓDIGO 6)
        }
        const apenasAutorizadas = nfsAcumuladas.filter(nf => nf.cStatus === 'autorizada');
        const nfsFiltradas = filtrarNfsPorCarga(apenasAutorizadas, cargaParaFiltrar);
        const mapaCargas = await buscarCargasDasNfs(nfsFiltradas);
        setCargasPorNf(mapaCargas);
        setResultado({ ...(dataFinalResp || {}), nfs: nfsFiltradas, total_de_registros: nfsFiltradas.length, total_de_paginas: 1 });
        setPagina(1);
      } else {
        const { data } = await base44.functions.invoke('listarNfsOmie', {
          ...filtrosBusca,
          pagina: pg,
          registros_por_pagina: 50
        });
        if (data?.sucesso) {
          const apenasAutorizadas = (data.nfs || []).filter(nf => nf.cStatus === 'autorizada');
          const mapaCargas = await buscarCargasDasNfs(apenasAutorizadas);
          setCargasPorNf(mapaCargas);
          setResultado({ ...data, nfs: apenasAutorizadas, total_de_registros: apenasAutorizadas.length });
          setPagina(pg);
        } else {
          toast.error(data?.error || 'Erro ao consultar NFs');
        }
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
    const filtrosCarga = { ...filtros, data_inicial: '', data_final: '', numero_carga: cargaFiltro.numero_carga || '' };
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
      String(nf.cNomeFantasia || '').toLowerCase().includes(termo) ||
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
    const mapa = {
      autorizada: { label: 'Autorizada', cor: 'bg-green-100 text-green-800' },
      cancelada:  { label: 'Cancelada',  cor: 'bg-red-100 text-red-800' },
      denegada:   { label: 'Denegada',   cor: 'bg-orange-100 text-orange-800' },
      inutilizada:{ label: 'Inutilizada',cor: 'bg-gray-200 text-gray-800' },
      rejeitada:  { label: 'Rejeitada',  cor: 'bg-red-100 text-red-800' },
      pendente:   { label: 'Pendente',   cor: 'bg-yellow-100 text-yellow-800' },
    };
    const info = mapa[v] || { label: v || 'Pendente', cor: 'bg-gray-100 text-gray-800' };
    return <Badge className={info.cor}>{info.label}</Badge>;
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
                    <th className="p-2 text-left font-semibold">Cliente (Fantasia)</th>
                    <th className="p-2 text-left font-semibold">CNPJ/CPF</th>
                    <th className="p-2 text-left font-semibold">Nº Carga</th>
                    <th className="p-2 text-right font-semibold">Valor</th>
                    <th className="p-2 text-left font-semibold">Status</th>
                    <th className="p-2 text-left font-semibold">Extrair</th>
                  </tr>
                </thead>
                <tbody>
                  {nfsFiltradas.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="text-center py-12 text-slate-500">Nenhuma NF encontrada</td>
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
                        <td className="p-2" title={nf.cRazao}>{nf.cNomeFantasia || nf.cRazao}</td>
                        <td className="p-2">{nf.cCPFCNPJDest}</td>
                        <td className="p-2">
                          {cargasPorNf[String(nf.cNumero || '').replace(/\D/g, '')] ? (
                            <Badge variant="outline" className="font-mono">{cargasPorNf[String(nf.cNumero || '').replace(/\D/g, '')]}</Badge>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
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