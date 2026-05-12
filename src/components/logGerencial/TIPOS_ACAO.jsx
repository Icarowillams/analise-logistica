// Catálogo central de tipos de ação registrados no Log Gerencial
import {
  Send, Trash2, Edit, FilePlus2, Shield, FileCheck2, ArrowLeftRight,
  Scissors, Ban, Unlock, LogIn, MoreHorizontal
} from 'lucide-react';

export const TIPOS_ACAO = [
  { valor: 'envio', label: 'Envio', cor: 'bg-blue-100 text-blue-800 border-blue-300', icon: Send, descricao: 'Envio de dados para o Omie (pedidos, clientes, produtos, etc).' },
  { valor: 'criacao', label: 'Criação', cor: 'bg-green-100 text-green-800 border-green-300', icon: FilePlus2, descricao: 'Criação de um novo registro no sistema (cliente, pedido, carga, etc).' },
  { valor: 'edicao', label: 'Edição', cor: 'bg-yellow-100 text-yellow-800 border-yellow-300', icon: Edit, descricao: 'Alteração de campos de um registro existente — exibe campo, valor anterior e valor novo.' },
  { valor: 'exclusao', label: 'Exclusão', cor: 'bg-red-100 text-red-800 border-red-300', icon: Trash2, descricao: 'Remoção de registros do sistema (cliente, pedido, produto, etc).' },
  { valor: 'permissao', label: 'Permissões', cor: 'bg-purple-100 text-purple-800 border-purple-300', icon: Shield, descricao: 'Alteração de permissões e acessos de usuários.' },
  { valor: 'faturamento', label: 'Faturamento', cor: 'bg-emerald-100 text-emerald-800 border-emerald-300', icon: FileCheck2, descricao: 'Faturamento de pedidos ou cargas — emissão de NF concluída.' },
  { valor: 'transferencia', label: 'Transferência', cor: 'bg-orange-100 text-orange-800 border-orange-300', icon: ArrowLeftRight, descricao: 'Transferência de pedidos/NFs entre cargas ou rotas.' },
  { valor: 'corte', label: 'Corte', cor: 'bg-red-100 text-red-800 border-red-300', icon: Scissors, descricao: 'Corte/ajuste de quantidade ou remoção de itens de pedidos.' },
  { valor: 'cancelamento', label: 'Cancelamento', cor: 'bg-gray-200 text-gray-800 border-gray-400', icon: Ban, descricao: 'Cancelamento de pedidos, notas fiscais ou cargas.' },
  { valor: 'liberacao', label: 'Liberação', cor: 'bg-blue-100 text-blue-800 border-blue-300', icon: Unlock, descricao: 'Liberação de pedidos para faturamento (etapa 20).' },
  { valor: 'login', label: 'Login', cor: 'bg-gray-200 text-gray-800 border-gray-400', icon: LogIn, descricao: 'Acesso ao sistema por um usuário.' },
  { valor: 'outro', label: 'Outro', cor: 'bg-gray-200 text-gray-800 border-gray-400', icon: MoreHorizontal, descricao: 'Outras ações não classificadas nas categorias acima.' }
];

export const MAPA_TIPOS = Object.fromEntries(TIPOS_ACAO.map(t => [t.valor, t]));