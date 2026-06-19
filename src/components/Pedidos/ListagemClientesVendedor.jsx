import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Printer, Search, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

// Dados fixos da empresa (fallback caso ConfiguracaoOmie/Empresa não tenham)
const EMPRESA_FALLBACK = {
  razao_social: 'PAO E MEL INDUSTRIA DE PANIFICACAO LTDA',
  cnpj: '26.946.943/0001-03',
  inscricao_estadual: '070470707',
  endereco: 'ROD PE 20, 0 - TIUMA - SAO LOURENCO DA MATA/PE',
  cep: '54749-000',
  telefone: '(81)3454-7552'
};

const DIAS_ORDEM = [
  { key: 'segunda', label: 'Segunda-feira' },
  { key: 'terca', label: 'Terça-feira' },
  { key: 'quarta', label: 'Quarta-feira' },
  { key: 'quinta', label: 'Quinta-feira' },
  { key: 'sexta', label: 'Sexta-feira' },
  { key: 'sabado', label: 'Sábado' },
  { key: 'domingo', label: 'Domingo' }
];

// Remove prefixo [NNNNN] do início do nome fantasia
const limparFantasia = (txt) => {
  if (!txt) return '';
  return txt.replace(/^\s*\[\d+\]\s*/, '').trim();
};

const montarEndereco = (c) => {
  const partes = [];
  const linha1 = [c.endereco, c.numero].filter(Boolean).join(', ');
  if (linha1) partes.push(linha1);
  if (c.bairro) partes.push(c.bairro);
  const cidadeUf = [c.cidade, c.estado].filter(Boolean).join('/');
  if (cidadeUf) partes.push(cidadeUf);
  return partes.join(' - ');
};

const telefoneCliente = (c) => c.telefone || c.telefone_2 || c.whatsapp || '';

const printStyles = `
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #000; padding: 16px; }
.header-box { border:1px solid #000; padding:6px 8px; margin-bottom:8px; }
.titulo-faixa { background:#3b6fb5; color:#fff; font-weight:700; padding:4px 8px; font-size:12px; }
.empresa-linha { font-size:10px; line-height:1.5; }
.empresa-linha b { font-weight:700; }
.vendedor-titulo { font-weight:700; font-size:13px; margin:10px 0 4px; }
.dia-titulo { border:1px solid #000; padding:3px 8px; font-weight:700; font-size:11px; margin:8px 0 2px; display:inline-block; min-width:160px; }
.cliente-row { border-bottom:1px solid #000; padding:3px 0; }
.cliente-linha1 { display:flex; justify-content:space-between; align-items:baseline; font-weight:700; font-size:11px; }
.cliente-nome { flex:1; }
.cliente-fantasia { width:230px; text-align:left; }
.cliente-tel { width:110px; text-align:right; font-weight:400; }
.cliente-end { font-size:9.5px; color:#222; margin-top:1px; }
.rodape { display:flex; justify-content:space-between; margin-top:14px; font-size:11px; font-weight:700; border-top:1px solid #000; padding-top:4px; }
`;

