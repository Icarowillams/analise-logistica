import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const owner = body.owner || 'Icarowillams';
    const repo = body.repo || 'analise-logistica';
    const filterPrefix = body.prefix || ''; // ex: 'base44/src/functions'
    const filterExtensions = body.extensions || []; // ex: ['.js', '.jsx', '.ts']

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('github');
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };

    const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    const repoData = await repoRes.json();
    const defaultBranch = repoData.default_branch || 'main';

    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`;
    const treeRes = await fetch(treeUrl, { headers });
    const treeData = await treeRes.json();

    let files = (treeData.tree || []).filter(item => item.type === 'blob');
    
    if (filterPrefix) {
      files = files.filter(f => f.path.startsWith(filterPrefix));
    }
    if (filterExtensions.length > 0) {
      files = files.filter(f => filterExtensions.some(ext => f.path.endsWith(ext)));
    }

    return Response.json({
      sucesso: true,
      total: files.length,
      files: files.map(f => ({ path: f.path, size: f.size }))
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});