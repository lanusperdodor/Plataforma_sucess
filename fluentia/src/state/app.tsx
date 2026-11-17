import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { LangCode } from '@/content';
import { addStudyTime, checkAchievements, getProfile, updateProfile, type Profile } from '@/db/repo';
import type { Db } from '@/db/types';
import type { AiClient } from '@/services/ai/client';
import { createRuntimeAi } from '@/services/aiRuntime';
import { sttAvailable } from '@/services/stt';

interface AppContextValue {
  db: Db;
  ai: AiClient;
  profile: Profile;
  lang: LangCode;
  setLang(lang: LangCode): Promise<void>;
  /** Releia os dados: chame depois de qualquer gravação que mude o que as telas mostram. */
  refresh(): Promise<void>;
  /** Muda a cada refresh; use como dependência de carregamento. */
  version: number;
  /** O aparelho tem reconhecimento de fala disponível. */
  speech: boolean;
  /** Última conquista desbloqueada, para avisar o usuário. */
  toast: string | null;
  clearToast(): void;
}

const Ctx = createContext<AppContextValue | null>(null);

export function AppProvider({ db, initialProfile, children }: { db: Db; initialProfile: Profile; children: ReactNode }) {
  const [profile, setProfile] = useState(initialProfile);
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const ai = useMemo(() => createRuntimeAi(db), [db]);
  const speech = useMemo(() => sttAvailable(), []);

  const refresh = useCallback(async () => {
    setProfile(await getProfile(db));
    setVersion((v) => v + 1);
    const fresh = await checkAchievements(db);
    if (fresh.length) setToast(`Conquista desbloqueada: ${fresh.map((a) => a.title).join(', ')}`);
  }, [db]);

  const setLang = useCallback(
    async (lang: LangCode) => {
      await updateProfile(db, { active_lang: lang });
      await refresh();
    },
    [db, refresh]
  );

  const value = useMemo<AppContextValue>(
    () => ({ db, ai, profile, lang: profile.active_lang, setLang, refresh, version, speech, toast, clearToast: () => setToast(null) }),
    [db, ai, profile, setLang, refresh, version, speech, toast]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp fora do AppProvider');
  return v;
}

/** Carrega dados do banco e recarrega quando a tela ganha foco ou quando algo é gravado. */
export function useData<T>(loader: (db: Db) => Promise<T>, deps: unknown[] = []): { data: T | null; error: string | null; reload(): void } {
  const { db, version } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loaderRef
        .current(db)
        .then((d) => {
          if (alive) {
            setData(d);
            setError(null);
          }
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : 'Erro ao carregar os dados.'));
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, version, tick, ...deps])
  );
  return { data, error, reload: () => setTick((t) => t + 1) };
}

/** Conta o tempo de estudo enquanto a tela está em foco e o app em primeiro plano. */
export function useStudyTimer(lang: LangCode, activity: string, active = true): void {
  const { db } = useApp();
  const started = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (started.current === null) return;
    const seconds = (Date.now() - started.current) / 1000;
    started.current = null;
    addStudyTime(db, lang, activity, seconds).catch(() => undefined);
  }, [db, lang, activity]);

  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      started.current = Date.now();
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') started.current = Date.now();
        else flush();
      });
      const timer = setInterval(() => {
        // Grava em blocos de um minuto para não perder tempo se o app for encerrado.
        flush();
        started.current = Date.now();
      }, 60_000);
      return () => {
        clearInterval(timer);
        sub.remove();
        flush();
      };
    }, [active, flush])
  );
}

export function useOnce(fn: () => void | (() => void)): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(fn, []);
}
