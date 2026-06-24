import React, { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

const PERIODOS = [
  { v: 'semanal', l: 'Semanal' },
  { v: 'quinzenal', l: 'Quinzenal' },
  { v: 'mensal', l: 'Mensal' },
];

export default function ParametrosCobertura() {
  const [params, setParams] = useState(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    base44.entities.ParametroCobertura.filter({ chave: 'principal' }).then((r) => {
      setParams(r[0] || {
        chave: 'principal', raio_geo_metros: 300, checkout_timeout_minutos: 120,
        periodicidade_gerencia: 'mensal', periodicidade_coordenador: 'quinzenal',
        periodicidade_supervisor: 'semanal', periodicidade_vendedor: 'semanal',
        periodicidade_promotor: 'semanal', itens_coleta_meses: 1,
      });
    });
  }, []);

  const salvar = async () => {
    setSalvando(true);
    try {
      const dados = { ...params, atualizado_em: new Date().toISOString() };
      if (params.id) await base44.entities.ParametroCobertura.update(params.id, dados);
      else { const novo = await base44.entities.ParametroCobertura.create(dados); setParams(novo); }
      toast.success('Parâmetros salvos');
    } catch (e) {
      toast.error('Erro ao salvar: ' + (e?.message || ''));
    } finally {
      setSalvando(false);
    }
  };

  const set = (k, v) => setParams((p) => ({ ...p, [k]: v }));

  if (!params) return <div className="p-8 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;

  const periodicidades = ['gerencia', 'coordenador', 'supervisor', 'vendedor', 'promotor'];
  const LBL = { gerencia: 'Gerência', coordenador: 'Coordenador', supervisor: 'Supervisor', vendedor: 'Vendedor', promotor: 'Promotor' };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="p-6 space-y-4">
        <h3 className="font-semibold text-slate-800">Geolocalização & check-out</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Raio aceitável (metros)</Label>
            <Input type="number" value={params.raio_geo_metros} onChange={(e) => set('raio_geo_metros', Number(e.target.value))} />
          </div>
          <div>
            <Label>Timeout de check-out (minutos)</Label>
            <Input type="number" value={params.checkout_timeout_minutos} onChange={(e) => set('checkout_timeout_minutos', Number(e.target.value))} />
          </div>
          <div>
            <Label>Itens a coletar — últimos N meses</Label>
            <Input type="number" value={params.itens_coleta_meses} onChange={(e) => set('itens_coleta_meses', Number(e.target.value))} />
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h3 className="font-semibold text-slate-800">Periodicidade por papel</h3>
        <div className="grid grid-cols-2 gap-4">
          {periodicidades.map((p) => (
            <div key={p}>
              <Label>{LBL[p]}</Label>
              <Select value={params[`periodicidade_${p}`]} onValueChange={(v) => set(`periodicidade_${p}`, v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODOS.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </Card>

      <Button onClick={salvar} disabled={salvando} className="gap-2">
        {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Salvar parâmetros
      </Button>
    </div>
  );
}