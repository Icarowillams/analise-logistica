import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, Users, Loader2, RefreshCw } from 'lucide-react';

export default function ConsultaClientes() {
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');

  const { data: clientes = [], isFetching, refetch } = useQuery({
    queryKey: ['consulta-clientes', termo],
    queryFn: async () => {
      if (!termo) return [];
      const todos = await base44.entities.Cliente.filter({}, '-updated_date', 200);
      const t = termo.toLowerCase();
      return todos.filter(c =>
        (c.razao_social || '').toLowerCase().includes(t) ||
        (c.nome_fantasia || '').toLowerCase().includes(t) ||
        (c.cnpj_cpf || '').includes(t) ||
        (c.codigo_cliente_omie || '').includes(t) ||
        (c.cidade || '').toLowerCase().includes(t)
      );
    },
    enabled: !!termo,
    staleTime: 30_000
  });

  const pesquisar = () => setTermo(busca.trim());

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <Users className="w-8 h-8 text-blue-500" />
        <div>
          <h1 className="text-2xl font-bold">Consulta de Clientes</h1>
          <p className="text-sm text-slate-500">Busque por nome, CNPJ/CPF, código Omie ou cidade</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Digite nome, CNPJ/CPF, código ou cidade..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && pesquisar()}
          className="flex-1"
        />
        <Button onClick={pesquisar} disabled={isFetching}>
          {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Buscar
        </Button>
      </div>

      {termo && (
        <div className="text-sm text-slate-500">
          {clientes.length} resultado(s) para "{termo}"
        </div>
      )}

      <div className="grid gap-3">
        {clientes.map(c => (
          <Card key={c.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-semibold">{c.nome_fantasia || c.razao_social}</div>
                  {c.razao_social && c.nome_fantasia && (
                    <div className="text-xs text-slate-500">{c.razao_social}</div>
                  )}
                  <div className="flex gap-4 mt-1 text-sm text-slate-600 flex-wrap">
                    {c.cnpj_cpf && <span>CPF/CNPJ: {c.cnpj_cpf}</span>}
                    {c.codigo_cliente_omie && <span>Cód. Omie: {c.codigo_cliente_omie}</span>}
                    {c.cidade && <span>{c.cidade}{c.estado ? ` - ${c.estado}` : ''}</span>}
                  </div>
                  <div className="flex gap-4 mt-1 text-sm text-slate-600 flex-wrap">
                    {c.telefone1_ddd && c.telefone1_numero && <span>Tel: ({c.telefone1_ddd}) {c.telefone1_numero}</span>}
                    {c.email && <span>{c.email}</span>}
                    {c.vendedor_nome && <span>Vendedor: {c.vendedor_nome}</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-1 items-end">
                  {c.rota_nome && <Badge variant="outline">{c.rota_nome}</Badge>}
                  {c.segmento_nome && <Badge variant="secondary">{c.segmento_nome}</Badge>}
                  {c.inativo && <Badge variant="destructive">Inativo</Badge>}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
