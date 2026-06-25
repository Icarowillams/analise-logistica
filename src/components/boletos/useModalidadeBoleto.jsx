import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

const normalizar = (v) => String(v || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const somenteNumeros = (v) => String(v || '').replace(/\D/g, '');

/**
 * Carrega modalidades + APENAS os clientes do contexto informado (não a base inteira).
 * @param {Object} opts
 * @param {string[]} opts.cnpjs   CNPJs/CPFs dos pedidos da carga selecionada
 * @param {string[]} opts.codigos códigos Omie dos clientes da carga selecionada
 */
export function useModalidadeBoleto({ cnpjs = [], codigos = [] } = {}) {
  const { data: modalidades = [] } = useQuery({
    queryKey: ['modalidades-pagamento-boleto'],
    queryFn: () => base44.entities.ModalidadePagamento.list(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  // Chaves do contexto — normalizadas e únicas
  const cnpjsKey = useMemo(
    () => [...new Set(cnpjs.map(somenteNumeros).filter(c => c.length >= 11))].sort(),
    [cnpjs]
  );
  const codigosKey = useMemo(
    () => [...new Set(codigos.map(c => String(c || '').trim()).filter(Boolean))].sort(),
    [codigos]
  );

  // Busca SOB DEMANDA apenas os clientes da carga (por CNPJ/CPF), nunca a base inteira
  const { data: clientes = [], isLoading: loadingClientes } = useQuery({
    queryKey: ['clientes-modalidade-boleto-contexto', cnpjsKey, codigosKey],
    enabled: cnpjsKey.length > 0 || codigosKey.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const buscas = [];
      if (cnpjsKey.length > 0) {
        buscas.push(base44.entities.Cliente.filter({ cnpj_cpf: { $in: cnpjsKey } }));
      }
      if (codigosKey.length > 0) {
        buscas.push(base44.entities.Cliente.filter({ codigo_omie: { $in: codigosKey } }));
        buscas.push(base44.entities.Cliente.filter({ codigo_cliente_omie: { $in: codigosKey } }));
      }
      const resultados = await Promise.all(buscas);
      const planos = resultados.flat();
      // Dedup por id
      const vistos = new Set();
      return planos.filter(c => {
        if (vistos.has(c.id)) return false;
        vistos.add(c.id);
        return true;
      });
    }
  });

  const modalidadeBoletoIds = useMemo(() => {
    // Identifica a(s) modalidade(s) de Boleto Bancário pelo NOME, sem amarrar a um ID fixo
    // do banco. Fallback secundário: qualquer modalidade que contenha "BOLETO".
    const ids = new Set();
    modalidades.forEach(m => {
      const nome = normalizar(m.nome);
      if (nome.includes('BOLETO') && nome.includes('BANCARIO')) ids.add(m.id);
    });
    if (ids.size === 0) {
      modalidades.forEach(m => {
        if (normalizar(m.nome).includes('BOLETO')) ids.add(m.id);
      });
    }
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