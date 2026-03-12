import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Play, Square, Clock, MapPin, Plus, History, Route, UserPlus, Search as SearchIcon } from 'lucide-react';
import { toast } from 'sonner';
import BuscaClienteSupervisor from '@/components/RotaSupervisor/BuscaClienteSupervisor';
import FormVisitaSupervisor from '@/components/RotaSupervisor/FormVisitaSupervisor';
import VisitaCardResumida from '@/components/RotaSupervisor/VisitaCardResumida';
import HistoricoRotasSupervisor from '@/components/RotaSupervisor/HistoricoRotasSupervisor';

function getLocalDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getLocalISOString(date = new Date()) {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
  const mm = String(Math.abs(offset) % 60).padStart(2, '0');
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${hh}:${mm}`;
}

export default function RotaSupervisores() {
  const [currentUser, setCurrentUser] = useState(null);
  const [supervisor, setSupervisor] = useState(null);
  const [tab, setTab] = useState('hoje');
  const [showBusca, setShowBusca] = useState(false);
  const [showTipoEscolha, setShowTipoEscolha] = useState(false);
  const [isProspeccao, setIsProspeccao] = useState(false);
  const [visitaEmAndamento, setVisitaEmAndamento] = useState(null); // cliente selecionado para visita
  const [resumoGeral, setResumoGeral] = useState('');
  const [loadingAction, setLoadingAction] = useState(false);
  const queryClient = useQueryClient();

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  useEffect(() => {
    base44.auth.me().then(user => {
      setCurrentUser(user);
      const v = vendedores.find(ve => ve.email?.toLowerCase() === user.email?.toLowerCase());
      setSupervisor(v);
    }).catch(() => {});
  }, [vendedores]);

  const hoje = getLocalDateStr();

  // Buscar roteiro do dia atual
  const { data: rotaHoje, isLoading: loadingRota } = useQuery({
    queryKey: ['rotaSupervisorHoje', supervisor?.id, hoje],
    queryFn: async () => {
      const rotas = await base44.entities.RotaSupervisor.filter({
        supervisor_id: supervisor.id,
        data: hoje
      });
      return rotas[0] || null;
    },
    enabled: !!supervisor
  });

  // Visitas do roteiro do dia
  const { data: visitasHoje = [] } = useQuery({
    queryKey: ['visitasSupervisor', rotaHoje?.id],
    queryFn: () => base44.entities.VisitaSupervisor.filter({ rota_supervisor_id: rotaHoje.id }),
    enabled: !!rotaHoje
  });

  const clientesJaVisitados = visitasHoje.map(v => v.cliente_id);

  const handleIniciarRoteiro = () => {
    setLoadingAction(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const agora = new Date();
        await base44.entities.RotaSupervisor.create({
          supervisor_id: supervisor.id,
          supervisor_nome: supervisor.nome,
          data: hoje,
          hora_inicio: getLocalISOString(agora),
          latitude_inicio: pos.coords.latitude,
          longitude_inicio: pos.coords.longitude,
          status: 'em_andamento'
        });
        await queryClient.invalidateQueries({ queryKey: ['rotaSupervisorHoje'] });
        toast.success('Roteiro iniciado!');
        setLoadingAction(false);
      },
      () => {
        toast.error('Erro ao obter localização.');
        setLoadingAction(false);
      }
    );
  };

  const handleFinalizarRoteiro = () => {
    setLoadingAction(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const agora = new Date();
        const inicio = new Date(rotaHoje.hora_inicio);
        const diffMs = agora - inicio;
        const tempoMinutos = Math.round(diffMs / 60000);

        await base44.entities.RotaSupervisor.update(rotaHoje.id, {
          hora_fim: getLocalISOString(agora),
          latitude_fim: pos.coords.latitude,
          longitude_fim: pos.coords.longitude,
          tempo_total_minutos: tempoMinutos,
          resumo_geral: resumoGeral,
          status: 'finalizado'
        });
        await queryClient.invalidateQueries({ queryKey: ['rotaSupervisorHoje'] });
        toast.success('Roteiro finalizado!');
        setLoadingAction(false);
      },
      () => {
        toast.error('Erro ao obter localização.');
        setLoadingAction(false);
      }
    );
  };

  const handleSelectCliente = (cliente) => {
    setVisitaEmAndamento(cliente);
    setShowBusca(false);
  };

  const tempoDecorrido = () => {
    if (!rotaHoje?.hora_inicio) return '';
    const inicio = new Date(rotaHoje.hora_inicio);
    const agora = rotaHoje.hora_fim ? new Date(rotaHoje.hora_fim) : new Date();
    const diffMs = agora - inicio;
    const mins = Math.round(diffMs / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  };

  if (!supervisor) {
    return (
      <div>
        <PageHeader title="Rota Supervisores" icon={Route} />
        <Alert>
          <AlertDescription>
            Você não está cadastrado como funcionário no sistema. Entre em contato com o administrador.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Rota Supervisores" subtitle={`Olá, ${supervisor.nome}`} icon={Route} />

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="hoje">
            <MapPin className="w-4 h-4 mr-2" /> Hoje
          </TabsTrigger>
          <TabsTrigger value="historico">
            <History className="w-4 h-4 mr-2" /> Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="hoje">
          {loadingRota ? (
            <p className="text-sm text-center py-8 text-slate-500">Carregando...</p>
          ) : !rotaHoje ? (
            /* SEM ROTEIRO - BOTÃO INICIAR */
            <Card>
              <CardContent className="pt-6 text-center space-y-4">
                <p className="text-slate-600">Nenhum roteiro iniciado para hoje.</p>
                <Button
                  onClick={handleIniciarRoteiro}
                  disabled={loadingAction}
                  className="bg-gradient-to-r from-amber-500 to-amber-600 text-black text-lg px-8 py-6"
                >
                  <Play className="w-5 h-5 mr-2" />
                  {loadingAction ? 'Localizando...' : 'Iniciar Roteiro'}
                </Button>
              </CardContent>
            </Card>
          ) : (
            /* ROTEIRO EM ANDAMENTO OU FINALIZADO */
            <div className="space-y-4">
              {/* Status do Roteiro */}
              <Card className={rotaHoje.status === 'finalizado' ? 'border-green-200 bg-green-50/30' : 'border-amber-200 bg-amber-50/30'}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge className={rotaHoje.status === 'finalizado' ? 'bg-green-500' : 'bg-amber-500 text-black'}>
                          {rotaHoje.status === 'finalizado' ? 'Finalizado' : 'Em Andamento'}
                        </Badge>
                        <span className="text-sm text-slate-600">
                          Início: <strong>{new Date(rotaHoje.hora_inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
                        <Clock className="w-3 h-3" />
                        Tempo: {tempoDecorrido()}
                        {rotaHoje.status === 'finalizado' && rotaHoje.hora_fim && (
                          <span className="ml-2">
                            | Fim: <strong>{new Date(rotaHoje.hora_fim).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline">{visitasHoje.length} visita(s)</Badge>
                  </div>
                </CardContent>
              </Card>

              {/* Visitas já concluídas */}
              {visitasHoje.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-700">Visitas Realizadas</h3>
                  {visitasHoje.map(v => <VisitaCardResumida key={v.id} visita={v} />)}
                </div>
              )}

              {/* Ações do roteiro em andamento */}
              {rotaHoje.status === 'em_andamento' && (
                <>
                  {/* Visita em andamento */}
                  {visitaEmAndamento ? (
                    <FormVisitaSupervisor
                      cliente={visitaEmAndamento}
                      rotaSupervisorId={rotaHoje.id}
                      supervisor={supervisor}
                      onClose={() => {
                        setVisitaEmAndamento(null);
                        queryClient.invalidateQueries({ queryKey: ['visitasSupervisor', rotaHoje.id] });
                      }}
                    />
                  ) : (
                    <>
                      {/* Busca de clientes */}
                      {showBusca ? (
                        <BuscaClienteSupervisor
                          onSelectCliente={handleSelectCliente}
                          clientesJaAdicionados={clientesJaVisitados}
                        />
                      ) : (
                        <Button onClick={() => setShowBusca(true)} variant="outline" className="w-full border-dashed border-2">
                          <Plus className="w-4 h-4 mr-2" /> Adicionar Visita
                        </Button>
                      )}
                    </>
                  )}

                  {/* Finalizar Roteiro */}
                  {!visitaEmAndamento && (
                    <Card className="border-red-200">
                      <CardContent className="pt-4 space-y-3">
                        <div>
                          <Label className="font-semibold text-sm">Resumo Geral do Roteiro</Label>
                          <Textarea
                            placeholder="Escreva um resumo geral do seu dia de visitas..."
                            value={resumoGeral}
                            onChange={(e) => setResumoGeral(e.target.value)}
                            rows={3}
                          />
                        </div>
                        <Button
                          onClick={handleFinalizarRoteiro}
                          disabled={loadingAction}
                          className="w-full bg-red-600 hover:bg-red-700"
                        >
                          <Square className="w-4 h-4 mr-2" />
                          {loadingAction ? 'Finalizando...' : 'Finalizar Roteiro'}
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}

              {/* Resumo do roteiro finalizado */}
              {rotaHoje.status === 'finalizado' && rotaHoje.resumo_geral && (
                <Card>
                  <CardContent className="pt-4">
                    <Label className="text-xs text-slate-500 font-semibold">Resumo Geral</Label>
                    <p className="text-sm text-slate-700 mt-1">{rotaHoje.resumo_geral}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="historico">
          <HistoricoRotasSupervisor />
        </TabsContent>
      </Tabs>
    </div>
  );
}