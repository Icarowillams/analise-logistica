import Dashboard from './pages/Dashboard';
import Vendedores from './pages/Vendedores';
import Produtos from './pages/Produtos';
import Clientes from './pages/Clientes';
import Segmentos from './pages/Segmentos';
import Redes from './pages/Redes';
import MotivosTroca from './pages/MotivosTroca';
import PlanosPagamento from './pages/PlanosPagamento';
import Rotas from './pages/Rotas';
import ImportarVendas from './pages/ImportarVendas';
import ImportarTrocas from './pages/ImportarTrocas';
import MetasProduto from './pages/MetasProduto';
import MetasPositivacao from './pages/MetasPositivacao';
import MetasPrecoMedio from './pages/MetasPrecoMedio';
import MetasCadastro from './pages/MetasCadastro';
import MetasTroca from './pages/MetasTroca';
import PainelRodrigosM from './pages/PainelRodrigosM';
import DashboardVendedor from './pages/DashboardVendedor';
import DashboardTrocas from './pages/DashboardTrocas';
import DashboardClientes from './pages/DashboardClientes';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Dashboard": Dashboard,
    "Vendedores": Vendedores,
    "Produtos": Produtos,
    "Clientes": Clientes,
    "Segmentos": Segmentos,
    "Redes": Redes,
    "MotivosTroca": MotivosTroca,
    "PlanosPagamento": PlanosPagamento,
    "Rotas": Rotas,
    "ImportarVendas": ImportarVendas,
    "ImportarTrocas": ImportarTrocas,
    "MetasProduto": MetasProduto,
    "MetasPositivacao": MetasPositivacao,
    "MetasPrecoMedio": MetasPrecoMedio,
    "MetasCadastro": MetasCadastro,
    "MetasTroca": MetasTroca,
    "PainelRodrigosM": PainelRodrigosM,
    "DashboardVendedor": DashboardVendedor,
    "DashboardTrocas": DashboardTrocas,
    "DashboardClientes": DashboardClientes,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};