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
      { title: 'Importar Vendas', path: 'ImportarVendas' }
    ]
  },
  {
    title: 'Cadastros',
    icon: Settings,
    submenu: [
      { title: 'Funcionários', path: 'Funcionarios' },
      { title: 'Funções/Departamentos', path: 'Funcoes' },
      { title: 'Produtos', path: 'Produtos' },
      { title: 'Categorias', path: 'Categorias' },
      { title: 'Tabelas de Preço', path: 'TabelasPreco' },
      { title: 'Clientes', path: 'Clientes' },
      { title: 'Segmentos', path: 'Segmentos' },
      { title: 'Redes', path: 'Redes' },
      { title: 'Ocorrência de Troca', path: 'MotivosTroca' },
      { title: 'Planos de Pagamento', path: 'PlanosPagamento' },
      { title: 'Unidades de Medida', path: 'UnidadesMedida' },
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
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50">
      <style>{`
        :root {
          --primary: 45 100% 51%;
          --primary-foreground: 0 0% 0%;
          --accent: 0 72% 51%;
        }
        
        .sidebar-gradient {
          background: linear-gradient(180deg, #1a1a1a 0%, #2d2d2d 50%, #3d3d3d 100%);
        }
        
        .menu-item-active {
          background: linear-gradient(90deg, rgba(250,204,21,0.25) 0%, rgba(250,204,21,0.1) 100%);
          border-left: 3px solid #facc15;
        }
        
        .menu-item-hover:hover {
          background: linear-gradient(90deg, rgba(250,204,21,0.15) 0%, rgba(250,204,21,0.05) 100%);
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .animate-fade-in {
          animation: fadeIn 0.3s ease-out;
        }
        
        .btn-pao-mel {
          background: linear-gradient(135deg, #facc15 0%, #f59e0b 100%);
          color: #1a1a1a;
        }
        
        .btn-pao-mel:hover {
          background: linear-gradient(135deg, #fbbf24 0%, #d97706 100%);
        }
      `}</style>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-neutral-900 z-50 flex items-center justify-between px-4 shadow-xl">
        <div className="flex items-center gap-3">
          <img 
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6926e3c1dcadc4e314506362/7c2bd1831_8297750cb_cropped-cropped-logo.png" 
            alt="Pão & Mel" 
            className="h-10 w-auto"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="text-white hover:bg-neutral-800"
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
        <div className="h-24 flex items-center justify-center px-6 border-b border-neutral-700/50 bg-white/5">
          <img 
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6926e3c1dcadc4e314506362/7c2bd1831_8297750cb_cropped-cropped-logo.png" 
            alt="Pão & Mel" 
            className="h-16 w-auto"
          />
        </div>

        {/* Navigation */}
        <nav className="p-4 h-[calc(100%-6rem)] overflow-y-auto">
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
                        ? 'menu-item-active text-yellow-400'
                        : 'text-neutral-300 hover:text-yellow-300'
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
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium text-neutral-300 hover:text-yellow-300 menu-item-hover transition-all duration-200"
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
                      <ul className="mt-1 ml-4 pl-4 border-l border-neutral-700/50 space-y-1">
                        {item.submenu.map((subItem) => (
                          <li key={subItem.path}>
                            <Link
                              to={createPageUrl(subItem.path)}
                              onClick={() => setSidebarOpen(false)}
                              className={`
                                block px-4 py-2.5 rounded-lg text-sm
                                transition-all duration-200
                                ${isActiveRoute(subItem.path)
                                  ? 'text-yellow-400 bg-yellow-500/15 font-medium'
                                  : 'text-neutral-400 hover:text-yellow-300 hover:bg-neutral-700/30'
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