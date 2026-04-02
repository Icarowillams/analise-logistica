import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calculator, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';

export default function AcertoCaixa() {
  const [dataFiltro, setDataFiltro] = useState(new Date().toISOString().split('T')[0]);
  const [motoristaFiltro, setMotoristaFiltro] = useState('');

  const { data: cargas = [] } = useQuery({
    queryKey: ['cargasAcerto'],
    queryFn: () => base44.entities.Carga.list('-data_carga', 100)
  });

  const { data: divergencias = [] } = useQuery({
    queryKey: ['divergenciasAcerto'],
    queryFn: () => base44.entities.Divergencia.list('-data', 200)
  });

  const { data: trocas = [] } = useQuery({
    queryKey: ['trocasAcerto'],
    queryFn: () => base44.entities.Troca.list('-data_troca', 200)
  });

  const { data: retornos = [] } = useQuery({
    queryKey: ['retornosAcerto'],
    queryFn: () => base44.entities.Retorno.list('-data_retorno', 200)
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  const motoristas = useMemo(() => {
    const nomes = [...new Set(cargas.map(c => c.motorista_nome).filter(Boolean))];
    return nomes.sort();
  }, [cargas]);

  const resumo = useMemo(() => {
    const cargasDia = cargas.filter(c => c.data_carga === dataFiltro && (!motoristaFiltro || c.motorista_nome === motoristaFiltro));
    const divsDia = divergencias.filter(d => d.data === dataFiltro && (!motoristaFiltro || d.motorista_nome === motoristaFiltro));
    const trocasDia = trocas.filter(t => t.data_troca === dataFiltro && (!motoristaFiltro || t.motorista_nome === motoristaFiltro));
    const retornosDia = retornos.filter(r => r.data_retorno === dataFiltro && (!motoristaFiltro || r.motorista_nome === motoristaFiltro));

    return {
      cargasDia,
      totalEntregue: cargasDia.reduce((s, c) => s + (c.valor_entregue || 0), 0),
      totalDevolvido: cargasDia.reduce((s, c) => s + (c.valor_devolvido || 0), 0),
      totalRetornos: retornosDia.reduce((s, r) => s + (r.valor_retorno || 0), 0),
      totalTrocas: trocasDia.reduce((s, t) => s + (Number(t.valor_total) || 0), 0),
      divPendentes: divsDia.filter(d => !d.resolvido).length,
      divTotal: divsDia.length,
    };
  }, [cargas, divergencias, trocas, retornos, dataFiltro, motoristaFiltro]);

  const saldoFinal = resumo.totalEntregue - resumo.totalDevolvido - resumo.totalRetornos - resumo.totalTrocas;

  return (
    <div className="space-y-4">
      <PageHeader title="Acerto de Caixa" icon={Calculator} subtitle="Consolidado financeiro diário por motorista" />

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div>
          <Label className="text-xs">Data</Label>
          <Input type="date" value={dataFiltro} onChange={e => setDataFiltro(e.target.value)} className="h-9 w-44" />
        </div>
        <div>
          <Label className="text-xs">Motorista</Label>
          <Select value={motoristaFiltro} onValueChange={v => setMotoristaFiltro(v === '__all__' ? '' : v)}>
            <SelectTrigger className="h-9 w-52"><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              {motoristas.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <TrendingUp className="w-5 h-5 text-green-500 mx-auto mb-1" />
            <div className="text-lg font-bold text-green-600">R$ {resumo.totalEntregue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
            <div className="text-xs text-slate-500">Total Entregue</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <TrendingDown className="w-5 h-5 text-red-400 mx-auto mb-1" />
            <div className="text-lg font-bold text-red-500">R$ {resumo.totalDevolvido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
            <div className="text-xs text-slate-500">Devolvido</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <TrendingDown className="w-5 h-5 text-orange-400 mx-auto mb-1" />
            <div className="text-lg font-bold text-orange-500">R$ {(resumo.totalRetornos + resumo.totalTrocas).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
            <div className="text-xs text-slate-500">Retornos + Trocas</div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-amber-400 shadow-sm">
          <CardContent className="p-4 text-center">
            <Calculator className="w-5 h-5 text-amber-500 mx-auto mb-1" />
            <div className={`text-lg font-bold ${saldoFinal >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              R$ {saldoFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-slate-500">Saldo Final</div>
          </CardContent>
        </Card>
      </div>

      {/* Divergências pendentes */}
      {resumo.divPendentes > 0 && (
        <Card className="border-orange-200 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0" />
            <div>
              <div className="font-medium text-sm text-orange-700">{resumo.divPendentes} divergência(s) pendente(s)</div>
              <div className="text-xs text-slate-500">Acesse a tela de Divergências para resolver.</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cargas do dia */}
      <Card className="border-0 shadow-md">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Cargas do Dia ({resumo.cargasDia.length})</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-2">
          {resumo.cargasDia.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">Nenhuma carga nesta data.</p>
          ) : resumo.cargasDia.map(c => (
            <div key={c.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div>
                <div className="text-sm font-medium">{c.numero_carga}</div>
                <div className="text-xs text-slate-500">{c.motorista_nome} · {c.rota_nome}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-green-600">R$ {(c.valor_entregue || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                <Badge className="text-xs">{c.status}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}