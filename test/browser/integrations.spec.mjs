import {test,expect} from './fixtures.mjs';
test('administrador encontra integração e URLs; credenciais ausentes impedem autorização',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('edg.language','pt-BR'));await page.goto('/');await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.getByLabel('E-mail',{exact:true}).fill('admin@example.com');await page.getByLabel('Senha',{exact:true}).fill('UI-exclusive-fixture-2026');await page.locator('#auth-form').getByRole('button',{name:'Entrar',exact:true}).click();
 await page.getByRole('link',{name:'Integrações',exact:true}).click();await expect(page.getByRole('heading',{name:'Integrações',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Conectar Melhor Envio',exact:true})).toBeDisabled();await expect(page.getByText(/Configuração pendente/)).toBeVisible();
 await expect(page.locator('code').filter({hasText:'/api/integrations/melhorenvio/callback'})).toBeVisible();await expect(page.locator('code').filter({hasText:'/api/webhooks/melhorenvio'})).toBeVisible();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
