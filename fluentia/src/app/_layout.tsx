import { DarkTheme, ThemeProvider } from 'expo-router';
import Stack from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Loading, T } from '@/components/ui';
import { openAppDb } from '@/db/expoDb';
import { migrate } from '@/db/migrations';
import { bootstrap, getProfile, type Profile } from '@/db/repo';
import type { Db } from '@/db/types';
import { AppProvider, useApp } from '@/state/app';
import { colors, radius, space } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const navTheme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, border: colors.border, primary: colors.primary, text: colors.text } };

function Toast() {
  const { toast, clearToast } = useApp();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clearToast, 5000);
    return () => clearTimeout(t);
  }, [toast, clearToast]);
  if (!toast) return null;
  return (
    <Pressable onPress={clearToast} style={[s.toast, { top: insets.top + space.sm }]} accessibilityRole="alert">
      <T v="small" color={colors.bg} style={s.toastText}>
        🏆 {toast}
      </T>
    </Pressable>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState<{ db: Db; profile: Profile } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const db = await openAppDb();
      await migrate(db);
      await bootstrap(db);
      setReady({ db, profile: await getProfile(db) });
    })()
      .catch((e) => setError(e instanceof Error ? e.message : 'Erro desconhecido ao abrir o banco de dados.'))
      .finally(() => SplashScreen.hideAsync().catch(() => undefined));
  }, []);

  if (error) {
    return (
      <View style={s.error}>
        <T v="h2">Não foi possível abrir seus dados</T>
        <T v="small">{error}</T>
        <T v="small">Seus dados não foram alterados. Feche e abra o aplicativo de novo; se persistir, atualize o Fluentia.</T>
      </View>
    );
  }
  if (!ready) return <Loading label="Preparando o Fluentia…" />;

  return (
    <GestureHandlerRootView style={s.fill}>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          <AppProvider db={ready.db} initialProfile={ready.profile}>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade_from_bottom' }} />
            <Toast />
          </AppProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  error: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: space.xl, gap: space.md },
  toast: { position: 'absolute', left: space.lg, right: space.lg, backgroundColor: colors.primary, borderRadius: radius.md, padding: space.md, alignItems: 'center' },
  toastText: { fontWeight: '700' },
});
