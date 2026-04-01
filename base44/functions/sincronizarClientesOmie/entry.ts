import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const OMIE_APP_KEY = Deno.env.get("OMIE_APP_KEY");
const OMIE_APP_SECRET = Deno.env.get("OMIE_APP_SECRET");
const OMIE_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

const UF_VALIDAS = new Set([
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
    'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC',
    'SP','SE','TO'
]);

const estadoParaUF = {
    'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM',
    'bahia': 'BA', 'ceara': 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES',
    'goias': 'GO', 'maranhao': 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS',
    'minas gerais': 'MG', 'para': 'PA', 'paraiba': 'PB', 'parana': 'PR',
    'pernambuco': 'PE', 'piaui': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
    'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR', 'santa catarina': 'SC',
    'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO'
};

function textoParaUF(texto) {
    if (!texto) return '';
    const t = texto.trim();
    if (t.length === 2 && UF_VALIDAS.has(t.toUpperCase())) return t.toUpperCase();
    const chave = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return estadoParaUF[chave] || '';
}

function pareceEndereco(val) {
    if (!val) return false;
    const t = val.toLowerCase();
    return /^(rua |av\.|av |avenida |trav |rod |estrada |alameda |praca |largo |vila )/.test(t);
}

function pareceCEP(val) {
    if (!val) return false;
    const nums = val.replace(/[^\d]/g, '');
    return nums.length === 8;
}

function removerAspas(val) {
    if (typeof val !== 'string') return val;
    let v = val.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1).trim();
    }
    return v;
}

// Cache de CEPs já consultados para não repetir chamadas
const cepCache = {};

