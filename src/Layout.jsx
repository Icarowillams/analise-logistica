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
  Languages,
  HelpCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

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
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 honeycomb-bg" translate="no" lang="pt-BR">
      <style>{`
        :root {
          --primary: 45 100% 51%;
          --primary-foreground: 0 0% 0%;
          --accent: 0 72% 51%;
        }
        
        .honeycomb-bg {
          background-color: #fefce8;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='49' viewBox='0 0 28 49'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='%23f59e0b' fill-opacity='0.08'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9zM0 15l12.98-7.5V0h-2v6.35L0 12.69v2.3zm0 18.5L12.98 41v8h-2v-6.85L0 35.81v-2.3zM15 0v7.5L27.99 15H28v-2.31h-.01L17 6.35V0h-2zm0 49v-8l12.99-7.5H28v2.31h-.01L17 42.15V49h-2z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
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
        
        .hexagon-icon {
          clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
        }
      `}</style>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-neutral-900 z-50 flex items-center justify-between px-3 shadow-xl">
        <div className="flex items-center gap-2">
          <img 
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6926e3c1dcadc4e314506362/7c2bd1831_8297750cb_cropped-cropped-logo.png" 
            alt="Pão & Mel" 
            className="h-8 w-auto"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="text-white hover:bg-neutral-800 h-9 w-9"
        >
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
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
        <div className="h-40 flex items-center justify-center px-6 border-b border-neutral-700/50 bg-white/5">
          <img 
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6926e3c1dcadc4e314506362/7c2bd1831_8297750cb_cropped-cropped-logo.png" 
            alt="Pão & Mel" 
            className="h-28 w-auto"
          />
        </div>

        {/* User Info & Logout */}
        <div className="px-4 py-3 border-b border-neutral-700/50">
          <div className="flex items-center justify-between">
            <div className="text-sm text-neutral-400 truncate flex-1 mr-2">
              {currentUser?.email}
            </div>
            <div className="flex items-center gap-1">
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-neutral-400 hover:text-yellow-400 hover:bg-yellow-500/10"
                  >
                    <HelpCircle className="w-4 h-4" />
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Languages className="w-5 h-5 text-yellow-500" />
                      Desativar Tradução Automática
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 mt-4">
                    <p className="text-sm text-slate-600">
                      Se o navegador está traduzindo esta página automaticamente, clique no botão abaixo para tentar desativar.
                    </p>
                    
                    <Button 
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={() => {
                        // Força o idioma para português no HTML
                        document.documentElement.lang = 'pt-BR';
                        document.documentElement.setAttribute('translate', 'no');
                        document.body.setAttribute('translate', 'no');
                        
                        // Adiciona classe do Google Translate para não traduzir
                        document.body.classList.add('notranslate');
                        document.documentElement.classList.add('notranslate');
                        
                        // Tenta remover elementos do Google Translate se existirem
                        const gtElements = document.querySelectorAll('.goog-te-banner-frame, .skiptranslate, #goog-gt-tt');
                        gtElements.forEach(el => el.remove());
                        
                        // Adiciona meta tag se não existir
                        if (!document.querySelector('meta[name="google"]')) {
                          const meta = document.createElement('meta');
                          meta.name = 'google';
                          meta.content = 'notranslate';
                          document.head.appendChild(meta);
                        }
                        
                        alert('Tradução desativada! Se ainda aparecer, siga as instruções abaixo.');
                      }}
                    >
                      <Languages className="w-4 h-4 mr-2" />
                      Desativar Tradução Agora
                    </Button>
                    
                    <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                      <p className="text-sm font-medium text-slate-700 mb-2">Se não funcionar, faça manualmente:</p>
                      <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
                        <li>Clique no ícone do Google Tradutor na barra</li>
                        <li>Selecione <strong>"Nunca traduzir este site"</strong></li>
                      </ol>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => base44.auth.logout()}
                className="text-neutral-400 hover:text-red-400 hover:bg-red-500/10"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="p-4 h-[calc(100%-13rem)] overflow-y-auto">
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
                    <div className="w-8 h-8 flex items-center justify-center bg-neutral-700/50 hexagon-icon">
                      <item.icon className="w-4 h-4" />
                    </div>
                    {item.title}
                  </Link>
                ) : (
                  <>
                    <button
                      onClick={() => toggleSubmenu(item.title)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium text-neutral-300 hover:text-yellow-300 menu-item-hover transition-all duration-200"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 flex items-center justify-center bg-neutral-700/50 hexagon-icon">
                          <item.icon className="w-4 h-4" />
                        </div>
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
      <main className="lg:ml-72 min-h-screen pt-14 lg:pt-0">
        <div className="p-3 sm:p-4 md:p-6 lg:p-8 animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}