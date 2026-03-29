import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

export default function ClienteVendaAccordion({ cliente }) {
  const [openCliente, setOpenCliente] = useState(false);
  const [openPedidos, setOpenPedidos] = useState({});

  const togglePedido = (numPedido) => {
    setOpenPedidos(prev => ({ ...prev, [numPedido]: !prev[numPedido] }));
  };

  return (
    <Collapsible open={openCliente} onOpenChange={setOpenCliente}>
      <div className="border border-slate-200 rounded-lg bg-white hover:shadow-md transition-shadow">
        <CollapsibleTrigger className="w-full p-4 flex items-center justify-between hover:bg-slate-50">
          <div className="flex items-center gap-3 flex-1">
            {openCliente ? <ChevronDown className="w-4 h-4 text-slate-600" /> : <ChevronRight className="w-4 h-4 text-slate-600" />}
            <div className="text-left flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-500">{cliente.codigo}</span>
                <span className="text-sm font-semibold text-slate-800">{cliente.nome}</span>
              </div>
              <div className="flex gap-4 mt-1 text-xs text-slate-600">
                <span>Qtd: <strong className="text-blue-700">{cliente.qtdTotal}</strong></span>
                <span>Valor: <strong className="text-blue-700">{cliente.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></span>
                <span>Pedidos: <strong className="text-blue-700">{cliente.pedidos.length}</strong></span>
              </div>
            </div>
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-2 bg-slate-50">
            {cliente.pedidos.map((pedido, pIdx) => (
              <div key={pIdx} className="border border-slate-300 rounded-md bg-white">
                <button onClick={() => togglePedido(pedido.numero)} className="w-full p-3 flex items-center justify-between hover:bg-slate-50">
                  <div className="flex items-center gap-2 flex-1">
                    {openPedidos[pedido.numero] ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                    <div className="text-left flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-700">Pedido: {pedido.numero}</span>
                        {pedido.data && <span className="text-xs text-slate-500">• {new Date(pedido.data + 'T00:00:00').toLocaleDateString('pt-BR')}</span>}
                        <Badge className="bg-green-100 text-green-700 text-[10px]">{pedido.status}</Badge>
                      </div>
                      <div className="flex gap-3 mt-0.5 text-xs text-slate-600">
                        <span>Qtd: {pedido.qtdTotal}</span>
                        <span>Valor: {pedido.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                        <span>Médio: {pedido.precoMedio.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                      </div>
                    </div>
                  </div>
                </button>
                
                {openPedidos[pedido.numero] && (
                  <div className="px-3 pb-3 space-y-1.5 bg-slate-50">
                    {pedido.itens.map((item, iIdx) => (
                      <div key={iIdx} className="p-2 bg-white rounded border border-slate-200 text-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-slate-500">{item.codProduto}</span>
                            <span className="font-medium text-slate-700">{item.nomeProduto}</span>
                          </div>
                        </div>
                        <div className="flex gap-3 mt-1 text-slate-600">
                          <span>Qtd: <strong>{item.qtd}</strong></span>
                          <span>Unit: {item.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                          <span>Total: <strong className="text-blue-600">{item.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}