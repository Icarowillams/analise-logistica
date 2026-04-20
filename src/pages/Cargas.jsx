import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Truck, Plus, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import DataTable from '@/components/ui/DataTable';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { toast } from 'sonner';

const STATUS_COLORS = {
  montando: 'bg-slate-200 text-slate-700',
  conferindo: 'bg-amber-100 text-amber-800',
  pronta: 'bg-blue-100 text-blue-800',
  faturada: 'bg-green-100 text-green-800',
  em_rota: 'bg-indigo-100 text-indigo-800',
  finalizada: 'bg-emerald-100 text-emerald-800',
  cancelada: 'bg-red-100 text-red-800'
};

export default function Cargas() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [faturando, setFaturando] = useState(null);
  const [excluindo, setExcluindo] = useState(null);

  const { data: cargas = [], isLoading } = useQuery({
    queryKey: ['cargas'],
    queryFn: () => base44.entities.Carga.list('-created_date', 500)
  });

  const faturar = async (carga) => {
    if (!confirm(`Faturar carga ${carga.numero_carga} (${carga.quantidade_pedidos} pedidos)?`)) return;
    setFaturando(carga.id);
    try {
      const { data } = await base44.functions.invoke('faturarCargaOmie', { carga_id: carga.id });
      if (data?.sucesso) {
        toast.success(`${data.sucessos} faturados | ${data.erros} erros | ${data.skips} ignorados (D1)`);
        queryClient.invalidateQueries({ queryKey: ['cargas'] });
      } else {
        toast.error(data?.error || 'Erro ao faturar');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setFaturando(null);
  };

  const excluir = async () => {
    if (!excluindo) return;
    try {
      await base44.entities.Carga.delete(excluindo.id);
      toast.success('Carga excluída');
      queryClient.invalidateQueries({ queryKey: ['cargas'] });
    } catch (e) {
      toast.error(e.message);
    }
    setExcluindo(null);
  };

  const columns = [
    { key: 'numero_carga', label: 'Nº Carga', sortable: true, width: '140px' },
    { key: 'data_carga', label: 'Data', sortable: true, width: '120px' },
    { key: 'motorista_nome', label: 'Motorista' },
    { key: 'veiculo_placa', label: 'Veículo', width: '110px' },
    { key: 'rota_nome', label: 'Rota' },
    { key: 'quantidade_pedidos', label: 'Pedidos', width: '80px', sortable: true },
    {
      key: 'valor_total',
      label: 'Valor',
      width: '140px',
      sortable: true,
      render: (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    },
    {
      key: 'status_carga',
      label: 'Status',
      width: '120px',
      render: (v) => <Badge className={STATUS_COLORS[v] || ''}>{v}</Badge>
    },
    {
      key: 'acoes',
      label: 'Ações',
      width: '200px',
      render: (_, row) => (
        <div className="flex gap-1">
          {['montando', 'conferindo', 'pronta'].includes(row.status_carga) && (
            <Button size="sm" onClick={() => faturar(row)} disabled={faturando === row.id}>
              {faturando === row.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Faturar'}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setExcluindo(row)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      )
    }
  ];

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Truck className="w-8 h-8 text-amber-500" />
          <div>
            <h1 className="text-2xl font-bold">Cargas</h1>
            <p className="text-sm text-slate-500">Cargas montadas para faturamento e rota</p>
          </div>
        </div>
        <Button onClick={() => navigate('/MontagemCarga')}>
          <Plus className="w-4 h-4 mr-2" />
          Nova carga
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{cargas.length} cargas registradas</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-8 text-center text-slate-500"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
          ) : (
            <DataTable data={cargas} columns={columns} searchable pageSize={50} emptyMessage="Nenhuma carga criada ainda" />
          )}
        </CardContent>
      </Card>

      <DeleteConfirmDialog
        open={!!excluindo}
        onOpenChange={() => setExcluindo(null)}
        onConfirm={excluir}
        title="Excluir carga"
        description={`Excluir carga ${excluindo?.numero_carga}? Os pedidos no Omie NÃO serão alterados.`}
      />
    </div>
  );
}