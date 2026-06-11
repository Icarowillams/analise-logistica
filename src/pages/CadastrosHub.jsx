import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import {
  Search, Settings, ChevronRight,
  ShoppingCart, Users, Truck, Briefcase, FileText,
  Package, Tags, Ruler, DollarSign, CreditCard, Target,
  UserCircle, ClipboardList, UserPlus, UserCog, Tag, Network, AlertTriangle,
  Map, Route as RouteIcon, Car, User, Building2, Receipt, ScrollText
} from 'lucide-react';
import { Input } from '@/components/ui/input';

// Estrutura de categorias — 5 grupos por domínio de negócio.
const CATEGORIAS = [
  {
    titulo: 'Comercial',
    icon: ShoppingCart,
    cor: 'emerald',
    itens: [
      { label: 'Produtos', path: 'Produtos', icon: Package },
      { label: 'Categorias', path: 'Categorias', icon: Tags },
      { label: 'Unidades de Medida', path: 'UnidadesMedida', icon: Ruler },
      { label: 'Tabelas de Preço', path: 'TabelasPreco', icon: DollarSign },
      { label: 'Planos de Pagamento', path: 'PlanosPagamento', icon: CreditCard },
      { label: 'Cadastro de Metas', path: 'Metas', icon: Target },
    ],
  },
  {
    titulo: 'Clientes & Vendas',
    icon: Users,
    cor: 'blue',
    itens: [
      { label: 'Clientes', path: 'Clientes', icon: UserCircle },
      { label: 'Consulta de Clientes', path: 'ConsultaClientes', icon: ClipboardList },
      { label: 'Pré-Cadastros', path: 'PreCadastros', icon: UserPlus },
      { label: 'Vendedores', path: 'Vendedores', icon: UserCog },
      { label: 'Segmentos', path: 'Segmentos', icon: Tag },
      { label: 'Redes', path: 'Redes', icon: Network },
      { label: 'Ocorrências - Motivos', path: 'MotivosTroca', icon: AlertTriangle },
    ],
  },
  {
    titulo: 'Logística',
    icon: Truck,
    cor: 'orange',
    itens: [
      { label: 'Rotas', path: 'Rotas', icon: Map },
      { label: 'Roteiros', path: 'GestaoRoteiros', icon: RouteIcon },
      { label: 'Veículos', path: 'Veiculos', icon: Car },
      { label: 'Motoristas', path: 'Motoristas', icon: User },
    ],
  },
  {
    titulo: 'Equipe',
    icon: Briefcase,
    cor: 'violet',
    itens: [
      { label: 'Funcionários', path: 'Funcionarios', icon: Users },
      { label: 'Funções/Departamentos', path: 'Funcoes', icon: Briefcase },
    ],
  },
  {
    titulo: 'Fiscal',
    icon: FileText,
    cor: 'rose',
    itens: [
      { label: 'Cenários Fiscais', path: 'CenariosFiscais', icon: Receipt },
      { label: 'Cenários Fiscais Locais', path: 'CenariosFiscaisLocais', icon: ScrollText },
      { label: 'Empresa', path: 'Empresa', icon: Building2 },
    ],
  },
];

const CORES = {
  emerald: { bg: 'bg-emerald-100', text: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700', hover: 'hover:bg-emerald-50' },
  blue: { bg: 'bg-blue-100', text: 'text-blue-600', badge: 'bg-blue-50 text-blue-700', hover: 'hover:bg-blue-50' },
  orange: { bg: 'bg-orange-100', text: 'text-orange-600', badge: 'bg-orange-50 text-orange-700', hover: 'hover:bg-orange-50' },
  violet: { bg: 'bg-violet-100', text: 'text-violet-600', badge: 'bg-violet-50 text-violet-700', hover: 'hover:bg-violet-50' },
  rose: { bg: 'bg-rose-100', text: 'text-rose-600', badge: 'bg-rose-50 text-rose-700', hover: 'hover:bg-rose-50' },
};

export default function CadastrosHub() {
  const [busca, setBusca] = useState('');

  const categoriasFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return CATEGORIAS;
    return CATEGORIAS
      .map((cat) => ({
        ...cat,
        itens: cat.itens.filter((i) => i.label.toLowerCase().includes(termo)),
      }))
      .filter((cat) => cat.itens.length > 0);
  }, [busca]);

  const totalItens = useMemo(
    () => categoriasFiltradas.reduce((acc, c) => acc + c.itens.length, 0),
    [categoriasFiltradas]
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3 sm:gap-4">
        <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center shadow-lg shadow-amber-500/30 shrink-0">
          <Settings className="h-5 w-5 sm:h-6 sm:w-6 text-neutral-900" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-neutral-900 tracking-tight">Cadastros</h1>
          <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">Gerencie todos os cadastros do sistema</p>
        </div>
      </div>

      {/* Busca */}
      <div className="relative mb-8 max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar cadastro..."
          className="pl-9 h-11 bg-white"
        />
      </div>

      {/* Grid de categorias */}
      {categoriasFiltradas.length === 0 ? (
        <div className="text-center py-16 text-neutral-400">
          <Search className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p>Nenhum cadastro encontrado para "{busca}".</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-start">
          {categoriasFiltradas.map((cat) => {
            const c = CORES[cat.cor];
            const CatIcon = cat.icon;
            return (
              <div
                key={cat.titulo}
                className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-5 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className={`h-10 w-10 rounded-xl ${c.bg} flex items-center justify-center shrink-0`}>
                    <CatIcon className={`h-5 w-5 ${c.text}`} />
                  </div>
                  <h2 className="font-semibold text-neutral-900 flex-1">{cat.titulo}</h2>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.badge}`}>
                    {cat.itens.length}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {cat.itens.map((item) => {
                    const ItemIcon = item.icon;
                    return (
                      <Link
                        key={item.path}
                        to={createPageUrl(item.path)}
                        className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-700 transition-colors ${c.hover}`}
                      >
                        <ItemIcon className="h-4 w-4 text-neutral-400 shrink-0" />
                        <span className="flex-1 truncate">{item.label}</span>
                        <ChevronRight className="h-4 w-4 text-neutral-300 group-hover:text-neutral-500 transition-colors" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {busca && (
        <p className="text-xs text-neutral-400 mt-6">
          {totalItens} {totalItens === 1 ? 'resultado' : 'resultados'} para "{busca}".
        </p>
      )}
    </div>
  );
}
