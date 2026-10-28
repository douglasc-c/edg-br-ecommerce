import {test,expect} from './fixtures.mjs';

test('Brasil: compra, condições para download, devolução com protocolo e resposta na conta',async({page,baseURL})=>{
  await page.addInitScript(()=>localStorage.setItem('edg.language','pt-BR'));
  const password='Brazil-browser-fixture-2026',email=`br-${Date.now()}@example.test`;
  const headers={Origin:baseURL,'Content-Type':'application/json'};
  let login=await page.request.post('/api/auth/register',{headers,data:{name:'Cliente Brasil',email,password}});expect(login.status()).toBe(201);
  let auth=await login.json();const customerHeaders={...headers,'X-CSRF-Token':auth.csrf};
  const products=await (await page.request.get('/api/products')).json(),product=products.find(p=>p.name==='Mochila urbana');expect(product).toBeTruthy();
  expect((await page.request.put(`/api/cart/${product.id}`,{headers:customerHeaders,data:{quantity:1}})).status()).toBe(200);
  const quote=await (await page.request.post('/api/shipping/quote',{headers:customerHeaders,data:{postal_code:'80010000'}})).json();
  const response=await page.request.post('/api/checkout',{headers:{...customerHeaders,'Idempotency-Key':crypto.randomUUID()},data:{quote_id:quote.id,service_id:quote.options[0].id,terms_accepted:true,address:{name:'Cliente Brasil',phone:'41999999999',document:'12345678901',postal_code:'80010000',street:'Rua de teste',number:'1',district:'Centro',city:'Curitiba',state:'PR'}}});expect(response.status()).toBe(201);
  const order=await response.json();await page.goto('/#orders');await expect(page.locator('html')).toHaveAttribute('lang','pt-BR');
  await page.locator(`[data-action="order"][data-id="${order.id}"]`).click();
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'Baixar condições da compra'}).click();expect((await download).suggestedFilename()).toBe(`pedido-${order.number}.html`);
  await page.getByRole('button',{name:'Solicitar devolução',exact:true}).click();await page.getByLabel('Mensagem',{exact:true}).fill('Solicito o exercício do direito de arrependimento.');await page.getByRole('button',{name:'Registrar solicitação',exact:true}).click();
  await expect(page.locator('.support-request')).toContainText('Solicito o exercício');await expect(page.locator('.support-request h3')).toContainText('EDG-BR-');
  const protocol=await page.locator('.support-request h3').first().innerText();
  login=await page.request.post('/api/auth/login',{headers,data:{email:'admin@example.com',password:'UI-exclusive-fixture-2026'}});expect(login.status()).toBe(200);
  await page.goto('/?session=admin#customer-requests');await page.locator('.support-request').filter({hasText:protocol}).getByRole('button',{name:'Responder atendimento'}).click();
  await page.getByLabel('Resposta ao cliente').fill('Recebemos seu pedido e enviaremos as instruções de devolução.');await page.getByRole('button',{name:'Salvar resposta',exact:true}).click();
  await page.request.post('/api/auth/login',{headers,data:{email,password}});await page.goto('/?session=customer#support');await expect(page.locator('.support-request').filter({hasText:protocol})).toContainText('enviaremos as instruções');
});

test('políticas brasileiras funcionam sem JavaScript e as rotas antigas não servem regras espanholas',async({browser,baseURL})=>{
  const context=await browser.newContext({javaScriptEnabled:false});const page=await context.newPage();
  for(const path of ['/privacidade/','/termos/','/trocas-e-devolucoes/','/devoluciones/']){
    const response=await page.goto(baseURL+path);expect(response.status()).toBe(200);await expect(page.locator('html')).toHaveAttribute('lang','pt-BR');await expect(page.getByRole('heading',{level:1})).toBeVisible();await expect(page.locator('body')).not.toContainText('14 días');
  }
  await expect(page.locator('body')).toContainText('sete dias');await context.close();
});
