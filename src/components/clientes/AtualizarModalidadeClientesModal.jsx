import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, CreditCard, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Modal para atualização rápida em massa da MODALIDADE DE PAGAMENTO dos clientes.
 *
 * Aceita colar um texto com duas colunas: CÓDIGO DO CLIENTE e MODALIDADE.
 * Separadores aceitos: tab, vírgula ou ponto-e-vírgula.
 *
 * Exemplo:
 *   20070;BOLETO BANCARIO
 *   3117	PIX
 *   2453,DINHEIRO
 */
export default function AtualizarModalidadeClientesModal({ open, onOpenChange }) {
  const [texto, setTexto] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const queryClient = useQueryClient();

  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => base44.entities.Cliente.list(),
    enabled: open,
  });

  const { data: modalidades = [] } = useQuery({
    queryKey: ['modalidadesPagamento'],
    queryFn: () => base44.entities.ModalidadePagamento.list(),
    enabled: open,
  });

  // Mapa de modalidades por nome normalizado (uppercase + sem acentos)
  const modalidadesMap = useMemo(() => {
    const map = {};
    const norm = (s) => String(s || '').trim().toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    modalidades.forEach((m) => {
      if (m.nome) map[norm(m.nome)] = m;
    });
    return map;
  }, [modalidades]);

  // Mapa de clientes por código (interno ou integração)
  const clientesMap = useMemo(() => {
    const map = {};
    clientes.forEach((c) => {
      const codigos = [c.codigo_interno, c.codigo_integracao].filter(Boolean);
      codigos.forEach((cod) => {
        const key = String(cod).trim().toLowerCase();
        if (key && !map[key]) map[key] = c;
      });
    });
    return map;
  }, [clientes]);

  const parseLinhas = (raw) => {
    const norm = (s) => String(s || '').trim().toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const linhas = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const itens = [];
    let naoEncontrados = 0;
    let modalidadesInvalidas = 0;
    let semAlteracao = 0;

    for (const linha of linhas) {
      const partes = linha.split(/\t|;|,/).map((p) => p.trim()).filter(Boolean);
      if (partes.length < 2) continue;

      const codigo = partes[0];
      const nomeModalidade = partes.slice(1).join(' '); // junta caso modalidade tenha espaços/vírgula interna
      const keyCod = String(codigo).trim().toLowerCase();
      const cliente = clientesMap[keyCod];
      const modalidade = modalidadesMap[norm(nomeModalidade)];

      if (!cliente) {
        naoEncontrados++;
        itens.push({ codigo, nomeModalidade, status: 'nao_encontrado' });
        continue;
      }
      if (!modalidade) {
        modalidadesInvalidas++;
        itens.push({ codigo, nomeModalidade, cliente, status: 'modalidade_invalida' });
        continue;
      }
      if (cliente.modalidade_pagamento_id === modalidade.id) {
        semAlteracao++;
        itens.push({ codigo, nomeModalidade, cliente, modalidade, status: 'sem_alteracao' });
        continue;
      }
      itens.push({ codigo, nomeModalidade, cliente, modalidade, status: 'atualizar' });
    }

    const atualizar = itens.filter((i) => i.status === 'atualizar');
    return { itens, atualizar, naoEncontrados, modalidadesInvalidas, semAlteracao, totalLinhas: linhas.length };
  };

  const handlePreValidar = () => {
    if (!texto.trim()) {
      toast.error('Cole os dados (código + modalidade) antes de pré-validar.');
      return;
    }
    const resultado = parseLinhas(texto);
    setPreview(resultado);
    if (resultado.atualizar.length === 0) {
      toast.warning('Nada para atualizar com os dados colados.');
    } else {
      toast.success(`Pré-validação ok: ${resultado.atualizar.length} cliente(s) serão atualizados.`);
    }
  };

  const handleAtualizar = async () => {
    if (!preview || preview.atualizar.length === 0) return;
    setLoading(true);
    let sucessos = 0;
    let erros = 0;
    try {
      for (const item of preview.atualizar) {
        try {
          await base44.entities.Cliente.update(item.cliente.id, {
            modalidade_pagamento_id: item.modalidade.id,
          });
          sucessos++;
        } catch (err) {
          console.error('Erro atualizando cliente', item.cliente.id, err);
          erros++;
        }
      }
      queryClient.invalidateQueries(['clientes']);
      if (erros === 0) {
        toast.success(`✅ ${sucessos} cliente(s) atualizado(s) com sucesso.`);
        setTexto('');
        setPreview(null);
        onOpenChange(false);
      } else {
        toast.warning(`Atualizados: ${sucessos} | Erros: ${erros}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const fechar = (v) => {
    if (loading) return;
    onOpenChange(v);
    if (!v) {
      setTexto('');
      setPreview(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-cyan-600" />
            Atualizar Modalidade de Pagamento em Massa
          </DialogTitle>
          <DialogDescription>
            Cole duas colunas: <strong>código do cliente</strong> e <strong>nome da modalidade</strong>.
            Separadores aceitos: <code>TAB</code>, <code>;</code> ou <code>,</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert className="border-cyan-200 bg-cyan-50 text-cyan-900">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Modalidades disponíveis</AlertTitle>
            <AlertDescription>
              {modalidades.length === 0
                ? 'Nenhuma modalidade cadastrada.'
                : modalidades.map((m) => m.nome).join(' • ')}
            </AlertDescription>
          </Alert>

          <Textarea
            rows={10}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setPreview(null);
            }}
            placeholder={`Exemplo:\n20070;BOLETO BANCARIO\n3117\tPIX\n2453,DINHEIRO`}
            className="font-mono text-sm"
            disabled={loading}
          />

          {preview && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center gap-2 font-semibold text-slate-900">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                Resumo da leitura
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div><span className="text-slate-500">Linhas</span><div className="font-bold">{preview.totalLinhas}</div></div>
                <div><span className="text-slate-500">Para atualizar</span><div className="font-bold text-cyan-700">{preview.atualizar.length}</div></div>
                <div><span className="text-slate-500">Sem alteração</span><div className="font-bold">{preview.semAlteracao}</div></div>
                <div><span className="text-slate-500">Não encontrados</span><div className="font-bold text-amber-700">{preview.naoEncontrados}</div></div>
                <div><span className="text-slate-500">Modalidade inválida</span><div className="font-bold text-red-700">{preview.modalidadesInvalidas}</div></div>
              </div>
              {preview.atualizar.length > 0 && (
                <div className="max-h-40 overflow-auto rounded-lg bg-white border border-slate-200">
                  {preview.atualizar.slice(0, 10).map((item, i) => (
                    <div key={`${item.codigo}-${i}`} className="p-2 border-b last:border-b-0 text-xs">
                      <strong>{item.codigo}</strong> — {item.cliente.razao_social || item.cliente.nome_fantasia} → <span className="text-cyan-700">{item.modalidade.nome}</span>
                    </div>
                  ))}
                  {preview.atualizar.length > 10 && (
                    <div className="p-2 text-xs text-slate-500 italic">... e mais {preview.atualizar.length - 10}</div>
                  )}
                </div>
              )}
              {(preview.naoEncontrados > 0 || preview.modalidadesInvalidas > 0) && (
                <div className="max-h-32 overflow-auto rounded-lg bg-red-50 border border-red-200 p-2 text-xs space-y-1">
                  {preview.itens.filter(i => i.status === 'nao_encontrado').slice(0, 5).map((i, idx) => (
                    <div key={`ne-${idx}`} className="text-red-700">Código <strong>{i.codigo}</strong> não encontrado</div>
                  ))}
                  {preview.itens.filter(i => i.status === 'modalidade_invalida').slice(0, 5).map((i, idx) => (
                    <div key={`mi-${idx}`} className="text-red-700">Modalidade <strong>{i.nomeModalidade}</strong> não existe</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => fechar(false)} disabled={loading}>Fechar</Button>
          <Button variant="outline" onClick={handlePreValidar} disabled={loading || !texto.trim()}>
            Pré-validar
          </Button>
          <Button
            onClick={handleAtualizar}
            disabled={loading || !preview || preview.atualizar.length === 0}
            className="bg-cyan-600 hover:bg-cyan-700"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Atualizar {preview ? `(${preview.atualizar.length})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}