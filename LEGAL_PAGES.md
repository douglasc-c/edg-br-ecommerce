# Páginas e fluxos legais — Brasil

Fonte central: `src/brazil-legal.mjs`, versão `BR-2026-10-28`. As páginas `/privacidade/`, `/termos/` e `/trocas-e-devolucoes/` são renderizadas no servidor/Worker e funcionam sem JavaScript. As rotas antigas em espanhol servem o mesmo conteúdo brasileiro.

O fornecedor é configurado por `STORE_LEGAL_NAME`, `STORE_DOCUMENT`, `STORE_ADDRESS`, `SUPPORT_EMAIL` e `PRIVACY_EMAIL`. Nunca são presumidos os dados cadastrais da empresa. O modo live em produção exige os dados essenciais; os campos do emitente NF-e continuam separados, pois não se deve publicar o JSON fiscal inteiro.

O checkout exibe produtos, quantidades, frete, desconto e total; inclui aceite dos termos e acesso às regras de devolução. As condições e a identificação do fornecedor são congeladas no pedido e podem ser baixadas pelo comprador autenticado em HTML. Pedidos anteriores à atualização não recebem um aceite retroativo nem uma cópia inventada de termos antigos.

`/api/requests` aceita pedidos de arrependimento, vício/defeito, privacidade e dúvidas. Há protocolo imediato e prevenção de duplicação, com acesso restrito ao titular. Administração, atendimento e financeiro podem responder pelo painel. O fluxo não autoriza exclusão irrestrita de dados sujeitos a retenção legal e não cria estorno fictício.

Os vídeos usam imagens locais; o YouTube é carregado após reprodução solicitada. A CSP bloqueia scripts e conexões de analytics opcionais por padrão. A camada Cloudflare pode ter recursos próprios de análise/segurança: confira sua configuração efetiva antes de ativar ferramentas adicionais e estabeleça a base legal e os mecanismos necessários.

## Referências verificadas em 28/10/2026

- [CDC, texto atualizado — Câmara](https://www2.camara.leg.br/legin/fed/lei/1990/lei-8078-11-setembro-1990-365086-normaatualizada-pl.html): arts. 18, 26 e 49, incluindo sete dias de arrependimento, restituição e garantia legal.
- [Decreto 7.962/2013 — Câmara](https://www2.camara.leg.br/legin/fed/decret/2013/decreto-7962-15-marco-2013-775557-publicacaooriginal-139266-pe.html): identificação do fornecedor, resumo da compra, correção de erros, contrato conservável, confirmação imediata e atendimento em até cinco dias.
- [LGPD — texto compilado](https://www.presidencia.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm): bases legais, retenção e direitos dos titulares.
- [ANPD — direitos dos titulares](https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares) e [guia de cookies](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia-orientativo-cookies-e-protecao-de-dados-pessoais.pdf): transparência e exercício dos direitos.

A configuração técnica precisa corresponder à operação real. O cumprimento das regras também depende do atendimento, das devoluções, das transferências de dados, dos prazos de retenção e da configuração fiscal efetiva.

- [Receita Federal — CNPJ alfanumérico](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/cnpj-alfanumerico): IN RFB 2.229/2024, novas inscrições a partir de 2026, preservando cadastros numéricos existentes.
