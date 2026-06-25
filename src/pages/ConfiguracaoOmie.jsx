import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { KeyRound, Save, Loader2, CheckCircle2, XCircle, ShieldAlert, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function ConfiguracaoOmie() {
  const [user, setUser] = useState(null);
  const [config, setConfig] = useState(null);
  const [appKey, setAppKey] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [secretMascarado, setSecretMascarado] = useState(null); // só leitura de status; nunca o secret completo
  const [nome, setNome] = useState('Produção');
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const carregar = async () => {
    const me = await base44.auth.me().catch(() => null);
    setUser(me);
    if (me?.role === 'admin') {
      // SEGURANÇA/LGPD: a tela NUNCA lê o app_secret completo do banco.
      // Usa getOmieCredentials (action get) que valida admin no servidor e devolve
      // apenas o secret MASCARADO ("...últimos4"). O campo de secret é write-only.
      const res = await base44.functions.invoke('getOmieCredentials', { action: 'get' }).catch(() => null);
      const data = res?.data || null;
      if (data) {
        setSecretMascarado(data.appSecretMascarada || null);
        // App Key não é segredo — exibe normalmente (mascarada se vier do backend).
        setAppKey(data.appKeyMascarada || '');
        if (data.nome) setNome(data.nome);
        if (data.id || data.atualizado_em) {
          setConfig({ id: data.id, updated_date: data.atualizado_em });
        }
      }
      // app_secret começa SEMPRE vazio — nunca recebe o valor real.
      setAppSecret('');
    }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);

  const salvar = async () => {
    // Write-only: App Key e App Secret em branco mantêm o valor atual do banco.
    // Só bloqueia quando NÃO há config ainda (criação inicial exige ambos).
    const keyDigitada = appKey.trim();
    const secretDigitado = appSecret.trim();
    // App Key vem mascarada do backend ("...1234"); não enviar valor mascarado de volta.
    const keyParaEnviar = keyDigitada && !keyDigitada.startsWith('...') ? keyDigitada : '';
    if (!config?.id && (!keyParaEnviar || !secretDigitado)) {
      toast.error('Para criar a configuração inicial, informe App Key e App Secret.');
      return;
    }
    setSaving(true);
    try {
      const res = await base44.functions.invoke('salvarCredenciaisOmie', {
        nome: nome.trim() || 'Produção',
        app_key: keyParaEnviar,        // em branco = mantém a atual
        app_secret: secretDigitado     // em branco = mantém o atual
      });
      const data = res?.data || {};
      if (data.error) throw new Error(data.error);
      toast.success('Credenciais salvas com sucesso!');
      setTestResult(null);
      setAppSecret(''); // limpa o campo após salvar — nunca retém o secret
      await carregar();
    } catch (e) {
      toast.error('Erro ao salvar: ' + (e?.response?.data?.error || e.message));
    } finally {
      setSaving(false);
    }
  };

  const testar = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await base44.functions.invoke('testarConexaoOmie', {});
      const data = res?.data || res;
      setTestResult(data);
      if (data.ok) toast.success('Conexão Omie OK!');
      else toast.error('Falha na conexão: ' + (data.error || 'desconhecido'));
    } catch (e) {
      setTestResult({ ok: false, error: e.message });
      toast.error('Erro ao testar: ' + e.message);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-cyan-600" /></div>;
  }

  if (user?.role !== 'admin') {
    return (
      <div className="max-w-xl mx-auto mt-10">
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-slate-600">
            <ShieldAlert className="w-6 h-6 text-amber-500" />
            Acesso restrito a administradores.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-cyan-600 flex items-center justify-center">
          <KeyRound className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Credenciais Omie</h1>
          <p className="text-sm text-slate-500">Gerencie as chaves de acesso à API Omie diretamente pelo banco.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Configuração ativa</span>
            {config?.updated_date && (
              <Badge variant="outline" className="font-normal">
                Atualizado em {format(new Date(config.updated_date), 'dd/MM/yyyy HH:mm')}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nome (identificação)</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Produção" />
          </div>
          <div className="space-y-2">
            <Label>App Key</Label>
            <Input value={appKey} onChange={(e) => setAppKey(e.target.value)} placeholder="OMIE_APP_KEY" />
            <p className="text-xs text-slate-400">Mostrada mascarada. Digite uma nova App Key apenas se quiser substituir a atual.</p>
          </div>
          <div className="space-y-2">
            <Label>App Secret</Label>
            <div className="relative">
              <Input
                type={showSecret ? 'text' : 'password'}
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder={secretMascarado ? 'Deixe em branco para manter o atual' : 'OMIE_APP_SECRET'}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-slate-400">
              {secretMascarado
                ? <>App Secret configurado: <span className="font-mono text-slate-500">••••••{String(secretMascarado).slice(-4)}</span> — por segurança, não é exibido. Deixe em branco para mantê-lo.</>
                : 'Nenhum App Secret configurado ainda.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Button onClick={salvar} disabled={saving} className="bg-cyan-600 hover:bg-cyan-700">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Salvar
            </Button>
            <Button onClick={testar} disabled={testing} variant="outline">
              {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Testar conexão
            </Button>
          </div>

          {testResult && (
            <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${testResult.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
              {testResult.ok ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <XCircle className="w-5 h-5 shrink-0" />}
              <div>
                {testResult.ok ? (
                  <>
                    <div className="font-medium">Conexão OK — {testResult.empresa?.razao_social}</div>
                    <div className="text-xs opacity-80">Fonte das credenciais: {testResult.fonte_credencial || 'n/d'}</div>
                  </>
                ) : (
                  <div>{testResult.error}</div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-slate-400 text-center">
        As credenciais ficam salvas no banco (entidade ConfiguracaoOmie). Todas as integrações Omie passam a usar este registro automaticamente.
      </p>
    </div>
  );
}