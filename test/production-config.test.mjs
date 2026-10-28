import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {configuration} from '../src/server.mjs';

const origin='https://edg-br-ecommerce.douglas-camargo-ltda.workers.dev';
const catalog={APP_URL:origin,COMMERCE_MODE:'catalog'};
const live={...catalog,COMMERCE_MODE:'live',INFINITEPAY_HANDLE:'test-store',INFINITEPAY_WEBHOOK_TOKEN:'x'.repeat(64),
  MELHOR_ENVIO_TOKEN:'shipping-fixture',MELHOR_ENVIO_SANDBOX:'false',ORIGIN_POSTAL_CODE:'80010000',
  SUPPORT_EMAIL:'support@example.test',STORE_LEGAL_NAME:'Fornecedor de teste',STORE_DOCUMENT:'00000000000000',STORE_ADDRESS:'Endereço de teste'};

test('o catálogo inicia com os valores publicados no Wrangler, sem credenciais de venda',()=>{
  const {vars:bindings}=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  const config=configuration(bindings,{production:true});
  assert.equal(config.production,true);assert.equal(config.url,origin);assert.equal(config.mode,'catalog');
  assert.equal(config.defaultLanguage,'pt-BR');assert.equal(config.currency,'BRL');
});

test('lê bindings herdados e não enumeráveis sem perder a validação de produção',()=>{
  const bindings=Object.create({COMMERCE_MODE:'catalog'});
  Object.defineProperties(bindings,{APP_URL:{get:()=>origin},STORE_NAME:{value:'Loja do binding'},STORE_DEFAULT_LANGUAGE:{value:'pt-BR'}});
  assert.deepEqual(Object.keys(bindings),[]);
  const config=configuration(bindings,{production:true});
  assert.equal(config.production,true);assert.equal(config.url,origin);assert.equal(config.mode,'catalog');
  assert.equal(config.storeName,'Loja do binding');
  assert.throws(()=>configuration(Object.create({COMMERCE_MODE:'catalog'}),{production:true}),{status:500,message:/APP_URL/});
});

test('identifica URL e modo inválidos nos logs sem incluir valores fornecidos',()=>{
  for(const APP_URL of ['', 'http://store.example.test', 'not-a-url', 'https://user:private-value@example.test/path']){
    assert.throws(()=>configuration({...catalog,APP_URL},{production:true}),error=>{
      assert.equal(error.status,500);assert.match(error.message,/APP_URL/);assert.doesNotMatch(error.message,/private-value/);return true;
    });
  }
  assert.throws(()=>configuration({...catalog,COMMERCE_MODE:'demo'},{production:true}),{status:500,message:/COMMERCE_MODE/});
});

test('aceita idioma e modo com caixa e espaços vindos do painel e mantém valores canônicos',()=>{
  const config=configuration({APP_URL:' '+origin+'/ ',COMMERCE_MODE:' CATALOG ',STORE_DEFAULT_LANGUAGE:' PT-BR '},{production:true});
  assert.equal(config.production,true);assert.equal(config.url,origin);assert.equal(config.mode,'catalog');assert.equal(config.defaultLanguage,'pt-BR');
  assert.throws(()=>configuration({...catalog,STORE_DEFAULT_LANGUAGE:'invalid'},{production:true}),{status:500,message:/STORE_DEFAULT_LANGUAGE/});
});

test('live continua exigindo credenciais completas e informa os nomes pendentes',()=>{
  assert.equal(configuration(live,{production:true}).mode,'live');
  assert.throws(()=>configuration({...catalog,COMMERCE_MODE:'live'},{production:true}),error=>{
    assert.equal(error.status,500);
    for(const key of ['INFINITEPAY_HANDLE','INFINITEPAY_WEBHOOK_TOKEN','MELHOR_ENVIO','ORIGIN_POSTAL_CODE','SUPPORT_EMAIL','MELHOR_ENVIO_SANDBOX'])assert.ok(error.message.includes(key),key);
    return true;
  });
  for(const [key,value] of Object.entries({INFINITEPAY_HANDLE:'',INFINITEPAY_WEBHOOK_TOKEN:'private-short-token',MELHOR_ENVIO_TOKEN:'',ORIGIN_POSTAL_CODE:'',SUPPORT_EMAIL:'',MELHOR_ENVIO_SANDBOX:'true'})){
    assert.throws(()=>configuration({...live,[key]:value},{production:true}),error=>{
      assert.equal(error.status,500);assert.ok(error.message.includes(key),key);assert.doesNotMatch(error.message,/private-short-token/);return true;
    });
  }
  for(const key of ['STORE_LEGAL_NAME','STORE_DOCUMENT','STORE_ADDRESS'])assert.throws(()=>configuration({...live,[key]:''},{production:true}),{status:500});
  assert.throws(()=>configuration({...live,INTEGRATIONS_ENCRYPTION_KEY:'invalid'},{production:true}),{status:500,message:/INTEGRATIONS_ENCRYPTION_KEY/});
});
