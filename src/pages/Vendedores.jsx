import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Users, Search, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Vendedores() {
  const [busca, setBusca] = useState('');

  const { data: vendedores = [], isFetching, refetch } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.filter({}, 'nome', 500),
    staleTime: 60_000
  });

  const filtrados = vendedores.filter(v => {
    const t = busca.toLowerCase();
    return !t || (v.nome || '').toLowerCase().includes(t) || (v.email || '').toLowerCase().includes(t) || (v.codigo_omie || '').includes(t);
  });

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-8 h-8 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold">Vendedores</h1>
            <p className="text-sm text-slate-500">{vendedores.length} vendedores cadastrados</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
        <Input placeholder="Buscar por nome, email ou código..." value={busca} onChange={e => setBusca(e.target.value)} className="pl-10" />
      </div>

      {isFetching && !vendedores.length && <div className="text-center py-8"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>}

      <div className="grid gap-2">
        {filtrados.map(v => (
          <Card key={v.id}>
            <CardContent className="p-3 flex items-center justify-between">
              <div>
                <div className="font-medium">{v.nome}</div>
                <div className="text-sm text-slate-500 flex gap-3">
                  {v.email && <span>{v.email}</span>}
                  {v.codigo_omie && <span>Cód: {v.codigo_omie}</span>}
                  {v.telefone && <span>Tel: {v.telefone}</span>}
                </div>
              </div>
              <div className="flex gap-1">
                {v.ativo === false && <Badge variant="destructive">Inativo</Badge>}
                {v.supervisor && <Badge variant="secondary">Supervisor</Badge>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
