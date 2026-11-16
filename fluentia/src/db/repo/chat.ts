import type { LangCode, Level } from '@/content';
import { XP } from '@/domain/gamification';
import { todayKey } from '@/domain/text';
import type { Db } from '../types';
import { nowIso } from './core';
import { addXp } from './learning';

export interface Conversation {
  id: number;
  lang: LangCode;
  scenario_id: string;
  title: string;
  level: Level;
  created_at: string;
  updated_at: string;
}

export interface TutorFeedback {
  /** A frase do aluno estava correta e natural. */
  ok: boolean;
  corrected?: string;
  explanation?: string;
  /** Dica que leva o aluno a se corrigir, sem entregar a resposta. */
  hint?: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant';
  content: string;
  reading: string | null;
  translation: string | null;
  feedback_json: string | null;
  created_at: string;
}

export async function createConversation(db: Db, lang: LangCode, scenarioId: string, title: string, level: Level): Promise<number> {
  const now = nowIso();
  const r = await db.run('INSERT INTO conversations (lang, scenario_id, title, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [lang, scenarioId, title, level, now, now]);
  return r.lastInsertRowId;
}

export async function listConversations(db: Db, lang: LangCode): Promise<(Conversation & { messages: number; errors: number })[]> {
  return db.all(
    `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS messages,
            (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.feedback_json LIKE '%"ok":false%') AS errors
     FROM conversations c WHERE c.lang = ? ORDER BY c.updated_at DESC`,
    [lang]
  );
}

export async function getConversation(db: Db, id: number): Promise<Conversation | null> {
  return db.first<Conversation>('SELECT * FROM conversations WHERE id = ?', [id]);
}

export async function getMessages(db: Db, conversationId: number): Promise<Message[]> {
  return db.all<Message>('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id', [conversationId]);
}

export async function addMessage(
  db: Db,
  conversationId: number,
  m: { role: 'user' | 'assistant'; content: string; reading?: string | null; translation?: string | null; feedback?: TutorFeedback | null }
): Promise<number> {
  const now = nowIso();
  const r = await db.run(
    'INSERT INTO messages (conversation_id, role, content, reading, translation, feedback_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [conversationId, m.role, m.content, m.reading ?? null, m.translation ?? null, m.feedback ? JSON.stringify(m.feedback) : null, now]
  );
  await db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, conversationId]);
  if (m.role === 'user') {
    const c = await getConversation(db, conversationId);
    if (c) await addXp(db, c.lang, XP.conversationTurn, 'conversation');
  }
  return r.lastInsertRowId;
}

/** A correção do professor refere-se à mensagem do aluno; guardamos junto dela para revisar depois. */
export async function setMessageFeedback(db: Db, messageId: number, feedback: TutorFeedback): Promise<void> {
  await db.run('UPDATE messages SET feedback_json = ? WHERE id = ?', [JSON.stringify(feedback), messageId]);
}

export async function deleteConversation(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM messages WHERE conversation_id = ?', [id]);
  await db.run('DELETE FROM conversations WHERE id = ?', [id]);
}

export async function deleteAllConversations(db: Db): Promise<void> {
  await db.exec('DELETE FROM messages; DELETE FROM conversations;');
}

export interface WritingFeedback {
  corrected: string;
  /** Avaliação geral em português. */
  summary: string;
  issues: { category: string; original: string; suggestion: string; explanation: string }[];
  /** Estimativa da IA (não é medida objetiva nem certificação). */
  levelEstimate?: string;
  strengths?: string[];
}

export async function saveWriting(db: Db, lang: LangCode, taskType: string, prompt: string, text: string, feedback: WritingFeedback | null): Promise<number> {
  const r = await db.run('INSERT INTO writing_submissions (lang, task_type, prompt, text, feedback_json, created_at) VALUES (?, ?, ?, ?, ?, ?)', [lang, taskType, prompt, text, feedback ? JSON.stringify(feedback) : null, nowIso()]);
  await addXp(db, lang, XP.writingSubmitted, 'writing');
  return r.lastInsertRowId;
}

export async function listWriting(db: Db, lang: LangCode, limit = 20) {
  return db.all<{ id: number; task_type: string; prompt: string; text: string; feedback_json: string | null; created_at: string }>(
    'SELECT id, task_type, prompt, text, feedback_json, created_at FROM writing_submissions WHERE lang = ? ORDER BY id DESC LIMIT ?',
    [lang, limit]
  );
}

export async function deleteAllWriting(db: Db): Promise<void> {
  await db.exec('DELETE FROM writing_submissions;');
}

export async function logAiUsage(db: Db, kind: string, inputTokens: number, outputTokens: number): Promise<void> {
  await db.run('INSERT INTO ai_usage (kind, input_tokens, output_tokens, day, created_at) VALUES (?, ?, ?, ?, ?)', [kind, inputTokens, outputTokens, todayKey(), nowIso()]);
}

export async function aiUsageOn(db: Db, day = todayKey()): Promise<{ requests: number; input: number; output: number }> {
  const r = await db.first<{ requests: number; input: number; output: number }>(
    'SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output FROM ai_usage WHERE day = ?',
    [day]
  );
  return r ?? { requests: 0, input: 0, output: 0 };
}

export async function aiUsageMonth(db: Db): Promise<{ requests: number; input: number; output: number }> {
  const month = todayKey().slice(0, 7);
  const r = await db.first<{ requests: number; input: number; output: number }>(
    "SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output FROM ai_usage WHERE substr(day, 1, 7) = ?",
    [month]
  );
  return r ?? { requests: 0, input: 0, output: 0 };
}
