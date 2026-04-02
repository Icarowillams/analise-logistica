import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calculator, Truck } from 'lucide-react';

// ── Dimensões fixas dos veículos ──
const VEICULOS = {
  volkswagen: { nome: 'Volkswagen', comp: 5.40, larg: 2.15, alt: 2.20 },
  iveco:      { nome: 'Iveco',      comp: 4.30, larg: 2.10, alt: 2.10 },
};

// ── Dimensões e capacidades por galeia (metros) ──
const GALEIAS = [
  {
    id: 'fn_fechada',
    nome: 'Forno Nobre (Fechada)',
    comp: 0.60, larg: 0.71, alt: 0.12,
    // qtd por veículo calculada exatamente como você descreveu:
    caps: {
      volkswagen: { c: 9, l: 3, a: 18, total: 486 },
      iveco:      { c: 7, l: 2, a: 17, total: 238 },
    }
  },
  {
    id: 'fn_aberta',
    nome: 'Forno Nobre (Aberta - Hambúrguer)',
    comp: 0.60, larg: 0.71, alt: 0.17,
    caps: {
      volkswagen: { c: 9, l: 3, a: 12, total: 324 },
      iveco:      { c: 7, l: 2, a: 12, total: 168 },
    }
  },
  {
    id: 'super_caixa',
    nome: 'Super Caixa',
    comp: 0.76, larg: 0.56, alt: 0.30,
    caps: {
      volkswagen: { c: 7, l: 3, a: 7, total: 147 },
      iveco:      { c: 5, l: 3, a: 7, total: 105 },
    }
  },
];

// Mapa galeia_id → galeias que cabem por veículo
const galeliaCapPorVeiculo = (galeiaId, veiculoKey) => {
  const g = GALEIAS.find(g => g.id === galeiaId);
  return g?.caps[veiculoKey]?.total || 0;
};

