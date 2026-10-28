# Atualização da base espanhola para o Brasil

Origem: `douglasc-c/edg-ecommerce`, `master`, commit `0ad24e88210fcbb349edb977412ef0dbe4a6e2c8`.
Destino analisado: `douglasc-c/edg-br-ecommerce`, `master`, commit `c4c9103588ff452a3c27c16978c653988ca97e47`.
A base brasileira havia importado o código espanhol de `1fa687ef98ee7dff1a6dcd792bd69804126bd10f`. Os repositórios têm históricos próprios; esta atualização compara essa base comum de código para reaplicar as diferenças brasileiras. A origem espanhola não é modificada.

## Comparação e resultado

| Área | Atualização recebida | Adaptação brasileira |
|---|---|---|
| Vitrine e navegação | Campanha, introdução, carrossel, cabeçalho móvel e menu de conta | Português por padrão; escolha manual de idioma preservada |
| Conteúdo | Páginas Skate e Música e seus assets | Mesma história da marca; vídeos externos só carregam após reprodução solicitada |
| Catálogo | Imagem de categoria, exclusão segura, múltiplos tamanhos e variantes | Preserva produtos e estoque antigos; alocação de saldos explícita |
| Compras | Correções de reserva, retomada de pagamento e idempotência | BRL e InfinitePay; não ativa Stripe, IBAN ou transferência espanhola |
| Frete | Suporte a variantes na cotação e nos itens | Melhor Envio, OAuth, tokens criptografados e webhook sem regressão preservados |
| Fiscal | Descrição das variantes na NF-e | Focus NFe brasileiro; CPF/CNPJ e CNPJ alfanumérico sem remover letras |
| E-mail | Entrega imediata, repetição e diagnóstico seguro de falhas | Resend e chave existentes preservados |
| Termos e consumidor | Páginas legais e acesso no checkout | CDC, Decreto 7.962/2013, sete dias de arrependimento e garantia legal |
| Privacidade | Transparência e canal do titular | LGPD, identificação brasileira e analytics opcionais bloqueados por padrão |
| Atendimento | Novo registro rastreável | Protocolo imediato, devolução, dúvidas e solicitações LGPD com resposta na conta |

## Banco de dados

As migrações V4 e V5 já significavam coisas distintas nos dois repositórios. Aplicar a sequência espanhola diretamente pularia colunas essenciais ou entraria em conflito com o banco brasileiro.

| Versões no Brasil | Conteúdo |
|---|---|
| V1–V3 | Base original de comércio e tamanhos |
| V4–V5 | InfinitePay e integração OAuth/webhooks do Melhor Envio, preservadas |
| V6–V12 | Migrações espanholas V4–V10, renumeradas para manter a sequência brasileira |
| V13 | Cópia das condições da compra por pedido e protocolos de atendimento |

A migração não converte saldos automaticamente para variantes. Pedidos, reservas, carrinhos e conexões antigas são preservados. A regressão usa o esquema real da versão brasileira V5, tanto com SQLite de Node quanto com o mecanismo transacional do Durable Object, e executa a atualização duas vezes para verificar repetibilidade.

Mantenha o Worker `edg-br-ecommerce`, o binding `STORE`, a classe `CommerceStore` e o objeto `primary`. As configurações do Worker preservam variáveis cadastradas no painel por meio de `keep_vars`.

## Configuração antes das vendas

Preencha os dados públicos reais da operação brasileira: `STORE_LEGAL_NAME`, `STORE_DOCUMENT`, `STORE_ADDRESS`, `SUPPORT_EMAIL` e, se diferente, `PRIVACY_EMAIL`. As vendas em modo live de produção exigem a identificação essencial. O cadastro verifica o formato do CPF/CNPJ, não sua existência ou situação cadastral.

Mantenha `STORE_CURRENCY=BRL`, `PAYMENT_PROVIDER=infinitepay`, `SHIPPING_PROVIDER=melhorenvio` e `EUROPE_CHECKOUT_ENABLED=false`. Não copie domínios, dados bancários, identificadores fiscais, tokens ou remetentes da Espanha. A atualização permanece em catálogo e não faz deploy.

Os documentos brasileiros estão em `/privacidade/`, `/termos/` e `/trocas-e-devolucoes/`. As rotas antigas também entregam as regras do Brasil. O comprador pode baixar as condições de seu pedido. Pedidos históricos não recebem um aceite retroativo inventado.

O painel de Atendimento é acessível aos perfis de administração, atendimento e financeiro. O protocolo confirma o recebimento; a resposta da equipe fica disponível na conta do cliente. O prazo de manifestação em demandas de consumo é de até cinco dias. Arrependimentos devem ser comunicados imediatamente ao provedor financeiro e ter a restituição e a logística reversa tratadas conforme o CDC.

## Limites operacionais

- A integração InfinitePay preservada não executa nem sincroniza estornos. A equipe precisa solicitá-los imediatamente no aplicativo do provedor e conciliar a devolução real. O protocolo não altera receita, pagamento ou estoque.
- A emissão fiscal continua exigindo homologação e configuração tributária. NCM, CFOP, CST/CSOSN, regime tributário, tributos da operação e obrigações vigentes devem ser validados com a contabilidade; a atualização não implementa um motor tributário completo.
- O cadastro e a preparação fiscal preservam CNPJ alfanumérico. Homologue a emissão e a etiqueta com os provedores contratados para esse formato.
- Atendimento de direitos LGPD, retenção, transferências internacionais e tratamento de incidentes exigem os procedimentos reais do controlador. O código e as políticas precisam corresponder à operação.
- Não houve acesso ao banco de produção, alteração de credenciais, cobrança real ou deploy nesta atualização.

## Verificação

```bash
npm ci
npm run check
npm test
npm run test:cloudflare
npm run check:cloudflare
npx playwright install --with-deps chromium webkit
npm run test:ui
```

Os testes de integração usam respostas simuladas dos provedores. Acompanhe o resultado do CI do pull request antes de incorporar e publicar. Consulte [PRODUCTION.md](PRODUCTION.md) e [LEGAL_PAGES.md](LEGAL_PAGES.md) para a configuração e as referências oficiais.
