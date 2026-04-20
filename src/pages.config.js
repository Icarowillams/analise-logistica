/**
 * pages.config.js - Page routing configuration
 * Apenas páginas relacionadas a Omie / Cadastros / Logística.
 */
import Categorias from './pages/Categorias';
import Clientes from './pages/Clientes';
import EmissaoPedidos from './pages/EmissaoPedidos';
import Empresa from './pages/Empresa';
import Funcionarios from './pages/Funcionarios';
import Funcoes from './pages/Funcoes';
import GerenciarPedidosPage from './pages/GerenciarPedidosPage';
import Home from './pages/Home';
import MotivosTroca from './pages/MotivosTroca';
import Pedidos from './pages/Pedidos';
import Permissoes from './pages/Permissoes';
import PlanosPagamento from './pages/PlanosPagamento';
import Produtos from './pages/Produtos';
import Redes from './pages/Redes';
import Rotas from './pages/Rotas';
import Segmentos from './pages/Segmentos';
import TabelasPreco from './pages/TabelasPreco';
import UnidadesMedida from './pages/UnidadesMedida';
import __Layout from './Layout.jsx';


export const PAGES = {
    "Categorias": Categorias,
    "Clientes": Clientes,
    "EmissaoPedidos": EmissaoPedidos,
    "Empresa": Empresa,
    "Funcionarios": Funcionarios,
    "Funcoes": Funcoes,
    "GerenciarPedidosPage": GerenciarPedidosPage,
    "Home": Home,
    "MotivosTroca": MotivosTroca,
    "Pedidos": Pedidos,
    "Permissoes": Permissoes,
    "PlanosPagamento": PlanosPagamento,
    "Produtos": Produtos,
    "Redes": Redes,
    "Rotas": Rotas,
    "Segmentos": Segmentos,
    "TabelasPreco": TabelasPreco,
    "UnidadesMedida": UnidadesMedida,
}

export const pagesConfig = {
    mainPage: "Home",
    Pages: PAGES,
    Layout: __Layout,
};