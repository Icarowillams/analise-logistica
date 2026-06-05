import './App.css'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import EnviarRotasOmie from './pages/EnviarRotasOmie';
import ControlePedidosVenda from './pages/ControlePedidosVenda';
import ControlePedidosTroca from './pages/ControlePedidosTroca';
import PreCadastros from './pages/PreCadastros';
import SincronizarClientesCSVPage from './pages/SincronizarClientesCSVPage.jsx';
import SincronizarClienteOmie from './pages/SincronizarClienteOmie.jsx';
import Veiculos from './pages/Veiculos.jsx';
import Motoristas from './pages/Motoristas.jsx';
import CenariosFiscais from './pages/CenariosFiscais.jsx';
import CenariosFiscaisLocais from './pages/CenariosFiscaisLocais.jsx';
import IntegracaoOmieDashboard from './pages/IntegracaoOmieDashboard.jsx';
import NotasOmie from './pages/NotasOmie.jsx';
import MontagemCarga from './pages/MontagemCarga.jsx';
import Cargas from './pages/Cargas.jsx';
import AjustesPedidos from './pages/AjustesPedidos.jsx';
import BoletosOmie from './pages/BoletosOmie.jsx';
import Operacao from './pages/Operacao.jsx';
import TestesOmie from './pages/TestesOmie.jsx';
import Roteiros from './pages/Roteiros.jsx';
import GestaoRoteiros from './pages/GestaoRoteiros.jsx';
import MeusRoteirosPage from './pages/MeusRoteiros.jsx';
import RotaSupervisoresPage from './pages/RotaSupervisores.jsx';
import AnalisesComercial from './pages/AnalisesComercial.jsx';
import RelatoriosVisitas from './pages/RelatoriosVisitas.jsx';
import Metas from './pages/Metas.jsx';
import AcertoCaixaPage from './pages/AcertoCaixa.jsx';
import AcertoCaixaEditar from './pages/AcertoCaixaEditar.jsx';
import AcertoResumoPDF from './pages/AcertoResumoPDF.jsx';
import LogGerencial from './pages/LogGerencial.jsx';
import EmissaoBoletos from './pages/EmissaoBoletos.jsx';
import ConfiguracaoOmie from './pages/ConfiguracaoOmie.jsx';
import CommitsGithub from './pages/CommitsGithub.jsx';
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
      <Route path="/enviarrotasomie" element={<LayoutWrapper currentPageName="EnviarRotasOmie"><EnviarRotasOmie /></LayoutWrapper>} />
      <Route path="/precadastros" element={<LayoutWrapper currentPageName="PreCadastros"><PreCadastros /></LayoutWrapper>} />
      <Route path="/Veiculos" element={<LayoutWrapper currentPageName="Veiculos"><Veiculos /></LayoutWrapper>} />
      <Route path="/Motoristas" element={<LayoutWrapper currentPageName="Motoristas"><Motoristas /></LayoutWrapper>} />
      <Route path="/CenariosFiscais" element={<LayoutWrapper currentPageName="CenariosFiscais"><CenariosFiscais /></LayoutWrapper>} />
      <Route path="/CenariosFiscaisLocais" element={<LayoutWrapper currentPageName="CenariosFiscaisLocais"><CenariosFiscaisLocais /></LayoutWrapper>} />
      <Route path="/IntegracaoOmieDashboard" element={<LayoutWrapper currentPageName="IntegracaoOmieDashboard"><IntegracaoOmieDashboard /></LayoutWrapper>} />
      <Route path="/sincronizarclientescsv" element={<LayoutWrapper currentPageName="SincronizarClientesCSV"><SincronizarClientesCSVPage /></LayoutWrapper>} />
      <Route path="/SincronizarClienteOmie" element={<LayoutWrapper currentPageName="SincronizarClienteOmie"><SincronizarClienteOmie /></LayoutWrapper>} />
      <Route path="/sincronizarclienteomie" element={<LayoutWrapper currentPageName="SincronizarClienteOmie"><SincronizarClienteOmie /></LayoutWrapper>} />
      <Route path="/ControlePedidosVenda" element={<LayoutWrapper currentPageName="ControlePedidosVenda"><ControlePedidosVenda /></LayoutWrapper>} />
      <Route path="/ControlePedidosTroca" element={<LayoutWrapper currentPageName="ControlePedidosTroca"><ControlePedidosTroca /></LayoutWrapper>} />
      <Route path="/NotasOmie" element={<LayoutWrapper currentPageName="NotasOmie"><NotasOmie /></LayoutWrapper>} />
      <Route path="/MontagemCarga" element={<LayoutWrapper currentPageName="MontagemCarga"><MontagemCarga /></LayoutWrapper>} />
      <Route path="/Cargas" element={<LayoutWrapper currentPageName="Cargas"><Cargas /></LayoutWrapper>} />
      <Route path="/AjustesPedidos" element={<LayoutWrapper currentPageName="AjustesPedidos"><AjustesPedidos /></LayoutWrapper>} />
      <Route path="/BoletosOmie" element={<LayoutWrapper currentPageName="BoletosOmie"><BoletosOmie /></LayoutWrapper>} />
      <Route path="/Operacao" element={<LayoutWrapper currentPageName="Operacao"><Operacao /></LayoutWrapper>} />
      <Route path="/TestesOmie" element={<LayoutWrapper currentPageName="TestesOmie"><TestesOmie /></LayoutWrapper>} />
      <Route path="/Roteiros" element={<LayoutWrapper currentPageName="Roteiros"><GestaoRoteiros /></LayoutWrapper>} />
      <Route path="/MeusRoteiros" element={<LayoutWrapper currentPageName="MeusRoteiros"><MeusRoteirosPage /></LayoutWrapper>} />
      <Route path="/meusroteiros" element={<LayoutWrapper currentPageName="MeusRoteiros"><MeusRoteirosPage /></LayoutWrapper>} />
      <Route path="/RotaSupervisores" element={<LayoutWrapper currentPageName="RotaSupervisores"><RotaSupervisoresPage /></LayoutWrapper>} />
      <Route path="/rotasupervisores" element={<LayoutWrapper currentPageName="RotaSupervisores"><RotaSupervisoresPage /></LayoutWrapper>} />
      <Route path="/PainelRoteiros" element={<LayoutWrapper currentPageName="PainelRoteiros"><Roteiros /></LayoutWrapper>} />
      <Route path="/painelroteiros" element={<LayoutWrapper currentPageName="PainelRoteiros"><Roteiros /></LayoutWrapper>} />
      <Route path="/AnalisesComercial" element={<LayoutWrapper currentPageName="AnalisesComercial"><AnalisesComercial /></LayoutWrapper>} />
      <Route path="/DashboardVendedor" element={<LayoutWrapper currentPageName="DashboardVendedor"><AnalisesComercial /></LayoutWrapper>} />
      <Route path="/DashboardTrocas" element={<LayoutWrapper currentPageName="DashboardTrocas"><AnalisesComercial /></LayoutWrapper>} />
      <Route path="/DashboardVendas" element={<LayoutWrapper currentPageName="DashboardVendas"><AnalisesComercial /></LayoutWrapper>} />
      <Route path="/DashboardClientes" element={<LayoutWrapper currentPageName="DashboardClientes"><AnalisesComercial /></LayoutWrapper>} />
      <Route path="/AnaliseDeVisitas" element={<LayoutWrapper currentPageName="AnaliseDeVisitas"><AnalisesComercial /></LayoutWrapper>} />
      <Route path="/MapaDeVisitas" element={<LayoutWrapper currentPageName="MapaDeVisitas"><AnalisesComercial /></LayoutWrapper>} />
      <Route path="/RelatoriosVisitas" element={<LayoutWrapper currentPageName="RelatoriosVisitas"><RelatoriosVisitas /></LayoutWrapper>} />
      <Route path="/RoteirosVisitas" element={<LayoutWrapper currentPageName="RoteirosVisitas"><RelatoriosVisitas /></LayoutWrapper>} />
      <Route path="/Estoque" element={<LayoutWrapper currentPageName="Estoque"><RelatoriosVisitas /></LayoutWrapper>} />
      <Route path="/Trocas" element={<LayoutWrapper currentPageName="Trocas"><RelatoriosVisitas /></LayoutWrapper>} />
      <Route path="/RotinaSupervisores" element={<LayoutWrapper currentPageName="RotinaSupervisores"><RelatoriosVisitas /></LayoutWrapper>} />
      <Route path="/Metas" element={<LayoutWrapper currentPageName="Metas"><Metas /></LayoutWrapper>} />
      <Route path="/AcertoCaixa" element={<LayoutWrapper currentPageName="AcertoCaixa"><AcertoCaixaPage /></LayoutWrapper>} />
      <Route path="/AcertoCaixaEditar" element={<LayoutWrapper currentPageName="AcertoCaixa"><AcertoCaixaEditar /></LayoutWrapper>} />
      <Route path="/AcertoResumoPDF" element={<AcertoResumoPDF />} />
      <Route path="/LogGerencial" element={<LayoutWrapper currentPageName="LogGerencial"><LogGerencial /></LayoutWrapper>} />
      <Route path="/EmissaoBoletos" element={<LayoutWrapper currentPageName="EmissaoBoletos"><EmissaoBoletos /></LayoutWrapper>} />
      <Route path="/ConfiguracaoOmie" element={<LayoutWrapper currentPageName="ConfiguracaoOmie"><ConfiguracaoOmie /></LayoutWrapper>} />
      <Route path="/CommitsGithub" element={<LayoutWrapper currentPageName="CommitsGithub"><CommitsGithub /></LayoutWrapper>} />
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