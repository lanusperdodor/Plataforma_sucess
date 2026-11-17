import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Button, Card, Header, Loading, Notice, Row, Screen, Section, T } from '@/components/ui';
import { aiUsageMonth, aiUsageOn, getSetting, setSetting } from '@/db/repo';
import { AiError, GEMINI_BASE_URL, isValidBackendUrl, type HealthResult } from '@/services/ai/client';
import { clearAiConfig, DEFAULT_BACKEND_URL, DEFAULT_DAILY_AI_LIMIT, loadAiConfig, saveAiConfig } from '@/services/aiRuntime';
import { useApp, useData } from '@/state/app';
import { colors, radius, space } from '@/theme';

type Mode = 'direct' | 'backend';
const GEMINI_KEYS_URL = 'https://aistudio.google.com/apikey';

export default function AiSettings() {
  const router = useRouter();
  const { db, ai } = useApp();
  const [mode, setMode] = useState<Mode>('direct');
  const [url, setUrl] = useState(DEFAULT_BACKEND_URL);
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState<{ mode: Mode } | null>(null);
  const [limit, setLimit] = useState('');
  const [status, setStatus] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [testing, setTesting] = useState(false);
  const { data, reload } = useData(async (d) => ({ today: await aiUsageOn(d), month: await aiUsageMonth(d), limit: Number(await getSetting(d, 'ai_daily_limit')) || DEFAULT_DAILY_AI_LIMIT }));

  useEffect(() => {
    loadAiConfig().then((c) => {
      if (!c) return;
      const m: Mode = c.mode === 'direct' ? 'direct' : 'backend';
      setMode(m);
      if (m === 'backend') setUrl(c.baseUrl);
      setSaved({ mode: m });
    });
  }, []);
  if (!data) return <Loading />;

  const save = async () => {
    setStatus(null);
    setHealth(null);
    const existing = await loadAiConfig();
    const keepOld = existing && (existing.mode ?? 'backend') === mode;
    const t = token.trim() || (keepOld ? existing!.token : '');
    if (mode === 'direct') {
      if (t.length < 20) return setStatus({ tone: 'danger', text: 'Cole a chave do Google AI Studio (começa com "AIza").' });
      await saveAiConfig({ mode: 'direct', baseUrl: GEMINI_BASE_URL, token: t });
    } else {
      if (!isValidBackendUrl(url)) return setStatus({ tone: 'danger', text: 'Use um endereço https:// (o token trafega no cabeçalho e precisa de conexão segura).' });
      if (t.length < 16) return setStatus({ tone: 'danger', text: 'O token precisa ter ao menos 16 caracteres (o mesmo APP_TOKEN do backend).' });
      await saveAiConfig({ mode: 'backend', baseUrl: url, token: t });
    }
    setToken('');
    setSaved({ mode });
    setTesting(true);
    try {
      const h = await ai.health();
      setHealth(h);
      if (mode === 'direct' && h.model) {
        const c = await loadAiConfig();
        if (c) await saveAiConfig({ ...c, model: h.model });
      }
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

      <Row gap={space.sm}>
        <Pressable testID="modo-gratis" onPress={() => { setMode('direct'); setStatus(null); }} style={[s.mode, mode === 'direct' && s.on]} accessibilityRole="radio" accessibilityState={{ selected: mode === 'direct' }}>
          <T v="h3">Simples e grátis</T>
          <T v="small">Google Gemini, com a sua chave</T>
        </Pressable>
        <Pressable testID="modo-backend" onPress={() => { setMode('backend'); setStatus(null); }} style={[s.mode, mode === 'backend' && s.on]} accessibilityRole="radio" accessibilityState={{ selected: mode === 'backend' }}>
          <T v="h3">Meu backend</T>
          <T v="small">Avançado (Cloudflare + Claude)</T>
        </Pressable>
      </Row>

      {mode === 'direct' ? (
        <Section title="Ligar em 1 minuto">
          <Card>
            <T v="small" color={colors.text}>1. Abra o Google AI Studio e entre com sua conta Google.</T>
            <Button small variant="secondary" icon="open-outline" title="Abrir aistudio.google.com/apikey" onPress={() => Linking.openURL(GEMINI_KEYS_URL)} />
            <T v="small" color={colors.text}>2. Toque em "Create API key" (criar chave) e copie a chave. Não precisa de cartão.</T>
            <T v="small" color={colors.text}>3. Cole aqui e toque em Salvar e testar.</T>
            <TextInput testID="chave-gemini" value={token} onChangeText={setToken} placeholder={saved?.mode === 'direct' ? '•••••••• (salva; deixe vazio para manter)' : 'Cole a chave (AIza…)'} placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} secureTextEntry style={s.input} />
            <Button testID="salvar-ia" title="Salvar e testar" icon="flash" loading={testing} onPress={save} />
          </Card>
          <Notice icon="information-circle" text="O nível gratuito do Gemini tem limites de uso por minuto e por dia (de sobra para estudar). No nível gratuito, o Google pode usar o conteúdo enviado para melhorar seus produtos: não escreva dados pessoais sensíveis nas conversas. A chave fica guardada só neste aparelho (Keystore) e não entra no backup." />
        </Section>
      ) : (
        <Section title="Conexão com o backend">
          <Card>
            <T v="tiny">Endereço do backend</T>
            <TextInput testID="url-backend" value={url} onChangeText={setUrl} placeholder={DEFAULT_BACKEND_URL} placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={s.input} />
            <T v="tiny">Token pessoal (APP_TOKEN)</T>
            <TextInput testID="token-backend" value={token} onChangeText={setToken} placeholder={saved?.mode === 'backend' ? '•••••••• (salvo; deixe vazio para manter)' : 'Cole o token'} placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} secureTextEntry style={s.input} />
            <T v="small">Veja docs/SERVICOS.md para publicar o backend. Ele usa Claude (pago por uso) e permite a avaliação fonética.</T>
            <Button testID="salvar-ia" title="Salvar e testar" icon="flash" loading={testing} onPress={save} disabled={!url} />
          </Card>
        </Section>
      )}

      {status ? <Notice tone={status.tone} text={status.text} /> : null}
      {health ? (
        <Card>
          <Row style={s.between}><T>Professor (modelo de linguagem)</T><T v="small" color={health.llm ? colors.success : colors.danger}>{health.llm ? 'disponível' : 'não configurado'}</T></Row>
          <Row style={s.between}><T>Avaliação fonética</T><T v="small" color={health.pronunciation ? colors.success : colors.muted}>{health.pronunciation ? 'disponível' : 'não configurada'}</T></Row>
        </Card>
      ) : null}
      {saved ? <Button variant="danger" small title="Remover configuração" onPress={async () => { await clearAiConfig(); setSaved(null); setHealth(null); setStatus(null); setUrl(DEFAULT_BACKEND_URL); }} /> : null}

      <Section title="Controle de uso">
        <Card>
          <Row style={s.between}><T>Requisições hoje</T><T v="small">{data.today.requests} de {data.limit}</T></Row>
          <Row style={s.between}><T>Neste mês</T><T v="small">{data.month.requests} requisições · {Math.round((data.month.input + data.month.output) / 1000)} mil tokens</T></Row>
          <T v="tiny">Limite diário no app</T>
          <Row gap={space.sm}>
            <TextInput value={limit} onChangeText={(t) => setLimit(t.replace(/\D/g, ''))} placeholder={String(data.limit)} placeholderTextColor={colors.faint} keyboardType="number-pad" style={[s.input, s.fill]} maxLength={4} />
            <Button small title="Salvar" disabled={!limit} onPress={async () => { await setSetting(db, 'ai_daily_limit', String(Math.max(1, Number(limit)))); setLimit(''); reload(); }} />
          </Row>
        </Card>
      </Section>

      <Section title="O que é enviado">
        <Card>
          <T v="small" color={colors.text}>• Conversa e redação: o texto que você escreve (ou que o reconhecimento de voz transcreveu) e o contexto da conversa vão ao provedor de IA escolhido.</T>
          <T v="small" color={colors.text}>• Geração de lições: título e objetivos da unidade e uma amostra do vocabulário que você já aprendeu.</T>
          <T v="small" color={colors.text}>• Voz: a síntese usa as vozes do Android (no aparelho). O reconhecimento usa o serviço de fala do Android (normalmente Google).</T>
          <T v="small" color={colors.text}>• Nada é enviado nas lições, exercícios, revisões e estatísticas.</T>
        </Card>
      </Section>
      <View />
    </Screen>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  between: { justifyContent: 'space-between' },
  mode: { flex: 1, padding: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface, gap: 2 },
  on: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  input: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 15, padding: space.md },
});
