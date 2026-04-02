import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Truck, Package, MapPin, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const STATUS_CARGA = {
  montando: 'bg-yellow-100 text-yellow-800',
  aguardando_saida: 'bg-blue-100 text-blue-800',
  em_rota: 'bg-orange-100 text-orange-800',
  finalizada: 'bg-green-100 text-green-800',
  cancelada: 'bg-red-100 text-red-800',
};
const STATUS_ENTREGA = {
  pendente: { label: 'Pendente', color: 'bg-slate-100 text-slate-700', icon: Clock },
  entregue: { label: 'Entregue', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  parcial: { label: 'Parcial', color: 'bg-yellow-100 text-yellow-800', icon: AlertCircle },
  nao_entregue: { label: 'Não Entregue', color: 'bg-red-100 text-red-800', icon: AlertCircle },
  devolvido: { label: 'Devolvido', color: 'bg-purple-100 text-purple-800', icon: AlertCircle },
};

export default function DetalheCarga() {
  const params = new URLSearchParams(window.location.search);
  const cargaId = params.get('id');
  const qc = useQueryClient();

  const { data: carga } = useQuery({
    queryKey: ['carga', cargaId],
    queryFn: () => base44.entities.Carga.filter({ id: cargaId }).then(r => r[0]),
    enabled: !!cargaId
  });

  const { data: itens = [] } = useQuery({
    queryKey: ['itensCarga', cargaId],
    queryFn: () => base44.entities.ItemCarga.filter({ carga_id: cargaId }),
    enabled: !!cargaId
  });

  const atualizarStatusItem = useMutation({
    mutationFn: ({ id, status_entrega }) => base44.entities.ItemCarga.update(id, { status_entrega }),
    onSuccess: () => { qc.invalidateQueries(['itensCarga', cargaId]); toast.success('Status atualizado!'); }
  });

  const atualizarStatusCarga = useMutation({
    mutationFn: (status) => base44.entities.Carga.update(cargaId, { status }),
    onSuccess: () => { qc.invalidateQueries(['carga', cargaId]); toast.success('Status da carga atualizado!'); }
  });

  if (!carga) return <div className="p-8 text-center text-slate-500">Carregando carga...</div>;

  const entregues = itens.filter(i => i.status_entrega === 'entregue').length;
  const total = itens.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/MontagemCargas">
          <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" />Voltar</Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Carga {carga.numero_carga}</h1>
          <p className="text-sm text-slate-500">{carga.data_montagem && new Date(carga.data_montagem + 'T12:00:00').toLocaleDateString('pt-BR')} · {carga.rota_nome}</p>
        </div>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-amber-600">{total}</div>
            <div className="text-xs text-slate-500 mt-1">Total de Pedidos</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{entregues}</div>
            <div className="text-xs text-slate-500 mt-1">Entregues</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <div className="text-2xl font-bold text-slate-600">{total - entregues}</div>
            <div className="text-xs text-slate-500 mt-1">Pendentes</div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 text-center">
            <Badge className={`text-xs ${STATUS_CARGA[carga.status] || 'bg-slate-100 text-slate-700'}`}>{carga.status?.replace('_', ' ')}</Badge>
            <div className="text-xs text-slate-500 mt-1">Status</div>
          </CardContent>
        </Card>
      </div>

      {/* Info da Carga */}
      <Card className="border-0 shadow-md">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Truck className="w-4 h-4 text-amber-600" />Informações da Carga</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div><span className="text-slate-500">Motorista:</span> <span className="font-medium">{carga.motorista_nome || '-'}</span></div>
            <div><span className="text-slate-500">Veículo:</span> <span className="font-medium">{carga.veiculo || '-'}</span></div>
            <div><span className="text-slate-500">Ajudante:</span> <span className="font-medium">{carga.ajudante_nome || '-'}</span></div>
            <div><span className="text-slate-500">KM Saída:</span> <span className="font-medium">{carga.km_saida || '-'}</span></div>
            <div><span className="text-slate-500">KM Retorno:</span> <span className="font-medium">{carga.km_retorno || '-'}</span></div>
            <div><span className="text-slate-500">Valor Total:</span> <span className="font-medium">R$ {(carga.valor_total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span></div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-slate-500">Alterar Status:</span>
            <Select value={carga.status} onValueChange={v => atualizarStatusCarga.mutate(v)}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="montando">Montando</SelectItem>
                <SelectItem value="aguardando_saida">Aguardando Saída</SelectItem>
                <SelectItem value="em_rota">Em Rota</SelectItem>
                <SelectItem value="finalizada">Finalizada</SelectItem>
                <SelectItem value="cancelada">Cancelada</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Itens da Carga */}
      <Card className="border-0 shadow-md">
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Package className="w-4 h-4 text-amber-600" />Pedidos na Carga ({itens.length})</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {itens.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">Nenhum pedido na carga ainda.</p>
          ) : (
            <div className="space-y-2">
              {itens.sort((a, b) => (a.ordem_entrega || 0) - (b.ordem_entrega || 0)).map(item => {
                const st = STATUS_ENTREGA[item.status_entrega] || STATUS_ENTREGA.pendente;
                const Icon = st.icon;
                return (
                  <div key={item.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      {item.ordem_entrega && <span className="w-6 h-6 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center text-xs font-bold">{item.ordem_entrega}</span>}
                      <div>
                        <div className="font-medium text-sm text-slate-800">{item.cliente_nome}</div>
                        <div className="text-xs text-slate-500">{item.cliente_cidade} {item.pedido_venda_numero && `· Pedido: ${item.pedido_venda_numero}`}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.valor > 0 && <span className="text-xs text-slate-600">R$ {item.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                      <Select value={item.status_entrega || 'pendente'} onValueChange={v => atualizarStatusItem.mutate({ id: item.id, status_entrega: v })}>
                        <SelectTrigger className={`h-7 w-36 text-xs ${st.color}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(STATUS_ENTREGA).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}