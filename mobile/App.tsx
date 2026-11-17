import * as Linking from 'expo-linking'
import * as Location from 'expo-location'
import * as Network from 'expo-network'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useRef, useState, type ComponentType, type RefAttributes } from 'react'
import { BackHandler, Platform, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { WebView as RNWebView, type WebViewNavigation } from 'react-native-webview'
import type { AndroidWebViewProps, IOSWebViewProps, ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes'
import { SITE_URL, isInternalUrl, startUrlFor } from './src/site'

void SplashScreen.preventAutoHideAsync()

/** Métodos usados do navegador interno. */
interface WebHandle { goBack(): void; reload(): void; injectJavaScript(js: string): void }
// a tipagem oficial junta as props do Windows e vira "never" no TypeScript 6; o app só roda em Android e iOS
const WebView = RNWebView as unknown as ComponentType<IOSWebViewProps & AndroidWebViewProps & RefAttributes<WebHandle>>

/**
 * App Tucaí (Android e iOS). Abre a plataforma por dentro do app e acrescenta recursos do celular:
 *  * GPS liberado para a navegação do entregador e o rastreio do cliente;
 *  * som do pedido novo sem precisar tocar na tela (mídia sem gesto liberada no app);
 *  * câmera e galeria para fotos, botão Voltar do Android, links externos (WhatsApp, telefone, mapas) fora do app;
 *  * tela própria quando estiver sem internet.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  )
}

function Shell() {
  const dark = useColorScheme() === 'dark'
  const web = useRef<WebHandle>(null)
  const [canGoBack, setCanGoBack] = useState(false)
  const [offline, setOffline] = useState(false)
  const [startUrl, setStartUrl] = useState(SITE_URL)

  // link de convite/notificação (tucai://pedidos/123 ou https://…/pedidos/123) abre a tela certa
  useEffect(() => {
    void Linking.getInitialURL().then((u) => { if (u) setStartUrl(startUrlFor(u)) })
    const sub = Linking.addEventListener('url', ({ url }) => {
      const target = startUrlFor(url)
      web.current?.injectJavaScript(`window.location.assign(${JSON.stringify(target)}); true;`)
    })
    return () => sub.remove()
  }, [])

  // pede a localização uma vez (o site usa para rota do entregador e rastreio)
  useEffect(() => { void Location.requestForegroundPermissionsAsync().catch(() => undefined) }, [])

  // Android: botão Voltar volta a página dentro do app
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) { web.current?.goBack(); return true }
      return false
    })
    return () => sub.remove()
  }, [canGoBack])

  const retry = useCallback(async () => {
    const s = await Network.getNetworkStateAsync().catch(() => null)
    if (s?.isInternetReachable === false) return
    setOffline(false)
    web.current?.reload()
  }, [])

  const onNav = (e: WebViewNavigation) => setCanGoBack(e.canGoBack)

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: dark ? '#17191B' : '#FFFFFF' }]} edges={['top', 'left', 'right']}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {offline ? (
        <View style={styles.offline}>
          <Text style={[styles.title, { color: dark ? '#fff' : '#17191B' }]}>Sem internet</Text>
          <Text style={[styles.text, { color: dark ? '#cbd5e1' : '#475569' }]}>Confira o Wi-Fi ou os dados móveis e tente de novo.</Text>
          <Pressable accessibilityRole="button" onPress={() => void retry()} style={styles.button}>
            <Text style={styles.buttonText}>Tentar de novo</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          ref={web}
          source={{ uri: startUrl }}
          style={styles.web}
          applicationNameForUserAgent="TucaiApp/1.0"
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          geolocationEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          allowsBackForwardNavigationGestures
          pullToRefreshEnabled
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          originWhitelist={['https://*', 'tucai://*']}
          onNavigationStateChange={onNav}
          onLoadEnd={() => void SplashScreen.hideAsync()}
          onError={() => { setOffline(true); void SplashScreen.hideAsync() }}
          onShouldStartLoadWithRequest={(req: ShouldStartLoadRequest) => {
            if (isInternalUrl(req.url)) return true
            // WhatsApp, telefone, e-mail, mapas, pagamento: fora do app
            void Linking.openURL(req.url).catch(() => undefined)
            return false
          }}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  web: { flex: 1 },
  offline: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '700' },
  text: { fontSize: 16, textAlign: 'center' },
  button: { marginTop: 8, backgroundColor: '#FF5500', borderRadius: 999, paddingHorizontal: 28, paddingVertical: 14, minHeight: 48 },
  buttonText: { color: '#17191B', fontSize: 17, fontWeight: '700' },
})
