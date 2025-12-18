import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { AlertCircle, Loader2, Filter } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';

export default function TrocasNaoCadastradasTab() {
  const [dates, setDates] = useState({
    start: '',
    end: ''
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list()
  });

  const { data: trocas = [], isLoading } = useQuery({
    queryKey: ['trocas_nao_cadastradas', dates.start, dates.end],
    queryFn: async () => {
      const allTrocas = await base44.entities.Troca.list('-data', 5000);
      
      // Filtrar apenas trocas sem cliente cadastrado ou sem vendedor
      let filtradas = allTrocas.filter(t => 
        !t.cliente_id || 
        !t.vendedor_id || 
        t.cliente_nome?.includes('Cliente Não Cadastrado') ||
        t.vendedor_nome === 'N/A'
      );
      
      // Aplicar filtro de data se necessário
      if (dates.start || dates.end) {
        filtradas = filtradas.filter(t => {
          if (dates.start && t.data < dates.start) return false;
          if (dates.end && t.data > dates.end) return false;
          return true;
        });
      }
      
      return filtradas;
    }
  });

  const relatorio = useMemo(() => {
    const agrupado = {};
    
    trocas.forEach(troca => {
      let codigoCliente = 'N/A';
      
      // Se tiver cliente_id, buscar o código do cliente
      if (troca.cliente_id) {
        const cliente = clientes.find(c => c.id === troca.cliente_id);
        codigoCliente = cliente?.codigo || 'N/A';
      } else {
        // Extrair código do cliente do nome se não cadastrado
        const match = troca.cliente_nome?.match(/Cliente Não Cadastrado: (.+)/);
        codigoCliente = match ? match[1] : 'N/A';
      }
      
      if (!agrupado[codigoCliente]) {
        agrupado[codigoCliente] = {
          codigo: codigoCliente,
          itens: [],
          total_qtd: 0
        };
      }
      
      agrupado[codigoCliente].itens.push(troca);
      agrupado[codigoCliente].total_qtd += (troca.quantidade || 0);
    });

    return Object.values(agrupado).sort((a, b) => b.total_qtd - a.total_qtd);
  }, [trocas, clientes]);

  const totalGeral = relatorio.reduce((acc, curr) => acc + curr.total_qtd, 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Filtros do Relatório</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 items-end">
            <div>
              <Label>Data Inicial</Label>
              <Input 
                type="date" 
                value={dates.start} 
                onChange={e => setDates(d => ({ ...d, start: e.target.value }))} 
              />
            </div>
            <div>
              <Label>Data Final</Label>
              <Input 
                type="date" 
                value={dates.end} 
                onChange={e => setDates(d => ({ ...d, end: e.target.value }))} 
              />
            </div>
            <Button variant="outline" className="mb-[2px]">
              <Filter className="w-4 h-4 mr-2" /> Filtrar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              Trocas de Clientes Não Cadastrados
            </CardTitle>
            <CardDescription className="mt-1">
              Listagem de trocas importadas sem cliente vinculado no sistema
            </CardDescription>
          </div>
          <div className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full font-medium">
            Total Qtd: {totalGeral.toLocaleString('pt-BR')}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead>Código Cliente</TableHead>
                    <TableHead className="text-right">Qtd Trocas</TableHead>
                    <TableHead>Produtos Trocados</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {relatorio.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8 text-slate-500">
                        Nenhuma troca sem cliente cadastrado no período
                      </TableCell>
                    </TableRow>
                  ) : (
                    relatorio.map((item, idx) => (
                      <TableRow key={idx} className="hover:bg-slate-50">
                        <TableCell className="font-mono font-medium text-amber-700">
                          {item.codigo}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {item.total_qtd.toLocaleString('pt-BR')}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {item.itens.map((troca, i) => (
                              <div key={i} className="text-sm">
                                <span className="text-slate-600">{troca.produto_original_nome}</span>
                                <span className="text-slate-400 mx-2">×</span>
                                <span className="font-medium">{troca.quantidade}</span>
                                <span className="text-xs text-slate-400 ml-2">
                                  ({format(parseISO(troca.data), 'dd/MM/yyyy')})
                                </span>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}