import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LANG_CODES, LANGS, type LangCode, type Level } from '@/content';
import { useApp } from '@/state/app';
import { colors, radius, space } from '@/theme';

/** Alterna o idioma em estudo. Cada idioma mostra o próprio nível: o progresso é independente. */
export function LangSwitcher({ levels }: { levels?: Partial<Record<LangCode, Level>> }) {
  const { lang, setLang } = useApp();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
      {LANG_CODES.map((code) => {
        const on = code === lang;
        return (
          <Pressable key={code} testID={`idioma-${code}`} onPress={() => setLang(code)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={LANGS[code].name} style={[s.chip, on && s.chipOn]}>
            <Text style={s.flag}>{LANGS[code].flag}</Text>
            <View>
              <Text style={[s.name, on && { color: colors.text }]}>{LANGS[code].name}</Text>
              <Text style={s.native}>
                {LANGS[code].nativeName}
                {levels?.[code] ? ` · ${levels[code]}` : ''}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: { gap: space.sm, paddingRight: space.lg },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm + 2, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  flag: { fontSize: 22 },
  name: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  native: { color: colors.faint, fontSize: 12 },
});
