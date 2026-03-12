import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { MapPin, CheckCircle, Clock, Store } from 'lucide-react';
import { toast } from 'sonner';
import FormTiposVisita from './FormTiposVisita';

function getLocalDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getLocalISOString(date = new Date()) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const mm = String(Math.abs(offset) % 60).padStart(2, '0');
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${hh}:${mm}`;
}

export default function FormVisitaSupervisor({ cliente, rotaSupervisorId, supervisor, isProspeccao = false, onClose }) {
  const queryClient = useQueryClient();
  const [checkinDone, setCheckinDone] = useState(false);
  const [checkinData, setCheckinData] = useState(null);
  const [checkoutDone, setCheckoutDone] = useState(false);
  const [checkoutData, setCheckoutData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [tiposVisita, setTiposVisita] = useState(isProspeccao ? ['prospeccao'] : []);
  const [formData, setFormData] = useState({
    obs_acompanhamento: '',
    prospeccao_nome_fantasia: isProspeccao ? (cliente.nome_fantasia || '') : '',
    obs_prospeccao: '',
    tipo_negociacao: '',
    acao_venda_prazo: '',
    acao_venda_produto: '',
    acao_venda_valor: '',
    tipo_exposicao: '',
    ponto_extra_prazo: '',
    ponto_extra_permanente: false,
    gondola_prazo: '',
    gondola_permanente: false,
    tipo_problema: '',
    descricao_problema: '',
    atitude_tomada: '',
    como_finalizado: '',
    resumo_visita: ''
  });

  const handleCheckin = () => {
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const agora = new Date();
        setCheckinData({
          time: getLocalISOString(agora),
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          displayTime: agora.toLocaleTimeString('pt-BR')
        });
        setCheckinDone(true);
        setLoading(false);
        toast.success('Check-in realizado!');
      },
      () => {
        toast.error('Erro ao obter localização.');
        setLoading(false);
      }
    );
  };

  const handleCheckout = () => {
    if (tiposVisita.length === 0) {
      toast.error('Selecione ao menos um tipo de visita.');
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const agora = new Date();
        setCheckoutData({
          time: getLocalISOString(agora),
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          displayTime: agora.toLocaleTimeString('pt-BR')
        });
        setCheckoutDone(true);
        setLoading(false);
        toast.success('Check-out realizado!');
      },
      () => {
        toast.error('Erro ao obter localização.');
        setLoading(false);
      }
    );
  };

  const tempoLoja = () => {
    if (!checkinData || !checkoutData) return null;
    const inicio = new Date(checkinData.time);
    const fim = new Date(checkoutData.time);
    const diffMs = fim - inicio;
    const mins = Math.round(diffMs / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return { minutos: mins, display: h > 0 ? `${h}h ${m}min` : `${m}min` };
  };

  const handleSalvar = async () => {
    if (tiposVisita.includes('resolucao')) {
      if (!formData.descricao_problema || !formData.atitude_tomada || !formData.como_finalizado) {
        toast.error('Preencha todos os campos obrigatórios de Resolução de Problemas.');
        return;
      }
    }

    setSalvando(true);
    const tempo = tempoLoja();

    const isVirtualClient = cliente._isProspeccao === true;
    const data = {
      rota_supervisor_id: rotaSupervisorId,
      supervisor_id: supervisor.id,
      supervisor_nome: supervisor.nome,
      cliente_id: isVirtualClient ? '' : cliente.id,
      cliente_codigo: isVirtualClient ? 'PROSPECCAO' : cliente.codigo,
      cliente_nome: cliente.nome_fantasia || cliente.razao_social,
      cliente_cidade: cliente.cidade || '',
      data_visita: getLocalDateStr(),
      checkin_time: checkinData.time,
      checkin_latitude: checkinData.latitude,
      checkin_longitude: checkinData.longitude,
      checkout_time: checkoutData.time,
      checkout_latitude: checkoutData.latitude,
      checkout_longitude: checkoutData.longitude,
      tempo_loja_minutos: tempo?.minutos || 0,
      tipos_visita: tiposVisita,
      resumo_visita: formData.resumo_visita,
      status: 'concluida'
    };

    if (tiposVisita.includes('acompanhamento')) data.obs_acompanhamento = formData.obs_acompanhamento;
    if (tiposVisita.includes('prospeccao')) {
      data.prospeccao_nome_fantasia = formData.prospeccao_nome_fantasia;
      data.obs_prospeccao = formData.obs_prospeccao;
    }
    if (tiposVisita.includes('negociacao')) {
      data.tipo_negociacao = formData.tipo_negociacao;
      if (formData.tipo_negociacao === 'venda') {
        data.acao_venda_prazo = formData.acao_venda_prazo;
        data.acao_venda_produto = formData.acao_venda_produto;
        data.acao_venda_valor = formData.acao_venda_valor ? Number(formData.acao_venda_valor) : 0;
      }
      if (formData.tipo_negociacao === 'exposicao') {
        data.tipo_exposicao = formData.tipo_exposicao;
        if (formData.tipo_exposicao === 'ponto_extra' || formData.tipo_exposicao === 'os_dois') {
          data.ponto_extra_prazo = formData.ponto_extra_permanente ? '' : formData.ponto_extra_prazo;
          data.ponto_extra_permanente = formData.ponto_extra_permanente;
        }
        if (formData.tipo_exposicao === 'gondola' || formData.tipo_exposicao === 'os_dois') {
          data.gondola_prazo = formData.gondola_permanente ? '' : formData.gondola_prazo;
          data.gondola_permanente = formData.gondola_permanente;
        }
      }
    }
    if (tiposVisita.includes('resolucao')) {
      data.tipo_problema = formData.tipo_problema;
      data.descricao_problema = formData.descricao_problema;
      data.atitude_tomada = formData.atitude_tomada;
      data.como_finalizado = formData.como_finalizado;
    }

    await base44.entities.VisitaSupervisor.create(data);
    await queryClient.invalidateQueries({ queryKey: ['visitasSupervisor'] });
    toast.success('Visita salva com sucesso!');
    setSalvando(false);
    onClose();
  };

  const toggleTipo = (tipo) => {
    setTiposVisita(prev => prev.includes(tipo) ? prev.filter(t => t !== tipo) : [...prev, tipo]);
  };

  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Store className="w-4 h-4" />
            {isProspeccao ? (
              <span>{cliente.nome_fantasia}</span>
            ) : (
              <span>{cliente.codigo} - {cliente.nome_fantasia || cliente.razao_social}</span>
            )}
            {isProspeccao && <Badge className="bg-green-100 text-green-700 text-[10px]">Prospecção</Badge>}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">Cancelar</Button>
        </div>
        {!isProspeccao && <p className="text-xs text-slate-500">{cliente.cidade}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* CHECK-IN */}
        {!checkinDone ? (
          <Button onClick={handleCheckin} disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700">
            <MapPin className="w-4 h-4 mr-2" />
            {loading ? 'Localizando...' : 'Fazer Check-in'}
          </Button>
        ) : (
          <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg border border-blue-200 text-sm">
            <CheckCircle className="w-4 h-4 text-blue-600" />
            <span>Check-in: <strong>{checkinData.displayTime}</strong></span>
          </div>
        )}

        {/* CONTEÚDO PÓS CHECK-IN */}
        {checkinDone && !checkoutDone && (
          <>
            {/* TIPOS DE VISITA */}
            <div className="space-y-2">
              <Label className="font-semibold">Tipo de Visita (múltipla seleção)</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { key: 'acompanhamento', label: 'Acompanhamento de Roteiro' },
                  { key: 'prospeccao', label: 'Prospecção de Cliente' },
                  { key: 'negociacao', label: 'Negociação Comercial' },
                  { key: 'resolucao', label: 'Resolução de Problemas' }
                ].map(t => (
                  <div key={t.key} className="flex items-center space-x-2 p-2 rounded border bg-white">
                    <Checkbox
                      id={`tipo-${t.key}`}
                      checked={tiposVisita.includes(t.key)}
                      onCheckedChange={() => toggleTipo(t.key)}
                    />
                    <label htmlFor={`tipo-${t.key}`} className="text-sm cursor-pointer">{t.label}</label>
                  </div>
                ))}
              </div>
            </div>

            {/* FORMULÁRIOS DINÂMICOS */}
            <FormTiposVisita
              tiposVisita={tiposVisita}
              formData={formData}
              setFormData={setFormData}
            />

            {/* CHECK-OUT */}
            <Button onClick={handleCheckout} disabled={loading || tiposVisita.length === 0}
              className="w-full bg-green-600 hover:bg-green-700">
              <CheckCircle className="w-4 h-4 mr-2" />
              {loading ? 'Localizando...' : 'Fazer Check-out'}
            </Button>
          </>
        )}

        {/* PÓS CHECK-OUT */}
        {checkoutDone && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-2 bg-green-50 rounded-lg border border-green-200 text-sm">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span>Check-out: <strong>{checkoutData.displayTime}</strong></span>
            </div>
            <div className="flex items-center gap-2 p-2 bg-amber-50 rounded-lg border border-amber-200 text-sm">
              <Clock className="w-4 h-4 text-amber-600" />
              <span>Tempo em Loja: <strong>{tempoLoja()?.display}</strong></span>
            </div>

            <div>
              <Label className="font-semibold">Resumo da Visita</Label>
              <Textarea
                placeholder="Descreva um resumo geral da visita..."
                value={formData.resumo_visita}
                onChange={(e) => setFormData({ ...formData, resumo_visita: e.target.value })}
                rows={3}
              />
            </div>

            <Button onClick={handleSalvar} disabled={salvando} className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-black">
              {salvando ? 'Salvando...' : 'Salvar Visita'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}