# Status da entrega

Legenda: ✅ implementado e testado automaticamente · 🔌 implementado, depende de configuração/serviço externo · 📱 implementado, depende do aparelho e **não foi testado em um celular real** · ⏳ pendente · ⚠️ limitação conhecida.

## Implementado e testado (testes automatizados)

- ✅ Banco SQLite com migrações, inicialização, persistência entre aberturas (arquivo real) e após recarregar o app (web).
- ✅ Quatro idiomas com progresso independente; seletor de idioma; níveis A1–C2 por idioma.
- ✅ Currículo A1 real: 3 unidades e 9 lições por idioma (36 lições), cada uma com objetivo, explicação, notas de pronúncia para brasileiros, 8–12 palavras, 3–7 frases e cenário de conversa. Coreano começa pelo Hangul e esconde a romanização a partir da 3ª unidade; mandarim começa por tons, pinyin e caracteres/radicais, com exercícios de tom.
- ✅ Exercícios: significado, tradução inversa, escuta + significado, identificar o que foi dito, montar frase, completar, tradução digitada (EN/ES), tradução para o português, ditado (EN/ES), identificação de tom, fala (pulável).
- ✅ Correção com várias respostas aceitas, tolerância a acento/digitação, diff do que faltou/sobrou; erros voltam como reforço na prática.
- ✅ Avaliação por lição (≥ 70 % para concluir), resultado por habilidade, melhor nota, desbloqueio sequencial, revisitar lições concluídas.
- ✅ Revisão espaçada FSRS, "Revisar hoje", retenção medida, dificuldades.
- ✅ Treinos livres de escuta, fala e escrita com o vocabulário estudado (priorizando os itens difíceis).
- ✅ Plano diário adaptativo, tempo por dia (15/30/45/60/personalizado), dias e prioridade por idioma, distribuição equilibrada, metas semanais.
- ✅ XP, sequência, recorde, conquistas (dados reais), calendário de atividade, estatísticas com gráficos; métricas objetivas separadas das estimativas da IA.
- ✅ Backup (exportar/importar JSON, com confirmação e restauração atômica), apagar conversas, textos ou tudo (com confirmação).
- ✅ Cliente de IA: timeout, repetição controlada, teto diário local, registro de tokens, mensagens de erro claras, nada inventado em falhas.
- ✅ Backend: autenticação por token, validação, limites por minuto/dia, logs sem conteúdo, Anthropic com fallback de recusa, alternativa compatível com "chat completions".
- ✅ APK de release compilado nesta sessão (`./gradlew assembleRelease`, arm64-v8a e armeabi-v7a, 58 MB): pacote `com.fluentia.pessoal`, versão 1.0.0, minSdk 24 / targetSdk 36, assinatura v2 verificada com `apksigner`. Assinado com a chave de depuração do template (serve para instalar no seu aparelho; não é para a Play Store).

## Versão web no claude.ai

- ✅ Publicada como página privada em https://claude.ai/artifact/VVpmN4gSA3CYuUUZJMM8Qe (o mesmo app, compilado para a web).
- ✅ Verificado no visualizador do claude.ai (emulado nesta sessão): cadastro, abrir lição de coreano, responder exercício com correção, professor respondendo com "Claude (sua conta)", progresso preservado ao recarregar, sem erros no console.
- Banco na web: SQLite (sql.js, WebAssembly) salvo no IndexedDB do navegador. Os dados ficam só naquele navegador; use o backup para levar a outro aparelho.
- Professor: capacidade `sample` do claude.ai (o Claude de quem abre a página). Microfone: ditado do claude.ai (só Chrome no computador e app desktop; nos apps de celular do Claude o ditado não é oferecido e os exercícios de fala podem ser pulados). Backup: download confirmado pelo claude.ai.
- ⚠️ Não testado com uma conta real abrindo o link: a primeira abertura é a sua. O claude.ai pede permissão na primeira pergunta ao Claude e no primeiro uso do microfone.

## Implementado, depende de configuração externa

- 🔌 Professor virtual (texto e voz), correção de redações, geração de lições com IA: precisam de uma chave de IA. Modo **grátis**: chave do Google Gemini colada no app, sem servidor. Modo avançado: backend próprio com Claude. **Testado só com respostas simuladas** (unitários e interface) — nenhuma chamada real a um provedor foi feita nesta sessão (não havia chave).
- 🔌 Avaliação fonética real (Azure AI Speech): código pronto, testado só com resposta simulada.
- 🔌 `eas build`: exige sua conta Expo (login), não feito aqui (o APK foi gerado pelo build local).
- 🔌 Backend publicado na Cloudflare: feito por você no painel (docs/SERVICOS.md, opção 1).

## Depende do aparelho (não testado em celular real)

- 📱 Microfone, permissão, reconhecimento de fala (`expo-speech-recognition`) e gravação temporária para reprodução (Android 13+).
- 📱 Síntese de voz por idioma (depende das vozes instaladas no aparelho) e velocidade reduzida.
- 📱 Compartilhar/salvar o arquivo de backup e escolher arquivo para restaurar.
- 📱 Vibração, armazenamento seguro (Keystore).

Esses fluxos foram verificados por compilação de tipos, pelo bundle do Android e, na versão web, pela interface (o teste web intercepta a síntese de voz e pula a fala, pois o navegador de teste não tem microfone).

## Pendente

- ⏳ Lições escritas para A2–C2 e para as unidades finais do A1: estão no currículo como unidades planejadas, com objetivos; podem ser geradas com IA no app (marcadas como "geradas por IA"). Escrever e revisar esse conteúdo à mão é o próximo grande trabalho.
- ⏳ Exercícios com imagens ("descrever imagens") e interpretação de textos longos: não implementados (sem banco de imagens com licença adequada). A escrita livre e o professor cobrem parte disso.
- ⏳ Conversa de baixa latência com detecção automática de silêncio e interrupção: hoje é por turnos (toque para falar; a captura termina sozinha no silêncio). Requer provedor com API de voz em tempo real.
- ⏳ Traçado de caracteres na tela (ordem dos traços interativa): hoje há explicação das regras e prática de reconhecimento.
- ⏳ Download de áudios para uso offline: a síntese já é local; não há áudios gravados por nativos.

## Limitações conhecidas

- ⚠️ Os níveis exibidos refletem o progresso no curso do app; não são certificação, nem equivalência exata com TOPIK/HSK.
- ⚠️ O resultado da prática de fala indica se o reconhecedor entendeu as palavras; não avalia fonemas, tons ou entonação sem o serviço fonético.
- ⚠️ Reconhecimento de fala e qualidade das vozes variam por aparelho e idioma; coreano e mandarim podem exigir instalar o idioma no app Google.
- ⚠️ Conteúdo gerado por IA (lições e correções) pode conter imprecisões; o app sinaliza o que é gerado.
- ⚠️ Limites de requisição do backend são por instância do Worker (aproximados); o teto real de gasto deve ser configurado no painel do provedor.
