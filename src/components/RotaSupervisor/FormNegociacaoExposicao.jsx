import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
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

export default function FormNegociacaoExposicao({ formData, setFormData }) {
  const update = (key, value) => setFormData(prev => ({ ...prev, [key]: value }));

  return (
    <div className="p-3 bg-white rounded border space-y-3">
      <Label className="text-xs font-semibold">Exposição</Label>

      {/* Prazo De/Até */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Prazo De</Label>
          <Input type="date" value={formData.exposicao_prazo_de || ''} onChange={(e) => update('exposicao_prazo_de', e.target.value)} className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Prazo Até</Label>
          <Input type="date" value={formData.exposicao_prazo_ate || ''} onChange={(e) => update('exposicao_prazo_ate', e.target.value)} className="h-8 text-xs" />
        </div>
      </div>

      {/* Tipo exposição */}
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
  );
}