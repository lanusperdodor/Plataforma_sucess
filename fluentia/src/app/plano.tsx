import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import { Button, Card, Header, Loading, Row, Screen, Section, T } from '@/components/ui';
import { LANG_CODES, LANGS, type LangCode } from '@/content';
import { getGoals, getLanguages, setGoal, updateLanguage, updateProfile } from '@/db/repo';
import { balancedWeek } from '@/domain/plan';
import { useApp, useData } from '@/state/app';
import { colors, radius, space } from '@/theme';

const DAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export default function Plan() {
  const router = useRouter();
  const { db, profile, refresh } = useApp();
  const [custom, setCustom] = useState('');
  const { data, reload } = useData(async (d) => ({ langs: await getLanguages(d), goals: await getGoals(d) }));
  if (!data) return <Loading />;

  const change = async (fn: () => Promise<void>) => {
    await fn();
    await refresh();
    reload();
  };
  const toggleDay = (code: LangCode, day: number) =>
    change(async () => {
      const row = data.langs.find((l) => l.code === code)!;
      const days: number[] = JSON.parse(row.weekdays);
      await updateLanguage(db, code, { weekdays: days.includes(day) ? days.filter((x) => x !== day) : [...days, day].sort() });
    });
  const balance = () =>
    change(async () => {
      const active = data.langs.filter((l) => l.active).map((l) => l.code);
      const week = balancedWeek(active, active.length > 2 ? 2 : active.length);
      for (const l of active) await updateLanguage(db, l, { weekdays: week[l] });
    });

  return (
    <Screen>
      <Header title="Plano de estudos" onBack={() => router.back()} />
      <Section title="Tempo por dia">
        <Row gap={space.sm} wrap>
          {[15, 30, 45, 60].map((m) => (
            <Pressable key={m} testID={`minutos-${m}`} onPress={() => change(() => updateProfile(db, { daily_minutes: m }))} style={[s.opt, profile.daily_minutes === m && s.on]}><T v="h3">{m} min</T></Pressable>
          ))}
        </Row>
        <Row gap={space.sm}>
          <TextInput value={custom} onChangeText={(t) => setCustom(t.replace(/\D/g, ''))} placeholder={`Personalizado (atual: ${profile.daily_minutes})`} placeholderTextColor={colors.faint} keyboardType="number-pad" style={s.input} maxLength={3} />
          <Button small title="Salvar" disabled={!custom} onPress={() => change(async () => { await updateProfile(db, { daily_minutes: Number(custom) }); setCustom(''); })} />
        </Row>
      </Section>

      <Section title="Idiomas e dias">
        <T v="small">Você não precisa estudar todos os idiomas todo dia. Escolha os dias de cada um; o tempo do dia é dividido entre os idiomas agendados, conforme a prioridade.</T>
        <Button small variant="secondary" icon="git-compare" title="Distribuir de forma equilibrada" onPress={balance} />
        {LANG_CODES.map((code) => {
          const row = data.langs.find((l) => l.code === code)!;
          const days: number[] = JSON.parse(row.weekdays);
          return (
            <Card key={code} style={row.active ? undefined : s.off}>
              <Row style={s.between}>
                <T v="h3">{LANGS[code].flag} {LANGS[code].name}</T>
                <Pressable onPress={() => change(() => updateLanguage(db, code, { active: !row.active }))} style={[s.toggle, !!row.active && s.on]} accessibilityRole="switch" accessibilityState={{ checked: !!row.active }}>
                  <T v="small" color={row.active ? colors.text : colors.muted}>{row.active ? 'Ativo' : 'Pausado'}</T>
                </Pressable>
              </Row>
              <Row gap={space.xs}>
                {DAYS.map((d, i) => (
                  <Pressable key={i} onPress={() => toggleDay(code, i)} accessibilityRole="checkbox" accessibilityLabel={DAY_NAMES[i]} accessibilityState={{ checked: days.includes(i) }} style={[s.day, days.includes(i) && s.on]}><T v="small" color={days.includes(i) ? colors.text : colors.faint}>{d}</T></Pressable>
                ))}
              </Row>
              <Row gap={space.xs}>
                <T v="small">Prioridade:</T>
                {[1, 2, 3].map((p) => (
                  <Pressable key={p} onPress={() => change(() => updateLanguage(db, code, { priority: p }))} style={[s.prio, row.priority === p && s.on]}><T v="small">{['Normal', 'Alta', 'Máxima'][p - 1]}</T></Pressable>
                ))}
              </Row>
            </Card>
          );
        })}
      </Section>

      <Section title="Metas semanais">
        {(['weekly_lessons', 'weekly_reviews'] as const).map((k) => (
          <Card key={k}>
            <Row style={s.between}>
              <T>{k === 'weekly_lessons' ? 'Lições por semana' : 'Revisões por semana'}</T>
              <Row gap={space.sm}>
                <Button small variant="secondary" title="−" onPress={() => change(() => setGoal(db, k, (data.goals[k] ?? 1) - (k === 'weekly_lessons' ? 1 : 10)))} />
                <T v="h3">{data.goals[k]}</T>
                <Button small variant="secondary" title="+" onPress={() => change(() => setGoal(db, k, (data.goals[k] ?? 1) + (k === 'weekly_lessons' ? 1 : 10)))} />
              </Row>
            </Row>
          </Card>
        ))}
      </Section>
    </Screen>
  );
}

const s = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  opt: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  on: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  off: { opacity: 0.55 },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.text, padding: space.md, fontSize: 16 },
  toggle: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  day: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2 },
  prio: { paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
});
