import { EN } from './en';
import { ES } from './es';
import { KO } from './ko';
import { ZH } from './zh';
import type { CourseContent, LangCode } from './types';

export const CURRICULUM: Record<LangCode, CourseContent[]> = { en: EN, es: ES, ko: KO, zh: ZH };

/** Mude quando o conteúdo embutido mudar, para o app atualizar as tabelas de curso. */
export const CONTENT_VERSION = '2026.11.1';

export * from './types';
