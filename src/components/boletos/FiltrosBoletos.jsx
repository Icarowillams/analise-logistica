import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function FiltrosBoletos({ onResultado }) {
  const hoje = new Date();
  const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const daqui30 = new Date(hoje.getTime() + 30 * 86400000);

  const [dataDe, setDataDe] = useState(fmt(hoje));
  const [dataAte, setDataAte] = useState(fmt(daqui30));
  const [filtrarPor, setFiltrarPor] = useState('V');
  const [cnpj, setCnpj] = useState('');
  const [loading, setLoading] = useState(false);

  const buscar = async () => {
    setLoading(true);
    try {
      const { data } = await base44.functions.invoke('listarContasReceberOmie', {
        data_de: dataDe,
        data_ate: dataAte,
        filtrar_por_data: filtrarPor,
        cnpj_cpf: cnpj || undefined,
        apenas_pendentes: true,
        registros_por_pagina: 200
      });
      if (data?.sucesso) {
        onResultado(data.titulos || []);
        toast.success(`${data.titulos?.length || 0} títulos em aberto`);
      } else {
        toast.error(data?.error || 'Erro ao buscar');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setLoading(false);
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <div>
            <Label>Filtrar por</Label>
            <Select value={filtrarPor} onValueChange={setFiltrarPor}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="V">Vencimento</SelectItem>
                <SelectItem value="E">Emissão</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Data de (DD/MM/AAAA)</Label>
            <Input value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
          </div>
          <div>
            <Label>Data até (DD/MM/AAAA)</Label>
            <Input value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
          </div>
          <div>
            <Label>CNPJ/CPF (opcional)</Label>
            <Input value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button onClick={buscar} disabled={loading} className="w-full">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
              Buscar
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}