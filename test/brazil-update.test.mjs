import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {database} from '../src/db.mjs';
import {initialize} from '../src/schema.mjs';
import {configuration,createApp} from '../src/server.mjs';
import {commerce} from '../src/commerce.mjs';
import {customerRequests} from '../src/customer-requests.mjs';
import {renderLegalPage,legalRoute,renderContract,sellerInfo} from '../src/brazil-legal.mjs';
import {hash,now,normalizeBrazilDocument,brazilDocumentFormat,invoiceKeyFormat} from '../src/security.mjs';

const seller={STORE_LEGAL_NAME:'Fornecedor de teste',STORE_DOCUMENT:'00000000000000',STORE_ADDRESS:'Endereço de teste, Curitiba, PR',SUPPORT_EMAIL:'suporte@example.test'};
const address={name:'Cliente',phone:'41999999999',document:'12345678901',postal_code:'80010000',street:'Rua de teste',number:'1',district:'Centro',city:'Curitiba',state:'PR'};
function fixture(t){
  const db=database(':memory:');t.after(()=>db.close());const config=configuration({...seller,COMMERCE_MODE:'demo'});
  const shop=commerce(db,config,{demo:true,quote:async()=>[{id:'shipping',name:'Frete de teste',price:1000,days:5}],preference:async()=>({id:'test',url:null})});
  const users={};for(const role of ['customer','admin','support','inventory']){
    const id=randomUUID(),raw=randomUUID(),csrf=randomUUID(),user={id,role,name:role,email:`${id}@example.test`,raw,csrf};
    db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)').run(id,role,user.email,'unused',role,now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(raw),id,csrf,new Date(Date.now()+60000).toISOString());users[role]=user;
  }
  const product=shop.saveProduct(users.admin,{sku:'BR-TEST',name:'Produto <teste>',category:'Shape',sizes:['8.25'],description:'Produto de teste',price:5000,cost:1000,low_stock:1,weight:.5,width:10,height:10,length:10,color:'#111111',icon:'◇'});
  shop.stock(users.admin,product.id,10,'Saldo de teste');
  return {db,config,shop,users,product,requests:customerRequests(db,shop),async buy(){shop.setCart(users.customer,product.id,1);const q=await shop.quote(users.customer,address.postal_code);return shop.checkout(users.customer,{quote_id:q.id,service_id:q.options[0].id,address},randomUUID());}};
}

