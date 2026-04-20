import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Loader2, Truck } from 'lucide-react';

export default function CargaFormModal({ open, onOpenChange, pedidosSelecionados, onCargaCriada }) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [numeroCarga, setNumeroCarga] = useState('');
  const [dataCarga, setDataCarga] = useState(hoje);
  const [motoristaId, setMotoristaId] = useState('');
  const [veiculoId, setVeiculoId] = useState('');
  const [rotaId, setRotaId] = useState('');
  const [obs, setObs] = useState('');
  const [salvando, setSalvando] = useState(false);

  const { data: motoristas = [] } = useQuery({ queryKey: ['motoristas'], queryFn: () => base44.entities.Motorista.list('-created_date', 500) });
  const { data: veiculos = [] } = useQuery({ queryKey: ['veiculos'], queryFn: () => base44.entities.Veiculo.list('-created_date', 500) });
  const { data: rotas = [] } = useQuery({ queryKey: ['rotas'], queryFn: () => base44.entities.Rota.list('-created_date', 500) });

  const salvar = async () => {
    if (pedidosSelecionados.length === 0) {
      toast.error('Selecione ao menos 1 pedido');
      return;
    }
    setSalvando(true);
    try {
      const motorista = motoristas.find(m => m.id === motoristaId);
      const veiculo = veiculos.find(v => v.id === veiculoId);
      const rota = rotas.find(r => r.id === rotaId);

      const clientesUnicos = new Set(pedidosSelecionados.map(p => p.cliente_id || p.codigo_cliente));
      const valorTotal = pedidosSelecionados.reduce((s, p) => s + (p.valor_total_pedido || 0), 0);

      const carga = await base44.entities.Carga.create({
        numero_carga: numeroCarga || `CARGA-${Date.now()}`,
        data_carga: dataCarga,
        rota_id: rotaId || null,
        rota_nome: rota?.nome || '',
        motorista_id: motoristaId || null,
        motorista_nome: motorista?.nome || '',
        veiculo_id: veiculoId || null,
        veiculo_placa: veiculo?.placa || '',
        pedidos_omie: pedidosSelecionados,
        quantidade_pedidos: pedidosSelecionados.length,
        quantidade_clientes: clientesUnicos.size,
        valor_total: valorTotal,
        status_carga: 'montando',
        observacoes: obs
      });

      toast.success('Carga criada com sucesso');
      onCargaCriada?.(carga);
      onOpenChange(false);
    } catch (e) {
      toast.error(e.message);
    }
    setSalvando(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-amber-500" />
            Nova Carga ({pedidosSelecionados.length} pedidos)
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
          <div>
            <Label>Número da carga</Label>
            <Input value={numeroCarga} onChange={(e) => setNumeroCarga(e.target.value)} placeholder="auto se vazio" />
          </div>
          <div>
            <Label>Data da carga</Label>
            <Input type="date" value={dataCarga} onChange={(e) => setDataCarga(e.target.value)} />
          </div>
          <div>
            <Label>Motorista</Label>
            <Select value={motoristaId} onValueChange={setMotoristaId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {motoristas.filter(m => m.status === 'ativo').map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Veículo</Label>
            <Select value={veiculoId} onValueChange={setVeiculoId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {veiculos.filter(v => v.ativo !== false).map(v => (
                  <SelectItem key={v.id} value={v.id}>{v.placa} - {v.descricao || v.modelo}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Rota principal</Label>
            <Select value={rotaId} onValueChange={setRotaId}>
              <SelectTrigger><SelectValue placeholder="Selecione (opcional)" /></SelectTrigger>
              <SelectContent>
                {rotas.map(r => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label>Observações</Label>
            <Input value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>
            {salvando && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Criar Carga
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}