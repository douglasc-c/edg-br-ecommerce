import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from '../src/db.mjs';
import {configuration,createApp} from '../src/server.mjs';
import {commerce} from '../src/commerce.mjs';
import {providers} from '../src/providers.mjs';
import {passwordHash,now} from '../src/security.mjs';
const environment={STORE_LEGAL_NAME:'Fornecedor de teste',STORE_DOCUMENT:'00000000000000',STORE_ADDRESS:'Endereço de teste sem operação real',NODE_ENV:'production',APP_URL:'https://br.example.test',COMMERCE_MODE:'live',PAYMENT_PROVIDER:'infinitepay',STORE_CURRENCY:'BRL',INFINITEPAY_HANDLE:'edg-br',INFINITEPAY_WEBHOOK_TOKEN:'a'.repeat(64),MELHOR_ENVIO_TOKEN:'shipping-test',MELHOR_ENVIO_SANDBOX:'false',ORIGIN_POSTAL_CODE:'80010000',SUPPORT_EMAIL:'suporte@example.test'};
const destination={name:'Cliente BR',phone:'41999999999',document:'12345678901',postal_code:'80010000',street:'Rua A',number:'10',district:'Centro',city:'Curitiba',state:'PR'};
function fixture(t){
 const db=database(':memory:');t.after(()=>db.close());const config=configuration(environment),calls=[];
 const f={db,config,calls,result:null};
 const fetcher=async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url,body});
  if(url.endsWith('/shipment/calculate'))return Response.json([{id:1,name:'PAC',company:{name:'Correios'},price:'19.90',delivery_time:7}]);
  if(url.endsWith('/links'))return Response.json({url:'https://checkout.infinitepay.com.br/edg-br?lenc=example'});
  if(url.endsWith('/payment_check')){if(f.fail)throw new Error('offline');return Response.json(f.result);}
  throw new Error('Unexpected URL '+url);
 };
 f.provider=providers(config,fetcher);f.shop=commerce(db,config,f.provider);
 for(const [key,role] of [['user','customer'],['admin','admin']]){f[key]={id:randomUUID(),name:key,email:key+'@example.test',role};const u=f[key];db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)').run(u.id,u.name,u.email,'unused',u.role,now());}
 f.p=f.shop.saveProduct(f.admin,{sku:'BR-001',name:'Produto Brasil',description:'Estoque brasileiro',category:'Teste',price:10001,cost:4000,low_stock:2,weight:.5,width:10,height:10,length:10,color:'#d9e4d5',icon:'◇'});f.shop.stock(f.admin,f.p.id,10,'Saldo inicial');
 f.stock=()=>({...db.prepare('SELECT stock,reserved FROM products WHERE id=?').get(f.p.id)});
 f.buy=async(quantity=2,coupon)=>{f.shop.setCart(f.user,f.p.id,quantity);const q=await f.shop.quote(f.user,destination.postal_code);return f.shop.checkout(f.user,{quote_id:q.id,service_id:q.options[0].id,address:destination,coupon,terms_accepted:true},randomUUID());};
 f.approve=o=>{f.result={success:true,paid:true,amount:o.total,paid_amount:o.total+10,installments:1,capture_method:'pix'};};
 return f;
}
const notification=o=>({order_nsu:o.id,invoice_slug:'invoice-test',transaction_nsu:randomUUID(),amount:1,paid:true});
test('configuração brasileira permite InfinitePay sem Mercado Pago e exige configuração real para vender',()=>{
 const c=configuration(environment);assert.equal(c.paymentProvider,'infinitepay');assert.equal(c.mpToken,undefined);assert.equal(c.currency,'BRL');
 assert.throws(()=>configuration({...environment,INFINITEPAY_WEBHOOK_TOKEN:''}),/Produção/);
 assert.throws(()=>configuration({...environment,INFINITEPAY_HANDLE:'$wrong'}),/InfiniteTag/);
 assert.throws(()=>configuration({...environment,STORE_CURRENCY:'EUR'}),/EUR/);
 assert.equal(configuration({NODE_ENV:'production',APP_URL:environment.APP_URL,COMMERCE_MODE:'catalog'}).paymentProvider,'infinitepay');
});
test('InfinitePay cria link com valor exato de produtos, cupom e frete definidos no servidor',async t=>{
 const f=fixture(t);f.shop.coupons.save(f.admin,{code:'BR10',type:'percent',value:1000,min_subtotal:0,max_discount:null,max_uses:10,per_user_limit:2,starts_at:'2020-01-01T00:00:00.000Z',ends_at:'2099-01-01T00:00:00.000Z',active:true});
 const o=await f.buy(3,'BR10');assert.equal(o.payment_provider,'infinitepay');assert.match(o.payment_url,/checkout.infinitepay/);
 const request=f.calls.find(c=>c.url.endsWith('/links')).body;assert.equal(request.handle,'edg-br');assert.equal(request.order_nsu,o.id);assert.equal(request.items.reduce((sum,p)=>sum+p.price*p.quantity,0),o.total);assert.equal(request.items.at(-1).price,1990);assert.equal(request.redirect_url,'https://br.example.test/?infinitepay_return=1');assert.equal(new URL(request.webhook_url).searchParams.get('token'),environment.INFINITEPAY_WEBHOOK_TOKEN);
 await f.shop.paymentLink(f.user,o.id);assert.equal(f.calls.filter(c=>c.url.endsWith('/links')).length,1);assert.deepEqual(f.stock(),{stock:10,reserved:3});assert.equal(f.shop.ledger().length,0);
});
test('confirmação consulta API canônica e recusa pendência, falha de rede e valor divergente',async t=>{
 const f=fixture(t),o=await f.buy(),input=notification(o);
 f.result={success:true,paid:false,amount:o.total,paid_amount:o.total};await assert.rejects(f.shop.confirmInfinitePayment(f.user,o.id,input),/ainda não confirmado/);
 f.approve(o);f.result.amount--;await assert.rejects(f.shop.confirmInfinitePayment(f.user,o.id,input),/diverge/);
 f.fail=true;await assert.rejects(f.shop.confirmInfinitePayment(f.user,o.id,input),/indisponível/);assert.deepEqual(f.stock(),{stock:10,reserved:2});assert.equal(f.shop.ledger().length,0);
});
test('webhook duplicado confirma uma venda e transação não pode ser reutilizada em outro pedido',async t=>{
 const f=fixture(t),o=await f.buy(),input=notification(o);f.approve(o);
 let paid=await f.shop.confirmInfinitePayment(null,o.id,input);assert.equal(paid.status,'paid');assert.equal(paid.payment_id,input.transaction_nsu);assert.deepEqual(f.stock(),{stock:8,reserved:0});
 paid=await f.shop.confirmInfinitePayment(null,o.id,input);assert.equal(f.shop.ledger().length,1);assert.deepEqual(f.stock(),{stock:8,reserved:0});assert.equal(JSON.parse(paid.payment_metadata).capture_method,'pix');
 const second=await f.buy();f.approve(second);await assert.rejects(f.shop.confirmInfinitePayment(null,second.id,{...input,order_nsu:second.id}),/outro pedido/);assert.equal(f.shop.order(second.id).payment_status,'pending');
 const check=f.calls.find(c=>c.url.endsWith('/payment_check')).body;assert.deepEqual(check,{handle:'edg-br',order_nsu:o.id,transaction_nsu:input.transaction_nsu,slug:input.invoice_slug});
 await assert.rejects(f.shop.refund(f.admin,o.id),/aplicativo InfinitePay/);assert.equal(f.shop.ledger().length,1);
});
test('pagamento após expiração não consome estoque reservado para outra compra',async t=>{
 const f=fixture(t),o=await f.buy(10);f.db.prepare('UPDATE orders SET reserved_until=? WHERE id=?').run('2000-01-01T00:00:00.000Z',o.id);f.shop.expire();await f.buy(10);f.approve(o);
 const result=await f.shop.confirmInfinitePayment(null,o.id,notification(o));assert.equal(result.status,'payment_review');assert.deepEqual(f.stock(),{stock:10,reserved:10});assert.equal(f.shop.ledger().length,1);
});
test('HTTP: webhook exige token e confirmação real; callback exige dono, sessão e CSRF',async t=>{
 const f=fixture(t),o=await f.buy(),input=notification(o);const password='InfinitePay-HTTP-test-2026';f.db.prepare('UPDATE users SET password=?').run(await passwordHash(password));
 const app=createApp({db:f.db,config:f.config,provider:f.provider});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>app.server.close(resolve)));const base=`http://127.0.0.1:${app.server.address().port}`;
 const call=async(path,body,auth={},extra={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:f.config.url,...auth,...extra},body:JSON.stringify(body)});
 assert.equal((await call('/api/webhooks/infinitepay',input)).status,401);assert.equal(f.calls.filter(c=>c.url.endsWith('/payment_check')).length,0);
 const webhook='/api/webhooks/infinitepay?token='+environment.INFINITEPAY_WEBHOOK_TOKEN;f.result={success:true,paid:false};let r=await call(webhook,input);assert.equal(r.status,400);assert.equal((await r.json()).success,false);assert.equal(f.shop.ledger().length,0);
 const login=await call('/api/auth/login',{email:f.admin.email,password});const auth={'Cookie':login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await login.json()).csrf};
 assert.equal((await call(`/api/orders/${o.id}/payment-check`,input,auth)).status,404);
 const user=await call('/api/auth/login',{email:f.user.email,password});const userAuth={Cookie:user.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await user.json()).csrf};
 assert.equal((await call(`/api/orders/${o.id}/payment-check`,input,{Cookie:userAuth.Cookie})).status,403);
 f.approve(o);r=await call(webhook,input,{}, {Origin:'https://provider.example'});assert.equal(r.status,200);assert.deepEqual(await r.json(),{success:true,message:null});
 r=await call(`/api/orders/${o.id}/payment-check`,input,userAuth);assert.equal(r.status,200);const result=await r.json();assert.equal(result.status,'paid');assert.equal(result.payment_metadata,undefined);assert.equal(result.items[0].cost,undefined);assert.equal(f.shop.ledger().length,1);
});
