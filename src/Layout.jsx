import React, { useState, useEffect, useMemo } from 'react';
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
  TrendingUp,
  Shield,
  Hexagon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import HoneycombBackground from '@/components/ui/HoneycombBackground';

export default function Layout({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [userPermissions, setUserPermissions] = useState(null);
  const [funcionarioAtual, setFuncionarioAtual] = useState(null);

  const { data: permissoes = [] } = useQuery({
    queryKey: ['permissoes'],
    queryFn: () => base44.entities.Permissao.list()
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list()
  });

  useEffect(() => {
    base44.auth.me().then(user => {
      setCurrentUser(user);
      const funcionario = vendedores.find(v => v.email?.toLowerCase() === user.email?.toLowerCase());
      setFuncionarioAtual(funcionario);
      if (funcionario) {
        const perm = permissoes.find(p => p.vendedor_id === funcionario.id);
        setUserPermissions(perm);
      }
    }).catch(() => {});
  }, [permissoes, vendedores]);

  const isAdmin = currentUser?.role === 'admin';
  
  const canViewPage = (pagePath) => {
    if (isAdmin) return true;
    if (!userPermissions) return false;
    return userPermissions.abas_visiveis?.includes(pagePath) || false;
  };

  const menuItems = useMemo(() => {
    const allMenuItems = [
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
          { title: 'Ocorrências - Motivos', path: 'MotivosTroca' },
          { title: 'Planos de Pagamento', path: 'PlanosPagamento' },
          { title: 'Unidades de Medida', path: 'UnidadesMedida' },
          { title: 'Rotas', path: 'Rotas' },
          { title: 'Roteiros', path: 'Roteiros' }
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
          { title: 'Dashboard Clientes', path: 'DashboardClientes' },
          { title: 'Análise de Visitas', path: 'AnaliseVisitas' },
          { title: 'Mapa de Visitas', path: 'MapaVendas' }
        ]
      },
      {
        title: 'Relatórios',
        icon: FileSpreadsheet,
        submenu: [
          { title: 'Roteiros/Visitas', path: 'RelatorioRoteiros' },
          { title: 'Estoque', path: 'RelatorioEstoque' },
          { title: 'Trocas', path: 'RelatorioTrocas' }
        ]
      },
      {
        title: 'Visitas',
        icon: TrendingUp,
        submenu: [
          { title: 'Meus Roteiros', path: 'MeusRoteiros' },
          { title: 'Painel de Roteiros', path: 'PainelGestorVisita' }
        ]
      }
    ];

    if (isAdmin) {
      allMenuItems.push({
        title: 'Permissões',
        icon: Shield,
        path: 'Permissoes'
      });
    }

    return allMenuItems.map(item => {
      if (item.submenu) {
        const filteredSubmenu = item.submenu.filter(sub => canViewPage(sub.path));
        return filteredSubmenu.length > 0 ? { ...item, submenu: filteredSubmenu } : null;
      }
      return canViewPage(item.path) ? item : null;
    }).filter(Boolean);
  }, [userPermissions, isAdmin]);

  const toggleSubmenu = (title) => {
    setExpandedMenus(prev =>
      prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
    );
  };

  const isActiveRoute = (path) => currentPageName === path;

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 relative">
      {/* Fundo de Colmeia Animado */}
      <HoneycombBackground intensity="light" />

      <style>{`
        :root {
          --primary: 45 100% 51%;
          --primary-foreground: 0 0% 0%;
          --accent: 38 92% 50%;
        }

        .sidebar-gradient {
          background: linear-gradient(180deg, #1a1a1a 0%, #262626 50%, #1f1f1f 100%);
        }

        .sidebar-honeycomb {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd'%3E%3Cg id='hexagons' fill='%23f59e0b' fill-opacity='0.03' fill-rule='nonzero'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
        }

        .menu-item-active {
          background: linear-gradient(90deg, rgba(245,158,11,0.3) 0%, rgba(245,158,11,0.1) 100%);
          border-left: 4px solid #f59e0b;
          box-shadow: inset 0 0 20px rgba(245,158,11,0.1);
        }

        .menu-item-hover:hover {
          background: linear-gradient(90deg, rgba(245,158,11,0.2) 0%, rgba(245,158,11,0.05) 100%);
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-5px); }
        }

        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }

        .animate-fade-in {
          animation: fadeIn 0.4s ease-out;
        }

        .animate-float {
          animation: float 3s ease-in-out infinite;
        }

        .btn-pao-mel {
          background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #d97706 100%);
          color: #1a1a1a;
          box-shadow: 0 4px 20px rgba(245,158,11,0.4);
        }

        .btn-pao-mel:hover {
          background: linear-gradient(135deg, #fcd34d 0%, #fbbf24 50%, #f59e0b 100%);
          box-shadow: 0 6px 25px rgba(245,158,11,0.5);
          transform: translateY(-1px);
        }

        .honey-glow {
          box-shadow: 0 0 40px rgba(245,158,11,0.15);
        }

        .honey-text {
          background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 50%, #f59e0b 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 3s linear infinite;
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
        fixed top-0 left-0 h-full w-72 sidebar-gradient sidebar-honeycomb z-40 
        transform transition-transform duration-300 ease-out
        lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        shadow-2xl border-r border-amber-500/10
      `}>
        {/* Logo com decoração hexagonal */}
        <div className="h-28 flex items-center justify-center px-6 border-b border-amber-500/20 bg-gradient-to-b from-neutral-800/50 to-transparent relative overflow-hidden">
          {/* Hexágonos decorativos */}
          <svg className="absolute -left-4 -top-4 w-16 h-18 opacity-10" viewBox="0 0 100 115.47">
            <polygon points="50,0 100,28.87 100,86.60 50,115.47 0,86.60 0,28.87" fill="#f59e0b"/>
          </svg>
          <svg className="absolute -right-6 -bottom-6 w-20 h-22 opacity-10" viewBox="0 0 100 115.47">
            <polygon points="50,0 100,28.87 100,86.60 50,115.47 0,86.60 0,28.87" fill="#f59e0b"/>
          </svg>

          <div className="relative animate-float">
            <img 
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6926e3c1dcadc4e314506362/7c2bd1831_8297750cb_cropped-cropped-logo.png" 
              alt="Pão & Mel" 
              className="h-18 w-auto drop-shadow-lg"
              style={{ filter: 'drop-shadow(0 4px 20px rgba(245,158,11,0.3))' }}
            />
          </div>
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
                      flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold
                      transition-all duration-300 menu-item-hover group
                      ${isActiveRoute(item.path)
                        ? 'menu-item-active text-amber-400'
                        : 'text-neutral-300 hover:text-amber-300'
                      }
                    `}
                  >
                    <div className={`p-1.5 rounded-lg transition-all duration-300 ${isActiveRoute(item.path) ? 'bg-amber-500/20' : 'group-hover:bg-amber-500/10'}`}>
                      <item.icon className="w-5 h-5" />
                    </div>
                    {item.title}
                  </Link>
                ) : (
                  <>
                    <button
                      onClick={() => toggleSubmenu(item.title)}
                      className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl text-sm font-semibold text-neutral-300 hover:text-amber-300 menu-item-hover transition-all duration-300 group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-1.5 rounded-lg transition-all duration-300 group-hover:bg-amber-500/10">
                          <item.icon className="w-5 h-5" />
                        </div>
                        {item.title}
                      </div>
                      <div className={`transition-transform duration-300 ${expandedMenus.includes(item.title) ? 'rotate-180' : ''}`}>
                        <ChevronDown className="w-4 h-4" />
                      </div>
                    </button>
                    {expandedMenus.includes(item.title) && (
                      <ul className="mt-2 ml-4 pl-4 border-l-2 border-amber-500/30 space-y-1">
                        {item.submenu.map((subItem) => (
                          <li key={subItem.path}>
                            <Link
                              to={createPageUrl(subItem.path)}
                              onClick={() => setSidebarOpen(false)}
                              className={`
                                block px-4 py-2.5 rounded-lg text-sm font-medium
                                transition-all duration-300
                                ${isActiveRoute(subItem.path)
                                  ? 'text-amber-400 bg-amber-500/20 shadow-inner'
                                  : 'text-neutral-400 hover:text-amber-300 hover:bg-amber-500/10'
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
      <main className="lg:ml-72 min-h-screen pt-16 lg:pt-0 relative">
        <div className="p-4 md:p-6 lg:p-8 animate-fade-in relative z-10">
          {children}
        </div>
      </main>
      </div>
      );
      }