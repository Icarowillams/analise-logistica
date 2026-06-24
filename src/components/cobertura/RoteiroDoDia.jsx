import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, Loader2, CheckCircle2, Navigation, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { capturarPosicao, distanciaMetros } from '@/lib/coberturaUtils';
import CheckoutVisitaModal from './CheckoutVisitaModal';

function hojeStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function RoteiroDoDia() {
  const [userId, setUserId] = useState(null);
  const hoje = hojeStr();

  const [tipoPromotor, setTipoPromotor] = useState(null); // ['venda'] | ['reposicao'] | ['venda','reposicao'] | null

  useEffect(() => {
    base44.auth.me().then(async (u) => {
      const vends = await base44.entities.Vendedor.filter({ email: u.email });
      const me = vends[0];
      setUserId(me?.id || u.id);
      const ehPromotor = me?.papeis?.includes('promotor');
      setTipoPromotor(ehPromotor && me?.tipo_promotor?.length ? me.tipo_promotor : null);
    }).catch(() => {});
  }, []);

  const { data: agendas = [], isLoading, refetch } = useQuery({
    queryKey: ['roteiro-dia', userId, hoje],
    queryFn: () => base44.entities.AgendaComercial.filter({ usuario_id: userId, data_prevista: hoje }, '', 500),
    enabled: !!userId,
  });

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes-roteiro'],
    queryFn: () => base44.entities.Cliente.list('', 5000),
  });
  const clientePorId = useMemo(() => Object.fromEntries(clientes.map((c) => [c.id, c])), [clientes]);

  // Visitas de hoje deste usuário — para localizar a visita ligada à agenda (check-out)
  const { data: visitasHoje = [], refetch: refetchVisitas } = useQuery({
    queryKey: ['visitas-hoje', userId, hoje],
    queryFn: () => base44.entities.Visita.filter({ vendedor_id: userId, data_visita: hoje }, '-created_date', 500),
    enabled: !!userId,
  });
  const visitaPorAgenda = useMemo(() => Object.fromEntries(visitasHoje.map((v) => [v.agenda_id, v])), [visitasHoje]);

  const [checkoutVisita, setCheckoutVisita] = useState(null);

  // Diferenciador por tipo de promotor: promotor só-venda vê visitas de venda,
  // só-reposição vê reposição; misto/demais papéis veem tudo.
  const visiveis = useMemo(() => {
    if (!tipoPromotor || (tipoPromotor.includes('venda') && tipoPromotor.includes('reposicao'))) return agendas;
    const alvo = tipoPromotor.includes('reposicao') ? 'reposicao' : 'venda';
    return agendas.filter((a) => (a.finalidade_visita || 'venda') === alvo);
  }, [agendas, tipoPromotor]);

  // ordena por região (agrupado) — atraso já é refletido por estarem na agenda do dia
  const ordenadas = useMemo(() => [...visiveis].sort((a, b) => (a.cliente_regiao || '').localeCompare(b.cliente_regiao || '')), [visiveis]);

  const fazerCheckin = async (agenda) => {
    try {
      const pos = await capturarPosicao();
      const cli = clientePorId[agenda.cliente_id];
      const dist = cli?.latitude ? distanciaMetros(pos.latitude, pos.longitude, cli.latitude, cli.longitude) : null;
      const params = (await base44.entities.ParametroCobertura.filter({ chave: 'principal' }))[0];
      const raio = params?.raio_geo_metros || 300;
      const fora = dist != null && dist > raio;

      const visita = await base44.entities.Visita.create({
        cliente_id: agenda.cliente_id,
        cliente_nome: agenda.cliente_nome,
        vendedor_id: agenda.usuario_id,
        vendedor_nome: agenda.usuario_nome,
        papel: agenda.papel,
        finalidade_visita: agenda.finalidade_visita,
        data_visita: hoje,
        hora_checkin: new Date().toISOString(),
        latitude_checkin: pos.latitude,
        longitude_checkin: pos.longitude,
        distancia_cadastro_m: dist,
        fora_do_raio: fora,
        agenda_id: agenda.id,
        checkout_pendente: true,
        status: 'checkin_realizado',
      });
      await base44.entities.AgendaComercial.update(agenda.id, { status_visita: 'realizada', visita_id: visita.id });
      toast.success(fora ? `Check-in feito (FORA do raio: ${dist}m)` : `Check-in feito${dist != null ? ` (${dist}m)` : ''}`);
      refetch();
      refetchVisitas();
    } catch (e) {
      toast.error('Não foi possível capturar a localização: ' + (e?.message || ''));
    }
  };

  if (!userId) return <div className="p-8 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Navigation className="w-5 h-5 text-cyan-600" />
        <h3 className="font-semibold text-slate-800">Roteiro de hoje — {new Date().toLocaleDateString('pt-BR')}</h3>
        <Badge variant="outline" className="ml-auto">{ordenadas.length} clientes</Badge>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
      ) : ordenadas.length === 0 ? (
        <Card className="p-8 text-center text-slate-400">Nenhuma visita agendada para você hoje.</Card>
      ) : (
        <div className="space-y-2">
          {ordenadas.map((a) => (
            <Card key={a.id} className="p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-800 truncate">{a.cliente_nome}</div>
                <div className="text-xs text-slate-500 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {a.cliente_regiao || 'Sem região'} · {a.finalidade_visita === 'reposicao' ? 'Reposição' : 'Venda'}
                </div>
              </div>
              {a.status_visita === 'realizada' ? (
                (() => {
                  const v = visitaPorAgenda[a.id];
                  if (v && v.checkout_pendente) {
                    return <Button size="sm" variant="outline" onClick={() => setCheckoutVisita(v)} className="gap-1 border-amber-300 text-amber-700"><LogOut className="w-3 h-3" /> Check-out</Button>;
                  }
                  return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 gap-1"><CheckCircle2 className="w-3 h-3" /> Concluído</Badge>;
                })()
              ) : (
                <Button size="sm" onClick={() => fazerCheckin(a)} className="gap-1"><MapPin className="w-3 h-3" /> Check-in</Button>
              )}
            </Card>
          ))}
        </div>
      )}

      <CheckoutVisitaModal
        visita={checkoutVisita}
        open={!!checkoutVisita}
        onClose={() => setCheckoutVisita(null)}
        onDone={() => { refetchVisitas(); refetch(); }}
      />
    </div>
  );
}