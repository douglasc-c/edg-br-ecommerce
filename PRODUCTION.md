# Produção — EDG Brasil

A configuração inicial continua em `COMMERCE_MODE=catalog`. A atualização do código não publica nem ativa pagamentos reais.

Siga [CLOUDFLARE.md](CLOUDFLARE.md) para as credenciais brasileiras. Configure também `STORE_LEGAL_NAME`, `STORE_DOCUMENT` (CPF/CNPJ), `STORE_ADDRESS`, `SUPPORT_EMAIL` e, se houver canal específico, `PRIVACY_EMAIL`. Esses dados são públicos e aparecem nas páginas legais e no resumo da compra. `APP_URL` deve ser a origem HTTPS brasileira, incluindo www quando esse for o endereço usado pela loja.

Preserve o nome `edg-br-ecommerce`, o binding `STORE`, a classe `CommerceStore` e o objeto `primary`. As migrações V1–V5 do Brasil não são substituídas pelas da Espanha. Antes da atualização do banco de produção, faça o backup disponível na sua infraestrutura e valide a atualização em um ambiente separado com uma cópia dos dados.

Ative `COMMERCE_MODE=live` somente com InfinitePay e Melhor Envio configurados e verificados. Mantenha `STORE_CURRENCY=BRL`, `PAYMENT_PROVIDER=infinitepay`, `SHIPPING_PROVIDER=melhorenvio`, `MELHOR_ENVIO_SANDBOX=false` e `EUROPE_CHECKOUT_ENABLED=false`. Não copie IBAN, conta Stripe, remetente Sendcloud, domínio ou identificação fiscal espanhóis.

A migração preserva produtos e tamanhos antigos. Produtos antigos não são automaticamente convertidos em variantes: abra o editor e distribua explicitamente os saldos. Reservas históricas são mantidas.

O atendimento precisa acompanhar os protocolos diariamente. O registro de arrependimento não executa um estorno InfinitePay: a equipe deve comunicar/solicitar a devolução imediatamente no aplicativo do provedor e conciliar o resultado. Também deve providenciar a logística reversa sem ônus quando aplicável. Não registre restituição como concluída antes de verificar a devolução real.

As alíquotas e os dados de NF-e continuam configuráveis. NCM, CFOP, CST/CSOSN, regime tributário, emitente e regras vigentes precisam ser validados com a contabilidade. A atualização não calcula automaticamente todas as obrigações fiscais brasileiras nem adapta a tributação por simples troca de moeda.

O cadastro público e a preparação da NF-e preservam CNPJ alfanumérico (IN RFB 2.229/2024). A aceitação do documento e da chave deve ser homologada nos serviços fiscais e logísticos efetivamente contratados. A validação local verifica o formato, não a existência nem a situação cadastral na Receita.
