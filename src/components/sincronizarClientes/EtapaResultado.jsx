import React, { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  CheckCircle, XCircle, RefreshCw, ArrowRight,
  Search, Users, ArrowLeft, AlertTriangle
} from 'lucide-react';

export default function EtapaResultado({ verificacao, onSincronizar, onReverificar, onVoltar }) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set(verificacao.clientes_faltando.map(c => c.id)));

  const faltando = verificacao.clientes_faltando || [];
  const total = verificacao.total_base44;
  const omie = verificacao.total_omie;
  const jaExistem = verificacao.ja_existem_no_omie;
  const faltandoCount = verificacao.faltando_no_omie;
  const pctSincronizado = total > 0 ? Math.round((jaExistem / total) * 100) : 100;

  const filtrados = useMemo(() => {
    const s = search.toLowerCase();
    if (!s) return faltando;
    return faltando.filter(c =>
      c.razao_social?.toLowerCase().includes(s) ||
      c.nome_fantasia?.toLowerCase().includes(s) ||
      c.cpf_cnpj?.includes(s)
    );
  }, [faltando, search]);

  const toggleAll = () => {
    if (selectedIds.size === faltando.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(faltando.map(c => c.id)));
    }
  };

  const toggleId = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  return (
    <div className="space-y-5">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Base44" value={total} color="slate" icon={<Users className="w-4 h-4" />} />
        <SummaryCard label="No Omie" value={omie} color="blue" icon={<img src="https://www.omie.com.br/wp-content/themes/flavor-flavor-flavor/lib/assets/img/logo-omie.svg" alt="" className="h-4" />} />
        <SummaryCard label="Sincronizados" value={jaExistem} color="green" icon={<CheckCircle className="w-4 h-4" />} />
        <SummaryCard label="Faltantes" value={faltandoCount} color={faltandoCount > 0 ? 'red' : 'green'} icon={faltandoCount > 0 ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />} />
      </div>

      {/* Progress bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-neutral-700">Taxa de Sincronização</span>
            <span className="text-sm font-bold text-neutral-900">{pctSincronizado}%</span>
          </div>
          <div className="h-4 bg-neutral-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 bg-gradient-to-r from-green-400 to-emerald-500"
              style={{ width: `${pctSincronizado}%` }}
            />
          </div>
          <p className="text-xs text-neutral-400 mt-1.5">{jaExistem} de {total} clientes sincronizados</p>
        </CardContent>
      </Card>

      {faltandoCount === 0 ? (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <p className="text-lg font-bold text-green-800">100% Sincronizado!</p>
              <p className="text-sm text-green-600">Todos os clientes ativos do Base44 estão no Omie.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Clients list */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm text-neutral-800">
                  Clientes Faltantes ({faltandoCount})
                </h3>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs h-7">
                    {selectedIds.size === faltando.length ? 'Desmarcar todos' : 'Selecionar todos'}
                  </Button>
                  <Badge className="bg-amber-100 text-amber-800 border-amber-200">{selectedIds.size} selecionado(s)</Badge>
                </div>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Filtrar por nome ou CNPJ..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-10 h-9"
                />
              </div>

              <ScrollArea className="h-[320px]">
                <div className="space-y-1 pr-2">
                  {filtrados.map(c => {
                    const checked = selectedIds.has(c.id);
                    return (
                      <div
                        key={c.id}
                        onClick={() => toggleId(c.id)}
                        className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors ${
                          checked ? 'bg-amber-50 border border-amber-200' : 'hover:bg-slate-50 border border-transparent'
                        }`}
                      >
                        <Checkbox checked={checked} className="shrink-0" />
                        <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-neutral-800 truncate">{c.razao_social}</p>
                          {c.nome_fantasia && c.nome_fantasia !== c.razao_social && (
                            <p className="text-xs text-neutral-400 truncate">{c.nome_fantasia}</p>
                          )}
                        </div>
                        <span className="text-xs text-neutral-400 shrink-0 font-mono">{c.cpf_cnpj || '—'}</span>
                      </div>
                    );
                  })}
                  {filtrados.length === 0 && (
                    <p className="text-center text-sm text-neutral-400 py-8">Nenhum cliente encontrado com esse filtro</p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between">
        <div className="flex gap-2">
          <Button variant="outline" onClick={onVoltar}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Voltar
          </Button>
          <Button variant="outline" onClick={onReverificar}>
            <RefreshCw className="w-4 h-4 mr-1" /> Reverificar
          </Button>
        </div>
        {faltandoCount > 0 && (
          <Button
            onClick={() => onSincronizar([...selectedIds])}
            disabled={selectedIds.size === 0}
            size="lg"
            className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold shadow-lg shadow-amber-500/30"
          >
            <ArrowRight className="w-5 h-5 mr-2" />
            Enviar {selectedIds.size} cliente(s) ao Omie
          </Button>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color, icon }) {
  const colors = {
    slate: 'bg-slate-50 border-slate-200 text-slate-800',
    blue: 'bg-blue-50 border-blue-200 text-blue-800',
    green: 'bg-green-50 border-green-200 text-green-800',
    red: 'bg-red-50 border-red-200 text-red-800',
  };
  const iconColors = {
    slate: 'text-slate-500',
    blue: 'text-blue-500',
    green: 'text-green-500',
    red: 'text-red-500',
  };
  return (
    <div className={`rounded-xl border p-3 ${colors[color]}`}>
      <div className={`mb-1 ${iconColors[color]}`}>{icon}</div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs opacity-70">{label}</p>
    </div>
  );
}