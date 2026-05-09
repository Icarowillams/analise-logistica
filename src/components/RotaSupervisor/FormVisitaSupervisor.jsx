import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { MapPin, Save, CheckCircle2, Store, Clock } from 'lucide-react';
import { toast } from 'sonner';
import FormTiposVisita from './FormTiposVisita';
import EstoqueSupervisorForm from './EstoqueSupervisorForm';

const TIPOS_OPCOES = [
  { value: 'acompanhamento', label: 'Acompanhamento', cor: 'border-blue-300' },
  { value: 'prospeccao', label: 'Prospecção', cor: 'border-purple-300' },
  { value: 'negociacao', label: 'Negociação Comercial', cor: 'border-green-300' },
  { value: 'resolucao', label: 'Resolução de Problemas', cor: 'border-red-300' },
];

export default function FormVisitaSupervisor({ rotaSupervisor, supervisor, cliente, visitaExistente, onConcluida, onCancelar }) {
  const [carregando, setCarregando] = useState(false);
  const [visita, setVisita] = useState(visitaExistente || null);
  const [formData, setFormData] = useState(visitaExistente || {
    tipos_visita: [],
    observacao_geral: '',
    obs_acompanhamento: '',
    prospeccao_nome_fantasia: '', obs_prospeccao: '',
    negociacao_venda: false, negociacao_exposicao: false, acoes_venda: [],
    tipo_problema: '', descricao_problema: '', atitude_tomada: '', como_finalizado: '',
    resumo_visita: ''
  });

  const fazerCheckin = () => {
    if (!cliente) { toast.error('Selecione um cliente'); return; }
    setCarregando(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const payload = {
          rota_supervisor_id: rotaSupervisor?.id,
          supervisor_id: supervisor?.id,
          supervisor_nome: supervisor?.nome,
          cliente_id: cliente.id,
          cliente_codigo: cliente.codigo_interno,
          cliente_nome: cliente.razao_social || cliente.nome_fantasia,
          cliente_cidade: cliente.cidade,
          data_visita: new Date().toISOString().slice(0, 10),
          checkin_time: new Date().toISOString(),
          checkin_latitude: pos.coords.latitude,
          checkin_longitude: pos.coords.longitude,
          status: 'checkin_realizado'
        };
        const nova = await base44.entities.VisitaSupervisor.create(payload);
        setVisita(nova);
        setCarregando(false);
        toast.success('Check-in realizado!');
      },
      async () => {
        const payload = {
          rota_supervisor_id: rotaSupervisor?.id,
          supervisor_id: supervisor?.id,
          supervisor_nome: supervisor?.nome,
          cliente_id: cliente.id,
          cliente_codigo: cliente.codigo_interno,
          cliente_nome: cliente.razao_social || cliente.nome_fantasia,
          cliente_cidade: cliente.cidade,
          data_visita: new Date().toISOString().slice(0, 10),
          checkin_time: new Date().toISOString(),
          status: 'checkin_realizado'
        };
        const nova = await base44.entities.VisitaSupervisor.create(payload);
        setVisita(nova);
        setCarregando(false);
        toast.warning('Check-in sem GPS');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const toggleTipo = (tipo) => {
    const tipos = formData.tipos_visita || [];
    const novo = tipos.includes(tipo) ? tipos.filter(t => t !== tipo) : [...tipos, tipo];
    setFormData({ ...formData, tipos_visita: novo });
  };

  const concluir = () => {
    if (!visita) return;
    setCarregando(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const checkoutTime = new Date().toISOString();
        const tempo = Math.round((new Date(checkoutTime) - new Date(visita.checkin_time)) / 60000);
        await base44.entities.VisitaSupervisor.update(visita.id, {
          ...formData,
          checkout_time: checkoutTime,
          checkout_latitude: pos.coords.latitude,
          checkout_longitude: pos.coords.longitude,
          tempo_loja_minutos: tempo,
          status: 'concluida'
        });
        setCarregando(false);
        toast.success('Visita concluída!');
        onConcluida?.();
      },
      async () => {
        const checkoutTime = new Date().toISOString();
        const tempo = Math.round((new Date(checkoutTime) - new Date(visita.checkin_time)) / 60000);
        await base44.entities.VisitaSupervisor.update(visita.id, {
          ...formData, checkout_time: checkoutTime, tempo_loja_minutos: tempo, status: 'concluida'
        });
        setCarregando(false);
        toast.success('Visita concluída!');
        onConcluida?.();
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  if (!cliente) return null;

  return (
    <Card className="p-4 space-y-3 border-2 border-amber-300">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold flex items-center gap-2">
            <Store className="w-4 h-4" />
            {cliente.codigo_interno} - {cliente.razao_social || cliente.nome_fantasia}
          </p>
          <p className="text-xs text-slate-500">{cliente.cidade}</p>
        </div>
        {visita?.checkin_time && (
          <div className="text-xs text-slate-600 flex items-center gap-1">
            <Clock className="w-3 h-3" />{new Date(visita.checkin_time).toLocaleTimeString('pt-BR').slice(0, 5)}
          </div>
        )}
      </div>

      {!visita && (
        <Button onClick={fazerCheckin} disabled={carregando} className="w-full bg-blue-600 hover:bg-blue-700 h-11">
          <MapPin className="w-4 h-4 mr-2" />Check-in nesta visita
        </Button>
      )}

      {visita && (
        <>
          <div>
            <Label className="text-sm font-semibold mb-2 block">Tipos de visita *</Label>
            <div className="grid grid-cols-2 gap-2">
              {TIPOS_OPCOES.map(t => (
                <label key={t.value} className={`flex items-center gap-2 p-2 rounded border-2 cursor-pointer ${formData.tipos_visita?.includes(t.value) ? t.cor + ' bg-white' : 'border-slate-200'}`}>
                  <Checkbox checked={formData.tipos_visita?.includes(t.value)} onCheckedChange={() => toggleTipo(t.value)} />
                  <span className="text-xs">{t.label}</span>
                </label>
              ))}
            </div>
          </div>

          <FormTiposVisita formData={formData} setFormData={setFormData} />

          <EstoqueSupervisorForm visitaId={visita.id} clienteId={cliente.id} clienteNome={cliente.razao_social || cliente.nome_fantasia} />

          <div className="space-y-2">
            <Label className="text-xs">Observação Geral</Label>
            <Textarea value={formData.observacao_geral || ''} onChange={(e) => setFormData({ ...formData, observacao_geral: e.target.value })} rows={2} className="text-sm" />
            <Label className="text-xs">Resumo da Visita</Label>
            <Textarea value={formData.resumo_visita || ''} onChange={(e) => setFormData({ ...formData, resumo_visita: e.target.value })} rows={3} className="text-sm" />
          </div>

          <div className="flex gap-2 pt-2 border-t">
            {onCancelar && <Button variant="outline" onClick={onCancelar} className="flex-1">Cancelar</Button>}
            <Button onClick={concluir} disabled={carregando || !formData.tipos_visita?.length} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
              <CheckCircle2 className="w-4 h-4 mr-2" />Finalizar Visita
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}