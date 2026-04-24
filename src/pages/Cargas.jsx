import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Truck, Plus, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import DataTable from '@/components/ui/DataTable';
import DeleteConfirmDialog from '@/components/forms/DeleteConfirmDialog';
import { toast } from 'sonner';

const FATURAVEL = ['montagem', 'montando', 'fechada', 'conferindo', 'pronta'];

const STATUS_COLORS = {
  montagem: 'bg-slate-200 text-slate-700',
  fechada: 'bg-slate-300 text-slate-700',
  montando: 'bg-slate-200 text-slate-700',
  conferindo: 'bg-amber-100 text-amber-800',
  pronta: 'bg-blue-100 text-blue-800',
  faturada: 'bg-green-100 text-green-800',
  em_rota: 'bg-indigo-100 text-indigo-800',
  entregue: 'bg-emerald-100 text-emerald-800',
  finalizada: 'bg-emerald-100 text-emerald-800',
  cancelada: 'bg-red-100 text-red-800'
};

export default function Cargas() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [faturando, setFaturando] = useState(null);
  const [excluindo, setExcluindo] = useState(null);
  const [selecionadas, setSelecionadas] = useState([]);
  const [faturandoLote, setFaturandoLote] = useState(false);

  const { data: cargasTodas = [], isLoading } = useQuery({
    queryKey: ['cargas'],
    queryFn: () => base44.entities.Carga.list('-created_date', 500)
  });

  // Exibe todas as cargas criadas (inclusive em montagem), para permitir faturamento a qualquer momento.
  const cargas = cargasTodas;

  const faturar = async (carga) => {
    if (!confirm(`Faturar carga ${carga.numero_carga} (${carga.quantidade_pedidos} pedidos)?`)) return;
    setFaturando(carga.id);
    try {
      const { data } = await base44.functions.invoke('faturarCargaOmie', { carga_id: carga.id });
      if (data?.sucesso) {
        if (data.erros > 0) {
          const erros = (data.resultados || []).filter(r => r.sucesso === false);
          const msg = erros.map(r => `Pedido ${r.codigo_pedido}: ${r.mensagem}`).join('\n');
          toast.error(`${data.sucessos} faturados | ${data.erros} erros`, { description: msg, duration: 15000 });
        } else {
          toast.success(`${data.sucessos} faturados | ${data.skips} ignorados (D1)`);
        }
        queryClient.invalidateQueries({ queryKey: ['cargas'] });
      } else {
        toast.error(data?.error || 'Erro ao faturar');
      }
    } catch (e) {
      toast.error(e.message);
    }
    setFaturando(null);
  };

  const faturarLote = async () => {
    const cargasFaturar = cargas.filter(c => selecionadas.includes(c.id) && FATURAVEL.includes(c.status_carga));
    if (cargasFaturar.length === 0) {
      toast.error('Nenhuma carga selecionada está em status que permita faturamento');
      return;
    }
    if (!confirm(`Faturar ${cargasFaturar.length} carga(s) selecionada(s)?`)) return;

    setFaturandoLote(true);
    let totalSucessos = 0, totalErros = 0, totalSkips = 0, cargasErro = 0;

    for (const carga of cargasFaturar) {
      try {
        const { data } = await base44.functions.invoke('faturarCargaOmie', { carga_id: carga.id });
        if (data?.sucesso) {
          totalSucessos += data.sucessos || 0;
          totalErros += data.erros || 0;
          totalSkips += data.skips || 0;
        } else {
          cargasErro++;
        }
      } catch (e) {
        cargasErro++;
      }
    }

    toast.success(`${cargasFaturar.length} carga(s): ${totalSucessos} pedidos faturados | ${totalErros} erros | ${totalSkips} D1${cargasErro ? ` | ${cargasErro} cargas falharam` : ''}`);
    queryClient.invalidateQueries({ queryKey: ['cargas'] });
    setSelecionadas([]);
    setFaturandoLote(false);
  };

  const toggleSelecionada = (id) => {
    setSelecionadas(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleTodas = () => {
    const faturaveis = cargas.filter(c => FATURAVEL.includes(c.status_carga)).map(c => c.id);
    setSelecionadas(prev => prev.length === faturaveis.length ? [] : faturaveis);
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

  const faturaveisIds = cargas.filter(c => FATURAVEL.includes(c.status_carga)).map(c => c.id);
  const todasSelecionadas = faturaveisIds.length > 0 && selecionadas.length === faturaveisIds.length;

  const columns = [
    {
      key: 'select',
      label: (
        <Checkbox
          checked={todasSelecionadas}
          onCheckedChange={toggleTodas}
          aria-label="Selecionar todas"
        />
      ),
      width: '40px',
      render: (_, row) => FATURAVEL.includes(row.status_carga) ? (
        <Checkbox
          checked={selecionadas.includes(row.id)}
          onCheckedChange={() => toggleSelecionada(row.id)}
          aria-label="Selecionar"
        />
      ) : null
    },
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
          {['montagem', 'montando', 'fechada', 'conferindo', 'pronta'].includes(row.status_carga) && (
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
        <div className="flex gap-2">
          {selecionadas.length > 0 && (
            <Button
              onClick={faturarLote}
              disabled={faturandoLote}
              className="bg-green-600 hover:bg-green-700"
            >
              {faturandoLote ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Faturar {selecionadas.length} selecionada(s)
            </Button>
          )}
          <Button onClick={() => navigate('/MontagemCarga')}>
            <Plus className="w-4 h-4 mr-2" />
            Nova carga
          </Button>
        </div>
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