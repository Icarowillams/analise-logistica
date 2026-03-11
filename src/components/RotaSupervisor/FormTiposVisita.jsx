import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';

function RadioOption({ name, value, checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm">
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className="accent-amber-500" />
      {label}
    </label>
  );
}

function PrazoField({ label, prazo, permanente, onChangePrazo, onChangePermanente }) {
  return (
    <div className="p-3 bg-white rounded border space-y-2">
      <Label className="text-xs font-semibold">{label}</Label>
      <div className="flex items-center gap-3">
        <div className="flex items-center space-x-2">
          <Checkbox id={`perm-${label}`} checked={permanente} onCheckedChange={onChangePermanente} />
          <label htmlFor={`perm-${label}`} className="text-xs cursor-pointer">Permanente</label>
        </div>
        {!permanente && (
          <Input type="date" value={prazo} onChange={(e) => onChangePrazo(e.target.value)} className="h-8 text-xs flex-1" />
        )}
      </div>
    </div>
  );
}

export default function FormTiposVisita({ tiposVisita, formData, setFormData }) {
  const update = (key, value) => setFormData(prev => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-4">
      {/* ACOMPANHAMENTO */}
      {tiposVisita.includes('acompanhamento') && (
        <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 space-y-2">
          <Label className="text-sm font-semibold text-blue-800">Acompanhamento de Roteiro</Label>
          <Textarea
            placeholder="Observações do acompanhamento..."
            value={formData.obs_acompanhamento}
            onChange={(e) => update('obs_acompanhamento', e.target.value)}
            rows={2}
          />
        </div>
      )}

      {/* PROSPECÇÃO */}
      {tiposVisita.includes('prospeccao') && (
        <div className="p-3 bg-purple-50 rounded-lg border border-purple-200 space-y-2">
          <Label className="text-sm font-semibold text-purple-800">Prospecção de Cliente</Label>
          <div>
            <Label className="text-xs">Nome Fantasia do Cliente Prospectado</Label>
            <Input
              placeholder="Nome Fantasia..."
              value={formData.prospeccao_nome_fantasia}
              onChange={(e) => update('prospeccao_nome_fantasia', e.target.value)}
              className="h-9"
            />
          </div>
          <Textarea
            placeholder="Observações da prospecção..."
            value={formData.obs_prospeccao}
            onChange={(e) => update('obs_prospeccao', e.target.value)}
            rows={2}
          />
        </div>
      )}

      {/* NEGOCIAÇÃO */}
      {tiposVisita.includes('negociacao') && (
        <div className="p-3 bg-green-50 rounded-lg border border-green-200 space-y-3">
          <Label className="text-sm font-semibold text-green-800">Negociação Comercial</Label>
          <div className="flex gap-4">
            <RadioOption name="tipo_neg" value="venda" checked={formData.tipo_negociacao === 'venda'} onChange={(v) => update('tipo_negociacao', v)} label="Venda" />
            <RadioOption name="tipo_neg" value="exposicao" checked={formData.tipo_negociacao === 'exposicao'} onChange={(v) => update('tipo_negociacao', v)} label="Exposição" />
          </div>

          {formData.tipo_negociacao === 'venda' && (
            <div className="p-3 bg-white rounded border space-y-2">
              <Label className="text-xs font-semibold">Ação Venda</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Prazo da Ação</Label>
                  <Input type="date" value={formData.acao_venda_prazo} onChange={(e) => update('acao_venda_prazo', e.target.value)} className="h-8 text-xs" />
                </div>
                <div>
                  <Label className="text-xs">Produto da Ação</Label>
                  <Input placeholder="Produto..." value={formData.acao_venda_produto} onChange={(e) => update('acao_venda_produto', e.target.value)} className="h-8 text-xs" />
                </div>
                <div>
                  <Label className="text-xs">Valor da Ação</Label>
                  <Input type="number" step="0.01" placeholder="0,00" value={formData.acao_venda_valor} onChange={(e) => update('acao_venda_valor', e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
            </div>
          )}

          {formData.tipo_negociacao === 'exposicao' && (
            <div className="space-y-3">
              <div className="flex gap-4 flex-wrap">
                <RadioOption name="tipo_exp" value="ponto_extra" checked={formData.tipo_exposicao === 'ponto_extra'} onChange={(v) => update('tipo_exposicao', v)} label="Ponto Extra" />
                <RadioOption name="tipo_exp" value="gondola" checked={formData.tipo_exposicao === 'gondola'} onChange={(v) => update('tipo_exposicao', v)} label="Gôndola" />
                <RadioOption name="tipo_exp" value="os_dois" checked={formData.tipo_exposicao === 'os_dois'} onChange={(v) => update('tipo_exposicao', v)} label="Os Dois" />
              </div>

              {(formData.tipo_exposicao === 'ponto_extra' || formData.tipo_exposicao === 'os_dois') && (
                <PrazoField
                  label="Ponto Extra"
                  prazo={formData.ponto_extra_prazo}
                  permanente={formData.ponto_extra_permanente}
                  onChangePrazo={(v) => update('ponto_extra_prazo', v)}
                  onChangePermanente={(v) => update('ponto_extra_permanente', v)}
                />
              )}

              {(formData.tipo_exposicao === 'gondola' || formData.tipo_exposicao === 'os_dois') && (
                <PrazoField
                  label="Gôndola"
                  prazo={formData.gondola_prazo}
                  permanente={formData.gondola_permanente}
                  onChangePrazo={(v) => update('gondola_prazo', v)}
                  onChangePermanente={(v) => update('gondola_permanente', v)}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* RESOLUÇÃO DE PROBLEMAS */}
      {tiposVisita.includes('resolucao') && (
        <div className="p-3 bg-red-50 rounded-lg border border-red-200 space-y-2">
          <Label className="text-sm font-semibold text-red-800">Resolução de Problemas</Label>
          <div className="flex gap-4">
            <RadioOption name="tipo_prob" value="logistica" checked={formData.tipo_problema === 'logistica'} onChange={(v) => update('tipo_problema', v)} label="Logística" />
            <RadioOption name="tipo_prob" value="atendimento" checked={formData.tipo_problema === 'atendimento'} onChange={(v) => update('tipo_problema', v)} label="Atendimento" />
          </div>
          <div>
            <Label className="text-xs">Descrição do Problema *</Label>
            <Textarea placeholder="Descreva o problema..." value={formData.descricao_problema} onChange={(e) => update('descricao_problema', e.target.value)} rows={2} />
          </div>
          <div>
            <Label className="text-xs">Atitude Tomada para Resolução *</Label>
            <Textarea placeholder="O que foi feito..." value={formData.atitude_tomada} onChange={(e) => update('atitude_tomada', e.target.value)} rows={2} />
          </div>
          <div>
            <Label className="text-xs">Como Foi Finalizado *</Label>
            <Textarea placeholder="Como terminou..." value={formData.como_finalizado} onChange={(e) => update('como_finalizado', e.target.value)} rows={2} />
          </div>
        </div>
      )}
    </div>
  );
}