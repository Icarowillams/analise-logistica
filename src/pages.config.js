/**
 * pages.config.js - Page routing configuration
 * Reflete as páginas reais existentes em App.jsx.
 */
import AcertoCaixa from './pages/AcertoCaixa';
import AcertoCaixaEditar from './pages/AcertoCaixaEditar';
import AcertoResumoPDF from './pages/AcertoResumoPDF';
import AjustesPedidos from './pages/AjustesPedidos';
import AnalisesComercial from './pages/AnalisesComercial';
import BoletosOmie from './pages/BoletosOmie';
import Cargas from './pages/Cargas';
import Categorias from './pages/Categorias';
import CenariosFiscais from './pages/CenariosFiscais';
import CenariosFiscaisLocais from './pages/CenariosFiscaisLocais';
import Clientes from './pages/Clientes';
import ConfiguracaoOmie from './pages/ConfiguracaoOmie';
import ConsultaClientes from './pages/ConsultaClientes';
import CommitsGithub from './pages/CommitsGithub';
import ControlePedidosTroca from './pages/ControlePedidosTroca';
import ControlePedidosVenda from './pages/ControlePedidosVenda';
import Dashboard from './pages/Dashboard';
import EmissaoBoletos from './pages/EmissaoBoletos';
import EmissaoPedidos from './pages/EmissaoPedidos';
import Empresa from './pages/Empresa';
import EnviarRotasOmie from './pages/EnviarRotasOmie';
import Funcionarios from './pages/Funcionarios';
import Funcoes from './pages/Funcoes';
import GerenciarPedidosPage from './pages/GerenciarPedidosPage';
import GestaoRoteiros from './pages/GestaoRoteiros';
import Home from './pages/Home';
import ImportarTrocas from './pages/ImportarTrocas';
import IntegracaoOmieDashboard from './pages/IntegracaoOmieDashboard';
import LogGerencial from './pages/LogGerencial';
import Metas from './pages/Metas';
import MeusRoteiros from './pages/MeusRoteiros';
import MontagemCarga from './pages/MontagemCarga';
import MotivosTroca from './pages/MotivosTroca';
import Motoristas from './pages/Motoristas';
import NotasOmie from './pages/NotasOmie';
import Operacao from './pages/Operacao';
import Pedidos from './pages/Pedidos';
import Permissoes from './pages/Permissoes';
import PlanosPagamento from './pages/PlanosPagamento';
import PreCadastros from './pages/PreCadastros';
import Produtos from './pages/Produtos';
import Redes from './pages/Redes';
import RelatoriosVisitas from './pages/RelatoriosVisitas';
import RotaSupervisores from './pages/RotaSupervisores';
import Rotas from './pages/Rotas';
import Roteiros from './pages/Roteiros';
import Segmentos from './pages/Segmentos';
import SincronizarClienteOmie from './pages/SincronizarClienteOmie';
import SincronizarClientesCSVPage from './pages/SincronizarClientesCSVPage';
import TabelasPreco from './pages/TabelasPreco';
import TestesOmie from './pages/TestesOmie';
import UnidadesMedida from './pages/UnidadesMedida';
import Veiculos from './pages/Veiculos';
import Vendedores from './pages/Vendedores';
import __Layout from './Layout.jsx';

export const PAGES = {
    "AcertoCaixa": AcertoCaixa,
    "AcertoCaixaEditar": AcertoCaixaEditar,
    "AcertoResumoPDF": AcertoResumoPDF,
    "AjustesPedidos": AjustesPedidos,
    "AnalisesComercial": AnalisesComercial,
    "BoletosOmie": BoletosOmie,
    "Cargas": Cargas,
    "Categorias": Categorias,
    "CenariosFiscais": CenariosFiscais,
    "CenariosFiscaisLocais": CenariosFiscaisLocais,
    "Clientes": Clientes,
    "ConfiguracaoOmie": ConfiguracaoOmie,
    "ConsultaClientes": ConsultaClientes,
    "CommitsGithub": CommitsGithub,
    "ControlePedidosTroca": ControlePedidosTroca,
    "ControlePedidosVenda": ControlePedidosVenda,
    "Dashboard": Dashboard,
    "EmissaoBoletos": EmissaoBoletos,
    "EmissaoPedidos": EmissaoPedidos,
    "Empresa": Empresa,
    "EnviarRotasOmie": EnviarRotasOmie,
    "Funcionarios": Funcionarios,
    "Funcoes": Funcoes,
    "GerenciarPedidosPage": GerenciarPedidosPage,
    "GestaoRoteiros": GestaoRoteiros,
    "Home": Home,
    "ImportarTrocas": ImportarTrocas,
    "IntegracaoOmieDashboard": IntegracaoOmieDashboard,
    "LogGerencial": LogGerencial,
    "Metas": Metas,
    "MeusRoteiros": MeusRoteiros,
    "MontagemCarga": MontagemCarga,
    "MotivosTroca": MotivosTroca,
    "Motoristas": Motoristas,
    "NotasOmie": NotasOmie,
    "Operacao": Operacao,
    "Pedidos": Pedidos,
    "Permissoes": Permissoes,
    "PlanosPagamento": PlanosPagamento,
    "PreCadastros": PreCadastros,
    "Produtos": Produtos,
    "Redes": Redes,
    "RelatoriosVisitas": RelatoriosVisitas,
    "RotaSupervisores": RotaSupervisores,
    "Rotas": Rotas,
    "Roteiros": Roteiros,
    "Segmentos": Segmentos,
    "SincronizarClienteOmie": SincronizarClienteOmie,
    "SincronizarClientesCSVPage": SincronizarClientesCSVPage,
    "TabelasPreco": TabelasPreco,
    "TestesOmie": TestesOmie,
    "UnidadesMedida": UnidadesMedida,
    "Veiculos": Veiculos,
    "Vendedores": Vendedores,
}

export const pagesConfig = {
    mainPage: "Home",
    Pages: PAGES,
    Layout: __Layout,
};