export default function CalculadoraCarga() {
  const [qtdPacotes, setQtdPacotes] = useState('');
  const [galeiaCalc, setGaleiaCalc] = useState('');

  const { data: produtos = [] } = useQuery({
    queryKey: ['produtosCalculadora'],
    queryFn: () => base44.entities.Produto.list()
  });

  // Produtos que têm tipo_embalagem e galeia vinculada via tipo
  const produtosComGaleia = useMemo(() => {
    return produtos.filter(p => p.status === 'ativo' && p.fator_caixa);
  }, [produtos]);

  // Cálculo de galeias necessárias e capacidade por veículo
  const calcular = (pacotes, galeiaId) => {
    if (!pacotes || !galeiaId) return null;
    const g = GALEIAS.find(g => g.id === galeiaId);
    if (!g) return null;

    // Precisamos de um fator de pacotes/galeia. Para o cálculo genérico usamos 1 galeia = 1 unidade de referência
    // O cálculo real por produto está na tabela abaixo
    const galeiasNecessarias = Math.ceil(Number(pacotes) / 1);
    return {
      galeiasNecessarias,
      vw: galeliaCapPorVeiculo(galeiaId, 'volkswagen'),
      iveco: galeliaCapPorVeiculo(galeiaId, 'iveco'),
    };
  };

  // Tabela de capacidade por produto: usa fator_caixa como pacotes/galeia
  const tabelaProdutos = useMemo(() => {
    return produtosComGaleia.map(p => {
      // Heurística: produto com "SP" no nome ou Super Caixa → super_caixa, senão fn_fechada ou fn_aberta
      let galeiaId = 'fn_fechada';
      let tipoLabel = 'FN';
      const nome = (p.nome || '').toUpperCase();
      if (nome.includes(' SP') || nome.endsWith('SP')) {
        galeiaId = 'super_caixa';
        tipoLabel = 'SP';
      } else if (nome.includes('HAMBURGUER') || nome.includes('HAMBÚRGUER') || nome.includes('BRIOCHE') || nome.includes('C/06') || nome.includes('C/15') || nome.includes('C/15')) {
        galeiaId = 'fn_aberta';
        tipoLabel = 'FN';
      }

      const pacotesPorGaleia = p.fator_caixa || 1;
      const capVW = galeliaCapPorVeiculo(galeiaId, 'volkswagen') * pacotesPorGaleia;
      const capIveco = galeliaCapPorVeiculo(galeiaId, 'iveco') * pacotesPorGaleia;
      const gVW = galeliaCapPorVeiculo(galeiaId, 'volkswagen');
      const gIveco = galeliaCapPorVeiculo(galeiaId, 'iveco');

      return { ...p, galeiaId, tipoLabel, pacotesPorGaleia, capVW, capIveco, gVW, gIveco };
    }).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [produtosComGaleia]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Calculator className="w-6 h-6 text-blue-600" /> Calculadora de Carga
        </h1>
        <p className="text-sm text-slate-500 mt-1">Calcule a capacidade de galeias por veículo</p>
      </div>

      {/* Capacidade por veículo */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Object.entries(VEICULOS).map(([key, v]) => (
          <Card key={key} className={`border shadow-sm ${key === 'volkswagen' ? 'bg-blue-50/60' : 'bg-slate-50/60'}`}>
            <CardHeader className="pb-2">
              <CardTitle className={`text-base flex items-center gap-2 ${key === 'volkswagen' ? 'text-blue-700' : 'text-slate-700'}`}>
                <Truck className="w-4 h-4" /> {v.nome}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[['Comprimento', v.comp + 'm'], ['Largura', v.larg + 'm'], ['Altura', v.alt + 'm']].map(([label, val]) => (
                  <div key={label} className="bg-white rounded-lg p-2 border border-slate-200">
                    <div className="text-xs text-slate-400">{label}</div>
                    <div className="font-bold text-slate-700">{val}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-600 mb-1">Capacidade de Galeias:</div>
                {GALEIAS.map(g => (
                  <div key={g.id} className="flex items-center justify-between py-1 border-b border-slate-100 last:border-0">
                    <span className="text-sm text-slate-600">{g.nome}</span>
                    <Badge className="bg-amber-500 text-white text-xs px-2">{g.caps[key].total} galeias</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Especificações das galeias */}
      <Card className="border shadow-sm bg-orange-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-orange-700">⬡ Especificações das Galeias</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {GALEIAS.map(g => (
              <div key={g.id} className="bg-white rounded-lg p-3 border border-orange-100">
                <div className="font-semibold text-sm text-slate-700 mb-2">{g.nome}</div>
                <div className="text-xs text-slate-500 space-y-0.5">
                  <div>Comprimento: {g.comp * 100}cm</div>
                  <div>Largura: {g.larg * 100}cm</div>
                  <div>Altura: {g.alt * 100}cm</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Calculadora por produto/quantidade */}
      <Card className="border shadow-sm bg-green-50/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-green-700">⬡ Calcular Galeias por Produto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-600">Tipo de Galeia</Label>
              <select
                value={galeiaCalc}
                onChange={e => setGaleiaCalc(e.target.value)}
                className="mt-1 w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Selecione o tipo</option>
                {GALEIAS.map(g => <option key={g.id} value={g.id}>{g.nome}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs text-slate-600">Quantidade de Galeias</Label>
              <Input
                type="number"
                min="1"
                placeholder="Ex: 50"
                value={qtdPacotes}
                onChange={e => setQtdPacotes(e.target.value)}
                className="mt-1 h-9"
              />
            </div>
          </div>
          {qtdPacotes && galeiaCalc && (() => {
            const g = GALEIAS.find(x => x.id === galeiaCalc);
            const qtd = Number(qtdPacotes);
            const capVW = g.caps.volkswagen.total;
            const capIveco = g.caps.iveco.total;
            const pctVW = Math.min(100, Math.round((qtd / capVW) * 100));
            const pctIveco = Math.min(100, Math.round((qtd / capIveco) * 100));
            return (
              <div className="grid grid-cols-2 gap-3 mt-2">
                {[
                  { label: 'Volkswagen', cap: capVW, pct: pctVW, cor: 'blue' },
                  { label: 'Iveco', cap: capIveco, pct: pctIveco, cor: 'slate' },
                ].map(({ label, cap, pct, cor }) => (
                  <div key={label} className="bg-white rounded-lg p-3 border">
                    <div className="text-sm font-semibold text-slate-700 mb-1">{label}</div>
                    <div className="text-xs text-slate-500">Capacidade total: <strong>{cap} galeias</strong></div>
                    <div className="text-xs text-slate-500">Usando: <strong>{qtd} galeias</strong></div>
                    <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pct > 90 ? 'bg-red-400' : pct > 70 ? 'bg-amber-400' : 'bg-green-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className={`text-xs mt-1 font-medium ${pct > 100 ? 'text-red-600' : 'text-slate-600'}`}>
                      {pct}% ocupado {pct > 100 ? '⚠ Excede capacidade' : ''}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Tabela capacidade por produto */}
      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">ℹ Capacidade por Produto</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">Produto</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-slate-600">Tipo Galeia</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-slate-600">Pacotes/Galeia</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-slate-600">Max VW</th>
                  <th className="text-center px-3 py-3 text-xs font-semibold text-slate-600">Max Iveco</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {tabelaProdutos.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-slate-400 text-xs">Cadastre produtos com fator de caixa para ver a tabela de capacidade.</td></tr>
                ) : tabelaProdutos.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5 text-slate-700 font-medium text-xs">{p.nome}</td>
                    <td className="px-3 py-2.5 text-center">
                      <Badge className={p.tipoLabel === 'SP' ? 'bg-orange-100 text-orange-700 border-orange-200' : 'bg-blue-100 text-blue-700 border-blue-200'} variant="outline">
                        {p.tipoLabel}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-600">{p.pacotesPorGaleia}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="text-blue-600 font-semibold">{p.capVW.toLocaleString('pt-BR')}</span>
                      <span className="text-xs text-slate-400 ml-1">({p.gVW} galeias)</span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className="text-slate-600 font-semibold">{p.capIveco.toLocaleString('pt-BR')}</span>
                      <span className="text-xs text-slate-400 ml-1">({p.gIveco} galeias)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}