import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import { Building2, Users, TrendingUp, UserX, Network, Tag } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import StatsCard from '@/components/ui/StatsCard';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const COLORS = ['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#f97316', '#eab308'];

export default function DashboardClientes() {
  const [searchCliente, setSearchCliente] = useState('');

  const { data: clientes = [], isLoading: lC } = useQuery({ queryKey: ['clientes'], queryFn: () => base44.entities.Cliente.list() });
  const { data: segmentos = [] } = useQuery({ queryKey: ['segmentos'], queryFn: () => base44.entities.Segmento.list() });
  const { data: redes = [] } = useQuery({ queryKey: ['redes'], queryFn: () => base44.entities.Rede.list() });
  const { data: vendas = [] } = useQuery({ queryKey: ['vendas'], queryFn: () => base44.entities.Venda.list('-data', 5000) });

  const isLoading = lC;

  // Métricas
  const totalClientes = clientes.length;
  const clientesAtivos = clientes.filter(c => c.status === 'ativo').length;
  const clientesInativos = clientes.filter(c => c.status === 'inativo').length;
  const prospectos = clientes.filter(c => c.status === 'prospecto').length;

  // Clientes por segmento
  const clientesPorSegmento = React.useMemo(() => {
    const grouped = {};
    clientes.forEach(c => {
      const seg = segmentos.find(s => s.id === c.segmento_id);
      const nome = seg?.nome || 'Sem segmento';
      if (!grouped[nome]) grouped[nome] = 0;
      grouped[nome] += 1;
    });
    return Object.entries(grouped).map(([name, value]) => ({ name, value }));
  }, [clientes, segmentos]);

  // Clientes por rede
  const clientesPorRede = React.useMemo(() => {
    const grouped = {};
    clientes.forEach(c => {
      const rede = redes.find(r => r.id === c.rede_id);
      const nome = rede?.nome || 'Independente';
      if (!grouped[nome]) grouped[nome] = 0;
      grouped[nome] += 1;
    });
    return Object.entries(grouped)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6)
      .map(([name, value]) => ({ name, value }));
  }, [clientes, redes]);

  // Clientes inativos (sem compras nos últimos 3 meses)
  const tresMesesAtras = new Date();
  tresMesesAtras.setMonth(tresMesesAtras.getMonth() - 3);
  const tresMesesStr = tresMesesAtras.toISOString().slice(0, 10);

  const clientesComComprasRecentes = new Set(
    vendas.filter(v => v.data >= tresMesesStr).map(v => v.cliente_id)
  );

  const clientesSemComprasRecentes = clientes
    .filter(c => c.status === 'ativo' && !clientesComComprasRecentes.has(c.id))
    .slice(0, 10);

  // Histórico de compras por cliente
  const historicoCliente = (clienteId) => {
    const vendasCliente = vendas.filter(v => v.cliente_id === clienteId);
    const total = vendasCliente.reduce((sum, v) => sum + (v.valor_total || 0), 0);
    const ultimaCompra = vendasCliente[0]?.data;
    return { total, qtd: vendasCliente.length, ultimaCompra };
  };

  // Busca clientes
  const clientesFiltrados = clientes
    .filter(c => 
      c.razao_social?.toLowerCase().includes(searchCliente.toLowerCase()) ||
      c.nome_fantasia?.toLowerCase().includes(searchCliente.toLowerCase())
    )
    .slice(0, 20);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center shadow-lg">
          <Building2 className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard de Clientes</h1>
          <p className="text-slate-500">Análise da base de clientes</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatsCard
          title="Total de Clientes"
          value={totalClientes}
          icon={Users}
          gradient="from-blue-500 to-cyan-600"
        />
        <StatsCard
          title="Clientes Ativos"
          value={clientesAtivos}
          icon={TrendingUp}
          gradient="from-emerald-500 to-teal-600"
        />
        <StatsCard
          title="Inativos"
          value={clientesInativos}
          icon={UserX}
          gradient="from-red-500 to-rose-600"
        />
        <StatsCard
          title="Prospectos"
          value={prospectos}
          icon={Building2}
          gradient="from-amber-500 to-orange-500"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5" />
              Clientes por Segmento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={clientesPorSegmento}
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {clientesPorSegmento.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Network className="w-5 h-5" />
              Clientes por Rede
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={clientesPorRede} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 12 }} />
                <YAxis dataKey="name" type="category" tick={{ fill: '#64748b', fontSize: 11 }} width={100} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 40px rgba(0,0,0,0.1)' }} />
                <Bar dataKey="value" fill="#6366f1" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Clientes Inativos */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600">
            <UserX className="w-5 h-5" />
            Clientes sem Compras nos Últimos 3 Meses
          </CardTitle>
        </CardHeader>
        <CardContent>
          {clientesSemComprasRecentes.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Razão Social</TableHead>
                    <TableHead>Cidade</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Última Compra</TableHead>
                    <TableHead>Total Histórico</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientesSemComprasRecentes.map(c => {
                    const hist = historicoCliente(c.id);
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.razao_social}</TableCell>
                        <TableCell>{c.cidade || '-'}</TableCell>
                        <TableCell>{c.telefone || '-'}</TableCell>
                        <TableCell>{hist.ultimaCompra || 'Nunca comprou'}</TableCell>
                        <TableCell>R$ {hist.total.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-center text-slate-500 py-8">Todos os clientes ativos têm compras recentes!</p>
          )}
        </CardContent>
      </Card>

      {/* Busca de Clientes */}
      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle>Histórico por Cliente</CardTitle>
          <Input
            placeholder="Buscar cliente..."
            value={searchCliente}
            onChange={(e) => setSearchCliente(e.target.value)}
            className="max-w-sm mt-2"
          />
        </CardHeader>
        <CardContent>
          {searchCliente && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Segmento</TableHead>
                    <TableHead>Qtd Compras</TableHead>
                    <TableHead>Total Comprado</TableHead>
                    <TableHead>Última Compra</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clientesFiltrados.map(c => {
                    const hist = historicoCliente(c.id);
                    const seg = segmentos.find(s => s.id === c.segmento_id);
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{c.razao_social}</p>
                            {c.nome_fantasia && <p className="text-sm text-slate-500">{c.nome_fantasia}</p>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={
                            c.status === 'ativo' ? 'bg-emerald-100 text-emerald-700' :
                            c.status === 'inativo' ? 'bg-red-100 text-red-700' :
                            'bg-amber-100 text-amber-700'
                          }>
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{seg?.nome || '-'}</TableCell>
                        <TableCell>{hist.qtd}</TableCell>
                        <TableCell>R$ {hist.total.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}</TableCell>
                        <TableCell>{hist.ultimaCompra || '-'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {!searchCliente && (
            <p className="text-center text-slate-500 py-8">Digite para buscar clientes...</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}