async function buscarEnderecoPorCEP(cep) {
    const cepLimpo = (cep || '').replace(/[^\d]/g, '');
    if (cepLimpo.length !== 8) return null;
    
    if (cepCache[cepLimpo]) return cepCache[cepLimpo];
    
    try {
        const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`, {
            signal: AbortSignal.timeout(3000)
        });
        const data = await res.json();
        if (data.erro) {
            cepCache[cepLimpo] = null;
            return null;
        }
        const resultado = {
            cidade: data.localidade || '',
            estado: data.uf || '',
            bairro: data.bairro || '',
            endereco: data.logradouro || ''
        };
        cepCache[cepLimpo] = resultado;
        return resultado;
    } catch {
        return null;
    }
}

// Detecta se um valor parece ser dado de endereço inválido como cidade
function pareceCidadeInvalida(val) {
    if (!val) return true;
    const t = val.trim();
    if (t.length <= 2) return true;
    if (t === '.' || t === 'NAO INFORMADO') return true;
    // Padrões comuns de dados errados no campo cidade
    if (/^(bloco|apto|apt|sala|lote|lt|qd|quadra|casa|andar|conj|lot|rod|r |rua |av |trav|estr)/i.test(t)) return true;
    if (/^\d/.test(t)) return true; // Começa com número
    if (/^(s\/n|sn)$/i.test(t)) return true;
    if (/\d{5}/.test(t)) return true; // Contém 5+ dígitos seguidos (CEP, número)
    if (/^[A-Z\s]{1,3}\s?\d/i.test(t)) return true; // "N 75", "8 A", "LT01"
    return false;
}

// Tenta corrigir campos trocados (endereço no campo cidade, cidade no campo estado, estado no campo cep, etc.)
function corrigirCamposTrocados(cliente) {
    let { endereco, numero, bairro, cidade, estado, cep, latitude, longitude } = cliente;
    
    // Tentar extrair UF de todos os campos
    const ufDoEstado = textoParaUF(estado);
    const ufDaCidade = textoParaUF(cidade);
    const ufDoCep = textoParaUF(cep);
    const ufDoBairro = textoParaUF(bairro);
    
    let ufFinal = '';
    let cidadeFinal = cidade || '';
    let cepFinal = (cep || '').replace(/[^\d]/g, '');
    let enderecoFinal = endereco || '';
    let numeroFinal = numero || '';
    let bairroFinal = bairro || '';

    // 1. Encontrar a UF válida em qualquer campo
    if (ufDoEstado) {
        ufFinal = ufDoEstado;
    } else if (ufDoCep) {
        // Estado está no campo CEP (ex: cep="PERNAMBUCO")
        ufFinal = ufDoCep;
        cepFinal = '';
    } else if (ufDaCidade) {
        ufFinal = ufDaCidade;
        cidadeFinal = '';
    } else if (ufDoBairro) {
        ufFinal = ufDoBairro;
        bairroFinal = '';
    }
    
    // 2. Se estado tinha um nome de cidade (não é UF), mover para cidade se cidade está vazia ou é endereço
    if (!ufDoEstado && estado && estado.length > 2) {
        const estadoLimpo = estado.trim();
        if (!pareceEndereco(estadoLimpo) && !pareceCEP(estadoLimpo)) {
            // Parece um nome de cidade no campo estado
            if (!cidadeFinal || pareceEndereco(cidadeFinal)) {
                cidadeFinal = estadoLimpo;
            }
        }
    }
    
    // 3. Se cidade parece endereço, limpar
    if (pareceEndereco(cidadeFinal)) {
        cidadeFinal = '';
    }
    
    // 3b. Se cidade é vazia ou parece inválida (complemento, bairro conhecido, etc.)
    // e o campo cep original tem nome de cidade, usar como cidade
    const cidadeInvalida = !cidadeFinal || cidadeFinal.length <= 2 || 
        /^(bloco|apto|sala|lote|qd|quadra|casa|andar|conj)\b/i.test(cidadeFinal);
    if (cidadeInvalida) {
        // Procurar cidade válida em outros campos (cep original pode ter nome de cidade)
        const cepOriginal = (cep || '').trim();
        if (cepOriginal && !pareceCEP(cepOriginal) && !pareceEndereco(cepOriginal) && cepOriginal.length > 2 && !textoParaUF(cepOriginal)) {
            cidadeFinal = cepOriginal;
        }
    }
    
    // 3c. Se cidade é bairro (RIO DOCE, etc.), e estado original tinha cidade, usar
    // Cidades conhecidas de PE para validação básica
    const cidadesConhecidasPE = ['RECIFE','OLINDA','JABOATAO DOS GUARARAPES','CABO DE SANTO AGOSTINHO',
        'CAMARAGIBE','PAULISTA','IGARASSU','ABREU E LIMA','SAO LOURENCO DA MATA','MORENO',
        'ITAMARACA','ILHA DE ITAMARACA','ARARIPINA','ARCOVERDE','BEZERROS','BELO JARDIM',
        'CARUARU','GARANHUNS','GOIANA','GRAVATA','LIMOEIRO','PALMARES','PESQUEIRA',
        'PETROLINA','SALGUEIRO','SANTA CRUZ DO CAPIBARIBE','SERRA TALHADA','SURUBIM',
        'TIMBAUBA','VITORIA DE SANTO ANTAO','CARPINA','ESCADA','IPOJUCA','SIRINHAEM',
        'NAZARE DA MATA','RIBEIRAO','CATENDE','CABO','JABOATAO'];
    
    if (cidadeFinal && !cidadesConhecidasPE.includes(cidadeFinal.toUpperCase())) {
        // Cidade pode ser bairro, verificar se estado original é uma cidade conhecida
        const estadoOriginal = (estado || '').trim().toUpperCase();
        if (cidadesConhecidasPE.includes(estadoOriginal)) {
            bairroFinal = bairroFinal || cidadeFinal;
            cidadeFinal = estadoOriginal;
        }
    }
    
    // 4. Tentar encontrar CEP numérico em algum campo
    if (cepFinal.length !== 8) {
        // CEP não é numérico, procurar em outros campos
        const campos = [cep, numero, bairro, cidade, estado, endereco];
        for (const c of campos) {
            const nums = (c || '').replace(/[^\d]/g, '');
            if (nums.length === 8 && parseInt(nums) >= 1000000) {
                cepFinal = nums;
                break;
            }
        }
        // Se latitude/longitude parecem CEP (8 dígitos válidos — coordenadas reais nunca têm 8 dígitos inteiros)
        if (cepFinal.length !== 8) {
            const latVal = Math.abs(Math.round(latitude || 0));
            const lonVal = Math.abs(Math.round(longitude || 0));
            const latStr = String(latVal);
            const lonStr = String(lonVal);
            if (lonStr.length === 8 && lonVal >= 1000000) {
                cepFinal = lonStr;
            } else if (latStr.length === 8 && latVal >= 1000000) {
                cepFinal = latStr;
            }
        }
    }
    
    // 5. Se ainda não tem UF, tentar PE como padrão (empresa em Pernambuco)
    if (!ufFinal) {
        ufFinal = 'PE';
    }
    
    // 6. Limpar campos que parecem ter dados errados
    if (pareceCEP(bairroFinal) || /^\d+$/.test(bairroFinal.trim())) {
        // Bairro é um número puro, pode ser o número do endereço
        if (!numeroFinal || numeroFinal === 'S/N') {
            numeroFinal = bairroFinal;
        }
        bairroFinal = '';
    }

    return {
        ...cliente,
        endereco: enderecoFinal,
        numero: numeroFinal,
        bairro: bairroFinal,
        cidade: cidadeFinal,
        estado: ufFinal,
        cep: cepFinal.substring(0, 8)
    };
}

async function mapearClienteParaOmie(clienteOriginal) {
    // Primeiro limpar aspas
    const cliente = { ...clienteOriginal };
    for (const key of Object.keys(cliente)) {
        if (typeof cliente[key] === 'string') cliente[key] = removerAspas(cliente[key]);
    }

    // Corrigir campos trocados (heurística local)
    const corrigido = corrigirCamposTrocados(cliente);

    const cpfCnpj = (corrigido.cpf_cnpj || "").replace(/[^\d]/g, "");
    const isPessoaFisica = cpfCnpj.length <= 11;

    // ===== VALIDAÇÕES PRÉ-ENVIO =====
    const errosValidacao = [];

    if (isPessoaFisica && cpfCnpj.length !== 11) {
        errosValidacao.push(`CPF inválido (${cpfCnpj.length} dígitos): "${cliente.cpf_cnpj}"`);
    }
    if (!isPessoaFisica && cpfCnpj.length !== 14) {
        errosValidacao.push(`CNPJ inválido (${cpfCnpj.length} dígitos): "${cliente.cpf_cnpj}"`);
    }
    if (cpfCnpj.length < 11) {
        errosValidacao.push(`CPF/CNPJ muito curto: "${cliente.cpf_cnpj}"`);
    }

    const razaoSocial = (corrigido.razao_social || corrigido.nome_fantasia || "").trim();
    if (!razaoSocial) {
        errosValidacao.push('Razão social vazia');
    }

    if (errosValidacao.length > 0) {
        return { erro: errosValidacao.join('; ') };
    }

    // ===== CONSULTAR VIACEP PARA CORRIGIR CIDADE/ESTADO/BAIRRO =====
    const cepLimpo = (corrigido.cep || "").replace(/[^\d]/g, "");
    let cidadeFinal = (corrigido.cidade || "").trim();
    let estadoFinal = (corrigido.estado || "").trim().toUpperCase();
    let bairroFinal = (corrigido.bairro || "").trim();
    let enderecoFinal = (corrigido.endereco || "").trim();

    // Se tem CEP válido, consultar ViaCEP para obter dados corretos
    if (cepLimpo.length === 8) {
        const dadosCep = await buscarEnderecoPorCEP(cepLimpo);
        if (dadosCep) {
            // Cidade e Estado do CEP são sempre confiáveis
            if (dadosCep.cidade) cidadeFinal = dadosCep.cidade;
            if (dadosCep.estado && UF_VALIDAS.has(dadosCep.estado)) estadoFinal = dadosCep.estado;
            // Bairro: usar do CEP se o atual parece inválido
            if (dadosCep.bairro && (!bairroFinal || bairroFinal === '.' || bairroFinal === 'NAO INFORMADO')) {
                bairroFinal = dadosCep.bairro;
            }
            // Endereço: usar do CEP se o atual está vazio
            if (dadosCep.endereco && (!enderecoFinal || enderecoFinal === '.' || enderecoFinal === 'NAO INFORMADO')) {
                enderecoFinal = dadosCep.endereco;
            }
            console.log(`[viaCEP] ${cepLimpo} → ${dadosCep.cidade}/${dadosCep.estado}`);
        }
    }

    // Se ainda não tem estado válido, usar PE como padrão
    if (!estadoFinal || !UF_VALIDAS.has(estadoFinal)) {
        estadoFinal = 'PE';
    }

    // Se cidade ainda parece inválida, tentar buscar nome de cidade nos campos originais
    if (pareceCidadeInvalida(cidadeFinal)) {
        const termosInvalidos = /km|rod|lot|trav|bloco|apto|apt|loja|sala|conj|quadra|qd|terreo|andar|galpao|box|pav|casa|etapa|ao\s/i;
        const camposOriginais = [
            clienteOriginal.cep, clienteOriginal.estado, clienteOriginal.bairro,
            clienteOriginal.cidade, clienteOriginal.numero
        ];
        for (const campo of camposOriginais) {
            const val = (campo || '').trim();
            if (val && val.length > 3 && !pareceEndereco(val) && !pareceCEP(val) 
                && !/^\d/.test(val) && !textoParaUF(val) && !termosInvalidos.test(val)) {
                cidadeFinal = val;
                console.log(`[fallback cidade] Usando "${val}" como cidade`);
                break;
            }
        }
    }

    // Se AINDA não tem cidade válida, o Omie vai rejeitar — registrar erro claro
    if (pareceCidadeInvalida(cidadeFinal)) {
        return { erro: `Cidade não identificada. CEP: "${clienteOriginal.cep}", Estado: "${clienteOriginal.estado}". Corrija o cadastro manualmente.` };
    }

    // ===== MONTAR OBJETO =====
    const nomeFantasia = (corrigido.nome_fantasia || corrigido.razao_social || razaoSocial).trim();
    const enderecoNumero = (corrigido.numero || "").trim();
    const email = (corrigido.email || "").trim();

    let inscricaoEstadual = "";
    if (isPessoaFisica) {
        inscricaoEstadual = "ISENTO";
    } else {
        inscricaoEstadual = (corrigido.inscricao_estadual || "").trim();
    }

    const clienteOmie = {
        codigo_cliente_integracao: corrigido.id,
        razao_social: razaoSocial.substring(0, 60),
        nome_fantasia: (nomeFantasia || razaoSocial).substring(0, 100),
        cnpj_cpf: cpfCnpj,
        pessoa_fisica: isPessoaFisica ? "S" : "N",
        contribuinte: isPessoaFisica ? "N" : "S",
        inativo: (corrigido.status || 'ativo').toLowerCase() === 'inativo' ? "S" : "N",

        endereco: (enderecoFinal || "NAO INFORMADO").substring(0, 60),
        endereco_numero: (enderecoNumero || "S/N").substring(0, 10),
        bairro: (bairroFinal || "NAO INFORMADO").substring(0, 60),
        cidade: cidadeFinal.substring(0, 60),
        estado: estadoFinal,
        cep: cepLimpo.length === 8 ? cepLimpo : "00000000",

        email: (email || "nfe@paoemel.com.br").substring(0, 500),
    };

    if (inscricaoEstadual) {
        clienteOmie.inscricao_estadual = inscricaoEstadual;
    }

    return clienteOmie;
}

// Busca UMA página de clientes do Omie
async function buscarPaginaOmie(pagina, registrosPorPagina = 500) {
    const response = await fetch(OMIE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            call: "ListarClientes",
            app_key: OMIE_APP_KEY,
            app_secret: OMIE_APP_SECRET,
            param: [{
                pagina,
                registros_por_pagina: registrosPorPagina,
                apenas_importado_api: "N"
            }]
        })
    });
    return await response.json();
}

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Não autorizado' }, { status: 401 });
        }

        const body = await req.json();
        const { modo, lote_inicio = 0, ids_para_enviar = null, pagina_omie = 1, clientes_omie_acumulados = null } = body;

        // ====================================================================
        // MODO: listar_base44 — retorna lista resumida de clientes ativos
        // ====================================================================
        if (modo === "listar_base44") {
            const { pagina_base44 = 1 } = body;
            const PAGE_SIZE = 500;
            const skip = Math.max(0, (Number(pagina_base44) - 1) * PAGE_SIZE);

            const lote = await base44.asServiceRole.entities.Cliente.list(
                '-created_date',
                PAGE_SIZE,
                skip
            );

            const arr = Array.isArray(lote) ? lote : [];
            const resumo = arr.map(c => ({
                id: c.id,
                razao_social: c.razao_social || '',
                nome_fantasia: c.nome_fantasia || '',
                cpf_cnpj: c.cpf_cnpj || '',
                status: c.status || 'ativo'
            }));

            const concluido = arr.length < PAGE_SIZE;

            return Response.json({
                clientes: resumo,
                count: resumo.length,
                total_bruto: arr.length,
                concluido,
                pagina: pagina_base44
            });
        }

        // ====================================================================
        // MODO: listar_omie — busca clientes paginados do Omie  
        // Retorna: códigos de integração e CPF/CNPJ de cada página
        // ====================================================================
        if (modo === "listar_omie") {
            console.log(`[sync] Buscando página ${pagina_omie} do Omie...`);
            const data = await buscarPaginaOmie(pagina_omie, 500);

            if (data.faultstring) {
                console.error('[sync] Erro Omie:', data.faultstring);
                return Response.json({ error: data.faultstring }, { status: 500 });
            }

            const clientes = (data.clientes_cadastro || []).map(c => ({
                codigo_integracao: c.codigo_cliente_integracao || '',
                cpf_cnpj: (c.cnpj_cpf || '').replace(/[^\d]/g, '')
            }));

            const totalPaginas = data.total_de_paginas || 1;
            const totalRegistros = data.total_de_registros || 0;

            console.log(`[sync] Página ${pagina_omie}/${totalPaginas}: ${clientes.length} registros (total: ${totalRegistros})`);

            return Response.json({
                pagina: pagina_omie,
                total_paginas: totalPaginas,
                total_registros: totalRegistros,
                clientes,
                concluido: pagina_omie >= totalPaginas
            });
        }

        // ====================================================================
        // MODO: comparar — recebe ambas as listas e retorna os faltantes
        // ====================================================================
        if (modo === "comparar") {
            const { clientes_base44, clientes_omie } = body;

            if (!clientes_base44 || !clientes_omie) {
                return Response.json({ error: 'Informe clientes_base44 e clientes_omie' }, { status: 400 });
            }

            const omieIntegracaoSet = new Set(
                clientes_omie.map(c => c.codigo_integracao).filter(Boolean)
            );
            const omieCpfCnpjSet = new Set(
                clientes_omie.map(c => c.cpf_cnpj).filter(v => v && v.length >= 11)
            );

            const faltando = [];
            const jaExistem = [];

            for (const c of clientes_base44) {
                const cpfNorm = (c.cpf_cnpj || '').replace(/[^\d]/g, '');
                const existePorId = omieIntegracaoSet.has(c.id);
                const existePorCpf = cpfNorm.length >= 11 && omieCpfCnpjSet.has(cpfNorm);

                if (!existePorId && !existePorCpf) {
                    faltando.push(c);
                } else {
                    jaExistem.push(c.id);
                }
            }

            return Response.json({
                total_base44: clientes_base44.length,
                total_omie: clientes_omie.length,
                faltando_no_omie: faltando.length,
                ja_existem_no_omie: jaExistem.length,
                clientes_faltando: faltando
            });
        }

        // ====================================================================
        // MODO: sincronizar — envia em lotes os clientes que faltam
        // ====================================================================
        if (modo === "sincronizar") {
            if (!ids_para_enviar || !Array.isArray(ids_para_enviar)) {
                return Response.json({ error: 'Informe ids_para_enviar' }, { status: 400 });
            }

            const LOTE_MAX = 10;
            const loteIds = ids_para_enviar.slice(lote_inicio, lote_inicio + LOTE_MAX);

            if (loteIds.length === 0) {
                return Response.json({ concluido: true, resumo: { total: 0, sucessos: 0, erros: 0 }, resultados: [] });
            }

            // Buscar dados completos dos clientes deste lote
            const clientesParaEnviar = [];
            for (const id of loteIds) {
                try {
                    const cli = await base44.asServiceRole.entities.Cliente.get(id);
                    if (cli) clientesParaEnviar.push(cli);
                } catch (e) {
                    console.error(`[sync] Erro ao buscar cliente ${id}:`, e.message);
                }
            }

            const resultados = [];
            const delay = (ms) => new Promise(r => setTimeout(r, ms));

            for (const cliente of clientesParaEnviar) {
                const clienteOmie = await mapearClienteParaOmie({ ...cliente });
                
                // Se mapeamento retornou erro de validação, registrar sem enviar
                if (clienteOmie.erro) {
                    resultados.push({
                        cliente_id: cliente.id,
                        razao_social: cliente.razao_social,
                        sucesso: false,
                        codigo_omie: null,
                        mensagem: `Dados inválidos: ${clienteOmie.erro}`
                    });
                    continue;
                }
                
                try {
                    console.log(`[sync] Enviando ${cliente.razao_social}: estado=${clienteOmie.estado}, cidade=${clienteOmie.cidade}, cep=${clienteOmie.cep}, bairro=${clienteOmie.bairro}`);
                    const response = await fetch(OMIE_URL, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            call: "UpsertCliente",
                            app_key: OMIE_APP_KEY,
                            app_secret: OMIE_APP_SECRET,
                            param: [clienteOmie]
                        })
                    });
                    const resultado = await response.json();
                    
                    // Detectar bloqueio de API e parar imediatamente
                    if (resultado.faultstring && resultado.faultstring.includes('API bloqueada por consumo indevido')) {
                        resultados.push({
                            cliente_id: cliente.id,
                            razao_social: cliente.razao_social,
                            sucesso: false,
                            codigo_omie: null,
                            mensagem: resultado.faultstring
                        });
                        // Retornar imediatamente com flag de bloqueio
                        return Response.json({
                            concluido: false,
                            bloqueado: true,
                            proximo_lote: lote_inicio,
                            resumo: { 
                                total: resultados.length, 
                                sucessos: resultados.filter(r => r.sucesso).length, 
                                erros: resultados.filter(r => !r.sucesso).length 
                            },
                            resultados,
                            mensagem_bloqueio: resultado.faultstring
                        });
                    }
                    
                    resultados.push({
                        cliente_id: cliente.id,
                        razao_social: cliente.razao_social,
                        sucesso: !resultado.faultstring,
                        codigo_omie: resultado.codigo_cliente_omie || null,
                        mensagem: resultado.faultstring || resultado.descricao_status || "Enviado com sucesso"
                    });
                } catch (err) {
                    resultados.push({
                        cliente_id: cliente.id,
                        razao_social: cliente.razao_social,
                        sucesso: false,
                        codigo_omie: null,
                        mensagem: err.message
                    });
                }
                await delay(1200);
            }

            const sucessos = resultados.filter(r => r.sucesso).length;
            const erros = resultados.filter(r => !r.sucesso).length;
            const proximoLote = lote_inicio + LOTE_MAX;
            const concluido = proximoLote >= ids_para_enviar.length;

            return Response.json({
                concluido,
                proximo_lote: concluido ? null : proximoLote,
                resumo: { total: resultados.length, sucessos, erros },
                resultados
            });
        }

        return Response.json({ error: 'Modo inválido. Use "listar_base44", "listar_omie", "comparar" ou "sincronizar"' }, { status: 400 });

    } catch (error) {
        console.error('Erro:', error.message);
        return Response.json({ error: error.message }, { status: 500 });
    }
});