export default function ListagemClientesVendedor() {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState('');
  const [vendedorId, setVendedorId] = useState('');
  const [ordenacao, setOrdenacao] = useState('dia'); // 'dia' | 'alfabetica'
  const [diaSemana, setDiaSemana] = useState('todos'); // 'todos' | <dia> | 'sem_dia'
  const [gerando, setGerando] = useState(false);

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ['empresa-listagem'],
    queryFn: () => base44.entities.Empresa.list(),
    staleTime: 10 * 60 * 1000
  });

  const vendedoresAtivos = useMemo(() => {
    return vendedores
      .filter(v => v.status !== 'inativo' && v.nome)
      .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  }, [vendedores]);

  const vendedoresFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return vendedoresAtivos;
    return vendedoresAtivos.filter(v => (v.nome || '').toLowerCase().includes(termo));
  }, [vendedoresAtivos, busca]);

  const empresa = useMemo(() => {
    const e = empresas[0] || {};
    return {
      razao_social: e.razao_social || EMPRESA_FALLBACK.razao_social,
      cnpj: e.cnpj || EMPRESA_FALLBACK.cnpj,
      inscricao_estadual: e.inscricao_estadual || EMPRESA_FALLBACK.inscricao_estadual,
      endereco: e.endereco
        ? [e.endereco, e.numero, e.bairro, e.cidade && `${e.cidade}/${e.estado || ''}`].filter(Boolean).join(' - ')
        : EMPRESA_FALLBACK.endereco,
      cep: e.cep || EMPRESA_FALLBACK.cep,
      telefone: e.telefone || EMPRESA_FALLBACK.telefone
    };
  }, [empresas]);

  const gerarRelatorio = async () => {
    const vendedor = vendedoresAtivos.find(v => v.id === vendedorId);
    if (!vendedor) {
      alert('Selecione um vendedor.');
      return;
    }
    setGerando(true);
    try {
      const clientes = await base44.entities.Cliente.filter({
        vendedor_id: vendedor.id,
        status: 'ativo'
      });

      const ordenados = [...clientes].sort((a, b) =>
        (a.razao_social || '').localeCompare(b.razao_social || '', 'pt-BR')
      );

      const html = montarHtml(vendedor, ordenados);
      const win = window.open('', '_blank');
      if (!win) {
        alert('Permita pop-ups para imprimir o relatório.');
        return;
      }
      win.document.write(html);
      win.document.close();
      setTimeout(() => { win.focus(); win.print(); }, 400);
      setOpen(false);
    } finally {
      setGerando(false);
    }
  };

  const montarItemCliente = (c) => {
    const codigo = c.codigo_interno || c.codigo_omie || '';
    const razao = (c.razao_social || '').toUpperCase();
    const fantasia = limparFantasia(c.nome_fantasia);
    const tel = telefoneCliente(c);
    const end = montarEndereco(c);
    return `
      <div class="cliente-row">
        <div class="cliente-linha1">
          <span class="cliente-nome">${codigo ? codigo + ' - ' : ''}${razao}</span>
          <span class="cliente-fantasia">${fantasia ? '- ' + fantasia : ''}</span>
          <span class="cliente-tel">${tel}</span>
        </div>
        <div class="cliente-end">${end}</div>
      </div>`;
  };

  const montarHtml = (vendedor, clientesTodos) => {
    const diaEspecifico = diaSemana !== 'todos';
    const labelDia = diaSemana === 'sem_dia'
      ? 'Sem dia definido'
      : (DIAS_ORDEM.find(d => d.key === diaSemana)?.label || '');

    // Filtra os clientes pelo dia escolhido (quando não for "todos")
    const clientes = !diaEspecifico
      ? clientesTodos
      : clientesTodos.filter(c => {
          const dias = Array.isArray(c.dias_visita) ? c.dias_visita : [];
          return diaSemana === 'sem_dia' ? dias.length === 0 : dias.includes(diaSemana);
        });

    // Quando um dia específico é escolhido, agrupar por dia não faz sentido (já é uma seção única).
    const agrupado = ordenacao === 'dia' && !diaEspecifico;
    const tituloModo = diaEspecifico
      ? labelDia
      : (ordenacao === 'dia' ? 'Agrupado por dia da semana' : 'Ordem Alfabética');
    const agora = new Date();
    const dtEmissao = `${agora.toLocaleDateString('pt-BR')} - ${agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

    let corpo = '';
    if (agrupado) {
      // monta grupos por dia; cliente com vários dias aparece em cada
      const grupos = {};
      const semDia = [];
      DIAS_ORDEM.forEach(d => { grupos[d.key] = []; });
      clientes.forEach(c => {
        const dias = Array.isArray(c.dias_visita) ? c.dias_visita : [];
        if (dias.length === 0) {
          semDia.push(c);
        } else {
          dias.forEach(d => {
            if (grupos[d]) grupos[d].push(c);
            else semDia.push(c);
          });
        }
      });
      DIAS_ORDEM.forEach(d => {
        if (grupos[d.key].length > 0) {
          corpo += `<div class="dia-titulo">${d.label}</div>`;
          grupos[d.key].forEach(c => { corpo += montarItemCliente(c); });
        }
      });
      if (semDia.length > 0) {
        corpo += `<div class="dia-titulo">Sem dia definido</div>`;
        semDia.forEach(c => { corpo += montarItemCliente(c); });
      }
    } else {
      clientes.forEach(c => { corpo += montarItemCliente(c); });
    }

    const codVend = vendedor.codigo_interno || vendedor.codigo || '';
    return `<html><head><title>Listagem_Clientes_${vendedor.nome}</title><meta charset="utf-8" /><style>${printStyles}</style></head>
    <body>
      <div class="titulo-faixa">Listagem de Clientes por Vendedor - ${tituloModo}</div>
      <div class="header-box">
        <div class="empresa-linha"><b>Empresa:</b> ${empresa.razao_social} <b>CNPJ:</b> ${empresa.cnpj} &nbsp;&nbsp; <b>Insc. Estadual:</b> ${empresa.inscricao_estadual}</div>
        <div class="empresa-linha"><b>Endereço:</b> ${empresa.endereco} CEP ${empresa.cep}</div>
        <div class="empresa-linha"><b>Fone:</b> ${empresa.telefone} &nbsp;&nbsp; <b>Dt Emissão:</b> ${dtEmissao}</div>
      </div>
      <div class="vendedor-titulo">VENDEDOR: ${codVend ? codVend + ' - ' : ''}${(vendedor.nome || '').toUpperCase()}</div>
      ${corpo || '<div style="padding:20px;text-align:center;">Nenhum cliente ativo encontrado para este vendedor.</div>'}
      <div class="rodape">
        <span>Clientes Listados: ${clientes.length}</span>
        <span>Pág. 1</span>
      </div>
    </body></html>`;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 w-auto h-9 px-3 sm:px-4 text-xs sm:text-sm">
          <Printer className="w-4 h-4 shrink-0" />
          <span className="hidden sm:inline">Imprimir Listagem de Clientes</span>
          <span className="inline sm:hidden">Imprimir Listagem</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-blue-600" />
            Imprimir Listagem de Clientes por Vendedor
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label>Vendedor</Label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Buscar vendedor por nome..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-52 overflow-y-auto border rounded-md divide-y">
              {vendedoresFiltrados.length === 0 && (
                <div className="px-3 py-3 text-sm text-slate-500">Nenhum vendedor encontrado.</div>
              )}
              {vendedoresFiltrados.map(v => (
                <button
                  key={v.id}
                  onClick={() => setVendedorId(v.id)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${vendedorId === v.id ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-slate-50'}`}
                >
                  {v.codigo_interno || v.codigo ? `${v.codigo_interno || v.codigo} - ` : ''}{v.nome}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Dia da semana</Label>
            <select
              value={diaSemana}
              onChange={(e) => setDiaSemana(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="todos">Todos os dias</option>
              {DIAS_ORDEM.map(d => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
              <option value="sem_dia">Sem dia definido</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label>Ordenação</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setOrdenacao('dia')}
                className={`px-3 py-2 rounded-md border text-sm transition-colors ${ordenacao === 'dia' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-slate-50'}`}
              >
                Agrupado por dia da semana
              </button>
              <button
                onClick={() => setOrdenacao('alfabetica')}
                className={`px-3 py-2 rounded-md border text-sm transition-colors ${ordenacao === 'alfabetica' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white hover:bg-slate-50'}`}
              >
                Lista alfabética
              </button>
            </div>
          </div>

          <Button
            onClick={gerarRelatorio}
            disabled={!vendedorId || gerando}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
          >
            {gerando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Printer className="w-4 h-4 mr-2" />}
            {gerando ? 'Gerando...' : 'Gerar / Imprimir'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}