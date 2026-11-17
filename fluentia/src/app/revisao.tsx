import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { AudioButtons, buzz, TargetText } from '@/components/learn';
import { Button, Card, Header, Loading, ProgressBar, Row, Screen, T } from '@/components/ui';
import { display } from '@/content';
import { getDueCards, rateCard, type DueCard } from '@/db/repo';
import { previewIntervals, Rating, type Grade } from '@/domain/srs';
import { hashSeed } from '@/domain/text';
import { useApp, useStudyTimer } from '@/state/app';
import { colors, radius, space } from '@/theme';

const BUTTONS: { rating: Grade; label: string; color: string }[] = [
  { rating: Rating.Again, label: 'Errei', color: colors.danger },
  { rating: Rating.Hard, label: 'Difícil', color: colors.warn },
  { rating: Rating.Good, label: 'Bom', color: colors.primary },
  { rating: Rating.Easy, label: 'Fácil', color: colors.success },
];

/**
 * Cartões de revisão. Metade pede para lembrar o significado; metade pede para produzir no idioma
 * a partir do português. Quem avalia é você, com honestidade — o FSRS agenda a próxima revisão.
 */
export default function ReviewSession() {
  const router = useRouter();
  const { db, lang, refresh } = useApp();
  const [cards, setCards] = useState<DueCard[] | null>(null);
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [again, setAgain] = useState(0);
  useStudyTimer(lang, 'review');
  useEffect(() => {
    getDueCards(db, lang, 40).then(setCards);
  }, [db, lang]);

  if (!cards) return <Loading />;
  const card = cards[i];

  if (!card) {
    return (
      <Screen>
        <Header title="Revisão" onBack={() => router.back()} />
        <Card tone="success">
          <T v="h2" testID="revisao-concluida">Revisão concluída</T>
          <T v="small" color={colors.text}>{done} cartões revisados{again ? `, ${again} voltarão em breve` : ''}.</T>
        </Card>
        <Button title="Voltar" onPress={() => router.back()} />
      </Screen>
    );
  }

  const reverse = hashSeed(card.item_id + card.reps) % 2 === 1;
  const text = display(lang, card.term);
  const intervals = previewIntervals(card, new Date());

  const rate = async (r: Grade) => {
    buzz(r === Rating.Again ? 'bad' : 'ok');
    await rateCard(db, card, r);
    setDone((d) => d + 1);
    if (r === Rating.Again) setAgain((a) => a + 1);
    setShown(false);
    if (i + 1 >= cards.length) await refresh();
    setI(i + 1);
  };

  return (
    <Screen>
      <Header title="Revisão" subtitle={`${i + 1} de ${cards.length}`} onBack={() => router.back()} />
      <ProgressBar value={i / cards.length} />
      <Animated.View key={card.item_id + i} entering={FadeIn.duration(200)}>
        <Card style={s.card}>
          <T v="tiny">{reverse ? 'Como se diz?' : 'O que significa?'}</T>
          {reverse ? <T v="h1" style={s.center}>{card.translation}</T> : <TargetText text={text} reading={card.reading} readingHidden lang={lang} />}
          {!reverse ? <AudioButtons text={text} lang={lang} /> : null}
          {shown ? (
            <View style={s.answer}>
              {reverse ? (
                <>
                  <TargetText text={text} reading={card.reading} lang={lang} />
                  <AudioButtons text={text} lang={lang} autoPlay />
                </>
              ) : (
                <T v="h2" color={colors.success}>{card.translation}</T>
              )}
            </View>
          ) : null}
        </Card>
      </Animated.View>
      {shown ? (
        <>
          <T v="small" style={s.center}>Quanto você lembrou?</T>
          <Row gap={space.sm}>
            {BUTTONS.map((b) => (
              <Pressable key={b.rating} testID={`nota-${b.label}`} onPress={() => rate(b.rating)} style={[s.rate, { borderColor: b.color }]} accessibilityRole="button" accessibilityLabel={`${b.label}, próxima em ${intervals[b.rating]}`}>
                <T v="h3" color={b.color}>{b.label}</T>
                <T v="small">{intervals[b.rating]}</T>
              </Pressable>
            ))}
          </Row>
        </>
      ) : (
        <Button testID="mostrar-resposta" title="Mostrar resposta" onPress={() => setShown(true)} />
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { minHeight: 240, justifyContent: 'center', gap: space.md },
  center: { textAlign: 'center' },
  answer: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md, gap: space.sm },
  rate: { flex: 1, alignItems: 'center', paddingVertical: space.md, borderRadius: radius.md, borderWidth: 1.5, backgroundColor: colors.surface, gap: 2 },
});
