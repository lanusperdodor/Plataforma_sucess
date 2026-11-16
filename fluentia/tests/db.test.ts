import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CURRICULUM } from '../src/content';
import { exportBackup, parseBackup, restoreBackup, summarizeBackup, wipeUserData } from '../src/db/backup';
import { migrate, SCHEMA_VERSION } from '../src/db/migrations';
import * as repo from '../src/db/repo';
import { scoreSession, type Skill } from '../src/domain/exercises';
import { Rating } from '../src/domain/srs';
import { todayKey } from '../src/domain/text';
import { freshDb } from './helpers';
import { createNodeDb } from './nodeDb';

const score = (ok: number, total: number, skill: Skill = 'writing') =>
  scoreSession(Array.from({ length: total }, (_, i) => ({ skill, correct: i < ok })));
const enL1 = CURRICULUM.en[0].units[0].lessons[0];
const enL2 = CURRICULUM.en[0].units[0].lessons[1];
const koL1 = CURRICULUM.ko[0].units[0].lessons[0];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('inicialização e migrações', () => {
  it('cria o esquema, o perfil, os quatro idiomas e o currículo', async () => {
    const db = await freshDb();
    expect((await db.first<{ user_version: number }>('PRAGMA user_version'))!.user_version).toBe(SCHEMA_VERSION);
    expect((await repo.getProfile(db)).active_lang).toBe('en');
    expect((await repo.getLanguages(db)).map((l) => l.code)).toEqual(['en', 'es', 'ko', 'zh']);
    for (const lang of ['en', 'es', 'ko', 'zh'] as const) {
      const tree = await repo.getCourseTree(db, lang);
      expect(repo.flattenLessons(tree).length).toBeGreaterThanOrEqual(9);
      expect(tree.some((u) => u.status === 'planned' && u.level === 'C2')).toBe(true);
    }
  });
  it('migrar e inicializar de novo não duplica nem apaga nada', async () => {
    const db = await freshDb();
    await repo.updateProfile(db, { name: 'Marcos' });
    const before = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM lessons'))!.n;
    expect(await migrate(db)).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION });
    await repo.bootstrap(db);
    expect((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM lessons'))!.n).toBe(before);
    expect((await repo.getProfile(db)).name).toBe('Marcos');
  });
  it('recusa abrir um banco de versão mais nova que o app', async () => {
    const db = createNodeDb();
    await db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    await expect(migrate(db)).rejects.toThrow(/mais novo/);
  });
});

describe('persistência', () => {
  it('o progresso continua lá depois de fechar e reabrir o banco', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fluentia-'));
    dirs.push(dir);
    const path = join(dir, 'fluentia.db');
    const db1 = await freshDb(path);
    await repo.updateProfile(db1, { name: 'Marcos', active_lang: 'ko', daily_minutes: 45 });
    await repo.recordAssessment(db1, 'ko', koL1, score(9, 10));
    await repo.addStudyTime(db1, 'ko', 'lesson', 300);
    db1.close();

    const db2 = await freshDb(path);
    const p = await repo.getProfile(db2);
    expect([p.name, p.active_lang, p.daily_minutes]).toEqual(['Marcos', 'ko', 45]);
    const s = await repo.getLangSummary(db2, 'ko');
    expect(s.lessonsCompleted).toBe(1);
    expect(s.wordsLearned).toBe(koL1.words.length + koL1.sentences.length);
    expect(await repo.secondsOn(db2, todayKey(), 'ko')).toBe(300);
    db2.close();
  });
});

