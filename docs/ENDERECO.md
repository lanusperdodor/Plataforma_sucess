# Endereço em campos separados (0042)

Mesmo formulário para cliente (checkout), loja (Minha loja e cadastro de negócio) e entregador (cadastro e "Meu endereço"):
**CEP · Cidade · UF · Rua · Número (ou "Sem número") · Bairro · Complemento**.

- Ao digitar os 8 números do CEP, o site consulta `/api/cep/:cep` (Worker → BrasilAPI, com ViaCEP como reserva; cache de 1 dia).
  Cidade e UF são preenchidas e travadas; rua e bairro vêm preenchidos quando o CEP é de rua (CEP geral da cidade pede para digitar).
  CEP não encontrado ou serviço fora: cidade e UF ficam livres para digitar.
- Banco: `address_parts jsonb` em `businesses`, `profiles` (último endereço do cliente) e `couriers`, validado por
  `public.address_parts_ok` (CEP com 8 dígitos, UF válida, tamanhos, só texto, sem `<` `>`).
  Na loja, `address_line` é montado pelo banco a partir das partes. No pedido, o checkout envia o texto montado
  (`delivery_address`), então telas antigas continuam mostrando o endereço.
- Entregador grava só o próprio endereço por `courier_set_address`; o Master (permissão `couriers.review`) lê por `admin_courier_address`.
- Teste: `supabase/tests/rls_endereco.sql`.
