import type { Level } from './types';

export interface Scenario {
  id: string;
  title: string;
  icon: string;
  /** Instrução dada ao professor virtual. */
  brief: string;
  minLevel: Level;
}

export const SCENARIOS: Scenario[] = [
  { id: 'free', title: 'Conversa livre', icon: 'chatbubbles', brief: 'Conversa aberta sobre o dia do aluno e assuntos do interesse dele.', minLevel: 'A1' },
  { id: 'intro', title: 'Apresentação pessoal', icon: 'hand-left', brief: 'Vocês acabaram de se conhecer. Troquem nomes, origem, profissão e interesses.', minLevel: 'A1' },
  { id: 'restaurant', title: 'Restaurante', icon: 'restaurant', brief: 'Você é o garçom de um restaurante. O aluno é o cliente: receba-o, anote o pedido, traga a conta.', minLevel: 'A1' },
  { id: 'market', title: 'Supermercado', icon: 'basket', brief: 'Você é atendente de um supermercado. O aluno procura produtos, pergunta preços e paga.', minLevel: 'A1' },
  { id: 'shopping', title: 'Compras', icon: 'bag-handle', brief: 'Você é vendedor em uma loja de roupas. O aluno quer experimentar, perguntar tamanhos e preços.', minLevel: 'A1' },
  { id: 'directions', title: 'Pedir informações', icon: 'map', brief: 'O aluno está perdido na cidade e pede informações. Você é um morador local.', minLevel: 'A1' },
  { id: 'friends', title: 'Conversar com amigos', icon: 'people', brief: 'Vocês são amigos conversando de forma informal sobre fim de semana, planos e gostos.', minLevel: 'A1' },
  { id: 'daily', title: 'Conversas cotidianas', icon: 'sunny', brief: 'Conversa sobre rotina, clima, família e pequenas coisas do dia a dia.', minLevel: 'A1' },
  { id: 'transport', title: 'Transporte público', icon: 'bus', brief: 'Você é funcionário de uma estação. O aluno compra bilhete e pergunta sobre linhas e horários.', minLevel: 'A2' },
  { id: 'hotel', title: 'Hotel', icon: 'bed', brief: 'Você é recepcionista de hotel. O aluno faz check-in, pergunta sobre serviços e resolve um problema no quarto.', minLevel: 'A2' },
  { id: 'airport', title: 'Aeroporto', icon: 'airplane', brief: 'Você é agente de check-in e depois oficial de imigração. O aluno despacha a mala e responde às perguntas de entrada no país.', minLevel: 'A2' },
  { id: 'phone', title: 'Atendimento telefônico', icon: 'call', brief: 'Você atende o telefone de uma empresa. O aluno liga para marcar um horário ou resolver um problema.', minLevel: 'A2' },
  { id: 'emergency', title: 'Emergências', icon: 'medkit', brief: 'Simule situações de urgência: farmácia, médico, perda de documentos. Você é o profissional que atende.', minLevel: 'A2' },
  { id: 'college', title: 'Faculdade', icon: 'school', brief: 'Vocês são colegas de faculdade conversando sobre aulas, trabalhos e a vida no campus.', minLevel: 'B1' },
  { id: 'interview', title: 'Entrevista de emprego', icon: 'briefcase', brief: 'Você é o entrevistador de uma empresa. Faça perguntas sobre experiência, pontos fortes e objetivos do aluno.', minLevel: 'B1' },
  { id: 'meeting', title: 'Reunião profissional', icon: 'easel', brief: 'Vocês estão em uma reunião de trabalho discutindo prazos e decisões de um projeto.', minLevel: 'B1' },
  { id: 'debate', title: 'Assuntos complexos', icon: 'bulb', brief: 'Discuta um tema atual (tecnologia, meio ambiente, cultura, economia), pedindo opiniões e argumentos.', minLevel: 'B2' },
];
