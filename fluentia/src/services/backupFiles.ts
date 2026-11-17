import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { exportBackup, parseBackup, type BackupFile } from '@/db/backup';
import type { Db } from '@/db/types';
import { todayKey } from '@/domain/text';

/** Gera o arquivo de backup e abre o compartilhamento do Android (salvar no Drive, enviar a si mesmo etc.). */
export async function shareBackup(db: Db): Promise<string> {
  const json = JSON.stringify(await exportBackup(db));
  const name = `fluentia-backup-${todayKey()}.json`;
  if (Platform.OS === 'web') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = name;
    a.click();
    return name;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(json);
  if (!(await Sharing.isAvailableAsync())) throw new Error('O compartilhamento de arquivos não está disponível neste aparelho.');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Salvar backup do Fluentia' });
  return name;
}

/** Abre o seletor de arquivos e lê um backup. Não altera nada: a restauração é confirmada depois. */
export async function pickBackup(): Promise<BackupFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return null;
  const asset = res.assets[0];
  const text = Platform.OS === 'web' ? await (asset.file ? asset.file.text() : (await fetch(asset.uri)).text()) : await new File(asset.uri).text();
  return parseBackup(text);
}
