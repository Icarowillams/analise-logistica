import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X, Users, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';

export default function AtualizacaoMassaPainel({
  selectedIds,
  onClear,
  vendedores = [],
  modalidades = [],
  rotas = [],
}) {
  const queryClient = useQueryClient();
  const [modalidadeId, setModalidadeId] = useState('');
  const [vendedorId, setVendedorId] = useState('');
  const [rotaId, setRotaId] = useState('');
  const [processando, setProcessando] = useState(false);
  const [progresso, setProgresso] = useState({ atual: 0, total: 0, erros: 0 });

  const count = selectedIds.length;
  const algumCampoPreenchido = modalidadeId || vendedorId || rotaId;

  const handleAplicar = async () => {
    if (!algumCampoPreenchido) {
      toast.warning('Preencha pelo menos um campo para aplicar.');
      return;
    }

    setProcessando(true);
    setProgresso({ atual: 0, total: count, erros: 0 });

    const dados = {};
    if (modalidadeId) dados.modalidade_pagamento_id = modalidadeId;
    if (vendedorId) {
      dados.vendedor_id = vendedorId;
      const vendedor = vendedores.find(v => v.id === vendedorId);
      if (vendedor?.supervisor_id) dados.supervisor_id = vendedor.supervisor_id;
    }
    if (rotaId) dados.rota_id = rotaId;

    let atualizados = 0;
    let erros = 0;

    // Processar em lotes de 20
    const LOTE = 20;
    for (let i = 0; i < selectedIds.length; i += LOTE) {
      const lote = selectedIds.slice(i, i + LOTE);
      const promises = lote.map(id =>
        base44.entities.Cliente.update(id, dados)
          .then(() => { atualizados++; })
          .catch(() => { erros++; })
      );
      await Promise.all(promises);
      setProgresso({ atual: Math.min(i + LOTE, count), total: count, erros });
    }

    setProcessando(false);
    queryClient.invalidateQueries(['clientes']);

    if (erros === 0) {
      toast.success(`${atualizados} cliente(s) atualizado(s) com sucesso!`);
    } else {
      toast.warning(`${atualizados} atualizado(s), ${erros} erro(s).`);
    }

    setModalidadeId('');
    setVendedorId('');
    setRotaId('');
    onClear();
  };

  if (count === 0) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:left-72">
      <div className="mx-auto max-w-5xl px-4 pb-4">
        <div className="bg-white rounded-xl shadow-2xl border border-slate-200 p-4 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <Users className="w-4 h-4 text-amber-500" />
              {count} cliente(s) selecionado(s)
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClear}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          {processando ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                Atualizando {progresso.atual}/{progresso.total}...
                {progresso.erros > 0 && <span className="text-red-500">({progresso.erros} erros)</span>}
              </div>
              <Progress value={(progresso.atual / progresso.total) * 100} className="h-2" />
            </div>
          ) : (
            <>
              {/* Campos */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Modalidade de Pagamento</Label>
                  <Select value={modalidadeId || '_none_'} onValueChange={v => setModalidadeId(v === '_none_' ? '' : v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Não alterar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_" className="text-slate-400 italic">Não alterar</SelectItem>
                      {modalidades.filter(m => m.status !== 'inativo').map(m => (
                        <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Vendedor</Label>
                  <Select value={vendedorId || '_none_'} onValueChange={v => setVendedorId(v === '_none_' ? '' : v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Não alterar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_" className="text-slate-400 italic">Não alterar</SelectItem>
                      {vendedores.filter(v => v.status !== 'inativo').map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Rota</Label>
                  <Select value={rotaId || '_none_'} onValueChange={v => setRotaId(v === '_none_' ? '' : v)}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Não alterar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_" className="text-slate-400 italic">Não alterar</SelectItem>
                      {rotas.filter(r => r.status !== 'inativo').map(r => (
                        <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Ação */}
              <div className="flex justify-end">
                <Button
                  onClick={handleAplicar}
                  disabled={!algumCampoPreenchido}
                  className="bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-neutral-900 font-semibold"
                >
                  Aplicar em {count} cliente(s)
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}