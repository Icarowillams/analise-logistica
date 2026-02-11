import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Save, Loader2 } from 'lucide-react';

export default function Empresa() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    codigo: '', razao_social: '', nome_fantasia: '', cnpj: '', inscricao_estadual: '',
    uf: '', endereco: '', numero: '', complemento: '', bairro: '', cep: '', cidade: '',
    telefone: '', celular: '', email: '', responsavel: '', cnae: '',
    regime_tributario: '', apuracao_lucro: ''
  });
  const [saving, setSaving] = useState(false);

  const { data: empresas = [], isLoading } = useQuery({
    queryKey: ['empresa'],
    queryFn: () => base44.entities.Empresa.list()
  });

  const empresa = empresas[0];

  useEffect(() => {
    if (empresa) {
      setForm({
        codigo: empresa.codigo || '',
        razao_social: empresa.razao_social || '',
        nome_fantasia: empresa.nome_fantasia || '',
        cnpj: empresa.cnpj || '',
        inscricao_estadual: empresa.inscricao_estadual || '',
        uf: empresa.uf || '',
        endereco: empresa.endereco || '',
        numero: empresa.numero || '',
        complemento: empresa.complemento || '',
        bairro: empresa.bairro || '',
        cep: empresa.cep || '',
        cidade: empresa.cidade || '',
        telefone: empresa.telefone || '',
        celular: empresa.celular || '',
        email: empresa.email || '',
        responsavel: empresa.responsavel || '',
        cnae: empresa.cnae || '',
        regime_tributario: empresa.regime_tributario || '',
        apuracao_lucro: empresa.apuracao_lucro || ''
      });
    }
  }, [empresa]);

  const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    if (empresa) {
      await base44.entities.Empresa.update(empresa.id, form);
    } else {
      await base44.entities.Empresa.create(form);
    }
    queryClient.invalidateQueries({ queryKey: ['empresa'] });
    setSaving(false);
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const Field = ({ label, field, span = 1, type = 'text' }) => (
    <div className={span > 1 ? `col-span-${span}` : ''} style={span > 1 ? { gridColumn: `span ${span}` } : {}}>
      <Label className="text-xs text-slate-500">{label}</Label>
      <Input value={form[field]} onChange={e => handleChange(field, e.target.value)} type={type} className="h-9" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
          <Building2 className="w-5 h-5 text-amber-700" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Cadastro da Empresa</h1>
          <p className="text-sm text-slate-500">Informações da empresa para documentos e notas</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Dados da Empresa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Identificação */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Código" field="codigo" />
            <Field label="Razão Social" field="razao_social" span={2} />
            <Field label="Nome Fantasia" field="nome_fantasia" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="CNPJ" field="cnpj" />
            <Field label="Inscrição Estadual" field="inscricao_estadual" />
            <Field label="CNAE" field="cnae" />
          </div>

          {/* Endereço */}
          <div className="border-t pt-4">
            <p className="text-sm font-semibold text-slate-600 mb-3">Endereço</p>
            <div className="grid grid-cols-6 gap-3">
              <div style={{ gridColumn: 'span 1' }}>
                <Label className="text-xs text-slate-500">UF</Label>
                <Input value={form.uf} onChange={e => handleChange('uf', e.target.value)} className="h-9" />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <Field label="Endereço" field="endereco" />
              </div>
              <Field label="Número" field="numero" />
              <Field label="Complemento" field="complemento" />
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <Field label="Bairro" field="bairro" />
              <Field label="Cidade" field="cidade" />
              <Field label="CEP" field="cep" />
            </div>
          </div>

          {/* Contato */}
          <div className="border-t pt-4">
            <p className="text-sm font-semibold text-slate-600 mb-3">Contato</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Telefone" field="telefone" />
              <Field label="Celular" field="celular" />
              <Field label="Email" field="email" />
              <Field label="Responsável" field="responsavel" />
            </div>
          </div>

          {/* Fiscal */}
          <div className="border-t pt-4">
            <p className="text-sm font-semibold text-slate-600 mb-3">Dados Fiscais</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-slate-500">Apuração de Lucro</Label>
                <Select value={form.apuracao_lucro} onValueChange={v => handleChange('apuracao_lucro', v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lucro_simples">Lucro Simples</SelectItem>
                    <SelectItem value="lucro_real">Lucro Real</SelectItem>
                    <SelectItem value="lucro_presumido">Lucro Presumido</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-slate-500">Regime Tributário (CRT)</Label>
                <Select value={form.regime_tributario} onValueChange={v => handleChange('regime_tributario', v)}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simples_nacional">Simples Nacional</SelectItem>
                    <SelectItem value="simples_excesso">Simples Nac. Excesso Sublimite Rec. Bruta</SelectItem>
                    <SelectItem value="regime_normal">Regime Normal</SelectItem>
                    <SelectItem value="simples_mei">Simples Nacional/MEI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={saving} className="bg-amber-500 hover:bg-amber-600 text-black">
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Salvar Empresa
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}