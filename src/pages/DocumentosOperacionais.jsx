import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { FileText, Printer, Download, Truck, Package, ArrowLeftRight } from 'lucide-react';

export default function DocumentosOperacionais() {
  const [tipoDoc, setTipoDoc] = useState('romaneio');
  const [cargaSelecionada, setCargaSelecionada] = useState('');
  const [pedidoSelecionado, setPedidoSelecionado] = useState('');

  const { data: cargas = [] } = useQuery({
    queryKey: ['cargas'],
    queryFn: () => base44.entities.Carga.list('-data_montagem', 100)
  });

  const { data: itensCarga = [] } = useQuery({
    queryKey: ['itensCarga', cargaSelecionada],
    queryFn: () => base44.entities.ItemCarga.filter({ carga_id: cargaSelecionada }),
    enabled: !!cargaSelecionada
  });

  const { data: pedidosVenda = [] } = useQuery({
    queryKey: ['pedidosVenda'],
    queryFn: () => base44.entities.PedidoVenda.list('-data_pedido', 200)
  });

  const { data: itensPedido = [] } = useQuery({
    queryKey: ['itensPedidoVenda', pedidoSelecionado],
    queryFn: () => base44.entities.ItemPedidoVenda.filter({ pedido_venda_id: pedidoSelecionado }),
    enabled: !!pedidoSelecionado
  });

  const { data: comodatos = [] } = useQuery({
    queryKey: ['comodatos'],
    queryFn: () => base44.entities.Comodato.list('-data_entrega', 200)
  });

  const carga = cargas.find(c => c.id === cargaSelecionada);
  const pedido = pedidosVenda.find(p => p.id === pedidoSelecionado);

  const imprimir = () => window.print();

  const DOCS = [
    { id: 'romaneio', label: 'Romaneio de Carga', icon: Truck, desc: 'Lista completa de pedidos de uma carga para conferência na expedição' },
    { id: 'pedido', label: 'Pedido de Venda', icon: Package, desc: 'Espelho do pedido com itens e valores para entrega ao cliente' },
    { id: 'comodato', label: 'Termo de Comodato', icon: FileText, desc: 'Termo de responsabilidade do equipamento cedido ao cliente' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Documentos Operacionais" icon={FileText} subtitle="Geração de documentos para operação logística" />

      {/* Seleção de tipo de documento */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {DOCS.map(doc => (
          <Card key={doc.id} className={`border-2 cursor-pointer transition-all hover:shadow-md ${tipoDoc === doc.id ? 'border-amber-400 shadow-md bg-amber-50' : 'border-transparent shadow-sm'}`} onClick={() => setTipoDoc(doc.id)}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${tipoDoc === doc.id ? 'bg-amber-200' : 'bg-slate-100'}`}>
                  <doc.icon className={`w-5 h-5 ${tipoDoc === doc.id ? 'text-amber-700' : 'text-slate-500'}`} />
                </div>
                <div>
                  <p className="font-semibold text-sm text-slate-800">{doc.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{doc.desc}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Seletores */}
      <Card className="border-0 shadow-md">
        <CardContent className="p-4">
          {tipoDoc === 'romaneio' && (
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">Selecione a Carga</Label>
                <Select value={cargaSelecionada} onValueChange={setCargaSelecionada}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue placeholder="Selecione uma carga" /></SelectTrigger>
                  <SelectContent>
                    {cargas.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.numero_carga} — {c.data_montagem && new Date(c.data_montagem + 'T12:00:00').toLocaleDateString('pt-BR')} · {c.rota_nome || 'Sem rota'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {cargaSelecionada && carga && (
                <div className="mt-4 p-4 bg-white border rounded-lg print:shadow-none" id="documento-impressao">
                  <div className="text-center mb-4 border-b pb-3">
                    <h2 className="text-lg font-bold">ROMANEIO DE CARGA</h2>
                    <p className="text-sm text-slate-600">Carga Nº {carga.numero_carga}</p>
                    <p className="text-xs text-slate-500">Data: {carga.data_montagem && new Date(carga.data_montagem + 'T12:00:00').toLocaleDateString('pt-BR')} · Rota: {carga.rota_nome}</p>
                    <p className="text-xs text-slate-500">Motorista: {carga.motorista_nome || '-'} · Veículo: {carga.veiculo || '-'}</p>
                  </div>
                  {itensCarga.length === 0 ? (
                    <p className="text-center text-slate-400 py-4 text-sm">Nenhum item na carga.</p>
                  ) : (
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100">
                          <th className="border border-slate-200 p-2 text-left">#</th>
                          <th className="border border-slate-200 p-2 text-left">Cliente</th>
                          <th className="border border-slate-200 p-2 text-left">Cidade</th>
                          <th className="border border-slate-200 p-2 text-center">Pedido</th>
                          <th className="border border-slate-200 p-2 text-right">Valor</th>
                          <th className="border border-slate-200 p-2 text-center">Assinatura</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itensCarga.sort((a, b) => (a.ordem_entrega || 0) - (b.ordem_entrega || 0)).map((item, i) => (
                          <tr key={item.id}>
                            <td className="border border-slate-200 p-2">{item.ordem_entrega || i + 1}</td>
                            <td className="border border-slate-200 p-2 font-medium">{item.cliente_nome}</td>
                            <td className="border border-slate-200 p-2">{item.cliente_cidade}</td>
                            <td className="border border-slate-200 p-2 text-center">{item.pedido_venda_numero || '-'}</td>
                            <td className="border border-slate-200 p-2 text-right">R$ {(item.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                            <td className="border border-slate-200 p-2 text-center w-28"> </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-amber-50 font-semibold">
                          <td colSpan={4} className="border border-slate-200 p-2 text-right">Total:</td>
                          <td className="border border-slate-200 p-2 text-right">R$ {itensCarga.reduce((acc, i) => acc + (i.valor || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="border border-slate-200 p-2"></td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}

          {tipoDoc === 'pedido' && (
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">Selecione o Pedido de Venda</Label>
                <Select value={pedidoSelecionado} onValueChange={setPedidoSelecionado}>
                  <SelectTrigger className="h-9 mt-1"><SelectValue placeholder="Selecione um pedido" /></SelectTrigger>
                  <SelectContent>
                    {pedidosVenda.slice(0, 50).map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.numero_pedido} — {p.cliente_nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {pedidoSelecionado && pedido && (
                <div className="mt-4 p-4 bg-white border rounded-lg" id="documento-impressao">
                  <div className="text-center mb-4 border-b pb-3">
                    <h2 className="text-lg font-bold">PEDIDO DE VENDA</h2>
                    <p className="text-sm text-slate-600">Pedido Nº {pedido.numero_pedido}</p>
                    <p className="text-xs text-slate-500">Data: {pedido.data_pedido && new Date(pedido.data_pedido + 'T12:00:00').toLocaleDateString('pt-BR')}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                    <div>
                      <p className="font-semibold text-slate-600 text-xs uppercase mb-1">Cliente</p>
                      <p className="font-medium">{pedido.cliente_nome}</p>
                      <p className="text-xs text-slate-500">{pedido.cliente_endereco}</p>
                      <p className="text-xs text-slate-500">{pedido.cliente_cidade}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-600 text-xs uppercase mb-1">Dados do Pedido</p>
                      <p className="text-xs">Vendedor: {pedido.vendedor_nome}</p>
                      <p className="text-xs">Pagamento: {pedido.plano_pagamento_nome}</p>
                      {pedido.numero_nota_fiscal && <p className="text-xs">NF: {pedido.numero_nota_fiscal}</p>}
                    </div>
                  </div>
                  {itensPedido.length > 0 ? (
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-100">
                          <th className="border border-slate-200 p-2 text-left">Produto</th>
                          <th className="border border-slate-200 p-2 text-center">Qtd</th>
                          <th className="border border-slate-200 p-2 text-right">Preço Unit.</th>
                          <th className="border border-slate-200 p-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itensPedido.map(item => (
                          <tr key={item.id}>
                            <td className="border border-slate-200 p-2">{item.produto_nome}</td>
                            <td className="border border-slate-200 p-2 text-center">{item.quantidade} {item.unidade_medida}</td>
                            <td className="border border-slate-200 p-2 text-right">R$ {(item.preco_unitario || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                            <td className="border border-slate-200 p-2 text-right">R$ {(item.valor_total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-amber-50 font-semibold">
                          <td colSpan={3} className="border border-slate-200 p-2 text-right">Total do Pedido:</td>
                          <td className="border border-slate-200 p-2 text-right">R$ {(pedido.valor_total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        </tr>
                      </tfoot>
                    </table>
                  ) : <p className="text-center text-slate-400 py-4 text-sm">Nenhum item no pedido.</p>}
                </div>
              )}
            </div>
          )}

          {tipoDoc === 'comodato' && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Comodatos Ativos</Label>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {comodatos.filter(c => c.status === 'ativo').map(c => (
                  <div key={c.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg text-sm">
                    <div>
                      <p className="font-medium">{c.cliente_nome}</p>
                      <p className="text-xs text-slate-500">{c.descricao_equipamento} {c.numero_serie && `· S/N: ${c.numero_serie}`}</p>
                    </div>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPedidoSelecionado(c.id)}>
                      <Printer className="w-3 h-3 mr-1" />Imprimir
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {(cargaSelecionada || pedidoSelecionado) && tipoDoc !== 'comodato' && (
        <div className="flex justify-end">
          <Button className="btn-pao-mel h-9" onClick={imprimir}>
            <Printer className="w-4 h-4 mr-2" />Imprimir Documento
          </Button>
        </div>
      )}
    </div>
  );
}