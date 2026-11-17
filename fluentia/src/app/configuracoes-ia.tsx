import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput } from 'react-native';
import { Button, Card, Header, Loading, Notice, Row, Screen, Section, T } from '@/components/ui';
import { aiUsageMonth, aiUsageOn, getSetting, setSetting } from '@/db/repo';
import { AiError, isValidBackendUrl, type HealthResult } from '@/services/ai/client';
import { clearAiConfig, DEFAULT_BACKEND_URL, DEFAULT_DAILY_AI_LIMIT, loadAiConfig, saveAiConfig } from '@/services/aiRuntime';
import { useApp, useData } from '@/state/app';
import { colors, radius, space } from '@/theme';

export default function AiSettings() {
  const router = useRouter();
  const { db, ai } = useApp();
  const [url, setUrl] = useState(DEFAULT_BACKEND_URL);
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [limit, setLimit] = useState('');
  const [status, setStatus] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [testing, setTesting] = useState(false);
  const { data, reload } = useData(async (d) => ({ today: await aiUsageOn(d), month: await aiUsageMonth(d), limit: Number(await getSetting(d, 'ai_daily_limit')) || DEFAULT_DAILY_AI_LIMIT }));

  useEffect(() => {
    loadAiConfig().then((c) => {
      if (c) {
        setUrl(c.baseUrl);
        setHasToken(true);
      }
    });
  }, []);
  if (!data) return <Loading />;

  const save = async () => {
    setStatus(null);
    if (!isValidBackendUrl(url)) return setStatus({ tone: 'danger', text: 'Use um endereço https:// (o token trafega no cabeçalho e precisa de conexão segura).' });
    const existing = await loadAiConfig();
    const t = token.trim() || existing?.token || '';
    if (t.length < 16) return setStatus({ tone: 'danger', text: 'O token precisa ter ao menos 16 caracteres (o mesmo APP_TOKEN do backend).' });
    await saveAiConfig({ baseUrl: url, token: t });
    setToken('');
    setHasToken(true);
    await test();
  };

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const h = await ai.health();
      setHealth(h);
      await setSetting(db, 'ai_pronunciation', h.pronunciation ? '1' : '0');
      setStatus(h.llm ? { tone: 'success', text: `Conectado. Provedor: ${h.provider}${h.model ? ` (${h.model})` : ''}.` } : { tone: 'danger', text: 'Backend acessível, mas sem chave do provedor de IA configurada.' });
    } catch (e) {
      setStatus({ tone: 'danger', text: e instanceof AiError ? e.message : 'Falha ao testar a conexão.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Screen>
      <Header title="Inteligência artificial" onBack={() => router.back()} />
      <Notice icon="shield-checkmark" text="O Fluentia não guarda chaves de provedores de IA. Ele fala só com um backend seu (um Cloudflare Worker gratuito incluído no projeto), que guarda a chave como segredo. Aqui você informa o endereço desse backend e o token pessoal que você definiu nele." />

      <Section title="Conexão">
        <Card>
          <T v="tiny">Endereço do backend</T>
          <TextInput testID="url-backend" value={url} onChangeText={setUrl} placeholder={DEFAULT_BACKEND_URL} placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={s.input} />
          <T v="tiny">Token pessoal (APP_TOKEN)</T>
          <TextInput testID="token-backend" value={token} onChangeText={setToken} placeholder={hasToken ? '•••••••• (salvo; deixe vazio para manter)' : 'Cole o token'} placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} secureTextEntry style={s.input} />
          <T v="small">Guardado no armazenamento seguro do Android (Keystore). Não entra no backup.</T>
          <Button testID="salvar-ia" title="Salvar e testar" icon="flash" loading={testing} onPress={save} disabled={!url} />
          {hasToken ? <Button variant="danger" small title="Remover configuração" onPress={async () => { await clearAiConfig(); setUrl(DEFAULT_BACKEND_URL); setHasToken(false); setHealth(null); setStatus(null); }} /> : null}
        </Card>
        {status ? <Notice tone={status.tone} text={status.text} /> : null}
        {health ? (
          <Card>
            <Row style={s.between}><T>Professor (modelo de linguagem)</T><T v="small" color={health.llm ? colors.success : colors.danger}>{health.llm ? 'disponível' : 'não configurado'}</T></Row>
            <Row style={s.between}><T>Avaliação fonética</T><T v="small" color={health.pronunciation ? colors.success : colors.muted}>{health.pronunciation ? 'disponível' : 'não configurada'}</T></Row>
          </Card>
        ) : null}
      </Section>

      <Section title="Controle de custos">
        <Card>
          <Row style={s.between}><T>Requisições hoje</T><T v="small">{data.today.requests} de {data.limit}</T></Row>
          <Row style={s.between}><T>Neste mês</T><T v="small">{data.month.requests} requisições · {Math.round((data.month.input + data.month.output) / 1000)} mil tokens</T></Row>
          <T v="small">Uma mensagem na conversa ≈ 1 requisição. O custo depende do provedor e do modelo; veja docs/SERVICOS.md. Configure também um limite de gastos no painel do provedor.</T>
          <T v="tiny">Limite diário no app</T>
          <Row gap={space.sm}>
            <TextInput value={limit} onChangeText={(t) => setLimit(t.replace(/\D/g, ''))} placeholder={String(data.limit)} placeholderTextColor={colors.faint} keyboardType="number-pad" style={[s.input, s.fill]} maxLength={4} />
            <Button small title="Salvar" disabled={!limit} onPress={async () => { await setSetting(db, 'ai_daily_limit', String(Math.max(1, Number(limit)))); setLimit(''); reload(); }} />
          </Row>
        </Card>
      </Section>

      <Section title="O que é enviado">
        <Card>
          <T v="small" color={colors.text}>• Conversa e redação: o texto que você escreve (ou que o reconhecimento de voz transcreveu) e o contexto da conversa vão ao seu backend e dele ao provedor de IA.</T>
          <T v="small" color={colors.text}>• Geração de lições: título e objetivos da unidade e uma amostra do vocabulário que você já aprendeu.</T>
          <T v="small" color={colors.text}>• Avaliação fonética (se configurada): a gravação da frase, só quando você toca em "Avaliação fonética".</T>
          <T v="small" color={colors.text}>• Voz: a síntese usa as vozes do Android (no aparelho). O reconhecimento usa o serviço de fala do Android (normalmente Google), que pode processar o áudio na nuvem.</T>
          <T v="small" color={colors.text}>• Nada é enviado nas lições, exercícios locais, revisões e estatísticas.</T>
        </Card>
      </Section>
    </Screen>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  between: { justifyContent: 'space-between' },
  input: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 15, padding: space.md },
});
