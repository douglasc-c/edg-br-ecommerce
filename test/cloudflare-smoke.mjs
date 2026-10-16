import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import jpeg from 'jpeg-js';

const directory=await mkdtemp(join(tmpdir(),'edg-worker-'));
const origin='https://store.example.test',password='Smoke-Test-Password-2026';
let mf;
try{
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--dry-run','--outdir',directory],{stdio:'pipe'});
  const options={name:"edg-test",modulesRoot:directory,modules:true,scriptPath:join(directory,'worker.js'),compatibilityDate:'2026-01-01',compatibilityFlags:['nodejs_compat'],cf:false,host:'127.0.0.1',port:0,
    durableObjects:{STORE:{className:'CommerceStore',useSQLite:true}},durableObjectsPersist:join(directory,'storage'),
    bindings:{APP_URL:origin,COMMERCE_MODE:'catalog',STORE_CURRENCY:'BRL',ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD:password},
    serviceBindings:{ASSETS:async request=>new Response(await readFile(resolve('public',new URL(request.url).pathname==='/'?'index.html':new URL(request.url).pathname.slice(1))))}};
  const create=opts=>new Miniflare({...convertV4MiniflareOptions(opts),resourcePersistencePath:join(directory,"storage")});
  mf=create(options);
  let auth={};
  async function call(path,method='GET',body,headers={}){
    const r=await mf.dispatchFetch(origin+path,{method,headers:{Origin:origin,'Content-Type':'application/json',...auth,...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await r.json();return {r,data};
  }
  let result=await call('/api/config');assert.equal(result.r.status,200,JSON.stringify(result.data));assert.equal(result.data.mode,'catalog');assert.equal(result.data.currency,'BRL');assert.equal(result.data.checkout_enabled,false);
  assert.equal((await call('/api/admin/products')).r.status,401);
  const login=await call('/api/auth/login','POST',{email:'admin@example.test',password});assert.equal(login.r.status,200,JSON.stringify(login.data));assert.match(login.r.headers.get('set-cookie'),/Secure/);
  auth={Cookie:login.r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':login.data.csrf};
  assert.equal((await call('/api/admin/products','POST',{} ,{Origin:'https://other.example'})).r.status,403);
  const photo=jpeg.encode({width:2,height:2,data:Buffer.alloc(16,255)},85).data;
  const upload=await mf.dispatchFetch(origin+'/api/admin/media',{method:'POST',headers:{Origin:origin,...auth,'Content-Type':'image/jpeg'},body:photo});const image=await upload.json();assert.equal(upload.status,201,JSON.stringify(image));
  const input={sku:'SMOKE-1',name:'Produto Brasil',category:'Teste',description:'Produto real',price:1999,cost:1000,low_stock:2,weight:.5,width:10,height:10,length:10,color:'#d9e4d5',icon:'◇',images:[image.id]};
  result=await call('/api/admin/products','POST',input);assert.equal(result.r.status,201,JSON.stringify(result.data));const id=result.data.id;
  result=await call(`/api/admin/products/${id}/stock`,'POST',{delta:12,reason:'Estoque inicial'});assert.equal(result.r.status,200,JSON.stringify(result.data));
  assert.equal((await call('/api/products')).data[0].available,12);
  for(const path of ['/api/checkout','/api/shipping/quote',`/api/orders/fake/demo-pay`,`/api/cart/${id}`,'/api/webhooks/mercadopago'])assert.equal((await call(path,path.includes('/cart/')?'PUT':'POST',{})).r.status,503,path);
  assert.equal((await call('/api/admin/orders')).data.length,0);assert.equal((await call('/api/admin/finance')).data.length,0);
  const downloaded=await mf.dispatchFetch(origin+image.url);assert.equal(downloaded.status,200);assert.equal(downloaded.headers.get('content-type'),'image/jpeg');assert.ok((await downloaded.arrayBuffer()).byteLength>0);
  await mf.dispose();mf=create({...options,bindings:Object.fromEntries(Object.entries(options.bindings).filter(([key])=>key!=='ADMIN_PASSWORD'))});
  assert.equal((await call('/api/products')).data[0].available,12,'Estoque preservado após reinício');
  assert.equal((await call('/api/admin/products')).r.status,200,'Sessão preservada após reinício');
  await mf.dispose();
  let confirmedTotal=0;
  const webhookToken='b'.repeat(64);
  mf=create({...options,bindings:{...options.bindings,COMMERCE_MODE:'live',PAYMENT_PROVIDER:'infinitepay',INFINITEPAY_HANDLE:'edg-br-test',INFINITEPAY_WEBHOOK_TOKEN:webhookToken,MELHOR_ENVIO_CLIENT_ID:'1234',MELHOR_ENVIO_CLIENT_SECRET:'workers-oauth-secret',INTEGRATIONS_ENCRYPTION_KEY:'a'.repeat(64),MELHOR_ENVIO_SANDBOX:'false',ORIGIN_POSTAL_CODE:'80010000',SUPPORT_EMAIL:'support@example.test'},outboundService:async request=>{
    const url=new URL(request.url);
    if(url.origin==='https://melhorenvio.com.br' && url.pathname==='/oauth/token')return Response.json({token_type:'Bearer',access_token:'workers-access-token',refresh_token:'workers-refresh-token',expires_in:2592000});
    if(url.hostname==='www.melhorenvio.com.br'){assert.equal(request.headers.get('authorization'),'Bearer workers-access-token');return Response.json([{id:1,name:'PAC',price:'19.90',delivery_time:7}]);}
    if(url.origin==='https://api.checkout.infinitepay.io' && url.pathname==='/links')return Response.json({url:'https://checkout.infinitepay.com.br/edg-br-test?lenc=test'});
    if(url.origin==='https://api.checkout.infinitepay.io' && url.pathname==='/payment_check')return Response.json({success:true,paid:true,amount:confirmedTotal,paid_amount:confirmedTotal,installments:1,capture_method:'pix'});
    throw new Error('Unexpected external call '+url.origin);
  }});
  const connect=await call('/api/admin/integrations/melhorenvio/connect','POST',{});assert.equal(connect.r.status,200,JSON.stringify(connect.data));
  const oauthState=new URL(connect.data.url).searchParams.get('state');
  const oauthCookie=connect.r.headers.get('set-cookie').split(';')[0];
  const callback=await mf.dispatchFetch(origin+'/api/integrations/melhorenvio/callback?'+new URLSearchParams({code:'worker-code',state:oauthState}),{redirect:'manual',headers:{Cookie:oauthCookie}});
  assert.equal(callback.status,303);assert.equal((await call('/api/admin/integrations/melhorenvio')).data.connected,true);
  assert.equal((await call(`/api/cart/${id}`,'PUT',{quantity:1})).r.status,200);
  const quote=(await call('/api/shipping/quote','POST',{postal_code:'80010000'})).data;
  const order=(await call('/api/checkout','POST',{quote_id:quote.id,service_id:quote.options[0].id,address:{name:'Admin',phone:'41999999999',document:'12345678901',postal_code:'80010000',street:'Rua A',number:'10',district:'Centro',city:'Curitiba',state:'PR'}},{'Idempotency-Key':'workers-infinitepay-test-order'})).data;
  assert.equal(order.payment_provider,'infinitepay',JSON.stringify(order));confirmedTotal=order.total;
  const payload={order_nsu:order.id,invoice_slug:'test-invoice',transaction_nsu:'workers-test-transaction'};
  assert.equal((await call('/api/webhooks/infinitepay','POST',payload)).r.status,401);
  for(let i=0;i<2;i++)assert.equal((await call('/api/webhooks/infinitepay?token='+webhookToken,'POST',payload)).r.status,200);
  assert.equal((await call('/api/products')).data[0].available,11);
  assert.equal((await call('/api/admin/finance')).data.length,1);
  console.log('Workers: catálogo, fotos, persistência, checkout InfinitePay, OAuth Melhor Envio e webhook idempotente aprovados (APIs externas simuladas).');
}finally{if(mf)await mf.dispose();await rm(directory,{recursive:true,force:true});}
