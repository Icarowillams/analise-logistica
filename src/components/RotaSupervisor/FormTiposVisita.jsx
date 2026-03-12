import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import FormNegociacaoVenda from './FormNegociacaoVenda';
import FormNegociacaoExposicao from './FormNegociacaoExposicao';

function RadioOption({ name, value, checked, onChange, label }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm">
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className="accent-amber-500" />
      {label}
    </label>
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

      {/* NEGOCIAÇÃO COMERCIAL */}
      {tiposVisita.includes('negociacao') && (
        <div className="p-3 bg-green-50 rounded-lg border border-green-200 space-y-3">
          <Label className="text-sm font-semibold text-green-800">Negociação Comercial</Label>
          
          {/* Checkboxes - Venda e Exposição */}
          <div className="flex gap-6">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="neg-venda"
                checked={formData.negociacao_venda || false}
                onCheckedChange={(v) => update('negociacao_venda', v)}
              />
              <label htmlFor="neg-venda" className="text-sm cursor-pointer font-medium">Venda</label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="neg-exposicao"
                checked={formData.negociacao_exposicao || false}
                onCheckedChange={(v) => update('negociacao_exposicao', v)}
              />
              <label htmlFor="neg-exposicao" className="text-sm cursor-pointer font-medium">Exposição</label>
            </div>
          </div>

          {/* Bloco Venda */}
          {formData.negociacao_venda && (
            <FormNegociacaoVenda formData={formData} setFormData={setFormData} />
          )}

          {/* Bloco Exposição */}
          {formData.negociacao_exposicao && (
            <FormNegociacaoExposicao formData={formData} setFormData={setFormData} />
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