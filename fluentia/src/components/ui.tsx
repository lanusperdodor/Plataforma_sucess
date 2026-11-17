import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, font, radius, space } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({ children, scroll = true, edges = ['top'], padded = true }: { children: ReactNode; scroll?: boolean; edges?: ('top' | 'bottom')[]; padded?: boolean }) {
  const pad = padded ? styles.pad : undefined;
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={[pad, styles.scrollContent]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, pad]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

type Variant = 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'tiny' | 'target';
export function T({ v = 'body', color, style, children, ...rest }: { v?: Variant; color?: string; style?: StyleProp<TextStyle>; children: ReactNode } & ComponentProps<typeof Text>) {
  const base = v === 'small' || v === 'tiny' ? colors.muted : colors.text;
  return (
    <Text {...rest} style={[font[v], { color: color ?? base }, v === 'tiny' && styles.upper, style]}>
      {children}
    </Text>
  );
}

export function Card({ children, style, onPress, tone, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; tone?: 'primary' | 'success' | 'danger' | 'warn'; testID?: string }) {
  const toneStyle =
    tone === 'primary'
      ? { backgroundColor: colors.primarySoft, borderColor: 'rgba(139,128,249,0.35)' }
      : tone === 'success'
        ? { backgroundColor: colors.successSoft, borderColor: 'rgba(74,222,128,0.35)' }
        : tone === 'danger'
          ? { backgroundColor: colors.dangerSoft, borderColor: 'rgba(248,113,113,0.35)' }
          : tone === 'warn'
            ? { backgroundColor: colors.warnSoft, borderColor: 'rgba(251,191,36,0.3)' }
            : null;
  if (onPress) {
    return (
      <Pressable testID={testID} onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.card, toneStyle, style, pressed && styles.pressed]}>
        {children}
      </Pressable>
    );
  }
  return (
    <View testID={testID} style={[styles.card, toneStyle, style]}>
      {children}
    </View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  small,
  style,
  testID,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const fg = variant === 'primary' || variant === 'success' ? '#0C0C11' : variant === 'danger' ? colors.danger : variant === 'ghost' ? colors.primary : colors.text;
  const inner = (
    <View style={[styles.btnInner, small && styles.btnSmall]}>
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={small ? 16 : 20} color={fg} /> : null}
      <Text style={[small ? styles.btnTextSmall : styles.btnText, { color: fg }]} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off }}
      style={({ pressed }) => [styles.btn, variant === 'secondary' && styles.btnSecondary, variant === 'danger' && styles.btnDanger, variant === 'success' && { backgroundColor: colors.success }, variant === 'ghost' && styles.btnGhost, off && styles.disabled, pressed && styles.pressed, style]}>
      {variant === 'primary' ? (
        <LinearGradient colors={['#9C92FF', colors.primaryStrong]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.btnGradient}>
          {inner}
        </LinearGradient>
      ) : (
        inner
      )}
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, active, size = 22, disabled, testID }: { icon: IconName; onPress: () => void; label: string; active?: boolean; size?: number; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconBtn, active && styles.iconBtnActive, disabled && styles.disabled, pressed && styles.pressed]}>
      <Ionicons name={icon} size={size} color={active ? colors.primary : colors.text} />
    </Pressable>
  );
}

export function ProgressBar({ value, color = colors.primary, height = 8 }: { value: number; color?: string; height?: number }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View style={[styles.track, { height }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
      <View style={{ width: `${pct * 100}%`, height, backgroundColor: color, borderRadius: radius.pill }} />
    </View>
  );
}

export function Pill({ text, tone = 'default', icon }: { text: string; tone?: 'default' | 'primary' | 'success' | 'danger' | 'warn'; icon?: IconName }) {
  const map = {
    default: [colors.surface2, colors.muted],
    primary: [colors.primarySoft, colors.primary],
    success: [colors.successSoft, colors.success],
    danger: [colors.dangerSoft, colors.danger],
    warn: [colors.warnSoft, colors.warn],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={fg} /> : null}
      <Text style={[styles.pillText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function Row({ children, style, gap = space.sm, wrap }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number; wrap?: boolean }) {
  return <View style={[styles.row, { gap }, wrap && styles.wrap, style]}>{children}</View>;
}

export function Stat({ icon, value, label, color = colors.primary }: { icon: IconName; value: string; label: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Row style={styles.sectionHead}>
        <T v="h2">{title}</T>
        {action}
      </Row>
      {children}
    </View>
  );
}

export function Notice({ icon = 'information-circle', text, tone = 'default', children }: { icon?: IconName; text: string; tone?: 'default' | 'warn' | 'danger' | 'primary' | 'success'; children?: ReactNode }) {
  const fg = tone === 'warn' ? colors.warn : tone === 'danger' ? colors.danger : tone === 'primary' ? colors.primary : tone === 'success' ? colors.success : colors.muted;
  return (
    <Card tone={tone === 'default' ? undefined : tone} style={styles.notice}>
      <Row style={styles.noticeRow} gap={space.md}>
        <Ionicons name={icon} size={20} color={fg} />
        <View style={styles.fill}>
          <T v="small" color={colors.text}>
            {text}
          </T>
          {children}
        </View>
      </Row>
    </Card>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <T v="small">{label}</T> : null}
    </View>
  );
}

export function Header({ title, onBack, right, subtitle }: { title: string; onBack?: () => void; right?: ReactNode; subtitle?: string }) {
  return (
    <Row style={styles.header} gap={space.md}>
      {onBack ? <IconButton icon="chevron-back" onPress={onBack} label="Voltar" testID="voltar" /> : null}
      <View style={styles.fill}>
        <T v="h2" numberOfLines={1}>
          {title}
        </T>
        {subtitle ? <T v="small">{subtitle}</T> : null}
      </View>
      {right}
    </Row>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  pad: { paddingHorizontal: space.lg },
  scrollContent: { paddingBottom: space.xxl * 2, paddingTop: space.sm, gap: space.lg, width: '100%', maxWidth: 720, alignSelf: 'center' },
  upper: { textTransform: 'uppercase' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.sm },
  pressed: { opacity: 0.75, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.4 },
  btn: { borderRadius: radius.md, overflow: 'hidden', minHeight: 54, justifyContent: 'center' },
  btnGradient: { minHeight: 54, justifyContent: 'center' },
  btnSecondary: { backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  btnDanger: { backgroundColor: colors.dangerSoft, borderWidth: 1, borderColor: 'rgba(248,113,113,0.4)' },
  btnGhost: { backgroundColor: 'transparent', minHeight: 44 },
  btnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  btnSmall: { paddingVertical: space.sm, paddingHorizontal: space.md },
  btnText: { fontSize: 16, fontWeight: '700' },
  btnTextSmall: { fontSize: 14, fontWeight: '700' },
  iconBtn: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  iconBtnActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  track: { backgroundColor: colors.surface2, borderRadius: radius.pill, overflow: 'hidden', width: '100%' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
  pillText: { fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  stat: { flex: 1, minWidth: 96, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: 4 },
  statValue: { color: colors.text, fontSize: 20, fontWeight: '800' },
  statLabel: { color: colors.muted, fontSize: 12 },
  section: { gap: space.md },
  sectionHead: { justifyContent: 'space-between' },
  notice: { padding: space.md },
  noticeRow: { alignItems: 'flex-start' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl, backgroundColor: colors.bg },
  header: { paddingVertical: space.sm },
});
