import AtualizarSupervisores from './pages/AtualizarSupervisores';
import Categorias from './pages/Categorias';
import Clientes from './pages/Clientes';
import ConfigurarIntegracao from './pages/ConfigurarIntegracao';
import ConfigurarWebhook from './pages/ConfigurarWebhook';
import Dashboard from './pages/Dashboard';
import DashboardClientes from './pages/DashboardClientes';
import DashboardTrocas from './pages/DashboardTrocas';
import DashboardVendedor from './pages/DashboardVendedor';
import Funcionarios from './pages/Funcionarios';
import Funcoes from './pages/Funcoes';
import Home from './pages/Home';
import Importacoes from './pages/Importacoes';
import ImportarVendas from './pages/ImportarVendas';
import MetasCadastro from './pages/MetasCadastro';
import MetasPositivacao from './pages/MetasPositivacao';
import MetasPrecoMedio from './pages/MetasPrecoMedio';
import MetasProduto from './pages/MetasProduto';
import MetasTroca from './pages/MetasTroca';
import MotivosTroca from './pages/MotivosTroca';
import PainelGestorVisita from './pages/PainelGestorVisita';
import PainelRodrigosM from './pages/PainelRodrigosM';
import Permissoes from './pages/Permissoes';
import PlanosPagamento from './pages/PlanosPagamento';
import Produtos from './pages/Produtos';
import Redes from './pages/Redes';
import RelatoriosGestorVisita from './pages/RelatoriosGestorVisita';
import Rotas from './pages/Rotas';
import Segmentos from './pages/Segmentos';
import SincronizarGestorVisita from './pages/SincronizarGestorVisita';
import TabelasPreco from './pages/TabelasPreco';
import UnidadesMedida from './pages/UnidadesMedida';
import Roteiros from './pages/Roteiros';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AtualizarSupervisores": AtualizarSupervisores,
    "Categorias": Categorias,
    "Clientes": Clientes,
    "ConfigurarIntegracao": ConfigurarIntegracao,
    "ConfigurarWebhook": ConfigurarWebhook,
    "Dashboard": Dashboard,
    "DashboardClientes": DashboardClientes,
    "DashboardTrocas": DashboardTrocas,
    "DashboardVendedor": DashboardVendedor,
    "Funcionarios": Funcionarios,
    "Funcoes": Funcoes,
    "Home": Home,
    "Importacoes": Importacoes,
    "ImportarVendas": ImportarVendas,
    "MetasCadastro": MetasCadastro,
    "MetasPositivacao": MetasPositivacao,
    "MetasPrecoMedio": MetasPrecoMedio,
    "MetasProduto": MetasProduto,
    "MetasTroca": MetasTroca,
    "MotivosTroca": MotivosTroca,
    "PainelGestorVisita": PainelGestorVisita,
    "PainelRodrigosM": PainelRodrigosM,
    "Permissoes": Permissoes,
    "PlanosPagamento": PlanosPagamento,
    "Produtos": Produtos,
    "Redes": Redes,
    "RelatoriosGestorVisita": RelatoriosGestorVisita,
    "Rotas": Rotas,
    "Segmentos": Segmentos,
    "SincronizarGestorVisita": SincronizarGestorVisita,
    "TabelasPreco": TabelasPreco,
    "UnidadesMedida": UnidadesMedida,
    "Roteiros": Roteiros,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};