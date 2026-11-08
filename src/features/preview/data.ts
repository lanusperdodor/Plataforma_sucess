export type Category = 'Todos' | 'Hambúrgueres' | 'Pizzas' | 'Brasileira' | 'Saudável' | 'Japonesa' | 'Doces'
export interface Restaurant { id: string; name: string; category: Category; description: string; image: string; initials: string; color: string; rating: string; time: string; distance: string; tag?: string }
export interface Product { id: string; restaurantId: string; name: string; description: string; price: number; image: string; category: string; popular?: boolean }
export interface CartLine { productId: string; quantity: number }
export interface DemoOrder { id: string; restaurantId: string; items: CartLine[]; total: number; mode: 'partner_delivery' | 'pickup'; createdAt: string; step: number }
export const photo = (id: string, width = 900) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=85`
export const restaurants: Restaurant[] = [
  { id: 'brasa', name: 'Brasa & Pão', category: 'Hambúrgueres', description: 'Hambúrguer de verdade, feito na brasa.', image: photo('photo-1568901346375-23c9450c58cd'), initials: 'B&P', color: '#254d3c', rating: '4,9', time: '25–35 min', distance: '1,2 km', tag: 'Queridinho do bairro' },
  { id: 'massa', name: 'Massa & Afeto', category: 'Pizzas', description: 'Fermentação lenta. Sabor sem pressa.', image: photo('photo-1579751626657-72bc17010498'), initials: 'm&a', color: '#a45e3e', rating: '4,8', time: '35–45 min', distance: '2,1 km', tag: 'Feito artesanalmente' },
  { id: 'quintal', name: 'Quintal da Vó', category: 'Brasileira', description: 'Comida de casa para o seu dia.', image: photo('photo-1547592180-85f173990554'), initials: 'QV', color: '#697c4a', rating: '4,9', time: '20–30 min', distance: '800 m', tag: 'Sabor de casa' },
  { id: 'verde', name: 'Folha & Grão', category: 'Saudável', description: 'Leve, fresco e cheio de sabor.', image: photo('photo-1512621776951-a57141f2eefd'), initials: 'f&g', color: '#39765b', rating: '4,7', time: '20–30 min', distance: '1,5 km' },
  { id: 'bento', name: 'Bento Sushi', category: 'Japonesa', description: 'Pequenos detalhes. Grandes sabores.', image: photo('photo-1579871494447-9811cf80d66c'), initials: '弁', color: '#344c55', rating: '4,8', time: '35–45 min', distance: '2,4 km' },
  { id: 'doce', name: 'Doce Capricho', category: 'Doces', description: 'Um carinho no meio da rotina.', image: photo('photo-1578985545062-69928b1d9587'), initials: 'dc', color: '#a4796e', rating: '4,9', time: '15–25 min', distance: '600 m', tag: 'Uma pausa doce' },
]
export const products: Product[] = [
  { id: 'burger', restaurantId: 'brasa', name: 'O Clássico da Brasa', description: 'Pão brioche, blend de 160 g, queijo, alface, tomate e maionese da casa.', price: 2800, image: photo('photo-1568901346375-23c9450c58cd', 600), category: 'Hambúrgueres', popular: true },
  { id: 'double', restaurantId: 'brasa', name: 'Duplo da Casa', description: 'Dois blends de 160 g, queijo em dobro, cebola caramelizada e molho especial.', price: 3800, image: photo('photo-1550547660-d9450f859349', 600), category: 'Hambúrgueres' },
  { id: 'fries', restaurantId: 'brasa', name: 'Batata da Boa', description: 'Batatas crocantes com sal de ervas e uma porção da nossa maionese.', price: 1600, image: photo('photo-1573080496219-bb080dd4f877', 600), category: 'Acompanhamentos' },
  { id: 'pizza', restaurantId: 'massa', name: 'Margherita do Forno', description: 'Molho de tomate artesanal, muçarela, manjericão fresco e azeite.', price: 5600, image: photo('photo-1579751626657-72bc17010498', 600), category: 'Pizzas', popular: true },
  { id: 'pizza2', restaurantId: 'massa', name: 'Quatro Queijos', description: 'Muçarela, parmesão, gorgonzola e requeijão cremoso. Massa de fermentação lenta.', price: 6400, image: photo('photo-1513104890138-7c749659a591', 600), category: 'Pizzas' },
  { id: 'lunch', restaurantId: 'quintal', name: 'Almoço do Quintal', description: 'Arroz soltinho, feijão, frango grelhado, legumes e salada fresca.', price: 2600, image: photo('photo-1547592180-85f173990554', 600), category: 'Pratos da casa', popular: true },
  { id: 'bowl', restaurantId: 'verde', name: 'Bowl do Dia', description: 'Grãos, folhas da estação, legumes assados, abacate e molho de ervas.', price: 3200, image: photo('photo-1512621776951-a57141f2eefd', 600), category: 'Bowls', popular: true },
  { id: 'sushi', restaurantId: 'bento', name: 'Combinado Bento · 20 peças', description: 'Uma seleção de sushis, sashimis e uramakis preparados na hora.', price: 6400, image: photo('photo-1579871494447-9811cf80d66c', 600), category: 'Combinados', popular: true },
  { id: 'cake', restaurantId: 'doce', name: 'Fatia de Chocolate', description: 'Bolo fofinho, recheio cremoso e cobertura de chocolate de verdade.', price: 1800, image: photo('photo-1578985545062-69928b1d9587', 600), category: 'Doces', popular: true },
  { id: 'drink', restaurantId: 'brasa', name: 'Suco natural de laranja', description: 'Feito na hora. 400 ml, sem adição de açúcar.', price: 900, image: photo('photo-1600271886742-f049cd451bba', 600), category: 'Bebidas' },
]
export const categoryImages: Record<Category, string> = {
  Todos: restaurants[0]!.image, Hambúrgueres: restaurants[0]!.image, Pizzas: restaurants[1]!.image,
  Brasileira: restaurants[2]!.image, Saudável: restaurants[3]!.image, Japonesa: restaurants[4]!.image, Doces: restaurants[5]!.image,
}
export const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
