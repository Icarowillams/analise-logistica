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
  HelpCircle,
  MapPin,
  PackageCheck,
  Warehouse,
  MonitorSpeaker,
  AlertTriangle,
  FileOutput,
  Workflow,
  ClipboardList,
  ScrollText
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
import { Toaster } from '@/components/ui/sonner';
import StatusOmieIndicator from '@/components/layout/StatusOmieIndicator';

export default function Layout({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedMenus, setExpandedMenus] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [userPermissions, setUserPermissions] = useState(null);
  const [funcionarioAtual, setFuncionarioAtual] = useState(null);

  const { data: permissoes = [] } = useQuery({
    queryKey: ['permissoes'],
    queryFn: () => base44.entities.Permissao.list(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false
  });

  const { data: vendedores = [] } = useQuery({
    queryKey: ['vendedores'],
    queryFn: () => base44.entities.Vendedor.list(),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false
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
        title: 'Cadastros',
        icon: Settings,
        path: 'CadastrosHub'
      },
      {
        title: 'Pedidos',
        icon: CreditCard,
        submenu: [
          { title: 'Consultar Pedidos', path: 'Pedidos' },
          { title: 'Emissão de Pedidos', path: 'EmissaoPedidos' },
          { title: 'Gerenciar Pedidos', path: 'GerenciarPedidosPage' },
          { title: 'Enviar Rotas Omie', path: 'EnviarRotasOmie' },
          { title: 'Controle Pedidos Venda', path: 'ControlePedidosVenda' },
          { title: 'Controle Pedidos Troca', path: 'ControlePedidosTroca' }
        ]
      },
      {
        title: 'Análises Comercial',
        icon: BarChart3,
        submenu: [
          { title: 'Gestão de Metas (Cascata)', path: 'GestaoMetas' },
          { title: 'Metas', path: 'Metas' },
          { title: 'Dashboard Vendedor', path: 'DashboardVendedor' },
          { title: 'Dashboard Trocas', path: 'DashboardTrocas' },
          { title: 'Dashboard Vendas', path: 'DashboardVendas' },
          { title: 'Dashboard Clientes', path: 'DashboardClientes' },
          { title: 'Análise de Visitas', path: 'AnaliseDeVisitas' },
          { title: 'Mapa de Visitas', path: 'MapaDeVisitas' }
        ]
      },
      {
        title: 'Relatórios Visitas',
        icon: FileOutput,
        submenu: [
          { title: 'Roteiros/Visitas', path: 'RoteirosVisitas' },
          { title: 'Estoque', path: 'Estoque' },
          { title: 'Trocas', path: 'Trocas' },
          { title: 'Rotina Supervisores', path: 'RotinaSupervisores' }
        ]
      },
      {
        title: 'Roteiros de Campo',
        icon: ClipboardList,
        submenu: [
          { title: 'Meus Roteiros', path: 'MeusRoteiros' },
          { title: 'Rota Supervisores', path: 'RotaSupervisores' },
          { title: 'Painel de Roteiros', path: 'PainelRoteiros' }
        ]
      },
      {
        title: 'Logística',
        icon: Warehouse,
        submenu: [
          { title: 'Notas Fiscais Omie', path: 'NotasOmie' },
          { title: 'Montagem de Carga', path: 'MontagemCarga' },
          { title: 'Cargas', path: 'Cargas' },
          { title: 'Ajustes de Pedidos', path: 'AjustesPedidos' },
          { title: 'Boletos Omie', path: 'BoletosOmie' },
          { title: 'Acerto de Caixa', path: 'AcertoCaixa' },
          { title: 'Relatório Carregamento', path: 'RelatorioCarregamento' },
        ]
      }
    ];

    if (isAdmin) {
      allMenuItems.push({
        title: 'Gerenciamento',
        icon: Shield,
        submenu: [
          { title: 'Permissões', path: 'Permissoes' },
          { title: 'Log Gerencial', path: 'LogGerencial' },
          { title: 'Credenciais Omie', path: 'ConfiguracaoOmie' },
          { title: 'Sincronizar Clientes CSV', path: 'sincronizarclientescsv' },
          { title: 'Sincronizar Clientes Omie', path: 'SincronizarClienteOmie' },
          { title: 'Supervisão Fila de Envio', path: 'SupervisaoFilaEnvio' },
          { title: 'Corrigir Planos (Planilha)', path: 'CorrigirPlanosPlanilha' }
        ]
      });

      allMenuItems.push({
        title: 'Integração Omie',
        icon: Settings,
        path: 'IntegracaoOmieDashboard'
      });

      allMenuItems.push({
        title: 'Commits GitHub',
        icon: ScrollText,
        path: 'CommitsGithub'
      });
    }

    return allMenuItems.map(item => {
      if (item.submenu) {
        const filteredSubmenu = item.submenu.filter(sub => canViewPage(sub.path));
        return filteredSubmenu.length > 0 ? { ...item, submenu: filteredSubmenu } : null;
      }
      return canViewPage(item.path) ? item : null;
    }).filter(Boolean);
  }, [userPermissions, isAdmin, currentUser]);

  const toggleSubmenu = (title) => {
    setExpandedMenus(prev =>
      prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
    );
  };

  const isActiveRoute = (path) => currentPageName === path;

  return (
    <div className="min-h-screen bg-[#eefcff]" translate="no" lang="pt-BR">
      <style>{`
        :root {
          --primary: 185 88% 45%;
          --primary-foreground: 0 0% 100%;
          --accent: 188 86% 92%;
        }
        
        .sidebar-gradient {
          background: linear-gradient(180deg, #063746 0%, #052c39 55%, #041f2b 100%);
        }
        
        .menu-item-active {
          background: rgba(20, 203, 219, 0.16);
          color: #67e8f9;
        }
        
        .menu-item-hover:hover {
          background: rgba(255, 255, 255, 0.07);
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
          border-radius: 10px;
        }
      `}</style>

      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-[#063746] z-50 flex items-center justify-between px-3 shadow-xl">
        <div className="flex items-center gap-2 text-white font-semibold">
          <img 
            src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6926e3c1dcadc4e314506362/7c2bd1831_8297750cb_cropped-cropped-logo.png" 
            alt="Pão & Mel" 
            className="h-8 w-auto"
          />
          <span className="text-cyan-200">+</span>
          <img src="https://media.base44.com/images/public/69cec8f0ff370a0c3a2d6d78/7be826633_image.png" alt="Omie" className="h-7 w-7 rounded-full bg-white" />
        </div>
        <div className="flex items-center gap-2">
          <StatusOmieIndicator compact />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-white hover:bg-neutral-800 h-9 w-9"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
        </div>
      </div>

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 h-full w-72 sidebar-gradient z-40 
        transform transition-transform duration-300 ease-out
        lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        shadow-2xl
      `}>
        {/* Logo */}
        <div className="h-32 flex items-center justify-center px-5 border-b border-white/10 bg-white/[0.03]">
          <div className="flex items-center gap-3">
            <img 
              src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/6926e3c1dcadc4e314506362/7c2bd1831_8297750cb_cropped-cropped-logo.png" 
              alt="Pão & Mel" 
              className="h-16 w-auto"
            />
            <div className="text-xl font-light text-cyan-100">+</div>
            <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-cyan-600 leading-none">
              <img src="https://media.base44.com/images/public/69cec8f0ff370a0c3a2d6d78/7be826633_image.png" alt="Omie" className="h-8 w-8" />
              Omie
            </div>
          </div>
        </div>

        {/* Status Omie + User Info & Logout */}
        <div className="px-4 py-3 border-b border-neutral-700/50 space-y-2">
          <StatusOmieIndicator />
          <div className="flex items-center justify-between">
            <div className="text-sm text-neutral-400 truncate flex-1 mr-2">
              {currentUser?.email}
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-neutral-400 hover:text-green-400 hover:bg-green-500/10"
                onClick={() => {
                  if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                      (pos) => {
                        alert(`Localização ativada!\nLat: ${pos.coords.latitude.toFixed(6)}\nLng: ${pos.coords.longitude.toFixed(6)}`);
                      },
                      (err) => {
                        if (err.code === 1) {
                          alert('Permissão de localização negada. Vá nas configurações do navegador e permita o acesso à localização para este site.');
                        } else {
                          alert('Não foi possível obter a localização. Verifique as permissões do navegador.');
                        }
                      },
                      { enableHighAccuracy: true }
                    );
                  } else {
                    alert('Seu navegador não suporta geolocalização.');
                  }
                }}
              >
                <MapPin className="w-4 h-4" />
              </Button>
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
        <nav className="p-3 h-[calc(100%-11rem)] overflow-y-auto">
          <ul className="space-y-1">
            {menuItems.map((item) => (
              <li key={item.title}>
                {item.path ? (
                  <Link
                    to={createPageUrl(item.path)}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
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
                        <div className="w-8 h-8 flex items-center justify-center bg-white/10 hexagon-icon">
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
      <Toaster richColors position="top-right" />
    </div>
  );
}