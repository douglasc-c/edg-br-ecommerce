import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {database} from '../src/db.mjs';
import {configuration,createApp} from '../src/server.mjs';
import {melhorEnvioOAuth,shippingScopes,shippingCallback} from '../src/melhorenvio-oauth.mjs';
import {providers} from '../src/providers.mjs';
import {commerce} from '../src/commerce.mjs';
import {hash,now,passwordHash} from '../src/security.mjs';
const settings={APP_URL:'https://br.example.test',NODE_ENV:'production',COMMERCE_MODE:'catalog',MELHOR_ENVIO_SANDBOX:'false',MELHOR_ENVIO_CLIENT_ID:'1234',MELHOR_ENVIO_CLIENT_SECRET:'test-client-secret-not-real',INTEGRATIONS_ENCRYPTION_KEY:'a'.repeat(64),SUPPORT_EMAIL:'suporte@example.test',ORIGIN_POSTAL_CODE:'80010000'};
const callbackInput=start=>new URLSearchParams({state:new URL(start.url).searchParams.get('state'),code:'test-authorization-code'});
const browser=start=>start.cookie.split(';')[0].split('=')[1];
function fixture(t){
 const db=database(':memory:');t.after(()=>db.close());const config=configuration(settings),calls=[];
 const admin={id:randomUUID(),name:'Administrador',email:'admin@example.test',role:'admin',token:hash(randomUUID())};
 const customer={id:randomUUID(),name:'Cliente',email:'customer@example.test',role:'customer'};
 for(const u of [admin,customer])db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)').run(u.id,u.name,u.email,'unused',u.role,now());
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(admin.token,admin.id,'fixture-csrf',new Date(Date.now()+86400000).toISOString());
 const f={db,config,admin,customer,calls,refreshCount:0};
 f.fetcher=async(url,options)=>{
  const input=JSON.parse(options.body);calls.push({url,input,headers:options.headers});
  if(url.endsWith('/oauth/token')){
   if(f.fail)return Response.json({error:'invalid_grant',secret:'never expose upstream body'},{status:f.fail});
   if(input.grant_type==='refresh_token')f.refreshCount++;
   return Response.json({token_type:'Bearer',access_token:input.grant_type==='refresh_token'?'rotated-access-token':'initial-access-token',refresh_token:input.grant_type==='refresh_token'?'rotated-refresh-token':'initial-refresh-token',expires_in:2592000,scope:shippingScopes.join(' ')});
  }
  assert.equal(options.headers.Authorization,'Bearer '+(f.refreshCount?'rotated-access-token':'initial-access-token'));
  return Response.json([{id:1,name:'PAC',price:'19.90',delivery_time:7}]);
 };
 f.connection=melhorEnvioOAuth(db,config,f.fetcher);
 f.connect=async()=>{const start=f.connection.begin(admin);await f.connection.finish(callbackInput(start),browser(start));return start;};
 f.row=()=>db.prepare("SELECT * FROM integration_connections WHERE provider='melhorenvio' AND environment='production'").get();
 return f;
}
test('OAuth fixa host, callback e escopos; armazena tokens criptografados e protege state com cookie',async t=>{
 const f=fixture(t),start=f.connection.begin(f.admin),url=new URL(start.url);assert.equal(url.origin,'https://melhorenvio.com.br');assert.equal(url.pathname,'/oauth/authorize');assert.equal(url.searchParams.get('redirect_uri'),settings.APP_URL+shippingCallback);assert.deepEqual(url.searchParams.get('scope').split(' '),shippingScopes);assert.match(start.cookie,/HttpOnly; SameSite=Lax/);assert.match(start.cookie,/Secure/);
 assert.equal(f.db.prepare('SELECT state_hash FROM integration_oauth_states').get().state_hash,hash(url.searchParams.get('state')));
 await assert.rejects(f.connection.finish(callbackInput(start),'f'.repeat(64)),/inválida/);assert.equal(f.calls.length,0);
 await f.connection.finish(callbackInput(start),browser(start));const row=f.row();assert.ok(!row.encrypted.includes('initial-access-token'));assert.ok(!row.encrypted.includes('initial-refresh-token'));assert.equal(await f.connection.accessToken(),'initial-access-token');assert.equal(f.connection.status().connected,true);assert.equal(f.connection.status().environment,'production');
 assert.equal(f.calls[0].input.client_secret,settings.MELHOR_ENVIO_CLIENT_SECRET);assert.equal(f.calls[0].input.redirect_uri,settings.APP_URL+shippingCallback);assert.match(f.calls[0].headers['User-Agent'],/suporte@example.test/);
 const publicStatus=JSON.stringify(f.connection.status());for(const secret of ['initial-access-token','initial-refresh-token',settings.MELHOR_ENVIO_CLIENT_SECRET,settings.INTEGRATIONS_ENCRYPTION_KEY])assert.ok(!publicStatus.includes(secret));
 await assert.rejects(f.connection.finish(callbackInput(start),browser(start)),/inválida/);assert.equal(f.calls.length,1);
});
test('state expira, exige sessão administrativa ativa e fica vinculado ao ambiente e aplicativo',async t=>{
 for(const change of ['expired','session','role','environment','client']){
  const f=fixture(t),start=f.connection.begin(f.admin);
  if(change==='expired')f.db.prepare('UPDATE integration_oauth_states SET expires_at=?').run('2000-01-01T00:00:00.000Z');
  if(change==='session')f.db.prepare('DELETE FROM sessions').run();
  if(change==='role')f.db.prepare("UPDATE users SET role='shipping' WHERE id=?").run(f.admin.id);
  if(change==='environment')f.connection=melhorEnvioOAuth(f.db,{...f.config,meSandbox:true},f.fetcher);
  if(change==='client')f.connection=melhorEnvioOAuth(f.db,{...f.config,meClientId:'999'},f.fetcher);
  await assert.rejects(f.connection.finish(callbackInput(start),browser(start)),/inválida/);assert.equal(f.calls.length,0);
 }
});
test('recusa de autorização não troca tokens e o state é de uso único',async t=>{
 const f=fixture(t),start=f.connection.begin(f.admin),input=callbackInput(start);input.set('error','access_denied');const result=await f.connection.finish(input,browser(start));assert.equal(result.denied,true);assert.equal(f.calls.length,0);assert.equal(f.connection.status().connected,false);await assert.rejects(f.connection.finish(input,browser(start)),/inválida/);
});
test('renovação é automática, usa refresh token, agrupa concorrência e persiste após reiniciar o serviço',async t=>{
 const f=fixture(t);await f.connect();f.db.prepare('UPDATE integration_connections SET expires_at=?').run(new Date(Date.now()+1000).toISOString());const values=await Promise.all([f.connection.accessToken(),f.connection.accessToken(),f.connection.accessToken()]);assert.deepEqual(values,Array(3).fill('rotated-access-token'));assert.equal(f.refreshCount,1);assert.ok(!f.row().encrypted.includes('rotated-refresh-token'));
 const restarted=melhorEnvioOAuth(f.db,f.config,f.fetcher);assert.equal(await restarted.accessToken(),'rotated-access-token');
 const p=providers(f.config,f.fetcher,restarted);await p.quote([{id:'a',price:1000,quantity:1,width:10,height:10,length:10,weight:.5}],'80010000');assert.equal(f.calls.at(-1).headers.Authorization,'Bearer rotated-access-token');
});
test('invalid_grant exige reconexão sem vazar resposta; desconectar apaga tokens e impede fallback silencioso',async t=>{
 const f=fixture(t);await f.connect();f.db.prepare('UPDATE integration_connections SET expires_at=?').run('2000-01-01T00:00:00.000Z');f.fail=401;await assert.rejects(f.connection.accessToken(),/recusou/);assert.equal(f.row().status,'reauthorize');assert.ok(!JSON.stringify(f.connection.status()).includes('never expose'));
 const connection=melhorEnvioOAuth(f.db,{...f.config,meToken:'legacy-token'},f.fetcher);connection.disconnect(f.admin);assert.equal(f.row().encrypted,'');assert.equal(connection.status().method,'disconnected');await assert.rejects(connection.accessToken(),/Reconecte/);
});
test('token pessoal continua disponível antes de conectar e erro transitório não usa token expirado',async t=>{
 const f=fixture(t),legacy=melhorEnvioOAuth(f.db,{...f.config,meToken:'legacy-token'},f.fetcher);assert.equal(legacy.status().method,'personal_token');assert.equal(await legacy.accessToken(),'legacy-token');
 await f.connect();f.db.prepare('UPDATE integration_connections SET expires_at=?').run('2000-01-01T00:00:00.000Z');f.fail=503;await assert.rejects(f.connection.accessToken(),/recusou/);assert.equal(f.row().status,'connected');
 f.db.prepare('UPDATE integration_connections SET expires_at=?').run(new Date(Date.now()+60000).toISOString());assert.equal(await f.connection.accessToken(),'initial-access-token');
});
test('chave incorreta não decifra tokens; manutenção renova e elimina estados vencidos',async t=>{
 const f=fixture(t);await f.connect();const other=melhorEnvioOAuth(f.db,{...f.config,integrationsKey:'b'.repeat(64)},f.fetcher);await assert.rejects(other.accessToken(),/criptografia/);
 f.connection.begin(f.admin);f.db.prepare('UPDATE integration_oauth_states SET expires_at=?').run('2000-01-01T00:00:00.000Z');f.db.prepare('UPDATE integration_connections SET expires_at=?').run(new Date(Date.now()+1000).toISOString());await f.connection.maintain();assert.equal(f.db.prepare('SELECT COUNT(*) n FROM integration_oauth_states').get().n,0);assert.equal(f.refreshCount,1);
});
async function httpFixture(t){
 const f=fixture(t),password='OAuth-admin-test-2026';f.db.prepare('UPDATE users SET password=?').run(await passwordHash(password));const app=createApp({db:f.db,config:f.config,fetcher:f.fetcher});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.server.close(resolve)));const base=`http://127.0.0.1:${app.server.address().port}`;
 f.call=async(path,method='GET',body,headers={})=>fetch(base+path,{method,redirect:'manual',headers:{Origin:f.config.url,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 f.login=async who=>{const r=await f.call('/api/auth/login','POST',{email:f[who].email,password});return {Cookie:r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await r.json()).csrf};};return f;
}
test('HTTP: apenas admin conecta, com CSRF; callback funciona com cookie Lax sem sessão Strict na requisição',async t=>{
 const f=await httpFixture(t);assert.equal((await f.call('/api/admin/integrations/melhorenvio')).status,401);const customer=await f.login('customer');assert.equal((await f.call('/api/admin/integrations/melhorenvio','GET',undefined,customer)).status,403);
 const admin=await f.login('admin');assert.equal((await f.call('/api/admin/integrations/melhorenvio/connect','POST',{}, {Cookie:admin.Cookie})).status,403);
 const start=await f.call('/api/admin/integrations/melhorenvio/connect','POST',{},admin);const payload=await start.json();assert.equal(start.status,200);const cookie=start.headers.get('set-cookie').split(';')[0];const state=new URL(payload.url).searchParams.get('state');
 let r=await f.call(shippingCallback+'?'+new URLSearchParams({code:'callback-code',state}),'GET',undefined,{Cookie:cookie});assert.equal(r.status,303);assert.equal(r.headers.get('location'),settings.APP_URL+'/?melhorenvio=connected#integrations');assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
 const status=await f.call('/api/admin/integrations/melhorenvio','GET',undefined,admin);assert.equal((await status.json()).connected,true);
 r=await f.call(shippingCallback+'?'+new URLSearchParams({code:'callback-code',state}),'GET',undefined,{Cookie:cookie});assert.equal(r.status,400);
 assert.equal((await f.call('/api/admin/integrations/melhorenvio/disconnect','POST',{},customer)).status,403);
 assert.equal((await f.call('/api/admin/integrations/melhorenvio/disconnect','POST',{},admin)).status,200);
});
test('webhook assinado é idempotente, ignora etiquetas externas e eventos antigos não alteram entrega ou rastreio',async t=>{
 const f=await httpFixture(t),shop=commerce(f.db,{...f.config,mode:'demo'},providers({...f.config,mode:'demo'}));const p=shop.saveProduct(f.admin,{sku:'ME-1',name:'Produto webhook',description:'Teste de rastreio',category:'Teste',price:1000,cost:500,low_stock:2,weight:.5,width:10,height:10,length:10,color:'#d9e4d5',icon:'◇'});shop.stock(f.admin,p.id,5,'Saldo inicial');shop.setCart(f.customer,p.id,1);const q=await shop.quote(f.customer,'80010000');const o=await shop.checkout(f.customer,{quote_id:q.id,service_id:q.options[0].id,address:{name:'Cliente',phone:'41999999999',document:'12345678901',postal_code:'80010000',street:'Rua A',number:'10',district:'Centro',city:'Curitiba',state:'PR'}},randomUUID());shop.demoPay(f.customer,o.id);f.db.prepare('UPDATE orders SET label_id=? WHERE id=?').run('label-test',o.id);
 const send=async(payload,signature)=>{const raw=JSON.stringify(payload);return f.call('/api/webhooks/melhorenvio','POST',payload,{'x-me-signature':signature||createHmac('sha256',settings.MELHOR_ENVIO_CLIENT_SECRET).update(raw).digest('base64')});};
 const posted={event:'order.posted',data:{id:'label-test',status:'posted',tracking:'CODE-NEW',tracking_url:'https://example.test/new'}};
 assert.equal((await send(posted,'bad-signature')).status,401);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM integration_webhooks').get().n,0);
 assert.equal((await send(posted)).status,200);let r=await send(posted);assert.equal((await r.json()).duplicate,true);
 const delivered={event:'order.delivered',data:{id:'label-test',status:'delivered',tracking:'CODE-DELIVERED',tracking_url:'https://example.test/delivered'}};await send(delivered);const count=shop.order(o.id).events.length;
 await send({...posted,data:{...posted.data,tracking:'CODE-OLD',tracking_url:'https://example.test/old'}});const current=shop.order(o.id);assert.equal(current.status,'delivered');assert.equal(current.tracking_code,'CODE-DELIVERED');assert.equal(current.tracking_url,'https://example.test/delivered');assert.equal(current.events.length,count);
 r=await send({event:'order.posted',data:{id:'external-label',status:'posted'}});assert.equal((await r.json()).ignored,true);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM integration_webhooks').get().n,3);
 const admin=await f.login('admin'),status=await f.call('/api/admin/integrations/melhorenvio','GET',undefined,admin);assert.ok((await status.json()).last_webhook_at);
});
