import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Button, Card, Header, Notice, Screen, Section, T } from '@/components/ui';
import { restoreBackup, summarizeBackup, wipeUserData, type BackupFile } from '@/db/backup';
import { bootstrap, deleteAllConversations, deleteAllWriting } from '@/db/repo';
import { pickBackup, shareBackup } from '@/services/backupFiles';
import { useApp } from '@/state/app';
import { colors, radius, space } from '@/theme';

export default function DataScreen() {
  const router = useRouter();
  const { db, refresh } = useApp();
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pending, setPending] = useState<BackupFile | null>(null);
  // Confirmação dentro do app antes de qualquer operação destrutiva (o claude.ai bloqueia o confirm() do navegador).
  const [ask, setAsk] = useState<{ title: string; message: string; resolve: (ok: boolean) => void } | null>(null);
  const confirm = (title: string, message: string) => new Promise<boolean>((resolve) => setAsk({ title, message, resolve }));
  const answer = (ok: boolean) => {
    ask?.resolve(ok);
    setAsk(null);
  };

  const run = async (fn: () => Promise<string>) => {
    setMsg(null);
    try {
      setMsg({ tone: 'success', text: await fn() });
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'A operação falhou.' });
    }
  };

  const summary = pending ? summarizeBackup(pending) : null;

  return (
    <Screen>
      <Header title="Dados e backup" onBack={() => router.back()} />
      <Modal visible={!!ask} transparent animationType="fade" onRequestClose={() => answer(false)}>
        <View style={s.backdrop}>
          <View style={s.dialog} accessibilityRole="alert">
            <T v="h2">{ask?.title ?? ''}</T>
            <T color={colors.text}>{ask?.message ?? ''}</T>
            <Button testID="confirmar" variant="danger" title="Confirmar" onPress={() => answer(true)} />
            <Button testID="cancelar" variant="secondary" title="Cancelar" onPress={() => answer(false)} />
          </View>
        </View>
      </Modal>
      <Notice icon="phone-portrait" text="Todo o seu progresso fica neste aparelho (SQLite). Faça backups de vez em quando: se o app for desinstalado, os dados locais são apagados." />
      {msg ? <Notice tone={msg.tone} text={msg.text} /> : null}

      <Section title="Backup">
        <Card>
          <T v="small">Gera um arquivo .json com perfil, progresso, vocabulário, revisões, conversas, textos e estatísticas. O token da IA não entra no arquivo.</T>
          <Button testID="exportar" title="Exportar backup" icon="download" onPress={() => run(async () => `Backup gerado: ${await shareBackup(db)}`)} />
          <Button
            testID="importar"
            variant="secondary"
            title="Restaurar de um arquivo"
            icon="push"
            onPress={() => run(async () => { const b = await pickBackup(); setPending(b); return b ? 'Arquivo lido. Confira e confirme abaixo.' : 'Nenhum arquivo escolhido.'; })}
          />
        </Card>
        {pending && summary ? (
          <Card tone="warn">
            <T v="h3">Restaurar este backup?</T>
            <T v="small" color={colors.text}>Criado em {new Date(summary.exportedAt).toLocaleString('pt-BR')}: {summary.lessons} lições concluídas, {summary.words} itens de vocabulário, {summary.conversations} conversas.</T>
            <T v="small" color={colors.warn}>Os dados atuais deste aparelho serão substituídos.</T>
            <Button
              testID="confirmar-restauracao"
              variant="danger"
              title="Substituir e restaurar"
              onPress={() => run(async () => {
                if (!(await confirm('Restaurar backup', 'Os dados atuais serão substituídos pelos do arquivo. Continuar?'))) return 'Restauração cancelada.';
                await restoreBackup(db, pending);
                await bootstrap(db);
                setPending(null);
                await refresh();
                return 'Backup restaurado.';
              })}
            />
            <Button variant="ghost" small title="Cancelar" onPress={() => setPending(null)} />
          </Card>
        ) : null}
      </Section>

      <Section title="Privacidade">
        <Card>
          <T v="small">Gravações de voz são temporárias: ficam só no cache durante o exercício e são apagadas ao repetir ou sair.</T>
          <Button variant="danger" small title="Apagar histórico de conversas" onPress={() => run(async () => { if (!(await confirm('Apagar conversas', 'Todas as conversas com o professor serão apagadas.'))) return 'Cancelado.'; await deleteAllConversations(db); await refresh(); return 'Conversas apagadas.'; })} />
          <Button variant="danger" small title="Apagar textos de escrita" onPress={() => run(async () => { if (!(await confirm('Apagar textos', 'Todos os textos enviados para correção serão apagados.'))) return 'Cancelado.'; await deleteAllWriting(db); await refresh(); return 'Textos apagados.'; })} />
        </Card>
      </Section>

      <Section title="Recomeçar do zero">
        <Card tone="danger">
          <T v="small" color={colors.text}>Apaga todo o progresso dos quatro idiomas, revisões, conversas e estatísticas. Não pode ser desfeito (a menos que você tenha um backup).</T>
          <Button
            testID="apagar-tudo"
            variant="danger"
            title="Apagar todos os dados"
            onPress={() => run(async () => {
              if (!(await confirm('Apagar todos os dados', 'Todo o seu progresso será apagado definitivamente. Tem certeza?'))) return 'Cancelado.';
              await wipeUserData(db);
              await bootstrap(db);
              await refresh();
              // A tela Início passa a mostrar as boas-vindas, porque o perfil ficou sem nome.
              return 'Dados apagados. Abra a aba Início para recomeçar.';
            })}
          />
        </Card>
      </Section>
    </Screen>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: space.lg },
  dialog: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.md, width: '100%', maxWidth: 480, alignSelf: 'center' },
});
