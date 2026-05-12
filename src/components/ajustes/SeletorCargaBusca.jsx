import React, { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Search, Truck, X, Check } from 'lucide-react';

/**
 * Seletor de carga via BUSCA POR TEXTO.
 * - Digita nº carga / motorista / rota / placa / cliente / nº pedido
 * - Mostra dropdown com matches
 * - Ao clicar, seleciona a carga (callback onChange)
 *
 * Props:
 *  - cargas: lista de cargas já filtradas pela regra de etapa (vem do pai)
 *  - cargaSelecionadaId
 *  - onChange(carga)
 *  - label
 *  - placeholder
 */
export default function SeletorCargaBusca({
  cargas = [],
  cargaSelecionadaId,
  onChange,
  label = 'Carga',
  placeholder = 'Digite nº carga, motorista, rota, cliente ou nº pedido...'
}) {
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(false);

  const cargaSelecionada = useMemo(
    () => cargas.find(c => c.id === cargaSelecionadaId),
    [cargas, cargaSelecionadaId]
  );

  const resultados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return cargas.slice(0, 30);
    return cargas.filter(c => {
      const blobCarga = [c.numero_carga, c.motorista_nome, c.rota_nome, c.veiculo_placa, c.data_carga]
        .filter(Boolean).join(' ').toLowerCase();
      if (blobCarga.includes(termo)) return true;
      // busca em pedidos da carga (nº pedido, NF, cliente)
      const pedidos = [...(c.pedidos_omie || []), ...(c.pedidos_internos || [])];
      return pedidos.some(p => {
        const blobPed = [p.numero_pedido, p.numero_nf, p.nome_cliente, p.nome_fantasia, p.codigo_pedido]
          .filter(Boolean).join(' ').toLowerCase();
        return blobPed.includes(termo);
      });
    }).slice(0, 30);
  }, [cargas, busca]);

  const selecionar = (carga) => {
    onChange(carga);
    setBusca('');
    setAberto(false);
  };

  const limpar = () => {
    onChange(null);
    setBusca('');
  };

  return (
    <div className="relative">
      <Label className="flex items-center gap-1.5"><Truck className="w-4 h-4" /> {label}</Label>

      {cargaSelecionada ? (
        <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-emerald-50 border-emerald-200">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <div className="flex-1 text-sm">
            <div className="font-medium text-emerald-900">
              Carga {cargaSelecionada.numero_carga} • {cargaSelecionada.data_carga}
            </div>
            <div className="text-xs text-emerald-700">
              {cargaSelecionada.motorista_nome || '-'} • {cargaSelecionada.rota_nome || '-'} •
              {' '}{(cargaSelecionada.pedidos_omie || []).length + (cargaSelecionada.pedidos_internos || []).length} pedido(s)
            </div>
          </div>
          <button onClick={limpar} className="text-emerald-700 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder={placeholder}
              value={busca}
              onChange={(e) => { setBusca(e.target.value); setAberto(true); }}
              onFocus={() => setAberto(true)}
              onBlur={() => setTimeout(() => setAberto(false), 200)}
              className="pl-9"
            />
          </div>

          {aberto && (
            <div className="absolute z-30 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-72 overflow-y-auto">
              {resultados.length === 0 ? (
                <div className="p-4 text-center text-sm text-slate-400">
                  {busca ? 'Nenhuma carga encontrada para essa busca.' : 'Nenhuma carga elegível.'}
                </div>
              ) : resultados.map(c => (
                <button
                  key={c.id}
                  onMouseDown={(e) => { e.preventDefault(); selecionar(c); }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-100 border-b last:border-b-0"
                >
                  <div className="text-sm font-medium">
                    Carga {c.numero_carga || '-'} • {c.data_carga}
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.motorista_nome || 'sem motorista'} • {c.rota_nome || 'sem rota'} •
                    {' '}{c.veiculo_placa || '-'} • {(c.pedidos_omie || []).length + (c.pedidos_internos || []).length} pedidos • {c.status_carga}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}