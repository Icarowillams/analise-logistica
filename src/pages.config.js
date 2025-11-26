import Dashboard from './pages/Dashboard';
import Vendedores from './pages/Vendedores';
import Produtos from './pages/Produtos';
import Clientes from './pages/Clientes';
import Segmentos from './pages/Segmentos';
import Redes from './pages/Redes';
import MotivosTroca from './pages/MotivosTroca';
import PlanosPagamento from './pages/PlanosPagamento';
import Rotas from './pages/Rotas';
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
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};