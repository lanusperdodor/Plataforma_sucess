# Instalar o Fluentia no Android

O app é configurado com o identificador `com.fluentia.pessoal`. Há duas formas de gerar o APK.

## Opção A — EAS Build (nuvem da Expo, recomendada)

Não precisa de Android Studio. Requer uma conta gratuita em expo.dev (o plano gratuito tem uma cota mensal de builds; confira em expo.dev/pricing).

```bash
cd fluentia
npm install
npx eas-cli@latest login
npx eas-cli@latest init          # vincula o projeto à sua conta (só na primeira vez)
npx eas-cli@latest build --platform android --profile preview
```

O perfil `preview` do `eas.json` gera um **APK**. Ao terminar, o terminal mostra um link e um QR code:

1. Abra o link no celular (ou leia o QR code) e baixe o `.apk`.
2. Toque no arquivo baixado. O Android pede para permitir "instalar apps desta fonte" para o navegador ou o gerenciador de arquivos — permita.
3. Instale e abra o **Fluentia** pelo ícone.

O perfil `production` gera um `.aab` (formato da Play Store), para uma eventual distribuição futura. Não é necessário publicar na loja.

## Opção B — build local

Requer o **JDK 17** (o plugin Gradle do React Native exige exatamente essa versão como toolchain; se houver outro JDK padrão, aponte com `org.gradle.java.installations.paths=/caminho/do/jdk-17` em `android/gradle.properties`) e o Android SDK (plataforma 37, build-tools 37.0.0, NDK 27.1.12297006, CMake 3.22.1).

```bash
cd fluentia
npm install
npx expo prebuild --platform android
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
# APK em android/app/build/outputs/apk/release/app-release.apk
```

Observação: o build local de release é assinado com a chave de depuração do template (suficiente para instalar no seu aparelho). Para atualizar o app sem desinstalar, use sempre a mesma assinatura: as versões geradas pelo EAS usam a chave guardada na sua conta Expo; elas não instalam por cima de um APK local (e vice-versa) — nesse caso, faça um **backup** em Perfil → Dados e backup, desinstale e restaure.

## Primeiro uso no celular

1. Abra o app, informe seu nome, o idioma inicial e o tempo diário.
2. Para usar o microfone: na primeira prática de fala o Android pede a permissão — permita.
3. Reconhecimento de fala: usa o serviço de voz do Android (app Google). Se um idioma não for reconhecido, instale-o em Configurações do Android → Google → Voz / Reconhecimento de fala offline.
4. Síntese de voz: usa as vozes do aparelho. Se a pronúncia de um idioma estiver ausente ou com voz robótica, instale a voz em Configurações → Acessibilidade/Sistema → Saída de texto para fala → Mecanismo do Google → instalar dados de voz (inglês, espanhol, coreano, chinês).
5. Professor de IA: Perfil → Inteligência artificial (veja docs/SERVICOS.md).

## Atualizar

Gere um novo APK (aumente `version`/`android.versionCode` em `app.json`) e instale por cima. Os dados do app são preservados. Faça backups de vez em quando: desinstalar o app apaga os dados locais.
