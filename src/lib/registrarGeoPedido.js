import { base44 } from '@/api/base44Client';
import { capturarPosicao, distanciaMetros } from '@/lib/coberturaUtils';

// Captura a geolocalização do lançamento de um pedido e cria o registro
// GeolocalizacaoPedido. INFORMATIVO e NÃO-BLOQUEANTE: qualquer falha (permissão
// negada, sem suporte) é engolida silenciosamente — nunca impede salvar o pedido.
// Retorna os campos geo para o caller opcionalmente gravar no Pedido.
export async function registrarGeoPedido({ pedido, cliente, usuario }) {
  try {
    const pos = await capturarPosicao();
    const dist = cliente?.latitude != null
      ? distanciaMetros(pos.latitude, pos.longitude, cliente.latitude, cliente.longitude)
      : null;
    const params = (await base44.entities.ParametroCobertura.filter({ chave: 'principal' }))[0];
    const raio = params?.raio_geo_metros || 300;
    const fora = dist != null && dist > raio;
    const canal = cliente?.canal_preferencial || pedido?.canal_pedido || null;

    await base44.entities.GeolocalizacaoPedido.create({
      pedido_id: pedido?.id,
      numero_pedido: pedido?.numero_pedido,
      cliente_id: cliente?.id,
      cliente_nome: cliente?.razao_social || cliente?.nome_fantasia,
      usuario_id: usuario?.id,
      usuario_nome: usuario?.nome,
      latitude: pos.latitude,
      longitude: pos.longitude,
      distancia_cadastro_m: dist,
      fora_do_raio: fora,
      canal_pedido: canal,
      criado_em: new Date().toISOString(),
    });

    return {
      geo_latitude: pos.latitude,
      geo_longitude: pos.longitude,
      geo_distancia_m: dist,
      geo_fora_do_raio: fora,
      canal_pedido: canal,
    };
  } catch {
    return null; // nunca bloqueia o lançamento do pedido
  }
}