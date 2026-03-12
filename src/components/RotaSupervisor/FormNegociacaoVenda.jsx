import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';

export default function FormNegociacaoVenda({ formData, setFormData }) {
  const acoes = formData.acoes_venda || [{ prazo_de: '', prazo_ate: '', produto: '', valor_acao: '', valor_investimento: '' }];

  const updateAcao = (index, field, value) => {
    const novas = [...acoes];
    novas[index] = { ...novas[index], [field]: value };
    setFormData(prev => ({ ...prev, acoes_venda: novas }));
  };

  const addAcao = () => {
    setFormData(prev => ({
      ...prev,
      acoes_venda: [...(prev.acoes_venda || []), { prazo_de: '', prazo_ate: '', produto: '', valor_acao: '', valor_investimento: '' }]
    }));
  };

  const removeAcao = (index) => {
    const novas = acoes.filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, acoes_venda: novas.length > 0 ? novas : [{ prazo_de: '', prazo_ate: '', produto: '', valor_acao: '', valor_investimento: '' }] }));
  };

  return (
    <div className="p-3 bg-white rounded border space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold">Ações de Venda</Label>
        <Button type="button" variant="outline" size="sm" onClick={addAcao} className="h-7 text-xs gap-1">
          <Plus className="w-3 h-3" /> Adicionar Produto
        </Button>
      </div>

      {acoes.map((acao, index) => (
        <div key={index} className="p-3 bg-slate-50 rounded border space-y-2 relative">
          {acoes.length > 1 && (
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-500">Produto {index + 1}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => removeAcao(index)} className="h-6 w-6 p-0 text-red-500 hover:text-red-700">
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Prazo De</Label>
              <Input type="date" value={acao.prazo_de} onChange={(e) => updateAcao(index, 'prazo_de', e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Prazo Até</Label>
              <Input type="date" value={acao.prazo_ate} onChange={(e) => updateAcao(index, 'prazo_ate', e.target.value)} className="h-8 text-xs" />
            </div>
          </div>

          <div>
            <Label className="text-xs">Produto da Ação</Label>
            <Input placeholder="Produto..." value={acao.produto} onChange={(e) => updateAcao(index, 'produto', e.target.value)} className="h-8 text-xs" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Valor da Ação</Label>
              <Input type="number" step="0.01" placeholder="0,00" value={acao.valor_acao} onChange={(e) => updateAcao(index, 'valor_acao', e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Valor do Investimento</Label>
              <Input type="number" step="0.01" placeholder="0,00" value={acao.valor_investimento} onChange={(e) => updateAcao(index, 'valor_investimento', e.target.value)} className="h-8 text-xs" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}