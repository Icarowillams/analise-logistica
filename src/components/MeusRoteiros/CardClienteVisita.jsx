import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MapPin, XCircle, ShoppingCart, Package, ArrowLeftRight, CheckCircle2, Send } from 'lucide-react';
import { toast } from 'sonner';
import EstoqueForm from './EstoqueForm';
import TrocasForm from './TrocasForm';
import ObservacoesVisita from './ObservacoesVisita';

export default function CardClienteVisita({ cliente, ordem, roteiro, vendedor, visitaExistente, onChange }) {
  const [expandido, setExpandido] = useState(false);
  const [visita, setVisita] = useState(visitaExistente || null);
  const [carregando, setCarregando] = useState(false);

  // estado de não atendimento
  const [naoAtendimentoOpen, setNaoAtendimentoOpen] = useState(false);
  const [motivoNao, setMotivoNao] = useState('');
  const [dataReagendamento, setDataReagendamento] = useState('');

  // estado de finalizar
  const [pedidoSolicitado, setPedidoSolicitado] = useState(false);
  const [motivoNaoPedido, setMotivoNaoPedido] = useState('');

  useEffect(() => { setVisita(visitaExistente || null); }, [visitaExistente?.id]);

  const status = visita?.status || 'pendente';
  const cfg = {
    pendente: { cor: 'bg-amber-100 text-amber-800 border-amber-300', label: 'Pendente' },
    checkin_realizado: { cor: 'bg-blue-100 text-blue-800 border-blue-300', label: 'Em andamento' },
    concluida: { cor: 'bg-emerald-100 text-emerald-800 border-emerald-300', label: 'Concluída' },
    nao_atendido: { cor: 'bg-red-100 text-red-800 border-red-300', label: 'Não atendido' }
  }[status];

  const fazerCheckin = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocalização não disponível');
      return;
    }
    setCarregando(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const payload = {
          numero_visita: `V${Date.now()}`,
          roteiro_id: roteiro?.id,
          cliente_id: cliente.cliente_id,
          cliente_nome: cliente.cliente_nome,
          cliente_codigo: cliente.cliente_codigo,
          cliente_cidade: cliente.cliente_cidade,
          vendedor_id: vendedor?.id,
          vendedor_nome: vendedor?.nome,
          data_visita: new Date().toISOString().slice(0, 10),
          hora_checkin: new Date().toISOString(),
          latitude_checkin: pos.coords.latitude,
          longitude_checkin: pos.coords.longitude,
          status: 'checkin_realizado'
        };
        const nova = await base44.entities.Visita.create(payload);
        setVisita(nova);
        setExpandido(true);
        setCarregando(false);
        toast.success(`Check-in registrado: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
        onChange?.();
      },
      async () => {
        const payload = {
          numero_visita: `V${Date.now()}`,
          roteiro_id: roteiro?.id,
          cliente_id: cliente.cliente_id,
          cliente_nome: cliente.cliente_nome,
          cliente_codigo: cliente.cliente_codigo,
          cliente_cidade: cliente.cliente_cidade,
          vendedor_id: vendedor?.id,
          vendedor_nome: vendedor?.nome,
          data_visita: new Date().toISOString().slice(0, 10),
          hora_checkin: new Date().toISOString(),
          status: 'checkin_realizado'
        };
        const nova = await base44.entities.Visita.create(payload);
        setVisita(nova);
        setExpandido(true);
        setCarregando(false);
        toast.warning('Sem GPS — visita iniciada sem localização');
        onChange?.();
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const salvarNaoAtendimento = async () => {
    if (!motivoNao) { toast.error('Selecione o motivo'); return; }
    setCarregando(true);
    try {
      const payload = {
        numero_visita: `V${Date.now()}`,
        roteiro_id: roteiro?.id,
        cliente_id: cliente.cliente_id,
        cliente_nome: cliente.cliente_nome,
        cliente_codigo: cliente.cliente_codigo,
        cliente_cidade: cliente.cliente_cidade,
        vendedor_id: vendedor?.id,
        vendedor_nome: vendedor?.nome,
        data_visita: new Date().toISOString().slice(0, 10),
        hora_checkin: new Date().toISOString(),
        observacoes: motivoNao,
        status: 'nao_atendido'
      };
      const nova = await base44.entities.Visita.create(payload);
      if (dataReagendamento) {
        await base44.entities.VisitaReagendada.create({
          cliente_id: cliente.cliente_id,
          cliente_nome: cliente.cliente_nome,
          cliente_codigo: cliente.cliente_codigo,
          cliente_cidade: cliente.cliente_cidade,
          vendedor_id: vendedor?.id,
          vendedor_nome: vendedor?.nome,
          data_reagendamento: dataReagendamento,
          data_original: new Date().toISOString().slice(0, 10),
          motivo_nao_atendimento: motivoNao,
          visita_original_id: nova.id,
          status: 'pendente'
        });
      }
      setVisita(nova);
      setNaoAtendimentoOpen(false);
      toast.success('Não atendimento registrado');
      onChange?.();
    } finally {
      setCarregando(false);
    }
  };

  const concluirVisita = async () => {
    if (!visita) return;
    setCarregando(true);
    try {
      await base44.entities.Visita.update(visita.id, {
        pedido_solicitado: pedidoSolicitado,
        motivo_nao_solicitacao_descricao: !pedidoSolicitado ? motivoNaoPedido : '',
        status: 'concluida'
      });
      setVisita({ ...visita, status: 'concluida', pedido_solicitado: pedidoSolicitado });
      toast.success('Visita concluída!');
      setExpandido(false);
      onChange?.();
    } finally {
      setCarregando(false);
    }
  };

  return (
    <Card className="bg-white">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-amber-400 text-neutral-900 text-sm font-bold shrink-0">{ordem}</span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900">{cliente.cliente_codigo} - {cliente.cliente_nome}</p>
            <p className="text-xs text-slate-500 uppercase tracking-wide mt-0.5">{cliente.cliente_cidade || '-'}{cliente.cliente_endereco ? `, ${cliente.cliente_endereco}` : ''}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-600" onClick={() => window.location.href = '/EmissaoPedidos'}>
              <Send className="w-4 h-4" />
            </Button>
            <Badge className={cfg.cor + ' border'}>{cfg.label}</Badge>
          </div>
        </div>

        {status === 'pendente' && !naoAtendimentoOpen && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr,200px] gap-2 mt-3">
            <Button onClick={fazerCheckin} disabled={carregando} className="bg-blue-600 hover:bg-blue-700 text-white h-11">
              <MapPin className="w-4 h-4 mr-2" />Check-in
            </Button>
            <Button variant="outline" onClick={() => setNaoAtendimentoOpen(true)} className="border-red-300 text-red-600 hover:bg-red-50 h-11">
              <XCircle className="w-4 h-4 mr-2" />Não Atendimento
            </Button>
          </div>
        )}

        {naoAtendimentoOpen && (
          <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 space-y-3">
            <div>
              <Label className="text-xs">Motivo do não atendimento *</Label>
              <Select value={motivoNao} onValueChange={setMotivoNao}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cliente_fechado">Cliente fechado</SelectItem>
                  <SelectItem value="horario_nao_comercial">Horário não comercial</SelectItem>
                  <SelectItem value="cliente_ausente">Cliente ausente</SelectItem>
                  <SelectItem value="endereco_nao_localizado">Endereço não localizado</SelectItem>
                  <SelectItem value="sem_tempo">Sem tempo</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Reagendar para (opcional)</Label>
              <Input type="date" value={dataReagendamento} onChange={(e) => setDataReagendamento(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setNaoAtendimentoOpen(false)} className="flex-1">Cancelar</Button>
              <Button onClick={salvarNaoAtendimento} disabled={carregando || !motivoNao} className="flex-1 bg-red-600 hover:bg-red-700">Confirmar</Button>
            </div>
          </div>
        )}

        {status === 'checkin_realizado' && (
          <div className="mt-3">
            <Button variant="outline" onClick={() => setExpandido(e => !e)} className="w-full">
              {expandido ? 'Recolher' : 'Continuar visita'}
            </Button>
          </div>
        )}
      </div>

      {expandido && visita && status === 'checkin_realizado' && (
        <div className="border-t bg-slate-50/50 p-4 space-y-3">
          <Tabs defaultValue="estoque" className="w-full">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="estoque" className="gap-1 text-xs"><Package className="w-3 h-3" />Estoque</TabsTrigger>
              <TabsTrigger value="trocas" className="gap-1 text-xs"><ArrowLeftRight className="w-3 h-3" />Trocas</TabsTrigger>
              <TabsTrigger value="finalizar" className="gap-1 text-xs"><CheckCircle2 className="w-3 h-3" />Finalizar</TabsTrigger>
            </TabsList>
            <TabsContent value="estoque">
              <EstoqueForm visitaId={visita.id} clienteId={cliente.cliente_id} clienteNome={cliente.cliente_nome} />
            </TabsContent>
            <TabsContent value="trocas">
              <TrocasForm visitaId={visita.id} clienteId={cliente.cliente_id} clienteNome={cliente.cliente_nome} />
            </TabsContent>
            <TabsContent value="finalizar" className="space-y-3 mt-4">
              <ObservacoesVisita visitaRegistro={visita} />
              <div className="p-3 bg-white rounded-lg border space-y-3">
                <Label className="text-sm font-semibold">Pedido</Label>
                <div className="flex gap-2">
                  <Button variant={pedidoSolicitado ? 'default' : 'outline'} onClick={() => setPedidoSolicitado(true)} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
                    <ShoppingCart className="w-4 h-4 mr-2" />Pedido solicitado
                  </Button>
                  <Button variant={!pedidoSolicitado ? 'default' : 'outline'} onClick={() => setPedidoSolicitado(false)} className="flex-1">Sem pedido</Button>
                </div>
                {!pedidoSolicitado && (
                  <div>
                    <Label className="text-xs">Motivo de não solicitação</Label>
                    <Textarea value={motivoNaoPedido} onChange={(e) => setMotivoNaoPedido(e.target.value)} rows={2} />
                  </div>
                )}
              </div>
              <Button onClick={concluirVisita} disabled={carregando} className="w-full bg-emerald-600 hover:bg-emerald-700 h-11">
                <CheckCircle2 className="w-4 h-4 mr-2" />Concluir Visita
              </Button>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </Card>
  );
}