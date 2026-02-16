/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AnaliseVisitas from './pages/AnaliseVisitas';
import AtualizarSupervisores from './pages/AtualizarSupervisores';
import Categorias from './pages/Categorias';
import Clientes from './pages/Clientes';
import ConfigurarIntegracao from './pages/ConfigurarIntegracao';
import ConfigurarWebhook from './pages/ConfigurarWebhook';
import Dashboard from './pages/Dashboard';
import DashboardClientes from './pages/DashboardClientes';
import DashboardTrocas from './pages/DashboardTrocas';
import DashboardVendedor from './pages/DashboardVendedor';
import Empresa from './pages/Empresa';
import Funcionarios from './pages/Funcionarios';
import Funcoes from './pages/Funcoes';
import Home from './pages/Home';
import Importacoes from './pages/Importacoes';
import ImportarVendas from './pages/ImportarVendas';
import MapaVendas from './pages/MapaVendas';
import MetasCadastro from './pages/MetasCadastro';
import MetasPositivacao from './pages/MetasPositivacao';
import MetasPrecoMedio from './pages/MetasPrecoMedio';
import MetasProduto from './pages/MetasProduto';
import MetasTroca from './pages/MetasTroca';
import MeusRoteiros from './pages/MeusRoteiros';
import MotivosTroca from './pages/MotivosTroca';
import PainelGestorVisita from './pages/PainelGestorVisita';
import PainelRodrigosM from './pages/PainelRodrigosM';
import Pedidos from './pages/Pedidos';
import Permissoes from './pages/Permissoes';
import PlanosPagamento from './pages/PlanosPagamento';
import Produtos from './pages/Produtos';
import Redes from './pages/Redes';
import RelatorioEstoque from './pages/RelatorioEstoque';
import RelatorioRoteiros from './pages/RelatorioRoteiros';
import RelatorioTrocas from './pages/RelatorioTrocas';
import RelatoriosGestorVisita from './pages/RelatoriosGestorVisita';
import Rotas from './pages/Rotas';
import Roteiros from './pages/Roteiros';
import Segmentos from './pages/Segmentos';
import SincronizarGestorVisita from './pages/SincronizarGestorVisita';
import TabelasPreco from './pages/TabelasPreco';
import UnidadesMedida from './pages/UnidadesMedida';
import EmissaoPedidos from './pages/EmissaoPedidos';
import GerenciarPedidosPage from './pages/GerenciarPedidosPage';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AnaliseVisitas": AnaliseVisitas,
    "AtualizarSupervisores": AtualizarSupervisores,
    "Categorias": Categorias,
    "Clientes": Clientes,
    "ConfigurarIntegracao": ConfigurarIntegracao,
    "ConfigurarWebhook": ConfigurarWebhook,
    "Dashboard": Dashboard,
    "DashboardClientes": DashboardClientes,
    "DashboardTrocas": DashboardTrocas,
    "DashboardVendedor": DashboardVendedor,
    "Empresa": Empresa,
    "Funcionarios": Funcionarios,
    "Funcoes": Funcoes,
    "Home": Home,
    "Importacoes": Importacoes,
    "ImportarVendas": ImportarVendas,
    "MapaVendas": MapaVendas,
    "MetasCadastro": MetasCadastro,
    "MetasPositivacao": MetasPositivacao,
    "MetasPrecoMedio": MetasPrecoMedio,
    "MetasProduto": MetasProduto,
    "MetasTroca": MetasTroca,
    "MeusRoteiros": MeusRoteiros,
    "MotivosTroca": MotivosTroca,
    "PainelGestorVisita": PainelGestorVisita,
    "PainelRodrigosM": PainelRodrigosM,
    "Pedidos": Pedidos,
    "Permissoes": Permissoes,
    "PlanosPagamento": PlanosPagamento,
    "Produtos": Produtos,
    "Redes": Redes,
    "RelatorioEstoque": RelatorioEstoque,
    "RelatorioRoteiros": RelatorioRoteiros,
    "RelatorioTrocas": RelatorioTrocas,
    "RelatoriosGestorVisita": RelatoriosGestorVisita,
    "Rotas": Rotas,
    "Roteiros": Roteiros,
    "Segmentos": Segmentos,
    "SincronizarGestorVisita": SincronizarGestorVisita,
    "TabelasPreco": TabelasPreco,
    "UnidadesMedida": UnidadesMedida,
    "EmissaoPedidos": EmissaoPedidos,
    "GerenciarPedidosPage": GerenciarPedidosPage,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};