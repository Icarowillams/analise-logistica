import { QueryClient } from '@tanstack/react-query';

// Defaults globais do TanStack Query
export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 3 * 60 * 1000,    // 3 min — reduz refetch automático, alivia API
			gcTime: 10 * 60 * 1000,      // 10 min
			refetchOnWindowFocus: false, // não pisca a tela ao voltar do browser
			refetchOnReconnect: true,
			retry: 1,
		},
		mutations: {
			retry: 2,
		},
	},
});

// Sobrescrições por tipo de query (casadas pelo primeiro segmento da queryKey).
// Cada chave aqui é um prefixo: vale para qualquer queryKey que comece com ele.
const QUERY_DEFAULTS = {
	// Cadastros estáveis — 15 min
	clientes:        { staleTime: 15 * 60 * 1000 },
	produtos:        { staleTime: 15 * 60 * 1000 },
	categorias:      { staleTime: 15 * 60 * 1000 },
	subCategorias:   { staleTime: 15 * 60 * 1000 },
	rotas:           { staleTime: 15 * 60 * 1000 },
	segmentos:       { staleTime: 15 * 60 * 1000 },
	redes:           { staleTime: 15 * 60 * 1000 },
	tabelasPreco:    { staleTime: 15 * 60 * 1000 },
	unidadesMedida:  { staleTime: 15 * 60 * 1000 },
	vendedores:      { staleTime: 15 * 60 * 1000 },
	planosPagamento: { staleTime: 15 * 60 * 1000 },
	modalidadesPagamento: { staleTime: 15 * 60 * 1000 },

	// Dados operacionais — 2 min (reduz refetch automático, alivia API)
	pedidos:             { staleTime: 2 * 60 * 1000 },
	cargas:              { staleTime: 2 * 60 * 1000 },
	cargasOperacao:      { staleTime: 2 * 60 * 1000 },
	operacaoEspelho:     { staleTime: 2 * 60 * 1000 },
	pedidoLiberadoOmie:  { staleTime: 2 * 60 * 1000 },

	// Logs e auditoria — 5 min, gcTime curto
	logIntegracaoOmie: { staleTime: 5 * 60 * 1000, gcTime: 2 * 60 * 1000 },
	logGerencial:      { staleTime: 5 * 60 * 1000, gcTime: 2 * 60 * 1000 },

	// Controle interno — 1 min
	controleCircuitBreakerOmie: { staleTime: 60 * 1000 },
	cacheOmieConsulta:          { staleTime: 60 * 1000 },
	rateLimitWebhook:           { staleTime: 60 * 1000 },

	// Dashboards e analytics — 5 min
	dashboard: { staleTime: 5 * 60 * 1000 },
	analytics: { staleTime: 5 * 60 * 1000 },
	analises:  { staleTime: 5 * 60 * 1000 },
};

Object.entries(QUERY_DEFAULTS).forEach(([prefixo, options]) => {
	queryClientInstance.setQueryDefaults([prefixo], options);
});