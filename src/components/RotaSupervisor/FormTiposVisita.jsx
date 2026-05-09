import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import FormNegociacaoVenda from './FormNegociacaoVenda';
import FormNegociacaoExposicao from './FormNegociacaoExposicao';

export default function FormTiposVisita({ formData, setFormData }) {
  const tipos = formData.tipos_visita || [];
  const update = (key, value) => setFormData(prev => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-3">
      {tipos.includes('acompanhamento') && (
        <Card className="p-3 bg-blue-50 border-blue-200 space-y-2">
          <Label className="text-sm font-semibold text-blue-800">Acompanhamento</Label>
          <Textarea value={formData.obs_acompanhamento || ''} onChange={(e) => update('obs_acompanhamento', e.target.value)}
            placeholder="Observações do acompanhamento..." rows={3} className="text-sm" />
        </Card>
      )}

      {tipos.includes('prospeccao') && (
        <Card className="p-3 bg-purple-50 border-purple-200 space-y-2">
          <Label className="text-sm font-semibold text-purple-800">Prospecção</Label>
          <div>
            <Label className="text-xs">Nome Fantasia</Label>
            <Input value={formData.prospeccao_nome_fantasia || ''} onChange={(e) => update('prospeccao_nome_fantasia', e.target.value)} className="h-9" />
          </div>
          <Textarea value={formData.obs_prospeccao || ''} onChange={(e) => update('obs_prospeccao', e.target.value)}
            placeholder="Observações da prospecção..." rows={2} className="text-sm" />
        </Card>
      )}

      {tipos.includes('negociacao') && (
        <Card className="p-3 bg-green-50 border-green-200 space-y-3">
          <Label className="text-sm font-semibold text-green-800">Negociação Comercial</Label>
          <div className="flex gap-4">
            <div className="flex items-center space-x-2">
              <Checkbox id="neg-venda" checked={!!formData.negociacao_venda}
                onCheckedChange={(v) => update('negociacao_venda', v)} />
              <label htmlFor="neg-venda" className="text-sm cursor-pointer">Venda</label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="neg-exp" checked={!!formData.negociacao_exposicao}
                onCheckedChange={(v) => update('negociacao_exposicao', v)} />
              <label htmlFor="neg-exp" className="text-sm cursor-pointer">Exposição</label>
            </div>
          </div>
          {formData.negociacao_venda && <FormNegociacaoVenda formData={formData} setFormData={setFormData} />}
          {formData.negociacao_exposicao && <FormNegociacaoExposicao formData={formData} setFormData={setFormData} />}
        </Card>
      )}

      {tipos.includes('resolucao') && (
        <Card className="p-3 bg-red-50 border-red-200 space-y-2">
          <Label className="text-sm font-semibold text-red-800">Resolução de Problemas</Label>
          <div>
            <Label className="text-xs">Tipo do Problema</Label>
            <Select value={formData.tipo_problema || ''} onValueChange={(v) => update('tipo_problema', v)}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="logistica">Logística</SelectItem>
                <SelectItem value="atendimento">Atendimento</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Descrição do Problema</Label>
            <Textarea value={formData.descricao_problema || ''} onChange={(e) => update('descricao_problema', e.target.value)} rows={2} className="text-sm" />
          </div>
          <div>
            <Label className="text-xs">Atitude Tomada</Label>
            <Textarea value={formData.atitude_tomada || ''} onChange={(e) => update('atitude_tomada', e.target.value)} rows={2} className="text-sm" />
          </div>
          <div>
            <Label className="text-xs">Como foi finalizado</Label>
            <Textarea value={formData.como_finalizado || ''} onChange={(e) => update('como_finalizado', e.target.value)} rows={2} className="text-sm" />
          </div>
        </Card>
      )}
    </div>
  );
}