describe('progresso', () => {
  it('cada idioma tem progresso independente', async () => {
    const db = await freshDb();
    await repo.recordAssessment(db, 'en', enL1, score(10, 10));
    await repo.recordAssessment(db, 'en', enL2, score(8, 10));
    await repo.recordAssessment(db, 'ko', koL1, score(7, 10));
    const [en, es, ko, zh] = await Promise.all((['en', 'es', 'ko', 'zh'] as const).map((l) => repo.getLangSummary(db, l)));
    expect(en.lessonsCompleted).toBe(2);
    expect(ko.lessonsCompleted).toBe(1);
    expect(es.lessonsCompleted).toBe(0);
    expect(zh.lessonsCompleted).toBe(0);
    expect(es.started).toBe(false);
    expect(zh.wordsLearned).toBe(0);
    expect(en.nextLesson?.id).toBe('en.a1.u1.l3');
    expect(ko.nextLesson?.id).toBe('ko.a1.u1.l2');
    expect(es.nextLesson?.id).toBe('es.a1.u1.l1');
  });
  it('nota abaixo do mínimo não conclui a lição nem libera a próxima', async () => {
    const db = await freshDb();
    await repo.recordAssessment(db, 'en', enL1, score(5, 10));
    const s = await repo.getLangSummary(db, 'en');
    expect(s.lessonsCompleted).toBe(0);
    expect(s.wordsLearned).toBe(0);
    const lessons = repo.flattenLessons(await repo.getCourseTree(db, 'en'));
    expect(lessons[0].status).toBe('started');
    expect(repo.isUnlocked(lessons, 'en.a1.u1.l1')).toBe(true);
    expect(repo.isUnlocked(lessons, 'en.a1.u1.l2')).toBe(false);
  });
  it('só abrir a lição não a conclui', async () => {
    const db = await freshDb();
    await repo.markLessonStarted(db, enL1.id, 'en');
    expect((await repo.getLangSummary(db, 'en')).lessonsCompleted).toBe(0);
  });
  it('refazer uma lição concluída com nota baixa não a desfaz e guarda a melhor nota', async () => {
    const db = await freshDb();
    expect((await repo.recordAssessment(db, 'en', enL1, score(9, 10))).firstCompletion).toBe(true);
    expect((await repo.recordAssessment(db, 'en', enL1, score(3, 10))).firstCompletion).toBe(false);
    const l = repo.flattenLessons(await repo.getCourseTree(db, 'en'))[0];
    expect(l.status).toBe('completed');
    expect(l.best_score).toBeCloseTo(0.9);
    expect((await repo.getLangSummary(db, 'en')).wordsLearned).toBe(enL1.words.length + enL1.sentences.length);
  });
  it('o nível em estudo é o da próxima lição pendente', async () => {
    const db = await freshDb();
    const s0 = await repo.getLangSummary(db, 'en');
    expect([s0.level, s0.levelProgress]).toEqual(['A1', 0]);
    for (const u of CURRICULUM.en[0].units) for (const l of u.lessons) await repo.recordAssessment(db, 'en', l, score(10, 10));
    const s1 = await repo.getLangSummary(db, 'en');
    expect(s1.finishedAvailable).toBe(true);
    expect(s1.level).toBe('A1');
    expect(s1.levelProgress).toBe(1);
  });
});

describe('respostas e estatísticas', () => {
  it('registra acertos e erros por habilidade; respostas não avaliadas não contam', async () => {
    const db = await freshDb();
    const base = { lang: 'en' as const, lessonId: enL1.id, itemId: enL1.words[0].id, context: 'practice' as const };
    await repo.recordAttempt(db, { ...base, type: 'dictation', skill: 'listening', correct: true });
    await repo.recordAttempt(db, { ...base, type: 'dictation', skill: 'listening', correct: false, userAnswer: 'tree', expected: 'three' });
    await repo.recordAttempt(db, { ...base, type: 'speak', skill: 'speaking', correct: null });
    const stats = await repo.getSkillStats(db, 'en');
    expect(stats.find((s) => s.skill === 'listening')).toMatchObject({ total: 2, correct: 1, accuracy: 0.5 });
    expect(stats.find((s) => s.skill === 'speaking')).toMatchObject({ total: 0, accuracy: null });
    const t = await repo.getTotals(db);
    expect([t.correct, t.wrong, t.attempts]).toEqual([1, 1, 2]);
    expect(t.streak).toBe(1);
    expect((await repo.getSkillStats(db, 'es')).every((s) => s.total === 0)).toBe(true);
  });
  it('tempo de estudo é separado por idioma', async () => {
    const db = await freshDb();
    await repo.addStudyTime(db, 'en', 'lesson', 120);
    await repo.addStudyTime(db, 'zh', 'review', 60);
    await repo.addStudyTime(db, 'zh', 'review', 1);
    const t = await repo.getTotals(db);
    expect(t.secondsByLang).toEqual({ en: 120, es: 0, ko: 0, zh: 60 });
    expect(t.seconds).toBe(180);
  });
  it('conquistas vêm de dados reais e não se repetem', async () => {
    const db = await freshDb();
    expect(await repo.checkAchievements(db)).toEqual([]);
    await repo.recordAssessment(db, 'en', enL1, score(10, 10));
    const got = (await repo.checkAchievements(db)).map((a) => a.id);
    expect(got).toContain('first-lesson');
    expect(got).toContain('perfect');
    expect(await repo.checkAchievements(db)).toEqual([]);
  });
});

