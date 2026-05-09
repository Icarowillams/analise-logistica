import React from 'react';
import { useLocation } from 'react-router-dom';
import PageHeader from '@/components/ui/PageHeader';
import { ClipboardList, Package, ArrowLeftRight, FileText } from 'lucide-react';
import RelatorioRoteiros from '@/components/relatorios/RelatorioRoteiros';
import RelatorioEstoque from '@/components/relatorios/RelatorioEstoque';
import RelatorioTrocas from '@/components/relatorios/RelatorioTrocas';
import RotinaSupervisores from '@/components/relatorios/RotinaSupervisores';

export default function RelatoriosVisitas() {
  const { pathname } = useLocation();
  const sub = pathname.toLowerCase();

  if (sub.includes('estoque')) return <Page title="Relatório de Estoque" subtitle="" Icon={Package} corIcon="bg-slate-700"><RelatorioEstoque /></Page>;
  if (sub.includes('trocas')) return <Page title="Relatório de Trocas" subtitle="" Icon={ArrowLeftRight} corIcon="bg-rose-500"><RelatorioTrocas /></Page>;
  if (sub.includes('rotina') || sub.includes('supervis')) return <Page title="Rotina Supervisores" subtitle="Relatório de visitas realizadas pelos supervisores" Icon={FileText} corIcon="bg-amber-500"><RotinaSupervisores /></Page>;
  return <Page title="Relatório de Roteiros" subtitle="Por período e data específica" Icon={ClipboardList} corIcon="bg-blue-500"><RelatorioRoteiros /></Page>;
}

const Page = ({ title, subtitle, Icon, corIcon, children }) => (
  <div className="space-y-6">
    <div className="flex items-center gap-3 mb-4">
      <div className={`w-10 h-10 rounded-xl ${corIcon} flex items-center justify-center text-white shadow-lg`}><Icon className="w-5 h-5" /></div>
      <div><h1 className="text-2xl font-bold">{title}</h1>{subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}</div>
    </div>
    {children}
  </div>
);