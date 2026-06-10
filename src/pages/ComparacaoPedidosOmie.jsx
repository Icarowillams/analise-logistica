import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, CheckCircle2, RefreshCw, Search, ChevronDown, ChevronUp } from 'lucide-react';

const ETAPA_CORES = {
  '10': 'bg-gray-100 text-gray-700',
  '20': 'bg-blue-100 text-blue-700',
  '50': 'bg-amber-100 text-amber-700',
  '60': 'bg-green-100 text-green-700',
};

const TIPO_CORES = {
  ETAPA_DIVERGENTE: 'bg-amber-50 border-amber-200',
  SEM_ESPELHO_LOCAL: 'bg-red-50 border-red-200',
  LOCAL_SEM_OMIE: 'bg-orange-50 border-orange-200',
};

const TIPO_LABELS = {
  ETAPA_DIVERGENTE: { label: 'Etapa Divergente', color: 'bg-amber-100 text-amber-800' },
  SEM_ESPELHO_LOCAL: { label: 'Sem Espelho Local', color: 'bg-red-100 text-red-800' },
  LOCAL_SEM_OMIE: { label: 'Local sem Omie', color: 'bg-orange-100 text-orange-800' },
};

function EtapaBadge({ etapa }) {
  if (!etapa) return <span className="text-gray-400 text-xs">—</span>;
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${ETAPA_CORES[etapa] || 'bg-gray-100 text-gray-600'}`}>
      {etapa}
    </span>
  );
}

function ResumoEtapas({ resumoEtapas }) {
  if (!resumoEtapas) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {Object.entries(resumoEtapas).map(([etapa, info]) => (
        <Card key={etapa} className="border">
          <CardContent className="pt-4 pb-3 px-4">
            <div className={`text-xs font-semibold px-2 py-0.5 rounded inline-block mb-2 ${ETAPA_CORES[etapa]}`}>
              Etapa {etapa} — {info.label}
            </div>
            <div className="text-2xl font-bold text-slate-800">{info.total_omie}</div>
            <div className="text-xs text-slate-500 mt-1 space-y-0.5">
              <div className="flex justify-between">
                <span>✅ Espelho OK</span>
                <span className="font-medium text-green-700">{info.com_espelho_correto}</span>
              </div>
              <div className="flex justify-between">
                <span>⚠️ Etapa divergente</span>
                <span className="font-medium text-amber-700">{info.etapa_divergente}</span>
              </div>
              <div className="flex justify-between">
                <span>❌ Sem espelho</span>
                <span className="font-medium text-red-700">{info.sem_espelho}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TabelaDivergencias({ items, titulo, corBadge }) {
  const [expandido, setExpandido] = useState(true);
  const [filtro, setFiltro] = useState('');

  const filtrados = items.filter(d =>
    !filtro ||
    d.numero_pedido?.includes(filtro) ||
    d.cliente_nome?.toLowerCase().includes(filtro.toLowerCase()) ||
    d.codigo_pedido?.includes(filtro)
  );

  if (!items.length) return null;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold text-slate-700">{titulo}</CardTitle>
            <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${corBadge}`}>{items.length}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setExpandido(!expandido)}>
            {expandido ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
        {expandido && (
          <div className="relative mt-2">
            <Search className="absolute left-2 top-2 w-3 h-3 text-slate-400" />
            <input
              className="w-full pl-7 pr-3 py-1.5 text-xs border rounded-md"
              placeholder="Filtrar por nº pedido, cliente..."
              value={filtro}
              onChange={e => setFiltro(e.target.value)}
            />
          </div>
        )}
      </CardHeader>
      {expandido && (
        <CardContent className="px-4 pb-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-slate-500">
                  <th className="text-left py-2 pr-3">Nº Pedido</th>
                  <th className="text-left py-2 pr-3">Cliente</th>
                  <th className="text-left py-2 pr-3">Etapa Omie</th>
                  <th className="text-left py-2 pr-3">Etapa Local</th>
                  <th className="text-left py-2 pr-3">Descrição</th>
                  <th className="text-right py-2">Valor</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.slice(0, 100).map((d, i) => (
                  <tr key={i} className={`border-b last:border-0 ${TIPO_CORES[d.tipo] || ''}`}>
                    <td className="py-1.5 pr-3 font-mono font-semibold text-slate-800">{d.numero_pedido || d.codigo_pedido}</td>
                    <td className="py-1.5 pr-3 text-slate-600 max-w-[150px] truncate">{d.cliente_nome}</td>
                    <td className="py-1.5 pr-3"><EtapaBadge etapa={d.etapa_omie} /></td>
                    <td className="py-1.5 pr-3"><EtapaBadge etapa={d.etapa_local || d.etapa_espelho} /></td>
                    <td className="py-1.5 pr-3 text-slate-500 max-w-[200px] truncate">{d.descricao}</td>
                    <td className="py-1.5 text-right font-medium">
                      {d.valor_total ? `R$ ${Number(d.valor_total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtrados.length > 100 && (
              <p className="text-xs text-slate-400 mt-2 text-center">Mostrando 100 de {filtrados.length} registros</p>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export default function ComparacaoPedidosOmie() {
  const [resultado, setResultado] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [dataInicial, setDataInicial] = useState('');
  const [dataFinal, setDataFinal] = useState('');

  const executar = async () => {
    setCarregando(true);
    setErro(null);
    setResultado(null);
    const res = await base44.functions.invoke('compararPedidosOmieLocal', {
      data_inicial: dataInicial || undefined,
      data_final: dataFinal || undefined
    });
    if (res.data?.sucesso) {
      setResultado(res.data);
    } else {
      setErro(res.data?.error || 'Erro desconhecido');
    }
    setCarregando(false);
  };

  return (
    <div className="max-w-6xl mx-auto p-4">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-800">Comparação Omie × Gerenciar Pedidos</h1>
        <p className="text-sm text-slate-500 mt-1">
          Busca pedidos em todas as etapas do Omie (10/20/50/60) e cruza com o espelho local.
        </p>
      </div>

      {/* Filtros */}
      <Card className="mb-5">
        <CardContent className="pt-4 pb-4 px-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-slate-600 block mb-1">Data inicial (DD/MM/AAAA)</label>
              <input
                type="text"
                placeholder="01/06/2025"
                value={dataInicial}
                onChange={e => setDataInicial(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm w-36"
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 block mb-1">Data final (DD/MM/AAAA)</label>
              <input
                type="text"
                placeholder="10/06/2025"
                value={dataFinal}
                onChange={e => setDataFinal(e.target.value)}
                className="border rounded px-3 py-1.5 text-sm w-36"
              />
            </div>
            <Button onClick={executar} disabled={carregando} className="bg-slate-800 hover:bg-slate-700 text-white">
              {carregando ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              {carregando ? 'Analisando...' : 'Executar Análise'}
            </Button>
          </div>
          {carregando && (
            <p className="text-xs text-slate-400 mt-2">
              ⏳ Buscando pedidos em todas as etapas do Omie... pode levar 1-2 minutos.
            </p>
          )}
        </CardContent>
      </Card>

      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 flex gap-2 text-red-700 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          {erro}
        </div>
      )}

      {resultado && (
        <>
          {/* Resumo geral */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            {[
              { label: 'Total Omie', value: resultado.resumo.total_omie, color: 'text-slate-800' },
              { label: 'Espelho Local', value: resultado.resumo.total_espelho, color: 'text-blue-700' },
              { label: 'Coincidentes', value: resultado.resumo.coincidentes, color: 'text-green-700' },
              { label: 'Divergências', value: resultado.resumo.divergencias, color: 'text-amber-700' },
              { label: 'Sem Espelho', value: resultado.divergencias.filter(d => d.tipo === 'SEM_ESPELHO_LOCAL').length, color: 'text-red-700' },
              { label: 'Local sem Omie', value: resultado.resumo.locais_sem_omie, color: 'text-orange-700' },
            ].map((item, i) => (
              <Card key={i}>
                <CardContent className="pt-3 pb-3 px-3 text-center">
                  <div className={`text-2xl font-bold ${item.color}`}>{item.value}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{item.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Resumo por etapa */}
          <ResumoEtapas resumoEtapas={resultado.resumo_etapas} />

          {/* Divergências */}
          {resultado.divergencias.length === 0 && resultado.locais_sem_omie.length === 0 ? (
            <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span className="text-green-700 font-medium">Nenhuma divergência encontrada! Omie e espelho local estão sincronizados.</span>
            </div>
          ) : (
            <>
              <TabelaDivergencias
                items={resultado.divergencias.filter(d => d.tipo === 'ETAPA_DIVERGENTE')}
                titulo="Etapas Divergentes (Omie ≠ Espelho Local)"
                corBadge="bg-amber-100 text-amber-800"
              />
              <TabelaDivergencias
                items={resultado.divergencias.filter(d => d.tipo === 'SEM_ESPELHO_LOCAL')}
                titulo="Pedidos no Omie sem Espelho Local"
                corBadge="bg-red-100 text-red-800"
              />
              <TabelaDivergencias
                items={resultado.locais_sem_omie}
                titulo="Pedidos Locais (enviados) não encontrados nas etapas ativas do Omie"
                corBadge="bg-orange-100 text-orange-800"
              />
            </>
          )}

          <p className="text-xs text-slate-400 mt-4 text-center">
            Gerado em {new Date(resultado.gerado_em).toLocaleString('pt-BR')}
          </p>
        </>
      )}
    </div>
  );
}