describe('revisão espaçada (FSRS)', () => {
  it('itens de uma lição concluída entram na fila de revisão', async () => {
    const db = await freshDb();
    await repo.recordAssessment(db, 'en', enL1, score(10, 10));
    const n = enL1.words.length + enL1.sentences.length;
    expect(await repo.countDue(db, 'en')).toBe(n);
    expect(await repo.countDue(db, 'es')).toBe(0);
  });
  it('"Bom" adia o cartão; "Errei" o traz de volta logo; intervalos crescem com acertos', async () => {
    const db = await freshDb();
    await repo.recordAssessment(db, 'en', enL1, score(10, 10));
    const t0 = new Date('2026-01-01T10:00:00Z');
    const [a, b] = await repo.getDueCards(db, 'en', 2, new Date());
    let good = await repo.rateCard(db, a, Rating.Good, t0);
    const again = await repo.rateCard(db, b, Rating.Again, t0);
    expect(new Date(again.due).getTime()).toBeLessThan(new Date(good.due).getTime());
    expect(new Date(again.due).getTime() - t0.getTime()).toBeLessThanOrEqual(10 * 60000);

    const intervals: number[] = [];
    for (let i = 0; i < 5; i++) {
      const when = new Date(good.due);
      good = await repo.rateCard(db, good, Rating.Good, when);
      intervals.push(new Date(good.due).getTime() - when.getTime());
    }
    expect(intervals[4]).toBeGreaterThan(intervals[1]);
    expect(intervals[4]).toBeGreaterThan(5 * 86400000);
  });
  it('a fila traz primeiro o que venceu há mais tempo e respeita a data', async () => {
    const db = await freshDb();
    await repo.recordAssessment(db, 'en', enL1, score(10, 10));
    const t0 = new Date();
    const cards = await repo.getDueCards(db, 'en', 50, t0);
    for (const c of cards) await repo.rateCard(db, c, Rating.Easy, t0);
    expect(await repo.countDue(db, 'en', t0)).toBe(0);
    const later = new Date(t0.getTime() + 120 * 86400000);
    expect(await repo.countDue(db, 'en', later)).toBe(cards.length);
    const due = await repo.getDueCards(db, 'en', 50, later);
    expect(due.map((d) => d.due)).toEqual([...due.map((d) => d.due)].sort());
  });
  it('errar um item aprendido em um exercício antecipa a revisão dele', async () => {
    const db = await freshDb();
    await repo.recordAssessment(db, 'en', enL1, score(10, 10));
    const t0 = new Date();
    for (const c of await repo.getDueCards(db, 'en', 50, t0)) await repo.rateCard(db, c, Rating.Easy, t0);
    expect(await repo.countDue(db, 'en')).toBe(0);
    await repo.recordAttempt(db, { lang: 'en', lessonId: enL1.id, itemId: enL1.words[0].id, type: 'translate', skill: 'writing', correct: false, context: 'drill' });
    expect(await repo.countDue(db, 'en', new Date(Date.now() + 1000))).toBe(1);
    expect((await repo.getHardItems(db, 'en'))[0].item_id).toBe(enL1.words[0].id);
  });
  it('retenção só considera cartões já aprendidos', async () => {
    const db = await freshDb();
    await repo.recordAssessment(db, 'en', enL1, score(10, 10));
    const t0 = new Date();
    const [a, b] = await repo.getDueCards(db, 'en', 2, t0);
    const a1 = await repo.rateCard(db, a, Rating.Good, t0);
    const b1 = await repo.rateCard(db, b, Rating.Good, t0);
    expect((await repo.getReviewOverview(db, 'en', t0)).retention30).toBeNull();
    await repo.rateCard(db, a1, Rating.Good, t0);
    await repo.rateCard(db, b1, Rating.Again, t0);
    const o = await repo.getReviewOverview(db, 'en', t0);
    expect(o.retention30).toBe(0.5);
    expect(o.reviews30).toBe(2);
  });
});

