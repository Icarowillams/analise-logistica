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
import { Receipt, Loader2, Search, RefreshCw, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import ListaTitulosCarga from '@/components/boletos/ListaTitulosCarga';
import ResultadoGeracaoBoletos from '@/components/boletos/ResultadoGeracaoBoletos';

const normalizar = (valor) => String(valor || '').trim().toUpperCase();
const somenteNumeros = (valor) => String(valor || '').replace(/\D/g, '');
const BOLETO_BANCARIO_ID_FALLBACK = '69ff70445fbcb49b659710df';

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
  const [apenasComBoletosDisponiveis, setApenasComBoletosDisponiveis] = useState(false);
  const [selecionados, setSelecionados] = useState(new Set());
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState(null);
  // Filtros dos títulos
  const [apenasComVinculo, setApenasComVinculo] = useState(true);
  const [filtroCliente, setFiltroCliente] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos');

  // Modalidades e clientes para filtro por modalidade BOLETO BANCÁRIO
  const { data: modalidades = [] } = useQuery({
    queryKey: ['modalidades-pagamento-emissao'],
    queryFn: () => base44.entities.ModalidadePagamento.list(),
    refetchOnWindowFocus: false
  });

  const { data: clientesBase = [], isLoading: loadingClientes } = useQuery({
    queryKey: ['clientes-modalidade-emissao'],
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
      const cnpj = somenteNumeros(cliente.cnpj_cpf);
      if (cnpj) porCnpj.set(cnpj, cliente);
    });
    return { porCodigoOmie, porCnpj };
  }, [clientesBase, modalidadeBoletoIds]);

  const isClienteBoleto = (titulo) => {
    const codigos = [titulo.codigo_cliente];
    for (const codigo of codigos) {
      if (clientesBoletoMap.porCodigoOmie.has(String(codigo || '').trim())) return true;
    }
    if (clientesBoletoMap.porCnpj.has(somenteNumeros(titulo.cnpj_cpf))) return true;
    return false;
  };

  // Lista as cargas (faturadas têm prioridade — são as que precisam de boleto)
  const { data: cargas = [], isLoading: loadingCargas } = useQuery({
    queryKey: ['cargas-emissao-boletos'],
    queryFn: () => base44.entities.Carga.list('-created_date', 200),
    refetchOnWindowFocus: false
  });

  // Pré-carrega TODOS os títulos em aberto sem boleto (últimos 90d) — 1 chamada só.
  // Usado para identificar quais cargas têm boletos disponíveis sem chamar o Omie por carga.
  const { data: titulosDisponiveis = [], isLoading: loadingTitulosDisp } = useQuery({
    queryKey: ['titulos-disponiveis-globais'],
    queryFn: async () => {
      const fmt = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
      const hoje = new Date();
      const inicio = new Date(hoje.getTime() - 365 * 86400000);
      const futuro = new Date(hoje.getTime() + 90 * 86400000);
      let acumulados = [];
      for (let pag = 1; pag <= 10; pag++) {
        const { data } = await base44.functions.invoke('listarContasReceberOmie', {
          data_de: fmt(inicio),
          data_ate: fmt(futuro),
          filtrar_por_data: 'V',
          apenas_pendentes: true,
          pagina: pag,
          registros_por_pagina: 100
        });
        if (!data?.sucesso) break;
        acumulados = acumulados.concat(data.titulos || []);
        if (pag >= (data.total_de_paginas || 1)) break;
      }
      // Só interessam títulos SEM boleto ainda gerado
      return acumulados.filter(t => !(t.numero_boleto && String(t.numero_boleto).trim()));
    },
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000
  });

  // Índices dos títulos disponíveis (sem boleto) p/ matching fiel — mesmos critérios
  // usados no carregamento de títulos por carga: codigo_cliente OU cnpj OU numero_documento (NF)
  const indicesTitulos = useMemo(() => {
    const codigos = new Set();
    const cnpjs = new Set();
    const nfs = new Set();
    titulosDisponiveis.forEach(t => {
      const cod = String(t.codigo_cliente || '').trim();
      if (cod) codigos.add(cod);
      const cn = String(t.cnpj_cpf || '').replace(/\D/g, '');
      if (cn) cnpjs.add(cn);
      const doc = String(t.numero_documento || '').replace(/\D/g, '');
      if (doc) nfs.add(doc);
    });
    return { codigos, cnpjs, nfs };
  }, [titulosDisponiveis]);

  // Verifica se a carga tem ao menos 1 pedido que casa com algum título disponível.
  // Critérios (qualquer um casa): codigo_cliente Omie, CNPJ do cliente, ou número da NF.
  const cargaTemBoletoDisponivel = (carga) => {
    const pedidos = carga.pedidos_omie || [];
    return pedidos.some(p => {
      const cod = String(p.codigo_cliente || '').trim();
      if (cod && indicesTitulos.codigos.has(cod)) return true;
      const cn = String(p.cnpj_cpf_cliente || '').replace(/\D/g, '');
      if (cn && indicesTitulos.cnpjs.has(cn)) return true;
      const nf = String(p.numero_nf || '').replace(/\D/g, '');
      if (nf && indicesTitulos.nfs.has(nf)) return true;
      return false;
    });
  };

  // Só faz sentido emitir boleto para cargas FATURADAS — antes disso ainda não existe
  // NF emitida e portanto não há título no Omie para virar boleto.
  const cargasFiltradas = useMemo(() => {
    const termo = filtroNumeroCarga.trim().toLowerCase();
    return cargas
      .filter(c => c.status_carga === 'faturada')
      .filter(c => !termo || String(c.numero_carga || '').toLowerCase().includes(termo))
      .filter(c => !apenasComBoletosDisponiveis || cargaTemBoletoDisponivel(c));
  }, [cargas, filtroNumeroCarga, apenasComBoletosDisponiveis, indicesTitulos]);

  const totalCargasComBoleto = useMemo(
    () => cargas.filter(c => c.status_carga === 'faturada' && cargaTemBoletoDisponivel(c)).length,
    [cargas, indicesTitulos]
  );

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
      const inicio = new Date(hoje.getTime() - 365 * 86400000);
      const fim = new Date(hoje.getTime() + 90 * 86400000);

      // Varre até 5 páginas (500 títulos) — suficiente p/ uma carga
      let acumulados = [];
      for (let pag = 1; pag <= 5; pag++) {
        const { data } = await base44.functions.invoke('listarContasReceberOmie', {
          data_de: fmt(inicio),
          data_ate: fmt(fim),
          filtrar_por_data: 'V',
          apenas_pendentes: true,
          pagina: pag,
          registros_por_pagina: 100
        });
        if (!data?.sucesso) throw new Error(data?.error || 'Falha ao consultar títulos');
        acumulados = acumulados.concat(data.titulos || []);
        if (pag >= (data.total_de_paginas || 1)) break;
      }

      let ocultosNaoBoleto = 0;
      // Conjunto dos números de pedidos desta carga para matching preciso
      const numPedidosCarga = new Set(
        pedidos.map(p => String(p.numero_pedido || '').trim()).filter(Boolean)
      );
      const codPedidosCarga = new Set(
        pedidos.map(p => String(p.codigo_pedido || '').trim()).filter(Boolean)
      );

      const titulos = acumulados.filter(t => {
        const cnpjT = String(t.cnpj_cpf || '').replace(/\D/g, '');
        const docT = String(t.numero_documento || '').replace(/\D/g, '');
        const codClienteT = String(t.codigo_cliente || '').trim();
        const numPedVinc = String(t.numero_pedido_vinculado || '').trim();

        // Prioridade 1: match exato por numero_pedido_vinculado
        if (numPedVinc) {
          if (numPedidosCarga.has(numPedVinc) || codPedidosCarga.has(numPedVinc)) {
            // Match preciso — pertence a esta carga
          } else {
            return false; // Tem pedido vinculado mas não é desta carga
          }
        } else if (docT) {
          // Prioridade 2: match por NF
          const baseNf = nfsCarga.size > 0 && nfsCarga.has(docT);
          if (!baseNf) return false;
        } else {
          // Prioridade 3: match genérico por cliente (só para títulos avulsos)
          const baseCodCli = codigosClienteCarga.size > 0 && codClienteT && codigosClienteCarga.has(codClienteT);
          const baseCnpj = cnpjsCarga.size > 0 && cnpjT && cnpjsCarga.has(cnpjT);
          if (!(baseCodCli || baseCnpj)) return false;
        }
        // Filtro de modalidade: só exibe se o cliente tem modalidade BOLETO BANCÁRIO
        if (!isClienteBoleto(t)) {
          ocultosNaoBoleto++;
          return false;
        }
        return true;
      });
      return { titulos, ocultosNaoBoleto };
    },
    enabled: !!cargaSelecionada && !loadingClientes,
    refetchOnWindowFocus: false
  });

  const titulosTodos = titulosResp?.titulos || [];
  const ocultosNaoBoleto = titulosResp?.ocultosNaoBoleto || 0;
  const titulos = useMemo(() => {
    const termo = filtroCliente.trim().toLowerCase();
    return titulosTodos.filter(t => {
      if (apenasComVinculo) {
        const temVinc = (t.numero_documento && String(t.numero_documento).trim()) ||
                        (t.numero_pedido_vinculado && String(t.numero_pedido_vinculado).trim());
        if (!temVinc) return false;
      }
      if (termo && !String(t.nome_cliente || '').toLowerCase().includes(termo)) return false;
      if (filtroStatus !== 'todos') {
        const st = String(t.status_titulo || '').toUpperCase();
        if (filtroStatus === 'aberto' && st !== 'ABERTO') return false;
        if (filtroStatus === 'atrasado' && st !== 'ATRASADO' && st !== 'VENCIDO') return false;
        if (filtroStatus === 'recebido' && st !== 'RECEBIDO') return false;
      }
      return true;
    });
  }, [titulosTodos, apenasComVinculo, filtroCliente, filtroStatus]);
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

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <Checkbox
                checked={apenasComBoletosDisponiveis}
                onCheckedChange={(v) => setApenasComBoletosDisponiveis(!!v)}
                disabled={loadingTitulosDisp}
              />
              Apenas cargas com boletos disponíveis
              {loadingTitulosDisp && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
            </label>
            {!loadingTitulosDisp && (
              <Badge variant="outline" className="text-xs">
                {totalCargasComBoleto} carga(s) com boleto pendente
              </Badge>
            )}
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
            <CardTitle className="text-base">2. Filtros</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <Label>Cliente</Label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    className="pl-8"
                    placeholder="Buscar por nome..."
                    value={filtroCliente}
                    onChange={(e) => setFiltroCliente(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label>Status do título</Label>
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
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer h-10">
                <Checkbox
                  checked={apenasComVinculo}
                  onCheckedChange={(v) => setApenasComVinculo(!!v)}
                />
                Apenas títulos com NF/Pedido vinculado
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {apenasComVinculo && ocultos > 0 && (
                <Badge variant="outline" className="text-xs">
                  {ocultos} título(s) avulso(s) ocultado(s)
                </Badge>
              )}
              {ocultosNaoBoleto > 0 && (
                <Badge className="bg-orange-100 text-orange-800 text-xs">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {ocultosNaoBoleto} título(s) oculto(s) — cliente sem modalidade Boleto Bancário
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {cargaSelecionada && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex flex-wrap items-center justify-between gap-3">
              <span>
                3. Títulos da carga
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