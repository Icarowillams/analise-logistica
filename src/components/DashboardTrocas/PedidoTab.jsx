import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, Download, Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

export default function PedidoTab({ vendas, clientes, produtos }) {
  const [numPedido, setNumPedido] = useState('');
  const [resultado, setResultado] = useState(null);

  const buscarPedido = () => {
    if (!numPedido.trim()) return;

    // Filtrar vendas do pedido que tenham troca > 0
    const vendasPedido = vendas.filter(v => 
      v.numero_pedido === numPedido && (v.troca || 0) > 0
    );

    if (vendasPedido.length === 0) {
      setResultado({ erro: 'Nenhuma troca encontrada para este pedido' });
      return;
    }

    const cliente = clientes.find(c => c.id === vendasPedido[0].cliente_id);
    const codCliente = cliente?.codigo || 'N/A';
    const nomeFantasia = vendasPedido[0].cliente_nome || 'N/A';

    const itens = vendasPedido.map(v => {
      const produto = produtos.find(p => p.id === v.produto_id);
      return {
        codProduto: produto?.codigo || 'N/A',
        nomeProduto: v.produto_nome,
        quantidade: v.troca || 0,
        valorUnitario: v.valor_unitario || 0,
        valorTotal: (v.troca || 0) * (v.valor_unitario || 0)
      };
    });

    const totalGeral = itens.reduce((acc, item) => acc + item.valorTotal, 0);

    setResultado({
      codCliente,
      nomeFantasia,
      numPedido,
      itens,
      totalGeral
    });
  };

  const exportarPDF = async () => {
    if (!resultado || resultado.erro) return;

    const element = document.getElementById('pedido-resultado');
    const canvas = await html2canvas(element, { scale: 2 });
    const imgData = canvas.toDataURL('image/png');
    
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgWidth = 210;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    
    pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
    pdf.save(`Pedido_${resultado.numPedido}_Trocas.pdf`);
  };

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            Buscar Pedido
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              type="text"
              placeholder="Digite o número do pedido"
              value={numPedido}
              onChange={(e) => setNumPedido(e.target.value.replace(/\D/g, ''))}
              onKeyPress={(e) => e.key === 'Enter' && buscarPedido()}
              className="flex-1"
            />
            <Button onClick={buscarPedido} className="bg-gradient-to-r from-amber-500 to-orange-600">
              <Search className="w-4 h-4 mr-2" />
              Buscar
            </Button>
          </div>
        </CardContent>
      </Card>

      {resultado && (
        <Card className="border-0 shadow-lg" id="pedido-resultado">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>
                {resultado.erro ? 'Resultado' : `Pedido ${resultado.numPedido}`}
              </CardTitle>
              {!resultado.erro && (
                <div className="mt-2 space-y-1 text-sm text-slate-600">
                  <p><strong>Cód. Cliente:</strong> {resultado.codCliente}</p>
                  <p><strong>Nome Fantasia:</strong> {resultado.nomeFantasia}</p>
                </div>
              )}
            </div>
            {!resultado.erro && (
              <Button variant="outline" onClick={exportarPDF} className="gap-2">
                <Download className="w-4 h-4" />
                Exportar PDF
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {resultado.erro ? (
              <div className="text-center py-8 text-slate-500">
                {resultado.erro}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead>Cód. Produto</TableHead>
                        <TableHead>Nome Produto</TableHead>
                        <TableHead className="text-right">Quantidade</TableHead>
                        <TableHead className="text-right">Valor Unitário</TableHead>
                        <TableHead className="text-right">Valor Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resultado.itens.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-xs">{item.codProduto}</TableCell>
                          <TableCell>{item.nomeProduto}</TableCell>
                          <TableCell className="text-right">{item.quantidade}</TableCell>
                          <TableCell className="text-right">
                            {item.valorUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {item.valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-slate-50 font-bold">
                        <TableCell colSpan={4} className="text-right">Total Geral:</TableCell>
                        <TableCell className="text-right text-red-600">
                          {resultado.totalGeral.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}