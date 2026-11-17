import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '@/theme';

/** Barras verticais simples (sem biblioteca externa). Valores nulos aparecem como "sem dados". */
export function BarChart({ data, max, format, height = 120, color = colors.primary, testID }: { data: { label: string; value: number | null }[]; max?: number; format?(v: number): string; height?: number; color?: string; testID?: string }) {
  const top = max ?? Math.max(1, ...data.map((d) => d.value ?? 0));
  const step = Math.max(1, Math.ceil(data.length / 7));
  return (
    <View testID={testID} accessibilityLabel={data.map((d) => `${d.label}: ${d.value === null ? 'sem dados' : format ? format(d.value) : d.value}`).join(', ')}>
      <View style={[s.bars, { height }]}>
        {data.map((d, i) => (
          <View key={i} style={s.col}>
            {d.value === null ? <View style={[s.empty, { height: 4 }]} /> : <View style={[s.bar, { height: Math.max(3, (d.value / top) * height), backgroundColor: color }]} />}
          </View>
        ))}
      </View>
      <View style={s.labels}>
        {data.map((d, i) => (
          <Text key={i} style={s.label} numberOfLines={1}>{i % step === 0 ? d.label : ''}</Text>
        ))}
      </View>
    </View>
  );
}

/** Calendário de atividade (últimas semanas), estilo mapa de calor. */
export function ActivityGrid({ days, studied }: { days: string[]; studied: Set<string> }) {
  return (
    <View style={s.grid}>
      {days.map((d) => (
        <View key={d} style={[s.cell, studied.has(d) && s.cellOn]} accessibilityLabel={`${d}: ${studied.has(d) ? 'estudou' : 'sem estudo'}`} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  col: { flex: 1, justifyContent: 'flex-end' },
  bar: { borderRadius: 4, width: '100%' },
  empty: { backgroundColor: colors.border, borderRadius: 2 },
  labels: { flexDirection: 'row', gap: 3, marginTop: space.xs },
  label: { flex: 1, color: colors.faint, fontSize: 9, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  cell: { width: 16, height: 16, borderRadius: radius.sm / 3, backgroundColor: colors.surface2 },
  cellOn: { backgroundColor: colors.primary },
});
