import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const payload = await req.json();
    const { event, data } = payload;
    
    // Só processa eventos de criação
    if (event?.type !== 'create') {
      return Response.json({ message: 'Evento ignorado - não é criação' });
    }
    
    const novoVendedor = data;
    
    if (!novoVendedor || !novoVendedor.id) {
      return Response.json({ error: 'Dados do vendedor inválidos' }, { status: 400 });
    }
    
    // Buscar todas as permissões existentes
    const permissoes = await base44.asServiceRole.entities.Permissao.list();
    
    // Verificar se já existe permissão para este vendedor
    const permExistente = permissoes.find(p => p.vendedor_id === novoVendedor.id);
    if (permExistente) {
      return Response.json({ message: 'Permissão já existe para este vendedor' });
    }
    
    // Se o vendedor tem uma função, buscar permissões de outro vendedor com a mesma função
    let permissaoModelo = null;
    
    if (novoVendedor.funcao_id) {
      // Buscar vendedores com a mesma função
      const vendedores = await base44.asServiceRole.entities.Vendedor.list();
      const vendedoresMesmaFuncao = vendedores.filter(v => 
        v.funcao_id === novoVendedor.funcao_id && v.id !== novoVendedor.id
      );
      
      // Buscar permissão de algum vendedor da mesma função
      for (const vendedor of vendedoresMesmaFuncao) {
        const perm = permissoes.find(p => p.vendedor_id === vendedor.id);
        if (perm) {
          permissaoModelo = perm;
          break;
        }
      }
    }
    
    // Se não encontrou modelo, também verificar pelo campo legado 'funcao'
    if (!permissaoModelo && novoVendedor.funcao) {
      const vendedores = await base44.asServiceRole.entities.Vendedor.list();
      const vendedoresMesmaFuncao = vendedores.filter(v => 
        v.funcao?.toLowerCase() === novoVendedor.funcao?.toLowerCase() && v.id !== novoVendedor.id
      );
      
      for (const vendedor of vendedoresMesmaFuncao) {
        const perm = permissoes.find(p => p.vendedor_id === vendedor.id);
        if (perm) {
          permissaoModelo = perm;
          break;
        }
      }
    }
    
    // Criar nova permissão para o vendedor
    const novaPermissao = {
      vendedor_id: novoVendedor.id,
      vendedor_email: novoVendedor.email || '',
      abas_visiveis: permissaoModelo?.abas_visiveis || [],
      permissoes_metas: permissaoModelo?.permissoes_metas || { visualizar: false, criar: false, alterar: false, excluir: false, exportar: false },
      permissoes_cadastros: permissaoModelo?.permissoes_cadastros || { criar: false, editar: false, excluir: false, importar_massa: false, visualizar: false, exportar: false },
      permissoes_importar: permissaoModelo?.permissoes_importar || { visualizar: false, importar: false, importar_massa: false, excluir_lancamento: false },
      permissoes_analises: permissaoModelo?.permissoes_analises || { visualizar: false, utilizar_filtros: false, exportar: false },
      permissoes_visitas: permissaoModelo?.permissoes_visitas || { visualizar: false, iniciar_roteiro: false, finalizar_roteiro: false, importar_fotos: false, marcar_solicitou_pedido: false, importar_ultimo_estoque: false, informar_estoque: false, informar_trocas: false },
      permissoes_relatorios: permissaoModelo?.permissoes_relatorios || { 
        rel_roteiros_visualizar: false, rel_roteiros_filtros: false, rel_roteiros_exportar: false,
        rel_estoque_visualizar: false, rel_estoque_filtros: false, rel_estoque_exportar: false,
        rel_trocas_visualizar: false, rel_trocas_filtros: false, rel_trocas_exportar: false,
        analise_visitas_visualizar: false, analise_visitas_filtros: false, analise_visitas_exportar: false
      }
    };
    
    await base44.asServiceRole.entities.Permissao.create(novaPermissao);
    
    return Response.json({ 
      success: true, 
      message: permissaoModelo 
        ? `Permissões copiadas de outro funcionário da mesma função` 
        : 'Permissão criada com valores padrão (sem modelo encontrado)'
    });
    
  } catch (error) {
    console.error('Erro ao aplicar permissão:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});