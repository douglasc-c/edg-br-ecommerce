# EDG Brasil no Cloudflare

## Publicar catálogo e estoque

Este repositório usa o Worker **edg-br-ecommerce**, reais e InfinitePay. Estoque, usuários, fotos e financeiro ficam separados da implantação europeia. O deploy inicial mantém as compras bloqueadas, para cadastrar os produtos reais primeiro.

Na raiz do projeto, com Node 24:

```bash
npm ci
npx wrangler login
npm run deploy
```

O Wrangler cria o banco SQLite persistente do Durable Object automaticamente. Não crie D1 ou R2 e não execute seed em produção. Anote a URL HTTPS retornada.

Configure os valores quando cada comando pedir:

```bash
npx wrangler secret put APP_URL
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD
```

- `APP_URL`: URL HTTPS exata da loja, sem caminho, por exemplo `https://edg-br-ecommerce.seu-subdominio.workers.dev`.
- `ADMIN_EMAIL`: seu e-mail administrativo.
- `ADMIN_PASSWORD`: senha exclusiva de 12 a 128 caracteres.

Abra a loja para criar o administrador no primeiro acesso. Entre e abra **Gestão**. Cadastre produtos e fotos em **Produtos**, e saldo inicial em **Estoque**. Itens inativos ficam fora da vitrine. Categorias e tamanhos da base foram preservados.

Depois de confirmar o acesso, pode remover o secret inicial com `npx wrangler secret delete ADMIN_PASSWORD`. A conta permanece no banco; mudanças nesse secret não redefinem uma senha existente. Use Minha conta para trocar a senha.

## Ativar InfinitePay e frete real

1. Na sua conta InfinitePay, habilite **Checkout Integrado**.
2. Localize sua **InfiniteTag** e use sem o símbolo `$`.
3. Configure a tag:

```bash
npx wrangler secret put INFINITEPAY_HANDLE
```

4. Gere um token aleatório próprio da loja:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put INFINITEPAY_WEBHOOK_TOKEN
```

Cole o valor gerado quando o segundo comando pedir. Esse token protege as notificações da loja; não é senha nem uma credencial fornecida pela InfinitePay. O sistema inclui a URL do webhook ao gerar cada checkout. Não é necessário cadastrar manualmente a URL em cada venda.

5. Configure frete e suporte:

```bash
npx wrangler secret put MELHOR_ENVIO_TOKEN
npx wrangler secret put ORIGIN_POSTAL_CODE
npx wrangler secret put SUPPORT_EMAIL
```

6. Em `wrangler.jsonc`, mantenha `PAYMENT_PROVIDER=infinitepay`, `STORE_CURRENCY=BRL`, e altere `vars` para incluir:

```json
"COMMERCE_MODE": "live",
"MELHOR_ENVIO_SANDBOX": "false"
```

Preserve as demais variáveis do arquivo. Publique novamente com `npm run deploy`.

A produção em modo live exige HTTPS, InfiniteTag, token do webhook com pelo menos 32 caracteres, token do Melhor Envio, CEP de origem, suporte e frete em produção. Não exige credenciais do banco espanhol ou do Mercado Pago.

O checkout redireciona para a InfinitePay, que oferece Pix e cartão de crédito conforme sua conta. O comprador retorna à loja; a confirmação consulta `/payment_check`. O webhook também faz essa verificação. Preços, cupons e frete vêm do banco, e não de valores enviados pelo comprador.

Valide uma venda controlada na sua conta antes de abrir a loja ao público. Os testes automatizados simulam as respostas externas e não comprovam a habilitação da conta real. Estornos devem ser feitos no aplicativo InfinitePay e conciliados pela equipe; não há estorno automático nesta integração.

## NF-e, etiquetas e e-mail

Essas integrações da base foram mantidas e usam configurações brasileiras:

| Serviço | Secrets/variáveis |
| --- | --- |
| NF-e Focus NFe | `FOCUS_NFE_TOKEN`, `NFE_EMITTER_JSON`, `NFE_DEFAULTS_JSON`, `NFE_ENVIRONMENT`. |
| Etiquetas Melhor Envio | `SHIPPING_FROM_JSON` com remetente/documento/IE; `MELHOR_ENVIO_WEBHOOK_SECRET` para rastreio automático. |
| Recuperação por e-mail | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_ENCRYPTION_KEY`. |

Consulte `.env.example` para o formato. Comece a NF-e com `NFE_ENVIRONMENT=homologation`; a emissão de produção requer parâmetros aprovados com a contabilidade. A nota é emitida por ação da equipe no pedido pago, antes da expedição. Nunca use dados fiscais fictícios para uma venda real.

## Publicação pelo painel

Após o código estar no GitHub, importe **douglasc-c/edg-br-ecommerce** em Workers & Pages:

| Campo | Valor |
| --- | --- |
| Branch | `master` |
| Diretório raiz | `/` |
| Build | `npm ci` |
| Deploy | `npm run deploy` |
| Node | `24` |

Adicione os secrets em Settings → Variables and Secrets. O `wrangler.jsonc` já define o nome do Worker, moeda, provedor, assets e binding persistente. Variáveis comuns devem permanecer nesse arquivo para não serem sobrescritas em deploys futuros.

