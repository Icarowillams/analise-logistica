import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Search, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function PedidosBuscaCarga({ onResultado }) {
  const [etapa, setEtapa] = useState('50');
  const [dataInicial, setDataInicial] = useState('');
  const [dataFinal, setDataFinal] = useState('');
  const [loading, setLoading] = useState(false);

  const buscar = async () => {
    setLoading(true);
    try {
      const { data: resBusca } = await base44.functions.invoke('buscarPedidosOmie', {
        etapa,
        data_inicial: dataInicial || undefined,
        data_final: dataFinal || undefined,
        registros_por_pagina: 200
      });
      if (!resBusca?.sucesso) {
        toast.error(resBusca?.error || 'Erro ao buscar pedidos');
        setLoading(false);
        return;
      }
      const { data: resEnriq } = await base44.functions.invoke('enriquecerPedidosCarga', {
        pedidos: resBusca.pedidos
      });
      onResultado(resEnriq?.pedidos || []);
      toast.success(`${resBusca.pedidos.length} pedidos encontrados`);
    } catch (e) {
      toast.error(e.message);
    }
    setLoading(false);
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <Label>Etapa Omie</Label>
            <Select value={etapa} onValueChange={setEtapa}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10 - Pré-venda</SelectItem>
                <SelectItem value="20">20 - Em separação</SelectItem>
                <SelectItem value="50">50 - Pronto p/ faturar</SelectItem>
                <SelectItem value="60">60 - Faturado</SelectItem>
                <SelectItem value="70">70 - NF emitida</SelectItem>
                <SelectItem value="80">80 - Entregue</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Data inicial (DD/MM/AAAA)</Label>
            <Input value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} placeholder="01/04/2026" />
          </div>
          <div>
            <Label>Data final (DD/MM/AAAA)</Label>
            <Input value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} placeholder="20/04/2026" />
          </div>
          <div className="flex items-end">
            <Button onClick={buscar} disabled={loading} className="w-full">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
              Buscar pedidos
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}