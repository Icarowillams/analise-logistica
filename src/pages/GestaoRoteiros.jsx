import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Workflow, Download, Plus } from 'lucide-react';
import RoteirosBusca from '@/components/roteiros/gestao/RoteirosBusca';
import RoteirosCriacaoMassa from '@/components/roteiros/gestao/RoteirosCriacaoMassa';
import RoteirosAtualizacaoMassa from '@/components/roteiros/gestao/RoteirosAtualizacaoMassa';
import RoteirosClientesPendentes from '@/components/roteiros/gestao/RoteirosClientesPendentes';
import RoteirosVisualizar from '@/components/roteiros/gestao/RoteirosVisualizar';
import RoteiroFormModal from '@/components/roteiros/gestao/RoteiroFormModal';
import { exportarRoteirosCSV } from '@/components/roteiros/gestao/gestaoUtils';

export default function GestaoRoteiros() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('busca');
  const [novoOpen, setNovoOpen] = useState(false);
  const [editando, setEditando] = useState(null);
  const [roteiroVisualizar, setRoteiroVisualizar] = useState(null);

  const { data: roteiros = [] } = useQuery({ queryKey: ['gestao-roteiros'], queryFn: () => base44.entities.Roteiro.list('-created_date', 1000) });
  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list('-created_date', 500) });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes-todos'], queryFn: () => base44.entities.Cliente.list('-created_date', 5000) });
  const { data: funcoes = [] } = useQuery({ queryKey: ['funcoes'], queryFn: () => base44.entities.Funcao.list() });
  const { data: precadastros = [] } = useQuery({ queryKey: ['precadastros'], queryFn: () => base44.entities.PreCadastro.list('-created_date', 1000) });

  const total = roteiros.length;

  const recarregar = () => {
    qc.invalidateQueries({ queryKey: ['gestao-roteiros'] });
    qc.invalidateQueries({ queryKey: ['precadastros'] });
  };

  const abrirVisualizar = (roteiro) => {
    setRoteiroVisualizar(roteiro);
    setTab('visualizar');
  };

  const abrirEditar = (roteiro) => {
    setEditando(roteiro);
    setNovoOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
          <Workflow className="w-6 h-6 text-neutral-900" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Gestão de Roteiros</h1>
          <p className="text-sm text-neutral-500">Planejamento de visitas e rotas de vendedores</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={() => exportarRoteirosCSV(roteiros, vendedores)} className="border-amber-300 text-amber-800 hover:bg-amber-50">
          <Download className="w-4 h-4 mr-2" />Exportar Roteiros ({total})
        </Button>
        <Button onClick={() => { setEditando(null); setNovoOpen(true); }} className="bg-gradient-to-r from-yellow-400 to-amber-500 hover:from-yellow-500 hover:to-amber-600 text-neutral-900 font-semibold shadow-lg shadow-amber-500/30">
          <Plus className="w-4 h-4 mr-2" />Novo Roteiro
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-white border h-auto flex-wrap">
          <TabsTrigger value="busca">Busca de Roteiros</TabsTrigger>
          <TabsTrigger value="criacao">Criação em Massa</TabsTrigger>
          <TabsTrigger value="atualizacao">Atualização em Massa</TabsTrigger>
          <TabsTrigger value="pendentes">Clientes Pendentes</TabsTrigger>
          <TabsTrigger value="visualizar">Visualizar Roteiro</TabsTrigger>
        </TabsList>

        <TabsContent value="busca">
          <RoteirosBusca
            roteiros={roteiros}
            vendedores={vendedores}
            funcoes={funcoes}
            onRecarregar={recarregar}
            onVisualizar={abrirVisualizar}
            onEditar={abrirEditar}
          />
        </TabsContent>

        <TabsContent value="criacao">
          <RoteirosCriacaoMassa vendedores={vendedores} clientes={clientes} onRecarregar={recarregar} />
        </TabsContent>

        <TabsContent value="atualizacao">
          <RoteirosAtualizacaoMassa roteiros={roteiros} vendedores={vendedores} funcoes={funcoes} clientes={clientes} onRecarregar={recarregar} />
        </TabsContent>

        <TabsContent value="pendentes">
          <RoteirosClientesPendentes precadastros={precadastros} onRecarregar={recarregar} />
        </TabsContent>

        <TabsContent value="visualizar">
          <RoteirosVisualizar roteiro={roteiroVisualizar} clientes={clientes} />
        </TabsContent>
      </Tabs>

      <RoteiroFormModal
        open={novoOpen}
        onOpenChange={setNovoOpen}
        roteiro={editando}
        vendedores={vendedores}
        clientes={clientes}
        roteiros={roteiros}
        onSaved={() => { recarregar(); setNovoOpen(false); setEditando(null); }}
      />
    </div>
  );
}