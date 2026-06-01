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
      const rows = await base44.entities.ConfiguracaoOmie.filter({ ativo: true }, '-updated_date', 1).catch(() => []);
      const ativo = rows?.[0];
      if (ativo) {
        setConfig(ativo);
        setAppKey(ativo.app_key || '');
        setAppSecret(ativo.app_secret || '');
        setNome(ativo.nome || 'Produção');
      }
    }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []);

  const salvar = async () => {
    if (!appKey.trim() || !appSecret.trim()) {
      toast.error('Preencha App Key e App Secret.');
      return;
    }
    setSaving(true);
    try {
      if (config?.id) {
        await base44.entities.ConfiguracaoOmie.update(config.id, {
          nome: nome.trim() || 'Produção',
          app_key: appKey.trim(),
          app_secret: appSecret.trim(),
          ativo: true
        });
      } else {
        const novo = await base44.entities.ConfiguracaoOmie.create({
          nome: nome.trim() || 'Produção',
          app_key: appKey.trim(),
          app_secret: appSecret.trim(),
          ativo: true
        });
        setConfig(novo);
      }
      toast.success('Credenciais salvas no banco com sucesso!');
      setTestResult(null);
      await carregar();
    } catch (e) {
      toast.error('Erro ao salvar: ' + e.message);
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
          </div>
          <div className="space-y-2">
            <Label>App Secret</Label>
            <div className="relative">
              <Input
                type={showSecret ? 'text' : 'password'}
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder="OMIE_APP_SECRET"
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