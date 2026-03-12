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
import { MapPin, CheckCircle, Clock, Store, Save } from 'lucide-react';
import { toast } from 'sonner';
import FormTiposVisita from './FormTiposVisita';
import EstoqueSupervisorForm from './EstoqueSupervisorForm';

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

const TIPOS_VISITA = [
  { key: 'acompanhamento', label: 'Acompanhamento de Roteiro' },
  { key: 'negociacao', label: 'Negociação Comercial' },
  { key: 'resolucao', label: 'Resolução de Problemas' },
  { key: 'estoque', label: 'Informar Estoque' }
];

export default function FormVisitaSupervisor({ cliente, rotaSupervisorId, supervisor, isProspeccao = false, visitaExistente = null, onClose }) {
  const queryClient = useQueryClient();
  // Se veio uma visita existente (checkin_realizado), restaurar estado
  const [checkinDone, setCheckinDone] = useState(!!visitaExistente);
  const [checkinData, setCheckinData] = useState(() => {
    if (visitaExistente?.checkin_time) {
      return {
        time: visitaExistente.checkin_time,
        latitude: visitaExistente.checkin_latitude,
        longitude: visitaExistente.checkin_longitude,
        displayTime: new Date(visitaExistente.checkin_time).toLocaleTimeString('pt-BR')
      };
    }
    return null;
  });
  const [checkoutDone, setCheckoutDone] = useState(false);
  const [checkoutData, setCheckoutData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [salvando, setSalvando] = useState(false);
  // ID da visita no banco (criada no check-in)
  const [visitaDbId, setVisitaDbId] = useState(visitaExistente?.id || null);

  const [tiposVisita, setTiposVisita] = useState(() => {
    if (visitaExistente?.tipos_visita?.length > 0) return visitaExistente.tipos_visita;
    return isProspeccao ? ['prospeccao'] : [];
  });
  const [formData, setFormData] = useState(() => {
    if (visitaExistente) {
      return {
        obs_acompanhamento: visitaExistente.obs_acompanhamento || '',
        prospeccao_nome_fantasia: visitaExistente.prospeccao_nome_fantasia || (isProspeccao ? (cliente.nome_fantasia || '') : ''),
        obs_prospeccao: visitaExistente.obs_prospeccao || '',
        negociacao_venda: visitaExistente.negociacao_venda || false,
        negociacao_exposicao: visitaExistente.negociacao_exposicao || false,
        acoes_venda: visitaExistente.acoes_venda?.length > 0 ? visitaExistente.acoes_venda : [{ prazo_de: '', prazo_ate: '', produto: '', valor_acao: '', valor_investimento: '' }],
        exposicao_prazo_de: visitaExistente.exposicao_prazo_de || '',
        exposicao_prazo_ate: visitaExistente.exposicao_prazo_ate || '',
        tipo_exposicao: visitaExistente.tipo_exposicao || '',
        ponto_extra_prazo: visitaExistente.ponto_extra_prazo || '',
        ponto_extra_permanente: visitaExistente.ponto_extra_permanente || false,
        gondola_prazo: visitaExistente.gondola_prazo || '',
        gondola_permanente: visitaExistente.gondola_permanente || false,
        tipo_problema: visitaExistente.tipo_problema || '',
        descricao_problema: visitaExistente.descricao_problema || '',
        atitude_tomada: visitaExistente.atitude_tomada || '',
        como_finalizado: visitaExistente.como_finalizado || '',
        resumo_visita: visitaExistente.resumo_visita || '',
        observacao_geral: visitaExistente.observacao_geral || ''
      };
    }
    return {
      obs_acompanhamento: '',
      prospeccao_nome_fantasia: isProspeccao ? (cliente.nome_fantasia || '') : '',
      obs_prospeccao: '',
      negociacao_venda: false,
      negociacao_exposicao: false,
      acoes_venda: [{ prazo_de: '', prazo_ate: '', produto: '', valor_acao: '', valor_investimento: '' }],
      exposicao_prazo_de: '',
      exposicao_prazo_ate: '',
      tipo_exposicao: '',
      ponto_extra_prazo: '',
      ponto_extra_permanente: false,
      gondola_prazo: '',
      gondola_permanente: false,
      tipo_problema: '',
      descricao_problema: '',
      atitude_tomada: '',
      como_finalizado: '',
      resumo_visita: '',
      observacao_geral: ''
    };
  });
  // Rastreia quais blocos já foram salvos no banco
  const [savedBlocks, setSavedBlocks] = useState(() => {
    if (!visitaExistente?.tipos_visita) return {};
    const blocks = {};
    visitaExistente.tipos_visita.forEach(t => { blocks[t] = true; });
    return blocks;
  });

  const handleCheckin = () => {
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const agora = new Date();
        const checkin = {
          time: getLocalISOString(agora),
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          displayTime: agora.toLocaleTimeString('pt-BR')
        };

        const isVirtualClient = cliente._isProspeccao === true;
        // Salvar no banco com status checkin_realizado
        const visitaCriada = await base44.entities.VisitaSupervisor.create({
          rota_supervisor_id: rotaSupervisorId,
          supervisor_id: supervisor.id,
          supervisor_nome: supervisor.nome,
          cliente_id: isVirtualClient ? '' : cliente.id,
          cliente_codigo: isVirtualClient ? 'PROSPECCAO' : cliente.codigo,
          cliente_nome: cliente.nome_fantasia || cliente.razao_social,
          cliente_cidade: cliente.cidade || '',
          data_visita: getLocalDateStr(),
          checkin_time: checkin.time,
          checkin_latitude: checkin.latitude,
          checkin_longitude: checkin.longitude,
          status: 'checkin_realizado'
        });

        setVisitaDbId(visitaCriada.id);
        setCheckinData(checkin);
        setCheckinDone(true);
        setLoading(false);
        queryClient.invalidateQueries({ queryKey: ['visitasSupervisor'] });
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

    const data = {
      checkout_time: checkoutData.time,
      checkout_latitude: checkoutData.latitude,
      checkout_longitude: checkoutData.longitude,
      tempo_loja_minutos: tempo?.minutos || 0,
      tipos_visita: tiposVisita,
      resumo_visita: formData.resumo_visita,
      observacao_geral: formData.observacao_geral,
      status: 'concluida'
    };

    if (tiposVisita.includes('acompanhamento')) data.obs_acompanhamento = formData.obs_acompanhamento;
    if (tiposVisita.includes('prospeccao')) {
      data.prospeccao_nome_fantasia = formData.prospeccao_nome_fantasia;
      data.obs_prospeccao = formData.obs_prospeccao;
    }
    if (tiposVisita.includes('negociacao')) {
      data.negociacao_venda = formData.negociacao_venda || false;
      data.negociacao_exposicao = formData.negociacao_exposicao || false;

      if (formData.negociacao_venda) {
        data.acoes_venda = (formData.acoes_venda || []).map(a => ({
          prazo_de: a.prazo_de,
          prazo_ate: a.prazo_ate,
          produto: a.produto,
          valor_acao: a.valor_acao ? Number(a.valor_acao) : 0,
          valor_investimento: a.valor_investimento ? Number(a.valor_investimento) : 0
        }));
      }

      if (formData.negociacao_exposicao) {
        data.exposicao_prazo_de = formData.exposicao_prazo_de;
        data.exposicao_prazo_ate = formData.exposicao_prazo_ate;
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

    // Atualizar a visita já criada no check-in
    await base44.entities.VisitaSupervisor.update(visitaDbId, data);

    // Se usou estoque, atualizar os registros temporários com o ID real da visita
    if (tiposVisita.includes('estoque') && visitaDbId) {
      const [estoques, trocas] = await Promise.all([
        base44.entities.EstoqueVisita.filter({ visita_id: visitaDbId }),
        base44.entities.TrocaVisita.filter({ visita_id: visitaDbId })
      ]);
      // Nenhuma migração necessária, já usam o ID real
    }

    await queryClient.invalidateQueries({ queryKey: ['visitasSupervisor'] });
    toast.success('Visita salva com sucesso!');
    setSalvando(false);
    onClose();
  };

  const handleSalvarBloco = async (bloco) => {
    const dataBloco = { tipos_visita: [...new Set([...tiposVisita])] };

    if (bloco === 'acompanhamento') {
      dataBloco.obs_acompanhamento = formData.obs_acompanhamento;
    } else if (bloco === 'negociacao') {
      dataBloco.negociacao_venda = formData.negociacao_venda || false;
      dataBloco.negociacao_exposicao = formData.negociacao_exposicao || false;
      if (formData.negociacao_venda) {
        dataBloco.acoes_venda = (formData.acoes_venda || []).map(a => ({
          prazo_de: a.prazo_de, prazo_ate: a.prazo_ate, produto: a.produto,
          valor_acao: a.valor_acao ? Number(a.valor_acao) : 0,
          valor_investimento: a.valor_investimento ? Number(a.valor_investimento) : 0
        }));
      }
      if (formData.negociacao_exposicao) {
        dataBloco.exposicao_prazo_de = formData.exposicao_prazo_de;
        dataBloco.exposicao_prazo_ate = formData.exposicao_prazo_ate;
        dataBloco.tipo_exposicao = formData.tipo_exposicao;
        if (formData.tipo_exposicao === 'ponto_extra' || formData.tipo_exposicao === 'os_dois') {
          dataBloco.ponto_extra_prazo = formData.ponto_extra_permanente ? '' : formData.ponto_extra_prazo;
          dataBloco.ponto_extra_permanente = formData.ponto_extra_permanente;
        }
        if (formData.tipo_exposicao === 'gondola' || formData.tipo_exposicao === 'os_dois') {
          dataBloco.gondola_prazo = formData.gondola_permanente ? '' : formData.gondola_prazo;
          dataBloco.gondola_permanente = formData.gondola_permanente;
        }
      }
    } else if (bloco === 'resolucao') {
      dataBloco.tipo_problema = formData.tipo_problema;
      dataBloco.descricao_problema = formData.descricao_problema;
      dataBloco.atitude_tomada = formData.atitude_tomada;
      dataBloco.como_finalizado = formData.como_finalizado;
    }

    await base44.entities.VisitaSupervisor.update(visitaDbId, dataBloco);
    setSavedBlocks(prev => ({ ...prev, [bloco]: true }));
    toast.success(`${bloco === 'acompanhamento' ? 'Acompanhamento' : bloco === 'negociacao' ? 'Negociação' : 'Resolução'} salvo!`);
  };

  const handleCancelar = async () => {
    // Se o check-in já foi salvo no banco, deletar o registro
    if (visitaDbId) {
      await base44.entities.VisitaSupervisor.delete(visitaDbId);
      queryClient.invalidateQueries({ queryKey: ['visitasSupervisor'] });
    }
    onClose();
  };

  const toggleTipo = (tipo) => {
    if (tipo === 'prospeccao' && isProspeccao) return;
    const isRemoving = tiposVisita.includes(tipo);
    if (isRemoving && savedBlocks[tipo]) {
      const confirmMsg = `O bloco "${TIPOS_VISITA.find(t => t.key === tipo)?.label}" já foi salvo. Deseja realmente removê-lo? Os dados salvos serão perdidos.`;
      if (!window.confirm(confirmMsg)) return;
      setSavedBlocks(prev => { const next = { ...prev }; delete next[tipo]; return next; });
    }
    setTiposVisita(prev => isRemoving ? prev.filter(t => t !== tipo) : [...prev, tipo]);
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
          <Button variant="ghost" size="sm" onClick={handleCancelar} className="text-xs">Cancelar</Button>
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
                {TIPOS_VISITA.map(t => (
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
              savedBlocks={savedBlocks}
              onSalvarBloco={handleSalvarBloco}
              visitaDbId={visitaDbId}
            />

            {/* INFORMAR ESTOQUE */}
            {tiposVisita.includes('estoque') && visitaDbId && (
              <EstoqueSupervisorForm
                visitaId={visitaDbId}
                clienteId={cliente._isProspeccao ? '' : cliente.id}
                clienteNome={cliente.nome_fantasia || cliente.razao_social}
              />
            )}

            {/* OBSERVAÇÃO GERAL */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold text-slate-700">Observação</Label>
                {savedBlocks.observacao && <CheckCircle className="w-4 h-4 text-green-500" />}
              </div>
              <Textarea
                placeholder="Observações gerais desta visita (opcional)..."
                value={formData.observacao_geral}
                onChange={(e) => setFormData({ ...formData, observacao_geral: e.target.value })}
                rows={2}
              />
              {visitaDbId && (
                <div className="flex items-center justify-end">
                  <Button
                    type="button" variant="outline" size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={async () => {
                      await base44.entities.VisitaSupervisor.update(visitaDbId, {
                        observacao_geral: formData.observacao_geral
                      });
                      setSavedBlocks(prev => ({ ...prev, observacao: true }));
                      toast.success('Observação salva!');
                    }}
                  >
                    <Save className="w-3.5 h-3.5" /> Salvar Observação
                  </Button>
                </div>
              )}
            </div>

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