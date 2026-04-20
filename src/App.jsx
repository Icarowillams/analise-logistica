import './App.css'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import RelatorioRotinaSupervisores from './pages/RelatorioRotinaSupervisores';
import CadastroMetas from './pages/CadastroMetas';
import RelatorioMetasGerais from './pages/RelatorioMetasGerais';
import DashboardPedidosVenda from './pages/DashboardPedidosVenda';

import EnviarRotasOmie from './pages/EnviarRotasOmie';
import ControlePedidosVenda from './pages/ControlePedidosVenda';
import ControlePedidosTroca from './pages/ControlePedidosTroca';
import PreCadastros from './pages/PreCadastros';
import SincronizarClientesOmie from './pages/SincronizarClientesOmie';
import SincronizarClientesCSVPage from './pages/SincronizarClientesCSVPage.jsx';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="/RelatorioRotinaSupervisores" element={<LayoutWrapper currentPageName="RelatorioRotinaSupervisores"><RelatorioRotinaSupervisores /></LayoutWrapper>} />

      <Route path="/enviarrotasomie" element={<LayoutWrapper currentPageName="EnviarRotasOmie"><EnviarRotasOmie /></LayoutWrapper>} />
      <Route path="/precadastros" element={<LayoutWrapper currentPageName="PreCadastros"><PreCadastros /></LayoutWrapper>} />
      <Route path="/sincronizarclientesomie" element={<LayoutWrapper currentPageName="SincronizarClientesOmie"><SincronizarClientesOmie /></LayoutWrapper>} />
      <Route path="/CadastroMetas" element={<LayoutWrapper currentPageName="CadastroMetas"><CadastroMetas /></LayoutWrapper>} />
      <Route path="/RelatorioMetasGerais" element={<LayoutWrapper currentPageName="RelatorioMetasGerais"><RelatorioMetasGerais /></LayoutWrapper>} />
      <Route path="/DashboardPedidosVenda" element={<LayoutWrapper currentPageName="DashboardPedidosVenda"><DashboardPedidosVenda /></LayoutWrapper>} />
      <Route path="/sincronizarclientescsv" element={<LayoutWrapper currentPageName="SincronizarClientesCSV"><SincronizarClientesCSVPage /></LayoutWrapper>} />
      <Route path="/ControlePedidosVenda" element={<LayoutWrapper currentPageName="ControlePedidosVenda"><ControlePedidosVenda /></LayoutWrapper>} />
      <Route path="/ControlePedidosTroca" element={<LayoutWrapper currentPageName="ControlePedidosTroca"><ControlePedidosTroca /></LayoutWrapper>} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <NavigationTracker />
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <VisualEditAgent />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App