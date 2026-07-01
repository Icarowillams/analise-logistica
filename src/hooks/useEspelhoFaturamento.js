import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

const STALE_MS = 10 * 60 * 1000;
const PAGE_LIMIT = 5000;

function isoToBr(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diffDays(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000);
}

// Lê TODAS as NFs do período, paginando por divisão de range se bater o limite.
// De-dup por id ao juntar as páginas. NUNCA retorna parcial truncado.
async function buscarEspelhoPaginado(inicio, fim) {
  async function buscarRange(start, end) {
    const results = await base44.entities.EspelhoFaturamentoNF.filter(
      { data_emissao: { $gte: start, $lte: end }, cancelada: false },
      '-data_emissao',
      PAGE_LIMIT
    );
    if (results.length === PAGE_LIMIT) {
      const totalDays = diffDays(start, end);
      if (totalDays <= 1) return results; // não dá pra dividir mais
      const mid = addDays(start, Math.floor(totalDays / 2));
      const [left, right] = await Promise.all([
        buscarRange(start, mid),
        buscarRange(addDays(mid, 1), end)
      ]);
      return [...left, ...right];
    }
    return results;
  }

  const all = await buscarRange(inicio, fim);
  const seen = new Map();
  for (const nf of all) {
    if (nf && nf.id && !seen.has(nf.id)) seen.set(nf.id, nf);
  }
  return Array.from(seen.values());
}

export function useEspelhoFaturamento(inicioISO, fimISO) {
  const queryClient = useQueryClient();
  const [isSincronizando, setIsSincronizando] = useState(false);
  const [erroSync, setErroSync] = useState(null);
  const autoSyncRef = useRef(false);

  const periodoChave = `${inicioISO}_${fimISO}`;

  // Query A: leitura local (instantânea, paginada)
  const { data: dados = [], isLoading } = useQuery({
    queryKey: ['espelho_fat', inicioISO, fimISO],
    queryFn: () => buscarEspelhoPaginado(inicioISO, fimISO),
    enabled: !!inicioISO && !!fimISO,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true
  });

  // Query B: controle de sync
  const { data: controle } = useQuery({
    queryKey: ['controle_sync', periodoChave],
    queryFn: () => base44.entities.ControleSyncFaturamento.filter({ periodo_chave: periodoChave }, '-updated_date', 1),
    enabled: !!periodoChave,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true
  });

  const ultimaSincronizacao = controle?.[0]?.ultima_sincronizacao || null;
  const syncEmAndamento = controle?.[0]?.em_andamento || false;
  const stale = !ultimaSincronizacao || (Date.now() - new Date(ultimaSincronizacao).getTime() > STALE_MS);

  const dispararSync = async (forcar = false) => {
    if (isSincronizando || syncEmAndamento) return;
    setIsSincronizando(true);
    setErroSync(null);
    try {
      await base44.functions.invoke('sincronizarEspelhoFaturamento', {
        data_inicial: isoToBr(inicioISO),
        data_final: isoToBr(fimISO),
        forcar
      });
      // Refetch (não só invalidate) pra garantir que o flag isSincronizando só
      // desce depois que os dados frescos já estão na tela — evita re-trigger.
      await queryClient.refetchQueries({ queryKey: ['controle_sync', periodoChave] });
      await queryClient.refetchQueries({ queryKey: ['espelho_fat', inicioISO, fimISO] });
    } catch (e) {
      setErroSync(e?.message || 'Erro ao sincronizar com o Omie');
    } finally {
      setIsSincronizando(false);
    }
  };

  // Auto-trigger sync background se stale (só uma vez por montagem/período)
  useEffect(() => {
    if (!inicioISO || !fimISO) return;
    if (stale && !syncEmAndamento && !isSincronizando && !autoSyncRef.current) {
      autoSyncRef.current = true;
      dispararSync(false);
    }
  }, [stale, syncEmAndamento, isSincronizando, inicioISO, fimISO]);

  // Reset do guard quando o período muda
  useEffect(() => {
    autoSyncRef.current = false;
  }, [periodoChave]);

  return {
    dados,
    isLoading,
    isSincronizando: isSincronizando || syncEmAndamento,
    ultimaSincronizacao,
    erroSync,
    sincronizarAgora: () => dispararSync(true)
  };
}