describe('conversas', () => {
  it('guarda mensagens, correções e apaga o histórico quando pedido', async () => {
    const db = await freshDb();
    const id = await repo.createConversation(db, 'es', 'restaurant', 'Restaurante', 'A1');
    const m = await repo.addMessage(db, id, { role: 'user', content: 'Quiero un cafe' });
    await repo.setMessageFeedback(db, m, { ok: false, corrected: 'Quiero un café.', explanation: 'Falta o acento.' });
    await repo.addMessage(db, id, { role: 'assistant', content: '¡Claro!', translation: 'Claro!' });
    const list = await repo.listConversations(db, 'es');
    expect(list[0]).toMatchObject({ messages: 2, errors: 1 });
    expect(await repo.listConversations(db, 'en')).toEqual([]);
    expect((await repo.getMessages(db, id)).map((x) => x.role)).toEqual(['user', 'assistant']);
    await repo.deleteAllConversations(db);
    expect(await repo.listConversations(db, 'es')).toEqual([]);
    expect((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM messages'))!.n).toBe(0);
  });
});

describe('backup e restauração', () => {
  async function populated() {
    const db = await freshDb();
    await repo.updateProfile(db, { name: 'Marcos', active_lang: 'zh', daily_minutes: 60 });
    await repo.updateLanguage(db, 'es', { weekdays: [1, 3, 5], priority: 2 });
    await repo.recordAssessment(db, 'en', enL1, score(10, 10));
    await repo.recordAssessment(db, 'ko', koL1, score(8, 10));
    await repo.addStudyTime(db, 'en', 'lesson', 600);
    const c = await repo.createConversation(db, 'en', 'free', 'Conversa livre', 'A1');
    await repo.addMessage(db, c, { role: 'user', content: 'Hello' });
    await repo.checkAchievements(db);
    return db;
  }
  it('exporta, restaura em um banco novo e os dados ficam idênticos', async () => {
    const src = await populated();
    const json = JSON.stringify(await exportBackup(src));
    const backup = parseBackup(json);
    expect(summarizeBackup(backup)).toMatchObject({ lessons: 2, conversations: 1 });

    const dst = await freshDb();
    await restoreBackup(dst, backup);
    await repo.bootstrap(dst);
    for (const t of ['profile', 'languages', 'lesson_progress', 'vocabulary', 'reviews', 'assessments', 'messages', 'study_sessions', 'xp_log', 'achievements']) {
      expect(await dst.all(`SELECT * FROM ${t} ORDER BY 1`), t).toEqual(await src.all(`SELECT * FROM ${t} ORDER BY 1`));
    }
    expect((await repo.getLangSummary(dst, 'en')).lessonsCompleted).toBe(1);
    expect(repo.flattenLessons(await repo.getCourseTree(dst, 'es')).length).toBeGreaterThan(0);
  });
  it('restaurar substitui (não mistura com) o que havia antes', async () => {
    const backup = await exportBackup(await populated());
    const dst = await freshDb();
    await repo.recordAssessment(dst, 'es', CURRICULUM.es[0].units[0].lessons[0], score(10, 10));
    await restoreBackup(dst, backup);
    expect((await repo.getLangSummary(dst, 'es')).lessonsCompleted).toBe(0);
    expect((await repo.getLangSummary(dst, 'ko')).lessonsCompleted).toBe(1);
  });
  it('rejeita arquivos inválidos sem tocar nos dados', async () => {
    expect(() => parseBackup('isto não é json')).toThrow(/JSON/);
    expect(() => parseBackup('{"format":"outro"}')).toThrow(/Fluentia/);
    expect(() => parseBackup(JSON.stringify({ format: 'fluentia-backup', schemaVersion: 999, tables: {} }))).toThrow(/mais nova/);
  });
  it('falha no meio da restauração desfaz tudo', async () => {
    const db = await populated();
    const backup = await exportBackup(db);
    backup.tables.vocabulary = [{ item_id: null as unknown as string, lang: 'en' }];
    await expect(restoreBackup(db, backup)).rejects.toThrow();
    expect((await repo.getLangSummary(db, 'en')).lessonsCompleted).toBe(1);
    expect((await repo.getProfile(db)).name).toBe('Marcos');
  });
  it('apagar tudo zera o progresso e mantém o currículo', async () => {
    const db = await populated();
    await wipeUserData(db);
    await repo.bootstrap(db);
    expect((await repo.getLangSummary(db, 'en')).lessonsCompleted).toBe(0);
    expect((await repo.getTotals(db)).xp).toBe(0);
    expect(repo.flattenLessons(await repo.getCourseTree(db, 'en')).length).toBeGreaterThanOrEqual(9);
  });
});
