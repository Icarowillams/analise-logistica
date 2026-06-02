import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function EditarCargaModal({ open, onOpenChange, carga, onSalvo }) {
  const [motoristaId, setMotoristaId] = useState('');
  const [veiculoId, setVeiculoId] = useState('');
  const [rotaId, setRotaId] = useState('');
  const [salvando, setSalvando] = useState(false);

  const { data: motoristas = [] } = useQuery({
    queryKey: ['motoristas-ativos'],
    queryFn: () => base44.entities.Motorista.filter({ status: 'ativo' }),
    staleTime: 60000
  });

  const { data: veiculos = [] } = useQuery({
    queryKey: ['veiculos-ativos'],
    queryFn: () => base44.entities.Veiculo.filter({ ativo: true }),
    staleTime: 60000
  });

  const { data: rotas = [] } = useQuery({
    queryKey: ['rotas-ativas'],
    queryFn: () => base44.entities.Rota.filter({ status: 'ativo' }),
    staleTime: 60000
  });

  useEffect(() => {
    if (carga) {
      setMotoristaId(carga.motorista_id || '');
      setVeiculoId(carga.veiculo_id || '');
      setRotaId(carga.rota_id || '');
    }
  }, [carga]);

  const salvar = async () => {
    setSalvando(true);
    try {
      const motorista = motoristas.find(m => m.id === motoristaId);
      const veiculo = veiculos.find(v => v.id === veiculoId);
      const rota = rotas.find(r => r.id === rotaId);

      await base44.entities.Carga.update(carga.id, {
        motorista_id: motoristaId || null,
        motorista_nome: motorista?.nome || '',
        veiculo_id: veiculoId || null,
        veiculo_placa: veiculo?.placa || '',
        rota_id: rotaId || null,
        rota_nome: rota?.nome || ''
      });

      await base44.functions.invoke('registrarLogGerencial', {
        tipo_acao: 'edicao',
        entidade_tipo: 'Carga',
        entidade_id: carga.id,
        carga_id: carga.id,
        entidade_descricao: `Carga ${carga.numero_carga}`,
        descricao: `Motorista/Veículo/Rota alterados na carga ${carga.numero_carga}`
      });

      toast.success('Carga atualizada com sucesso');
      onSalvo?.();
      onOpenChange(false);
    } catch (e) {
      toast.error(e.message);
    }
    setSalvando(false);
  };

  if (!carga) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar Carga {carga.numero_carga}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Motorista</Label>
            <Select value={motoristaId} onValueChange={setMotoristaId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {motoristas.map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Veículo</Label>
            <Select value={veiculoId} onValueChange={setVeiculoId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {veiculos.map(v => (
                  <SelectItem key={v.id} value={v.id}>{v.placa} — {v.descricao || v.modelo || ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Rota</Label>
            <Select value={rotaId} onValueChange={setRotaId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {rotas.map(r => (
                  <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}