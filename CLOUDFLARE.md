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
