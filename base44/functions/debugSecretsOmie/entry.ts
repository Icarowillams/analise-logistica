// Function temporária para diagnóstico dos secrets Omie
Deno.serve(async (req) => {
  const key = Deno.env.get('OMIE_APP_KEY');
  const secret = Deno.env.get('OMIE_APP_SECRET');
  return Response.json({
    has_key: !!key,
    has_secret: !!secret,
    key_length: key ? key.length : 0,
    secret_length: secret ? secret.length : 0,
    key_preview: key ? `${key.substring(0, 3)}...${key.substring(key.length - 2)}` : null,
    all_env_vars_with_omie: Object.keys(Deno.env.toObject()).filter(k => k.toLowerCase().includes('omie'))
  });
});