import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const owner = body.owner || 'Icarowillams';
    const repo = body.repo || 'analise-logistica';
    const action = body.action || 'tree'; // 'tree' | 'file' | 'batch_files'
    const filePath = body.path || '';
    const filePaths = body.paths || []; // para batch_files

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('github');
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    // ACTION: tree — retorna toda a árvore de arquivos do repositório
    if (action === 'tree') {
      // Pegar o branch padrão
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
      const repoData = await repoRes.json();
      const defaultBranch = repoData.default_branch || 'main';

      // Pegar a árvore recursiva
      const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`;
      const treeRes = await fetch(treeUrl, { headers });
      const treeData = await treeRes.json();

      if (!treeData.tree) {
        return Response.json({ error: 'Não foi possível obter a árvore do repositório', data: treeData }, { status: 400 });
      }

      const files = treeData.tree
        .filter(item => item.type === 'blob')
        .map(item => ({
          path: item.path,
          size: item.size,
          sha: item.sha
        }));

      const dirs = treeData.tree
        .filter(item => item.type === 'tree')
        .map(item => item.path);

      return Response.json({
        sucesso: true,
        branch: defaultBranch,
        total_files: files.length,
        total_dirs: dirs.length,
        truncated: treeData.truncated || false,
        files,
        dirs
      });
    }

    // ACTION: file — retorna conteúdo de 1 arquivo
    if (action === 'file') {
      if (!filePath) return Response.json({ error: 'path obrigatório' }, { status: 400 });

      const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
      const fileRes = await fetch(fileUrl, { headers });
      const fileData = await fileRes.json();

      if (fileData.message) {
        return Response.json({ error: fileData.message, path: filePath }, { status: 404 });
      }

      let content = '';
      if (fileData.encoding === 'base64' && fileData.content) {
        try {
          content = atob(fileData.content.replace(/\n/g, ''));
        } catch {
          content = '[BINÁRIO — não é possível decodificar como texto]';
        }
      }

      return Response.json({
        sucesso: true,
        path: filePath,
        size: fileData.size,
        content: content.slice(0, 50000) // limitar para não estourar payload
      });
    }

    // ACTION: batch_files — retorna conteúdo de múltiplos arquivos
    if (action === 'batch_files') {
      if (!filePaths.length) return Response.json({ error: 'paths obrigatório' }, { status: 400 });

      const results = [];
      for (const fp of filePaths.slice(0, 15)) { // max 15 arquivos por batch
        try {
          const fileUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${fp}`;
          const fileRes = await fetch(fileUrl, { headers });
          const fileData = await fileRes.json();

          let content = '';
          if (fileData.encoding === 'base64' && fileData.content) {
            try {
              content = atob(fileData.content.replace(/\n/g, ''));
            } catch {
              content = '[BINÁRIO]';
            }
          }

          results.push({
            path: fp,
            size: fileData.size || 0,
            content: content.slice(0, 30000),
            error: fileData.message || null
          });
        } catch (e) {
          results.push({ path: fp, error: e.message, content: '' });
        }
        // Rate limit courtesy
        await new Promise(r => setTimeout(r, 100));
      }

      return Response.json({ sucesso: true, results });
    }

    return Response.json({ error: 'action inválida. Use: tree, file, batch_files' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});