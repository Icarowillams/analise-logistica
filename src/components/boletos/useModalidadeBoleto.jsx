import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

const BOLETO_BANCARIO_ID_FALLBACK = '69ff70445fbcb49b659710df';
const normalizar = (v) => String(v || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const somenteNumeros = (v) => String(v || '').replace(/\D/g, '');

export function useModalidadeBoleto() {
  const { data: modalidades = [] } = useQuery({
    queryKey: ['modalidades-pagamento-boleto'],
    queryFn: () => base44.entities.ModalidadePagamento.list(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  const { data: clientes = [], isLoading: loadingClientes } = useQuery({
    queryKey: ['clientes-modalidade-boleto'],
    queryFn: () => base44.entities.Cliente.list('-updated_date', 5000),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  const modalidadeBoletoIds = useMemo(() => {
    const ids = new Set([BOLETO_BANCARIO_ID_FALLBACK]);
    modalidades.forEach(m => {
      const nome = normalizar(m.nome);
      if (nome.includes('BOLETO') && nome.includes('BANCARIO')) ids.add(m.id);
    });
    return ids;
  }, [modalidades]);

  const clientesBoletoMap = useMemo(() => {
    const porCodigoOmie = new Map();
    const porCnpj = new Map();
    clientes.forEach(c => {
      if (!modalidadeBoletoIds.has(c.modalidade_pagamento_id)) return;
      [c.codigo_omie, c.codigo_cliente_omie].forEach(cod => {
        const k = String(cod || '').trim();
        if (k) porCodigoOmie.set(k, c);
      });
      const cn = somenteNumeros(c.cnpj_cpf);
      if (cn) porCnpj.set(cn, c);
    });
    return { porCodigoOmie, porCnpj };
  }, [clientes, modalidadeBoletoIds]);

  const isClienteBoleto = (titulo) => {
    const cod = String(titulo.codigo_cliente || '').trim();
    if (cod && clientesBoletoMap.porCodigoOmie.has(cod)) return true;
    const cn = somenteNumeros(titulo.cnpj_cpf);
    if (cn && clientesBoletoMap.porCnpj.has(cn)) return true;
    return false;
  };

  return { clientesBoletoMap, modalidadeBoletoIds, isClienteBoleto, loadingClientes };
}