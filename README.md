# EDG Brasil — estoque e e-commerce

Versão brasileira da base `douglasc-c/edg-ecommerce` (commit `1fa687e`), com checkout **InfinitePay**, moeda **BRL**, NF-e brasileira e configuração própria para Cloudflare Workers. O repositório europeu não é alterado.

## Funcionalidades

- Vitrine, busca, categorias e tamanhos por categoria, fotos e carrinho.
- Gestão de produtos, entradas/saídas de estoque, reservas e alertas de saldo.
- Cupons, pedidos, financeiro, expedição e rastreio.
- Usuários com perfis de administrador, estoque, financeiro, expedição e atendimento.
- Checkout InfinitePay com produtos, descontos e frete calculados no servidor.
- Confirmação de pagamento pela API InfinitePay, por webhook ou retorno do comprador.
- Fretes e etiquetas pelo Melhor Envio; NF-e por Focus NFe; recuperação de senha por Resend.
- SQLite persistente em Durable Object e assets no Cloudflare; servidor Node também disponível.

## Começar pelo catálogo

A configuração do Worker começa com `COMMERCE_MODE=catalog`, `STORE_CURRENCY=BRL` e `PAYMENT_PROVIDER=infinitepay`. Permite organizar a operação sem aceitar vendas até finalizar a configuração.

Para publicar e ativar pagamentos, siga [CLOUDFLARE.md](CLOUDFLARE.md).

## Desenvolvimento local

Requer Node 24.

```bash
npm ci
cp .env.example .env
# Preencha ADMIN_EMAIL e ADMIN_PASSWORD em .env.
npm run seed
npm start
```

O modo `demo` simula pagamentos e frete, e fica identificado na interface. Os produtos de demonstração só são criados pelo seed em modo demo. O modo `catalog` usa estoque real sem checkout; `live` usa os provedores reais configurados.

```bash
npm run check
npm test
npm run test:cloudflare
npx playwright install --with-deps chromium
npm run test:ui
```

O teste de Workers valida catálogo, fotos, persistência após reinício e checkout/webhook InfinitePay com respostas externas simuladas. Nenhuma cobrança real é realizada pelos testes.

## Pagamentos e limites da integração

A integração usa o Checkout Integrado da InfinitePay: o servidor envia os itens em centavos para `/links`, recebe a URL e redireciona o comprador. A confirmação usa `/payment_check` com o pedido, a transação e a fatura; valores e status enviados pelo navegador ou webhook não aprovam uma venda por si só.

O webhook tem token próprio da loja, e repetições não duplicam baixa de estoque ou receita. O valor canônico `amount` deve coincidir com o total do pedido; `paid_amount` pode incluir taxas cobradas do comprador. O financeiro registra o valor do pedido, não taxas adicionais do provedor.

O retorno do checkout só consulta pedidos do usuário autenticado e exige CSRF. Webhooks não dependem da sessão do comprador. Uma transação não pode liquidar pedidos diferentes.

Estornos devem ser solicitados no aplicativo InfinitePay: a documentação pública do checkout não oferece endpoint de estorno ou consulta de devoluções. Esta integração não executa nem sincroniza estornos automaticamente. Não marque uma venda como estornada sem conciliar a devolução real; registre despesas/ajustes financeiros conforme o processo da operação.

A expiração da reserva é local e não cancela o link hospedado pela InfinitePay. Se um pagamento chegar após cancelamento ou sem saldo livre, o pedido fica em análise, sem liberação para expedição. Confira a transação no provedor antes de resolver o atendimento.

## Integrações brasileiras

| Serviço | Configuração |
| --- | --- |
| InfinitePay | Habilitar Checkout Integrado e configurar InfiniteTag sem `$`. |
| Melhor Envio | Token, CEP de origem, e-mail de suporte e ambiente; remetente para etiquetas. |
| Focus NFe | Token, emitente e regras fiscais revisadas com a contabilidade; homologação antes de produção. |
| Resend | API key, remetente verificado e chave estável de criptografia de 32 bytes. |

A emissão fiscal é uma operação explícita em pedidos pagos; cancelar a nota não devolve o pagamento. O acompanhamento de envio exige configurar as credenciais e o webhook do Melhor Envio. O fluxo de venda não habilita automaticamente a emissão de notas ou o envio de e-mails sem configurar os serviços correspondentes.

Documentação oficial: [Checkout InfinitePay](https://www.infinitepay.io/checkout-documentacao) e [habilitar Checkout Integrado](https://ajuda.infinitepay.io/pt-BR/articles/10766888-como-usar-o-checkout-integrado-da-infinitepay).
