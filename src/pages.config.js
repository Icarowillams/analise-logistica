import Dashboard from './pages/Dashboard';
import Produtos from './pages/Produtos';
import Clientes from './pages/Clientes';
import Segmentos from './pages/Segmentos';
import Redes from './pages/Redes';
import MotivosTroca from './pages/MotivosTroca';
import PlanosPagamento from './pages/PlanosPagamento';
import Rotas from './pages/Rotas';
import ImportarVendas from './pages/ImportarVendas';
import MetasProduto from './pages/MetasProduto';
import MetasPositivacao from './pages/MetasPositivacao';
import MetasPrecoMedio from './pages/MetasPrecoMedio';
import MetasCadastro from './pages/MetasCadastro';
import MetasTroca from './pages/MetasTroca';
import PainelRodrigosM from './pages/PainelRodrigosM';
import DashboardVendedor from './pages/DashboardVendedor';
import DashboardTrocas from './pages/DashboardTrocas';
import DashboardClientes from './pages/DashboardClientes';
import Funcionarios from './pages/Funcionarios';
import Funcoes from './pages/Funcoes';
import Categorias from './pages/Categorias';
import TabelasPreco from './pages/TabelasPreco';
import UnidadesMedida from './pages/UnidadesMedida';
import AtualizarSupervisores from './pages/AtualizarSupervisores';
import Permissoes from './pages/Permissoes';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Dashboard": Dashboard,
    "Produtos": Produtos,
    "Clientes": Clientes,
    "Segmentos": Segmentos,
    "Redes": Redes,
    "MotivosTroca": MotivosTroca,
    "PlanosPagamento": PlanosPagamento,
    "Rotas": Rotas,
    "ImportarVendas": ImportarVendas,
    "MetasProduto": MetasProduto,
    "MetasPositivacao": MetasPositivacao,
    "MetasPrecoMedio": MetasPrecoMedio,
    "MetasCadastro": MetasCadastro,
    "MetasTroca": MetasTroca,
    "PainelRodrigosM": PainelRodrigosM,
    "DashboardVendedor": DashboardVendedor,
    "DashboardTrocas": DashboardTrocas,
    "DashboardClientes": DashboardClientes,
    "Funcionarios": Funcionarios,
    "Funcoes": Funcoes,
    "Categorias": Categorias,
    "TabelasPreco": TabelasPreco,
    "UnidadesMedida": UnidadesMedida,
    "AtualizarSupervisores": AtualizarSupervisores,
    "Permissoes": Permissoes,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};