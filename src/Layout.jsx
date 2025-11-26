import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from './utils';
import {
  LayoutDashboard,
  Users,
  Package,
  Building2,
  Network,
  Tag,
  CreditCard,
  Route,
  FileSpreadsheet,
  ArrowLeftRight,
  Target,
  BarChart3,
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  Upload,
  Settings,
  TrendingUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const menuItems = [
  {
    title: 'Dashboard',
    icon: LayoutDashboard,
    path: 'Dashboard'
  },
  {
    title: 'Importações',
    icon: Upload,
    submenu: [
      { title: 'Importar Vendas', path: 'ImportarVendas' },
      { title: 'Importar Trocas', path: 'ImportarTrocas' }
    ]
  },
  {
    title: 'Cadastros',
    icon: Settings,
    submenu: [
      { title: 'Vendedores', path: 'Vendedores' },
      { title: 'Produtos', path: 'Produtos' },
      { title: 'Clientes', path: 'Clientes' },
      { title: 'Segmentos', path: 'Segmentos' },
      { title: 'Redes/Franquias', path: 'Redes' },
      { title: 'Motivos de Troca', path: 'MotivosTroca' },
      { title: 'Planos de Pagamento', path: 'PlanosPagamento' },
      { title: 'Rotas', path: 'Rotas' }
    ]
  },
  {
    title: 'Metas',
    icon: Target,
    submenu: [
      { title: 'Meta por Produto', path: 'MetasProduto' },
      { title: 'Meta por Positivação', path: 'MetasPositivacao' },
      { title: 'Meta por Preço Médio', path: 'MetasPrecoMedio' },
      { title: 'Meta por Cadastro', path: 'MetasCadastro' },
      { title: 'Meta por Troca', path: 'MetasTroca' },
      { title: 'Painel Rodrigos', path: 'PainelRodrigosM' }
    ]
  },
  {
    title: 'Análises',
    icon: BarChart3,
    submenu: [
      { title: 'Dashboard Vendedor', path: 'DashboardVendedor' },
      { title: 'Dashboard Trocas', path: 'DashboardTrocas' },
      { title: 'Dashboard Clientes', path: 'DashboardClientes' }
    ]
  }
];

export default function Layout({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState(['Cadastros', 'Metas', 'Análises', 'Importações']);

  const toggleSubmenu = (title) => {
    setExpandedMenus(prev =>
      prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
    );
  };

  const isActiveRoute = (path) => currentPageName === path;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50">
      <style>{`
        :root {
          --primary: 220 90% 56%;
          --primary-foreground: 0 0% 100%;
          --accent: 262 83% 58%;
        }
        
        .sidebar-gradient {
          background: linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #334155 100%);
        }
        
        .menu-item-active {
          background: linear-gradient(90deg, rgba(99,102,241,0.2) 0%, rgba(99,102,241,0.1) 100%);
          border-left: 3px solid #6366f1;
        }
        
        .menu-item-hover:hover {
          background: linear-gradient(90deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%);
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .animate-fade-in {
          animation: fadeIn 0.3s ease-out;
        }
      `}</style>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-slate-900 z-50 flex items-center justify-between px-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <TrendingUp className="w-6 h-6 text-white" />
          </div>
          <span className="text-white font-bold text-lg">Análise Comercial</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="text-white hover:bg-slate-800"
        >
          {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </Button>
      </div>

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 h-full w-72 sidebar-gradient z-40 
        transform transition-transform duration-300 ease-out
        lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        shadow-2xl
      `}>
        {/* Logo */}
        <div className="h-20 flex items-center gap-3 px-6 border-b border-slate-700/50">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <TrendingUp className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold text-lg tracking-tight">Análise</h1>
            <p className="text-slate-400 text-xs">Comercial</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="p-4 h-[calc(100%-5rem)] overflow-y-auto">
          <ul className="space-y-1">
            {menuItems.map((item) => (
              <li key={item.title}>
                {item.path ? (
                  <Link
                    to={createPageUrl(item.path)}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium
                      transition-all duration-200 menu-item-hover
                      ${isActiveRoute(item.path)
                        ? 'menu-item-active text-white'
                        : 'text-slate-300 hover:text-white'
                      }
                    `}
                  >
                    <item.icon className="w-5 h-5" />
                    {item.title}
                  </Link>
                ) : (
                  <>
                    <button
                      onClick={() => toggleSubmenu(item.title)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium text-slate-300 hover:text-white menu-item-hover transition-all duration-200"
                    >
                      <div className="flex items-center gap-3">
                        <item.icon className="w-5 h-5" />
                        {item.title}
                      </div>
                      {expandedMenus.includes(item.title) 
                        ? <ChevronDown className="w-4 h-4" />
                        : <ChevronRight className="w-4 h-4" />
                      }
                    </button>
                    {expandedMenus.includes(item.title) && (
                      <ul className="mt-1 ml-4 pl-4 border-l border-slate-700/50 space-y-1">
                        {item.submenu.map((subItem) => (
                          <li key={subItem.path}>
                            <Link
                              to={createPageUrl(subItem.path)}
                              onClick={() => setSidebarOpen(false)}
                              className={`
                                block px-4 py-2.5 rounded-lg text-sm
                                transition-all duration-200
                                ${isActiveRoute(subItem.path)
                                  ? 'text-indigo-400 bg-indigo-500/10 font-medium'
                                  : 'text-slate-400 hover:text-white hover:bg-slate-700/30'
                                }
                              `}
                            >
                              {subItem.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <main className="lg:ml-72 min-h-screen pt-16 lg:pt-0">
        <div className="p-4 md:p-6 lg:p-8 animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}