Não altere o nome do Worker, a classe `CommerceStore`, o binding `STORE` ou o identificador interno `primary` depois de cadastrar dados: isso pode apontar a aplicação para outro armazenamento. Atualizações normais preservam o banco. Nenhum dado ou secret da implantação europeia é copiado pelo repositório.

## Conexão automática do Melhor Envio: OAuth + webhook

Depois de publicar esta versão, abra **Gestão → Integrações** como administrador. Essa tela mostra as URLs exatas da sua implantação e o status da conexão. A autenticação fica disponível também em modo catálogo, antes de liberar vendas.

O token pessoal configurado em `MELHOR_ENVIO_TOKEN` continua funcionando enquanto não houver conexão OAuth. Para receber os webhooks do aplicativo, cadastre/conecte um aplicativo do Melhor Envio. Um token pessoal ou “API key” isolado não substitui o **Client ID + Client Secret** desse aplicativo.

### Cadastrar o aplicativo

Em Melhor Envio → Integrações → Área Dev. → Cadastrar aplicativo:

| Campo | Valor |
| --- | --- |
| Nome | EDG Brasil |
| Site | A URL pública HTTPS da loja brasileira. |
| URL de testes | A URL do ambiente de testes publicado; pode coincidir com o callback, conforme o formulário do Melhor Envio. |
| URL de redirecionamento | Copie a URL de callback exibida em Gestão → Integrações. |

O callback tem o formato:

```text
https://SUA-LOJA/api/integrations/melhorenvio/callback
```

Não acrescente `#integrations` ao callback cadastrado: o retorno ao painel é feito pelo servidor após concluir a autorização. Use exatamente a origem configurada em `APP_URL`.

### Configurar credenciais no Cloudflare

Cadastre como secrets:

```bash
npx wrangler secret put MELHOR_ENVIO_CLIENT_ID
npx wrangler secret put MELHOR_ENVIO_CLIENT_SECRET
npx wrangler secret put INTEGRATIONS_ENCRYPTION_KEY
npx wrangler secret put SUPPORT_EMAIL
```

Use o ID e o secret fornecidos pelo cadastro do aplicativo. Para `INTEGRATIONS_ENCRYPTION_KEY`, gere localmente um valor com:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Guarde essa chave e mantenha o mesmo valor em atualizações. Ela criptografa os tokens no banco; perder ou alterar a chave exige reconectar as contas. Os segredos não são exibidos na interface e não devem ser colocados em commits ou enviados pelo chat.

A assinatura do webhook usa o próprio `MELHOR_ENVIO_CLIENT_SECRET`. O antigo `MELHOR_ENVIO_WEBHOOK_SECRET` permanece como alternativa para implantações legadas sem credenciais OAuth; com OAuth configurado, prevalece o Client Secret real do aplicativo.

O Worker usa produção por padrão (`MELHOR_ENVIO_SANDBOX=false` no `wrangler.jsonc`). Para testes sandbox, altere para `true` e use um aplicativo criado no sandbox. Tokens e autorizações de produção e sandbox são separados. Não altere o ambiente de uma loja com vendas reais para testar.

### Autorizar a conta

1. Entre na loja como administrador e abra **Gestão → Integrações**.
2. Confira o ambiente e clique em **Conectar Melhor Envio**.
3. Autorize sua conta na página oficial do Melhor Envio.
4. Aguarde o retorno ao painel e confira o status **Conectado**.

O sistema solicita apenas `cart-read`, `cart-write`, `shipping-calculate`, `shipping-checkout`, `shipping-generate`, `shipping-print` e `shipping-tracking`. A compra de fretes usa saldo da carteira e continua sendo uma ação explícita na expedição.

A aplicação guarda os tokens criptografados em seu SQLite persistente e os renova automaticamente antes do vencimento, tanto nas requisições quanto na manutenção agendada. Uma autorização recusada ou revogada pode exigir nova conexão pelo administrador. Desconectar apaga os tokens locais e impede retornar silenciosamente ao token pessoal; para revogar o acesso no provedor, remova a autorização também no Melhor Envio.

### Cadastrar as notificações

No aplicativo do Melhor Envio, clique em **Novo Webhook** e cole a URL exibida no painel da EDG Brasil:

```text
https://SUA-LOJA/api/webhooks/melhorenvio
```

Selecione os eventos de atualização de etiquetas disponíveis. O sistema valida `X-ME-Signature` com HMAC-SHA256 sobre o corpo original da requisição, registra os eventos processados e ignora repetições idênticas. Notificações de etiquetas desconhecidas são ignoradas. Eventos antigos não fazem uma entrega concluída regredir nem sobrescrevem seu código/link de rastreio.

As etiquetas precisam ser criadas pelo mesmo aplicativo conectado. Etiquetas criadas pelo site do Melhor Envio ou por outro aplicativo não geram notificações para este webhook. Para os pedidos existentes, continua disponível **Consultar transportadora**. O painel mostra a última notificação válida processada para uma etiqueta da loja, e não confirma automaticamente se a URL já foi cadastrada no provedor.

Referências oficiais: [OAuth e autenticação](https://docs.melhorenvio.com.br/docs/autenticacao), [solicitar e renovar tokens](https://docs.melhorenvio.com.br/reference/solicitacao-do-token), [webhooks](https://docs.melhorenvio.com.br/docs/webhooks).
