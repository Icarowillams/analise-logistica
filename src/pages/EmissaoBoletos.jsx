import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Receipt, Loader2, Search, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import ListaTitulosCarga from '@/components/boletos/ListaTitulosCarga';
import ResultadoGeracaoBoletos from '@/components/boletos/ResultadoGeracaoBoletos';

// Página de Emissão Manual de Boletos por Carga
// Fluxo:
//   1. Usuário escolhe a Carga
//   2. Sistema busca os títulos (contas a receber) dos pedidos dessa carga no Omie
//   3. Usuário seleciona quais títulos quer gerar boleto
//   4. Clica em "Gerar Boletos" → chama gerarBoletosOmie
export default function EmissaoBoletos() {
  const queryClient = useQueryClient();
  const [cargaId, setCargaId] = useState('');
  const [filtroNumeroCarga, setFiltroNumeroCarga] = useState('');
  const [selecionados, setSelecionados] = useState(new Set());
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState(null);
  // Filtro: por padrão escondemos títulos sem NF/Pedido vinculado (lançamentos avulsos no Omie)
  const [apenasComVinculo, setApenasComVinculo] = useState(true);

  // Lista as cargas (faturadas têm prioridade — são as que precisam de boleto)
  const { data: cargas = [], isLoading: loadingCargas } = useQuery({
    queryKey: ['cargas-emissao-boletos'],
    queryFn: () => base44.entities.Carga.list('-created_date', 200),
    refetchOnWindowFocus: false
  });

  // Só faz sentido emitir boleto para cargas FATURADAS — antes disso ainda não existe
  // NF emitida e portanto não há título no Omie para virar boleto.
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

  // Busca os títulos (contas a receber) no Omie e filtra pelos pedidos da carga.
  // Como a API ListarContasReceber NÃO devolve nCodPedido no mapeamento atual,
  // casamos por DOIS critérios (qualquer um casa):
  //   1. CNPJ/CPF do cliente do título == CNPJ/CPF do cliente do pedido na carga
  //   2. numero_documento do título == numero_nf do pedido na carga
  // Buscamos os últimos 60 dias (suficiente para NFs recém-emitidas) — sem o
  // filtro de período o Omie pode retornar dados muito antigos e estourar paginação.
  const { data: titulosResp, isLoading: loadingTitulos, refetch: refetchTitulos } = useQuery({
    queryKey: ['titulos-carga', cargaId],
    queryFn: async () => {
      if (!cargaSelecionada) return { titulos: [] };
      const pedidos = cargaSelecionada.pedidos_omie || [];
      if (pedidos.length === 0) return { titulos: [] };

      const cnpjsCarga = new Set(
        pedidos.map(p => String(p.cnpj_cpf_cliente || '').replace(/\D/g, '')).filter(Boolean)
      );
      const nfsCarga = new Set(
        pedidos.map(p => String(p.numero_nf || '').replace(/\D/g, '')).filter(Boolean)
      );
      // codigo_cliente Omie sempre vem preenchido nos pedidos — usado como casamento principal.
      // O Omie devolve esse campo como NÚMERO no título, então normalizamos pra string sem espaços.
      const codigosClienteCarga = new Set(
        pedidos.map(p => String(p.codigo_cliente || '').trim()).filter(Boolean)
      );

      // Filtramos por EMISSÃO (e não vencimento) — cargas recém-faturadas ainda não venceram.
      // Janela: 90 dias atrás até hoje (cobre folga p/ NFs emitidas semanas antes).
      const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
      const hoje = new Date();
      const inicio = new Date(hoje.getTime() - 90 * 86400000);
      const fim = hoje;

      // Varre até 5 páginas (500 títulos) — suficiente p/ uma carga
      let acumulados = [];
      for (let pag = 1; pag <= 5; pag++) {
        const { data } = await base44.functions.invoke('listarContasReceberOmie', {
          data_de: fmt(inicio),
          data_ate: fmt(fim),
          filtrar_por_data: 'E',
          apenas_pendentes: false,
          pagina: pag,
          registros_por_pagina: 100
        });
        if (!data?.sucesso) throw new Error(data?.error || 'Falha ao consultar títulos');
        acumulados = acumulados.concat(data.titulos || []);
        if (pag >= (data.total_de_paginas || 1)) break;
      }

      const titulos = acumulados.filter(t => {
        const cnpjT = String(t.cnpj_cpf || '').replace(/\D/g, '');
        const docT = String(t.numero_documento || '').replace(/\D/g, '');
        // Omie devolve codigo_cliente como number — normaliza pra string
        const codClienteT = String(t.codigo_cliente || '').trim();
        const baseCodCli = codigosClienteCarga.size > 0 && codClienteT && codigosClienteCarga.has(codClienteT);
        const baseCnpj = cnpjsCarga.size > 0 && cnpjT && cnpjsCarga.has(cnpjT);
        const baseNf = nfsCarga.size > 0 && docT && nfsCarga.has(docT);
        return baseCodCli || baseCnpj || baseNf;
      });
      return { titulos };
    },
    enabled: !!cargaSelecionada,
    refetchOnWindowFocus: false
  });

  const titulosTodos = titulosResp?.titulos || [];
  const titulos = useMemo(() => {
    if (!apenasComVinculo) return titulosTodos;
    return titulosTodos.filter(t =>
      (t.numero_documento && String(t.numero_documento).trim()) ||
      (t.numero_pedido_vinculado && String(t.numero_pedido_vinculado).trim())
    );
  }, [titulosTodos, apenasComVinculo]);
  const ocultos = titulosTodos.length - titulos.length;

  const handleSelecionarCarga = (id) => {
    setCargaId(id);
    setSelecionados(new Set());
    setResultado(null);
  };

  const gerarBoletos = async () => {
    const codigos = Array.from(selecionados);
    if (codigos.length === 0) {
      toast.warning('Selecione ao menos um título para gerar boleto.');
      return;
    }
    if (!confirm(`Gerar ${codigos.length} boleto(s) no Omie?`)) return;

    setGerando(true);
    setResultado(null);
    try {
      const { data } = await base44.functions.invoke('gerarBoletosOmie', {
        titulos: codigos
      });
      if (data?.sucesso) {
        setResultado(data);
        const ok = data.sucessos || 0;
        const erros = data.erros || 0;
        if (ok > 0) toast.success(`${ok} boleto(s) gerado(s) com sucesso`);
        if (erros > 0) toast.error(`${erros} boleto(s) falharam — veja o detalhe abaixo`);
        setSelecionados(new Set());
        queryClient.invalidateQueries({ queryKey: ['titulos-carga', cargaId] });
      } else {
        toast.error(data?.error || 'Erro ao gerar boletos');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setGerando(false);
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <Receipt className="w-8 h-8 text-amber-500" />
        <div>
          <h1 className="text-2xl font-bold">Emissão de Boletos</h1>
          <p className="text-sm text-slate-500">
            Selecione uma carga, escolha os títulos e gere os boletos no Omie
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Selecione a Carga</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div className="md:col-span-1">
              <Label>Filtrar por nº</Label>
              <Input
                placeholder="Ex: 019"
                value={filtroNumeroCarga}
                onChange={(e) => setFiltroNumeroCarga(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Carga</Label>
              <Select value={cargaId} onValueChange={handleSelecionarCarga} disabled={loadingCargas}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingCargas ? 'Carregando...' : 'Escolha uma carga'} />
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
              <Button
                onClick={gerarBoletos}
                disabled={gerando || selecionados.size === 0}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                {gerando
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Gerando...</>
                  : <><Receipt className="w-4 h-4 mr-2" /> Gerar {selecionados.size} boleto(s)</>}
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <Checkbox
                  checked={apenasComVinculo}
                  onCheckedChange={(v) => setApenasComVinculo(!!v)}
                />
                Apenas títulos com NF/Pedido vinculado
              </label>
              {apenasComVinculo && ocultos > 0 && (
                <Badge variant="outline" className="text-xs">
                  {ocultos} título(s) avulso(s) ocultado(s)
                </Badge>
              )}
            </div>
            <ListaTitulosCarga
              titulos={titulos}
              loading={loadingTitulos}
              selecionados={selecionados}
              setSelecionados={setSelecionados}
            />
          </CardContent>
        </Card>
      )}

      {resultado && (
        <ResultadoGeracaoBoletos resultado={resultado} />
      )}
    </div>
  );
}