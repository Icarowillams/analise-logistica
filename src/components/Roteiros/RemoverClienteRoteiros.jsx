import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserMinus, Search, Loader2, Trash2 } from 'lucide-react';

const getDiaLabel = (d) => ({
  'segunda-feira': 'Segunda-feira', 'terca-feira': 'Terça-feira', 'quarta-feira': 'Quarta-feira',
  'quinta-feira': 'Quinta-feira', 'sexta-feira': 'Sexta-feira', 'sabado': 'Sábado', 'domingo': 'Domingo'
})[d] || d;

export default function RemoverClienteRoteiros() {
  const [busca, setBusca] = useState('');
  const [vendedorFiltro, setVendedorFiltro] = useState('');
  const [removendoId, setRemovendoId] = useState(null);

  const queryClient = useQueryClient();

  const { data: roteiros = [] } = useQuery({ queryKey: ['roteiros'], queryFn: () => base44.entities.Roteiro.list() });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });

  const removerMutation = useMutation({
    mutationFn: async ({ roteiro, clienteId, clienteCodigo }) => {
      const novosIds = (roteiro.clientes_ids || []).filter(id => id !== clienteId);
      const novosDetalhes = (roteiro.clientes_detalhes || [])
        .filter(c => c.cliente_id !== clienteId && c.cliente_codigo !== clienteCodigo)
        .map((c, idx) => ({ ...c, ordem: idx + 1 }));
      return base44.entities.Roteiro.update(roteiro.id, {
        clientes_ids: novosIds,
        clientes_detalhes: novosDetalhes
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['roteiros']);
      toast.success('Cliente removido do roteiro!');
      setRemovendoId(null);
    },
    onError: (e) => { toast.error('Erro: ' + e.message); setRemovendoId(null); }
  });

  // Encontra ocorrências do cliente buscado em todos os roteiros
  const ocorrencias = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return [];
    const result = [];
    roteiros.forEach(r => {
      if (vendedorFiltro && r.vendedor_id !== vendedorFiltro) return;
      (r.clientes_detalhes || []).forEach(c => {
        const match =
          c.cliente_codigo?.toLowerCase().includes(q) ||
          c.cliente_nome?.toLowerCase().includes(q) ||
          c.nome_fantasia?.toLowerCase().includes(q);
        if (match) {
          result.push({
            roteiro: r,
            cliente_id: c.cliente_id,
            cliente_codigo: c.cliente_codigo,
            cliente_nome: c.nome_fantasia || c.cliente_nome
          });
        }
      });
    });
    return result;
  }, [busca, vendedorFiltro, roteiros]);

  const handleRemover = (oc) => {
    setRemovendoId(`${oc.roteiro.id}-${oc.cliente_id}`);
    removerMutation.mutate({ roteiro: oc.roteiro, clienteId: oc.cliente_id, clienteCodigo: oc.cliente_codigo });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserMinus className="w-5 h-5 text-red-500" />Remover Cliente dos Roteiros
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          Busque um cliente pelo código ou nome. Aparecerão todos os roteiros (vendedor + dia) onde ele está.
          Clique em <strong>Remover</strong> para tirá-lo daquele dia específico.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Buscar cliente (código ou nome)</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                className="pl-9"
                placeholder="Ex: 28944 ou nome do cliente..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label>Filtrar por vendedor (opcional)</Label>
            <Select value={vendedorFiltro || 'all'} onValueChange={(v) => setVendedorFiltro(v === 'all' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Todos os vendedores" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os vendedores</SelectItem>
                {vendedores.map(v => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {busca.trim() && (
          <div className="border rounded-lg divide-y">
            {ocorrencias.length === 0 ? (
              <p className="text-center text-slate-500 py-8">Nenhum roteiro encontrado com esse cliente.</p>
            ) : (
              <>
                <div className="px-4 py-2 bg-slate-50 text-xs text-slate-600">
                  {ocorrencias.length} ocorrência(s) encontrada(s)
                </div>
                {ocorrencias.map((oc, idx) => {
                  const id = `${oc.roteiro.id}-${oc.cliente_id}`;
                  const isRemoving = removendoId === id;
                  return (
                    <div key={idx} className="flex items-center justify-between p-4 hover:bg-slate-50">
                      <div>
                        <p className="font-medium text-sm">
                          {oc.cliente_codigo} - {oc.cliente_nome}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Vendedor: <strong>{oc.roteiro.vendedor_nome}</strong>
                          <Badge variant="outline" className="ml-2">{getDiaLabel(oc.roteiro.dia_semana)}</Badge>
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-red-200 text-red-600 hover:bg-red-50"
                        onClick={() => handleRemover(oc)}
                        disabled={isRemoving}
                      >
                        {isRemoving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Trash2 className="w-4 h-4 mr-1" />Remover</>}
                      </Button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}