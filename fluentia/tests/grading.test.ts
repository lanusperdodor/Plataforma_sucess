import { describe, expect, it } from 'vitest';
import { compareSpeech, gradeText } from '../src/domain/grading';
import { diffTokens, normalize } from '../src/domain/text';

describe('correção de respostas escritas', () => {
  it('ignora caixa, pontuação e espaços', () => {
    expect(gradeText('  how ARE you ', ['How are you?'], 'en').verdict).toBe('correct');
  });
  it('aceita contrações equivalentes em inglês', () => {
    expect(gradeText("I'm from Brazil", ['I am from Brazil.'], 'en').correct).toBe(true);
    expect(gradeText('I do not understand', ["I don't understand."], 'en').correct).toBe(true);
    expect(gradeText("She isn't my mother", ['She is not my mother.'], 'en').correct).toBe(true);
  });
  it('aceita qualquer uma das respostas previstas', () => {
    const accepted = ['Estou bem, obrigado.', 'Estou bem, obrigada.', 'Eu estou bem, obrigado.'];
    expect(gradeText('eu estou bem obrigado', accepted, 'pt').verdict).toBe('correct');
    expect(gradeText('estou bem, obrigada', accepted, 'pt').verdict).toBe('correct');
  });
  it('acento faltando conta como acerto com ressalva', () => {
    const g = gradeText('Como estas?', ['¿Cómo estás?'], 'es');
    expect(g.verdict).toBe('almost');
    expect(g.correct).toBe(true);
    expect(g.note).toMatch(/acento/);
  });
  it('um erro de digitação em palavra longa é tolerado, com aviso', () => {
    const g = gradeText('I am from Brazik', ['I am from Brazil.'], 'en');
    expect(g.verdict).toBe('almost');
  });
  it('não tolera troca em palavra curta nem palavra errada', () => {
    expect(gradeText('He is my father', ['She is my father.'], 'en').correct).toBe(false);
    expect(gradeText('I am from China', ['I am from Brazil.'], 'en').correct).toBe(false);
    expect(gradeText('', ['Hello'], 'en').correct).toBe(false);
  });
  it('mostra o que faltou e o que foi trocado', () => {
    const g = gradeText('I from Brazil', ['I am from Brazil.'], 'en');
    expect(g.correct).toBe(false);
    expect(g.diff).toContainEqual({ op: 'missing', expected: 'am' });
  });
  it('mandarim: compara por caractere e ignora espaços e pontuação chinesa', () => {
    expect(normalize('你 好 吗？', 'zh')).toBe('你好吗');
    expect(gradeText('我是巴西人', ['我是巴西人'], 'zh').correct).toBe(true);
    expect(gradeText('我是中国人', ['我是巴西人'], 'zh').correct).toBe(false);
  });
  it('coreano: exige a frase exata, sem tolerância a troca de sílaba', () => {
    expect(gradeText('저는 학생입니다.', ['저는 학생입니다'], 'ko').correct).toBe(true);
    expect(gradeText('저는 학생입니까', ['저는 학생입니다'], 'ko').correct).toBe(false);
  });
});

describe('comparação de fala (transcrição × frase esperada)', () => {
  it('reconhece a frase mesmo sem pontuação e acentos', () => {
    const r = compareSpeech(['como estas'], ['¿Cómo estás?'], 'es');
    expect(r.matched).toBe(true);
    expect(r.wordsRecognized).toBe(1);
  });
  it('usa a melhor alternativa do reconhecedor', () => {
    const r = compareSpeech(['nice to meat you', 'nice to meet you'], ['Nice to meet you.'], 'en');
    expect(r.matched).toBe(true);
  });
  it('aponta palavras não reconhecidas', () => {
    const r = compareSpeech(['i am fine tank you'], ["I'm fine, thank you."], 'en');
    expect(r.matched).toBe(false);
    expect(r.wordsRecognized).toBeCloseTo(4 / 5);
    expect(r.diff).toContainEqual({ op: 'wrong', expected: 'thank', got: 'tank' });
  });
  it('sem transcrição não há acerto', () => {
    expect(compareSpeech([], ['Hello'], 'en').matched).toBe(false);
  });
});

describe('diff', () => {
  it('detecta palavras a mais', () => {
    expect(diffTokens(['a', 'b'], ['a', 'x', 'b'])).toEqual([
      { op: 'same', expected: 'a', got: 'a' },
      { op: 'extra', got: 'x' },
      { op: 'same', expected: 'b', got: 'b' },
    ]);
  });
});
