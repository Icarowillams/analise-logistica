import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Eye, Loader2, FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import DataTable from '@/components/ui/DataTable';
import NotaD1Pdf from '@/components/cargas/documentos/NotaD1Pdf';

/**
 * Aba de listagem das Notas D1 — vendas internas (sem NF-e Omie).
 * Lê pedidos_internos D1 de todas as Cargas e exibe em tabela com filtros.
 */
export default function NotasD1Tab({ cargaFiltroId, ativa = true }) {
  const [filtros, setFiltros] = useState({
    data_inicial: '',
    data_final: '',
    nome_cliente: '',
    cnpj_cliente: ''
  });
  const [notaSelecionada, setNotaSelecionada] = useState(null);

  // Só busca quando a aba estiver ativa — evita competir por rate-limit com NF-55
  const { data: cargas = [], isLoading } = useQuery({
    queryKey: ['cargas-notasd1'],
    queryFn: () => base44.entities.Carga.list('-data_carga', 2000),
    enabled: ativa,
    staleTime: 60000
  });

  const linhas = useMemo(() => {
    const out = [];
    const cargasFiltradas = cargaFiltroId
      ? cargas.filter(c => c.id === cargaFiltroId)
      : cargas;
    cargasFiltradas.forEach(carga => {
      (carga.pedidos_internos || []).forEach(p => {
        const modelo = (p.modelo_nota || '').toString().toLowerCase();
        if (modelo !== 'd1' && modelo !== '') return;
        out.push({
          carga_id: carga.id,
          numero_carga: carga.numero_carga,
          data_carga: carga.data_carga,
          motorista_nome: carga.motorista_nome,
          rota_nome: carga.rota_nome,
          veiculo_placa: carga.veiculo_placa,
          numero_pedido: p.numero_pedido,
          pedido_id: p.pedido_id,
          cliente_id: p.cliente_id,
          nome_cliente: p.nome_cliente,
          nome_fantasia: p.nome_fantasia,
          cidade: p.cidade,
          rota_cliente: p.rota_cliente,
          vendedor_nome: p.vendedor_nome,
          valor_total_pedido: p.valor_total_pedido || 0,
          quantidade_itens: p.quantidade_itens || (p.produtos || []).length,
          produtos: p.produtos || [],
          modelo_nota: 'd1',
          cenario_local_nome: p.cenario_local_nome || p.cenario_fiscal_nome,
          _carga: carga,
          _pedido: p
        });
      });
    });
    return out;
  }, [cargas, cargaFiltroId]);

  const filtradas = useMemo(() => {
    return linhas.filter(l => {
      if (filtros.data_inicial && l.data_carga && l.data_carga < filtros.data_inicial) return false;
      if (filtros.data_final && l.data_carga && l.data_carga > filtros.data_final) return false;
      if (filtros.nome_cliente) {
        const t = filtros.nome_cliente.toLowerCase();
        if (!`${l.nome_cliente || ''} ${l.nome_fantasia || ''}`.toLowerCase().includes(t)) return false;
      }
      return true;
    });
  }, [linhas, filtros]);

  const totalValor = filtradas.reduce((s, l) => s + Number(l.valor_total_pedido || 0), 0);

  const columns = [
    { key: 'numero_pedido', label: 'Nº Pedido', width: '110px', sortable: true },
    { key: 'numero_carga', label: 'Carga', width: '90px', sortable: true },
    {
      key: 'data_carga',
      label: 'Data',
      width: '110px',
      sortable: true,
      render: (v) => v ? new Date(v + 'T12:00:00').toLocaleDateString('pt-BR') : '-'
    },
    {
      key: 'nome_cliente',
      label: 'Cliente',
      render: (_, row) => (
        <div>
          <div className="font-medium">{row.nome_cliente || '-'}</div>
          {row.nome_fantasia && <div className="text-xs text-slate-500">{row.nome_fantasia}</div>}
        </div>
      )
    },
    { key: 'cidade', label: 'Cidade', width: '140px' },
    { key: 'vendedor_nome', label: 'Vendedor', width: '160px' },
    {
      key: 'quantidade_itens',
      label: 'Itens',
      width: '70px',
      render: (v) => <Badge variant="outline">{v || 0}</Badge>
    },
    {
      key: 'valor_total_pedido',
      label: 'Valor',
      width: '120px',
      sortable: true,
      render: (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    },
    {
      key: 'modelo_nota',
      label: 'Modelo',
      width: '90px',
      render: () => <Badge className="bg-amber-100 text-amber-800 border-amber-300">D1</Badge>
    },
    {
      key: 'acoes',
      label: 'Ver',
      width: '90px',
      render: (_, row) => (
        <Button size="sm" variant="outline" onClick={() => setNotaSelecionada(row)}>
          <Eye className="w-4 h-4 mr-1" /> Ver
        </Button>
      )
    }
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros — Notas D1</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <Label>Data inicial</Label>
              <Input type="date" value={filtros.data_inicial} onChange={(e) => setFiltros({ ...filtros, data_inicial: e.target.value })} />
            </div>
            <div>
              <Label>Data final</Label>
              <Input type="date" value={filtros.data_final} onChange={(e) => setFiltros({ ...filtros, data_final: e.target.value })} />
            </div>
            <div>
              <Label>Cliente (nome/fantasia)</Label>
              <Input value={filtros.nome_cliente} onChange={(e) => setFiltros({ ...filtros, nome_cliente: e.target.value })} />
            </div>
            <div className="flex items-end">
              <Button variant="outline" className="w-full" onClick={() => setFiltros({ data_inicial: '', data_final: '', nome_cliente: '', cnpj_cliente: '' })}>
                Limpar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-600" />
              {filtradas.length} Nota(s) D1
            </span>
            <span className="text-sm font-normal text-slate-600">
              Total: <b className="text-amber-700">R$ {totalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</b>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-12 text-center text-slate-500">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              Carregando notas D1…
            </div>
          ) : (
            <DataTable
              data={filtradas}
              columns={columns}
              searchable
              searchFields={['numero_pedido', 'numero_carga', 'nome_cliente', 'nome_fantasia', 'vendedor_nome', 'cidade']}
              pageSize={50}
              emptyMessage="Nenhuma nota D1 encontrada"
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={!!notaSelecionada} onOpenChange={(open) => !open && setNotaSelecionada(null)}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Nota D1 — Pedido {notaSelecionada?.numero_pedido} (Carga {notaSelecionada?.numero_carga})
            </DialogTitle>
          </DialogHeader>
          {notaSelecionada && (
            <NotaD1Pdf
              carga={notaSelecionada._carga}
              pedidos={[notaSelecionada._pedido]}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}