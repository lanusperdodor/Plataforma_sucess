import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, Row, Screen, T } from '@/components/ui';
import { LANG_CODES, LANGS, type LangCode } from '@/content';
import { updateProfile } from '@/db/repo';
import { useApp } from '@/state/app';
import { colors, radius, space } from '@/theme';

const MINUTES = [15, 30, 45, 60];

/** Primeira execução (ou depois de apagar tudo): exibida pela tela inicial enquanto o perfil não tem nome. */
export function Welcome() {
  const { db, refresh } = useApp();
  const [name, setName] = useState('');
  const [lang, setLang] = useState<LangCode>('en');
  const [minutes, setMinutes] = useState(30);
  const [custom, setCustom] = useState('');

  const save = async () => {
    const m = custom ? Number(custom) : minutes;
    await updateProfile(db, { name: name.trim(), active_lang: lang, daily_minutes: Number.isFinite(m) && m > 0 ? m : 30 });
    await refresh();
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={s.hero}>
        <Text style={s.logo}>Fluentia</Text>
        <T v="small">Seu professor particular de inglês, espanhol, coreano e mandarim.</T>
      </View>

      <Card>
        <T v="h3">Como posso te chamar?</T>
        <TextInput testID="nome" value={name} onChangeText={setName} placeholder="Seu nome" placeholderTextColor={colors.faint} style={s.input} autoCapitalize="words" maxLength={40} />
      </Card>

      <Card>
        <T v="h3">Por qual idioma quer começar?</T>
        <T v="small">Você pode estudar os quatro. O progresso de cada um é separado.</T>
        <View style={s.grid}>
          {LANG_CODES.map((c) => (
            <Pressable key={c} testID={`inicio-${c}`} onPress={() => setLang(c)} style={[s.lang, lang === c && s.on]} accessibilityRole="radio" accessibilityState={{ selected: lang === c }}>
              <Text style={s.flag}>{LANGS[c].flag}</Text>
              <T v="h3">{LANGS[c].name}</T>
              <T v="small">{LANGS[c].nativeName}</T>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <T v="h3">Quanto tempo por dia?</T>
        <Row gap={space.sm} wrap>
          {MINUTES.map((m) => (
            <Pressable key={m} onPress={() => { setMinutes(m); setCustom(''); }} style={[s.min, minutes === m && !custom && s.on]} accessibilityRole="radio">
              <T v="h3">{m} min</T>
            </Pressable>
          ))}
        </Row>
        <TextInput value={custom} onChangeText={(t) => setCustom(t.replace(/\D/g, ''))} placeholder="Outro (minutos)" placeholderTextColor={colors.faint} keyboardType="number-pad" style={s.input} maxLength={3} />
        <T v="small">Dá para mudar depois em Perfil → Plano de estudos.</T>
      </Card>

      <Button testID="comecar" title="Começar" icon="arrow-forward" onPress={save} disabled={!name.trim()} />
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { paddingVertical: space.xl, gap: space.sm },
  logo: { color: colors.primary, fontSize: 40, fontWeight: '900', letterSpacing: -1 },
  input: { backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 17, padding: space.md, marginTop: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  lang: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.surface2, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, padding: space.md, gap: 2 },
  on: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  flag: { fontSize: 26 },
  min: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface2 },
});
