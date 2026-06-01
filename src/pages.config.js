/**
 * pages.config.js - Page routing configuration
 * Reflete as páginas reais existentes em App.jsx.
 */
import AjustesPedidos from './pages/AjustesPedidos';
import BoletosOmie from './pages/BoletosOmie';
import Cargas from './pages/Cargas';
import Categorias from './pages/Categorias';
import Clientes from './pages/Clientes';
import Dashboard from './pages/Dashboard';
import EmissaoPedidos from './pages/EmissaoPedidos';
import Empresa from './pages/Empresa';
import Funcionarios from './pages/Funcionarios';
import Funcoes from './pages/Funcoes';
import GerenciarPedidosPage from './pages/GerenciarPedidosPage';
import Home from './pages/Home';
import MontagemCarga from './pages/MontagemCarga';
import MotivosTroca from './pages/MotivosTroca';
import NotasOmie from './pages/NotasOmie';
import Operacao from './pages/Operacao';
import Pedidos from './pages/Pedidos';
import Permissoes from './pages/Permissoes';
import PlanosPagamento from './pages/PlanosPagamento';
import Produtos from './pages/Produtos';
import Redes from './pages/Redes';
import Rotas from './pages/Rotas';
import Segmentos from './pages/Segmentos';
import TabelasPreco from './pages/TabelasPreco';
import TestesOmie from './pages/TestesOmie';
import UnidadesMedida from './pages/UnidadesMedida';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AjustesPedidos": AjustesPedidos,
    "BoletosOmie": BoletosOmie,
    "Cargas": Cargas,
    "Categorias": Categorias,
    "Clientes": Clientes,
    "Dashboard": Dashboard,
    "EmissaoPedidos": EmissaoPedidos,
    "Empresa": Empresa,
    "Funcionarios": Funcionarios,
    "Funcoes": Funcoes,
    "GerenciarPedidosPage": GerenciarPedidosPage,
    "Home": Home,
    "MontagemCarga": MontagemCarga,
    "MotivosTroca": MotivosTroca,
    "NotasOmie": NotasOmie,
    "Operacao": Operacao,
    "Pedidos": Pedidos,
    "Permissoes": Permissoes,
    "PlanosPagamento": PlanosPagamento,
    "Produtos": Produtos,
    "Redes": Redes,
    "Rotas": Rotas,
    "Segmentos": Segmentos,
    "TabelasPreco": TabelasPreco,
    "TestesOmie": TestesOmie,
    "UnidadesMedida": UnidadesMedida,
}

export const pagesConfig = {
    mainPage: "Home",
    Pages: PAGES,
    Layout: __Layout,
};