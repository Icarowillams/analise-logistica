import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

const DIAS = ['domingo', 'segunda-feira', 'terca-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sabado'];
const MAP_STATUS = { concluida: 'visitado', nao_atendido: 'nao_visitado', checkin_realizado: 'em_andamento' };

// Hook adaptador: lê a entidade Visita (fluxo de campo real) e normaliza
// para o formato esperado pelos dashboards de Visitas, Mapa e Vendedor.
export default function useVisitasAnalise() {
  const { data: visitasRaw = [], isLoading } = useQuery({
    queryKey: ['visitas_analise'],
    queryFn: () => base44.entities.Visita.list('-data_visita', 10000)
  });
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes_analise'],
    queryFn: () => base44.entities.Cliente.list('-created_date', 20000)
  });
  const { data: rotas = [] } = useQuery({
    queryKey: ['rotas_analise'],
    queryFn: () => base44.entities.Rota.list()
  });

  const visitas = useMemo(() => {
    const rotaNome = new Map(rotas.map(r => [r.id, r.nome]));
    const rotaCliente = new Map(clientes.map(c => [c.id, rotaNome.get(c.rota_id) || '']));
    return visitasRaw.map(v => {
      const d = v.data_visita ? new Date(v.data_visita + 'T12:00:00') : null;
      return {
        ...v,
        status: MAP_STATUS[v.status] || v.status,
        checkin_lat: v.latitude_checkin,
        checkin_lng: v.longitude_checkin,
        checkin_em: v.hora_checkin,
        gerou_pedido: !!v.pedido_solicitado,
        motivo_nao_atendimento: v.status === 'nao_atendido' ? (v.observacoes || 'nao_informado') : null,
        dia_semana: d ? DIAS[d.getDay()] : null,
        cliente_rota: rotaCliente.get(v.cliente_id) || ''
      };
    });
  }, [visitasRaw, clientes, rotas]);

  return { visitas, isLoading };
}