for(const durable of [false,true])test(`atualiza o banco brasileiro V5 preservando integração, pedido e reserva (${durable?'Durable Object':'Node'})`,t=>{
  const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());sql.exec(readFileSync(new URL('./fixtures/brazil-v5.sql',import.meta.url),'utf8'));
  sql.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)').run('u','Cliente','u@example.test','hash','admin',now());
  sql.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('session','u','csrf','2099-01-01');
  sql.prepare('INSERT INTO products(id,sku,name,description,category,price,cost,stock,reserved,weight,width,height,length,color,icon,created_at,size) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('p','SKU','Shape antigo','Descrição','Shape',10000,5000,10,2,.5,10,10,10,'#111111','◇',now(),'8.25');
  sql.prepare('INSERT INTO carts VALUES(?,?,?)').run('u','p',1);
  sql.prepare("INSERT INTO orders(id,number,user_id,status,subtotal,shipping,total,address,shipping_service,idempotency_key,request_hash,reserved_until,created_at,updated_at,payment_provider,payment_metadata,payment_id) VALUES('o',1001,'u','awaiting_payment',20000,1000,21000,?,?, 'old-key','old-hash','2099-01-01',?,?, 'infinitepay',?, 'original-payment')").run(JSON.stringify(address),JSON.stringify({id:'shipping',name:'PAC'}),now(),now(),'{"slug":"original"}');
  sql.prepare("INSERT INTO order_items(order_id,product_id,sku,name,price,cost,quantity,weight,width,height,length) VALUES('o','p','SKU','Shape antigo',10000,5000,2,.5,10,10,10)").run();
  sql.prepare("INSERT INTO integration_connections(provider,environment,client_id,encrypted,expires_at,connected_at,updated_at,actor_id) VALUES('melhorenvio','production','123','ciphertext-original','2099-01-01',?,?,'u')").run(now(),now());
  const before={order:{...sql.prepare('SELECT * FROM orders').get()},connection:{...sql.prepare('SELECT * FROM integration_connections').get()}};
  const db=durable?{exec:query=>sql.exec(query),prepare:query=>sql.prepare(query),transactionSync(fn){sql.exec('BEGIN IMMEDIATE');try{const result=fn();sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}}:sql;
  initialize(db);initialize(db);
  const after=sql.prepare('SELECT * FROM orders').get();for(const [key,value] of Object.entries(before.order))assert.equal(after[key],value,key);
  assert.deepEqual({...sql.prepare('SELECT * FROM integration_connections').get()},before.connection);
  assert.deepEqual({...sql.prepare('SELECT stock,reserved,size,sizes,variants_enabled FROM products').get()},{stock:10,reserved:2,size:'8.25',sizes:'["8.25"]',variants_enabled:0});
  assert.equal(sql.prepare('SELECT quantity FROM carts').get().quantity,1);assert.equal(sql.prepare('SELECT quantity FROM order_items').get().quantity,2);
  assert.equal(sql.prepare('SELECT MAX(version) v FROM schema_version').get().v,13);assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('produção BR exige identificação pública do fornecedor e mantém padrão brasileiro',()=>{
  const env={...seller,NODE_ENV:'production',COMMERCE_MODE:'live',APP_URL:'https://br.example.test',INFINITEPAY_HANDLE:'test',INFINITEPAY_WEBHOOK_TOKEN:'x'.repeat(64),MELHOR_ENVIO_TOKEN:'test',MELHOR_ENVIO_SANDBOX:'false',ORIGIN_POSTAL_CODE:'80010000'};
  const config=configuration(env);assert.equal(config.currency,'BRL');assert.equal(config.paymentProvider,'infinitepay');assert.equal(config.shippingProvider,'melhorenvio');assert.equal(config.defaultLanguage,'pt-BR');assert.equal(config.europeCheckout.enabled,false);
  for(const key of ['STORE_LEGAL_NAME','STORE_DOCUMENT','STORE_ADDRESS','SUPPORT_EMAIL'])assert.throws(()=>configuration({...env,[key]:''}),{status:500});
  assert.equal(configuration({...env,COMMERCE_MODE:'catalog',STORE_LEGAL_NAME:''}).mode,'catalog');
});

test('condições da compra preservam o fornecedor original e escapam dados do cliente',async t=>{
  const f=fixture(t),o=await f.buy();f.config.seller.name='Fornecedor posterior';
  const html=renderContract(f.shop.order(o.id,f.users.customer));assert.match(html,/Fornecedor de teste/);assert.doesNotMatch(html,/Fornecedor posterior/);assert.match(html,/Produto &lt;teste&gt;/);assert.match(html,/BR-2026-10-28/);assert.match(html,/60,00/);
  assert.equal(f.shop.order(o.id).payment_status,'pending');
});

test('protocolo é imediato e idempotente; devolução não altera pagamento nem estoque',async t=>{
  const f=fixture(t),order=await f.buy(),input={type:'withdrawal',message:'Quero devolver o pedido.',order_id:order.id},key=randomUUID();
  const receipt=f.requests.create(f.users.customer,input,key);assert.match(receipt.protocol,/^EDG-BR-/);assert.equal(f.requests.create(f.users.customer,input,key).id,receipt.id);
  assert.throws(()=>f.requests.create(f.users.customer,{...input,message:'Outra mensagem'},key),{status:409});
  assert.equal(f.requests.list(f.users.customer).length,1);assert.equal(f.requests.list(f.users.admin).length,0);
  assert.equal(f.shop.order(order.id).payment_status,'pending');assert.equal(f.db.prepare('SELECT reserved FROM products').get().reserved,1);assert.equal(f.shop.ledger().length,0);
  assert.match(f.shop.order(order.id).events.at(-1).message,new RegExp(receipt.protocol));
});

test('aceita pedido LGPD sem compra e mantém resposta disponível ao titular',t=>{
  const f=fixture(t),r=f.requests.create(f.users.customer,{type:'privacy',message:'Solicito acesso aos meus dados.'},randomUUID());
  f.requests.update(f.users.support,r.id,{status:'in_progress',response:'Recebemos seu pedido de acesso.'});
  assert.equal(f.requests.list(f.users.customer)[0].response,'Recebemos seu pedido de acesso.');
  assert.throws(()=>f.requests.create(f.users.customer,{type:'withdrawal',message:'Devolver'},randomUUID()),{status:400});
});

test('HTTP protege solicitações por dono, sessão, CSRF e permissão de atendimento',async t=>{
  const f=fixture(t),order=await f.buy(),app=createApp({db:f.db,config:f.config,runtime:'worker'});
  async function call(path,method='GET',input,user,headers={}){
    const req=Readable.from(input?[Buffer.from(JSON.stringify(input))]:[]);Object.assign(req,{url:path,method,headers:{origin:f.config.url,'content-type':'application/json',...(user?{cookie:`edg_session=${user.raw}`,'x-csrf-token':user.csrf}:{}),...headers},socket:{remoteAddress:'test'}});
    let status,body;const responseHeaders=new Headers();await app.handler(req,{headersSent:false,setHeader(k,v){responseHeaders.set(k,v);},writeHead(code,h){status=code;Object.entries(h).forEach(([k,v])=>responseHeaders.set(k,v));this.headersSent=true;},end(value){body=value;}});
    return {status,body,headers:responseHeaders};
  }
  const input={type:'withdrawal',message:'Solicito devolução.',order_id:order.id};
  assert.equal((await call('/api/requests')).status,401);
  assert.equal((await call('/api/requests','POST',input,f.users.customer,{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await call('/api/requests','POST',input,f.users.admin,{'idempotency-key':randomUUID()})).status,404);
  const response=await call('/api/requests','POST',input,f.users.customer,{'idempotency-key':randomUUID()});assert.equal(response.status,201);const receipt=JSON.parse(response.body);
  assert.equal((await call('/api/admin/requests','GET',undefined,f.users.inventory)).status,403);
  const list=await call('/api/admin/requests','GET',undefined,f.users.support);assert.equal(list.status,200);assert.equal(JSON.parse(list.body)[0].protocol,receipt.protocol);
  assert.equal((await call('/api/requests','GET',undefined,f.users.admin)).body,'[]');
  assert.equal((await call(`/api/orders/${order.id}/contract`,'GET',undefined,f.users.admin)).status,404);
  const contract=await call(`/api/orders/${order.id}/contract`,'GET',undefined,f.users.customer);assert.equal(contract.status,200);assert.match(contract.headers.get('content-disposition'),/attachment/);
});

test('rotas atuais e antigas entregam políticas brasileiras legíveis sem JavaScript',()=>{
  for(const route of ['/privacidade/','/privacidad/index.html','/termos','/terminos/','/trocas-e-devolucoes/','/devoluciones/'])assert.ok(legalRoute(route));
  const privacy=renderLegalPage('privacy',sellerInfo(seller));assert.match(privacy,/lang="pt-BR"/);assert.match(privacy,/LGPD/);assert.doesNotMatch(privacy,/<script|Espacio Económico|SKATEBOARDS S\.L/);
  const returns=renderLegalPage('returns',sellerInfo(seller));assert.match(returns,/sete dias/);assert.match(returns,/sem cobrança/);
});

test('CNPJ alfanumérico preserva letras no formato e na chave da NF-e',()=>{
  const value='00.000.000/E08G-12';assert.equal(normalizeBrazilDocument(value),'00000000E08G12');assert.equal(brazilDocumentFormat(value),true);assert.equal(brazilDocumentFormat('123.456.789-01'),true);assert.equal(brazilDocumentFormat('AB.123.456/0001-AA'),false);
  assert.equal(invoiceKeyFormat('412610'+'00000000E08G12'+'55'+'001'+'000000001'+'1'+'12345678'+'0'),true);assert.equal(invoiceKeyFormat('A'.repeat(44)),false);
});
