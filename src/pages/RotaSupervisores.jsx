import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ClipboardList, Plus, Clock, MapPin, CheckSquare } from 'lucide-react';
import { toast } from 'sonner';
import BuscaClienteSupervisor from '@/components/RotaSupervisor/BuscaClienteSupervisor';
import FormVisitaSupervisor from '@/components/RotaSupervisor/FormVisitaSupervisor';
import VisitaCardResumida from '@/components/RotaSupervisor/VisitaCardResumida';

export default function RotaSupervisores() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [supervisor, setSupervisor] = useState(null);
  const [rotaAtual, setRotaAtual] = useState(null);
  const [adicionarOpen, setAdicionarOpen] = useState(false);
  const [clienteAtual, setClienteAtual] = useState(null);
  const [resumoGeral, setResumoGeral] = useState('');
  const [tempoStr, setTempoStr] = useState('0min');
  const [iniciando, setIniciando] = useState(false);
  const [finalizando, setFinalizando] = useState(false);

  const { data: vendedores = [] } = useQuery({ queryKey: ['vendedores'], queryFn: () => base44.entities.Vendedor.list() });

  useEffect(() => { base44.auth.me().then(setUser).catch(() => null); }, []);

  useEffect(() => {
    if (!user || !vendedores.length) return;
    const sup = vendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
    setSupervisor(sup);
  }, [user, vendedores]);

  const hoje = new Date().toISOString().slice(0, 10);

  const { data: rotasHoje = [] } = useQuery({
    queryKey: ['rotaSupervisorHoje', supervisor?.id, hoje],
    queryFn: () => base44.entities.RotaSupervisor.filter({ supervisor_id: supervisor?.id, data: hoje }),
    enabled: !!supervisor?.id
  });

  useEffect(() => {
    if (rotasHoje.length > 0) {
      const ativa = rotasHoje.find(r => r.status === 'em_andamento') || rotasHoje[0];
      setRotaAtual(ativa);
      setResumoGeral(ativa.resumo_geral || '');
    } else {
      setRotaAtual(null);
    }
  }, [rotasHoje]);

  const { data: visitas = [] } = useQuery({
    queryKey: ['visitasSupervisor', rotaAtual?.id],
    queryFn: () => base44.entities.VisitaSupervisor.filter({ rota_supervisor_id: rotaAtual?.id }, '-checkin_time'),
    enabled: !!rotaAtual?.id
  });

  // Atualiza tempo
  useEffect(() => {
    if (!rotaAtual?.hora_inicio || rotaAtual.status !== 'em_andamento') return;
    const tick = () => {
      const ms = Date.now() - new Date(rotaAtual.hora_inicio).getTime();
      const min = Math.floor(ms / 60000);
      const h = Math.floor(min / 60);
      const m = min % 60;
      setTempoStr(h > 0 ? `${h}h ${m}min` : `${m}min`);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [rotaAtual?.hora_inicio, rotaAtual?.status]);

  const iniciarRoteiro = () => {
    if (!supervisor) { toast.error('Supervisor não identificado'); return; }
    setIniciando(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const nova = await base44.entities.RotaSupervisor.create({
          supervisor_id: supervisor.id,
          supervisor_nome: supervisor.nome,
          data: hoje,
          hora_inicio: new Date().toISOString(),
          latitude_inicio: pos.coords.latitude,
          longitude_inicio: pos.coords.longitude,
          status: 'em_andamento'
        });
        setRotaAtual(nova);
        queryClient.invalidateQueries({ queryKey: ['rotaSupervisorHoje'] });
        setIniciando(false);
        toast.success('Roteiro iniciado!');
      },
      async () => {
        const nova = await base44.entities.RotaSupervisor.create({
          supervisor_id: supervisor.id, supervisor_nome: supervisor.nome,
          data: hoje, hora_inicio: new Date().toISOString(), status: 'em_andamento'
        });
        setRotaAtual(nova);
        queryClient.invalidateQueries({ queryKey: ['rotaSupervisorHoje'] });
        setIniciando(false);
        toast.warning('Roteiro iniciado sem GPS');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const finalizarRoteiro = () => {
    if (!rotaAtual) return;
    setFinalizando(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const fim = new Date().toISOString();
        const tempo = Math.round((new Date(fim) - new Date(rotaAtual.hora_inicio)) / 60000);
        await base44.entities.RotaSupervisor.update(rotaAtual.id, {
          hora_fim: fim, latitude_fim: pos.coords.latitude, longitude_fim: pos.coords.longitude,
          tempo_total_minutos: tempo, resumo_geral: resumoGeral, status: 'finalizado'
        });
        queryClient.invalidateQueries({ queryKey: ['rotaSupervisorHoje'] });
        setFinalizando(false);
        toast.success('Roteiro finalizado!');
      },
      async () => {
        const fim = new Date().toISOString();
        const tempo = Math.round((new Date(fim) - new Date(rotaAtual.hora_inicio)) / 60000);
        await base44.entities.RotaSupervisor.update(rotaAtual.id, {
          hora_fim: fim, tempo_total_minutos: tempo, resumo_geral: resumoGeral, status: 'finalizado'
        });
        queryClient.invalidateQueries({ queryKey: ['rotaSupervisorHoje'] });
        setFinalizando(false);
        toast.success('Roteiro finalizado!');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  if (!user) return <div className="py-12 text-center text-slate-500">Carregando...</div>;

  return (
    <div className="space-y-4">
      <PageHeader title="Rota Supervisores" subtitle={`Olá, ${(supervisor?.nome || user?.full_name || '').toUpperCase()}`} icon={ClipboardList} />

      {!rotaAtual && (
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-slate-600">Você ainda não iniciou um roteiro hoje.</p>
            <Button onClick={iniciarRoteiro} disabled={iniciando} className="bg-blue-600 hover:bg-blue-700">
              <MapPin className="w-4 h-4 mr-2" />Iniciar Roteiro
            </Button>
          </CardContent>
        </Card>
      )}

      {rotaAtual && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <Badge className={rotaAtual.status === 'em_andamento' ? 'bg-amber-200 text-amber-900' : 'bg-emerald-200 text-emerald-900'}>
                  {rotaAtual.status === 'em_andamento' ? 'Em Andamento' : 'Finalizado'}
                </Badge>
                <span className="text-sm">Início: <strong>{new Date(rotaAtual.hora_inicio).toLocaleTimeString('pt-BR').slice(0, 5)}</strong></span>
                {rotaAtual.status === 'em_andamento' && (
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />Tempo: {tempoStr}
                  </span>
                )}
              </div>
              <Badge variant="outline">{visitas.length} visita(s)</Badge>
            </div>

            {rotaAtual.status === 'em_andamento' && !adicionarOpen && (
              <Button variant="outline" onClick={() => setAdicionarOpen(true)} className="w-full border-dashed border-2 h-12">
                <Plus className="w-4 h-4 mr-2" />Adicionar Visita
              </Button>
            )}

            {adicionarOpen && !clienteAtual && (
              <div className="space-y-3">
                <BuscaClienteSupervisor
                  onSelectCliente={setClienteAtual}
                  clientesJaAdicionados={visitas.map(v => v.cliente_id)}
                />
                <Button variant="outline" onClick={() => setAdicionarOpen(false)} className="w-full">Cancelar</Button>
              </div>
            )}

            {clienteAtual && (
              <FormVisitaSupervisor
                rotaSupervisor={rotaAtual}
                supervisor={supervisor}
                cliente={clienteAtual}
                onConcluida={() => {
                  setClienteAtual(null);
                  setAdicionarOpen(false);
                  queryClient.invalidateQueries({ queryKey: ['visitasSupervisor'] });
                }}
                onCancelar={() => { setClienteAtual(null); setAdicionarOpen(false); }}
              />
            )}

            <div className="space-y-2">
              {visitas.map(v => <VisitaCardResumida key={v.id} visita={v} />)}
            </div>

            {rotaAtual.status === 'em_andamento' && (
              <div className="border-t pt-3 space-y-3">
                <div>
                  <Label className="text-sm font-semibold">Resumo Geral do Roteiro</Label>
                  <Textarea value={resumoGeral} onChange={(e) => setResumoGeral(e.target.value)}
                    placeholder="Escreva um resumo geral do seu dia de visitas..." rows={3} className="mt-1" />
                </div>
                <Button onClick={finalizarRoteiro} disabled={finalizando} className="w-full bg-red-600 hover:bg-red-700 h-11">
                  <CheckSquare className="w-4 h-4 mr-2" />Finalizar Roteiro
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}