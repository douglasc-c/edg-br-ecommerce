import { legalRoute,renderLegalPage,sellerInfo } from '../src/brazil-legal.mjs';
import { DurableObject } from 'cloudflare:workers';
import { randomUUID } from 'node:crypto';
import { createApp, configuration } from '../src/server.mjs';
import { email, passwordHash, now } from '../src/security.mjs';
import { durableDatabase } from './database.mjs';
import { campaignVideoPaths, campaignVideoResponse } from '../src/video-response.mjs';
import { normalizeCountry } from '../src/language.mjs';
import { commerceStoreName } from './store-selection.mjs';

const storeUnavailable=(code='STORE_UNAVAILABLE')=>Response.json({error:'A loja está indisponível no momento. Tente novamente mais tarde.',code},{status:503,headers:{'Content-Language':'pt-BR','Cache-Control':'no-store'}});
function startupErrorCode(stage,error){
  if(stage==='configuration'){
    // Apenas nomes conhecidos, nunca a mensagem interna ou valores dos bindings.
    const fields=['APP_URL','COMMERCE_MODE','STORE_DEFAULT_LANGUAGE','STORE_CURRENCY','PAYMENT_PROVIDER','SHIPPING_PROVIDER','INFINITEPAY_HANDLE','INTEGRATIONS_ENCRYPTION_KEY','MELHOR_ENVIO_CLIENT_ID','EMAIL_ENCRYPTION_KEY','NFE_ENVIRONMENT','RESERVATION_MINUTES','EUROPE_CHECKOUT_ENABLED','PAYMENT_ENVIRONMENT','SENDCLOUD_ENVIRONMENT'];
    const field=fields.find(name=>String(error?.message||'').includes(name));
    return field?'CONFIG_'+field:'CONFIG_INVALID';
  }
  return {database:'STORE_DATABASE',administrator:'STORE_ADMIN_SETUP',application:'STORE_INITIALIZATION'}[stage]||'STORE_UNAVAILABLE';
}

// Un objeto estable es propietario de la base de datos de esta tienda. Nunca se deriva su nombre de la entrada del usuario.
export class CommerceStore extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.app=null;this.initializing=null;}
  async initialize(){
    if(this.app)return;
    if(!this.initializing)this.initializing=(async()=>{
      this.startupStage='configuration';
      // Leia os bindings diretamente; copiar env depende de propriedades enumeráveis.
      const config=configuration(this.env,{production:true});
      this.startupStage='database';
      const db=durableDatabase(this.ctx.storage);
      this.startupStage='administrator';
      if(!db.prepare("SELECT id FROM users WHERE role='admin' AND active=1").get()){
        if(!this.env.ADMIN_EMAIL || !this.env.ADMIN_PASSWORD)throw new Error('Configura ADMIN_EMAIL y ADMIN_PASSWORD.');
        const address=email(this.env.ADMIN_EMAIL);
        if(db.prepare('SELECT id FROM users WHERE email=?').get(address))throw new Error('Correo electrónico inicial ya registrado.');
        const pwd=await passwordHash(this.env.ADMIN_PASSWORD);
        db.prepare('INSERT INTO users(id,name,email,password,role,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),'Administrador EDG',address,pwd,'admin',now());
      }
      this.startupStage='application';
      this.app=createApp({db,config,runtime:'worker'});
      this.startupStage='ready';
    })().catch(error=>{this.initializing=null;throw error;});
    await this.initializing;
  }
  async fetch(request){
    try{
      // initialize comparte una promesa, incluida la derivación de la contraseña.
      // Una excepción en blockConcurrencyWhile terminaría el objeto antes del catch.
      await this.initialize();
      const result=await new Promise((resolve,reject)=>{
        const headers=new Headers();let status=200;
        const response={headersSent:false,setHeader(k,v){headers.set(k,v);},writeHead(code,values){status=code;for(const [k,v] of Object.entries(values))headers.set(k,v);this.headersSent=true;},end(content){resolve(new Response(request.method==='HEAD'?null:content??null,{status,headers}));}};
        const req={url:request.url,method:request.method,headers:Object.fromEntries(request.headers),country:normalizeCountry(request.headers.get('x-edg-country')),socket:{remoteAddress:request.headers.get('cf-connecting-ip')||'unknown'},async *[Symbol.asyncIterator](){if(request.body){for await(const chunk of request.body)yield Buffer.from(chunk);}}};
        this.app.handler(req,response).catch(reject);
      });
      if(request.method==='POST'&&new URL(request.url).pathname==='/api/auth/forgot-password'&&result.ok){
        // Keep delivery alive after the generic HTTP response, even if the
        // client disconnects. Cron remains the fallback for scheduled retries.
        this.ctx.waitUntil(this.app.recovery.flush().catch(()=>console.error('Error en el mantenimiento de correos')));
      }
      return result;
    }catch(error){console.error('Tienda no disponible:',error.message);return storeUnavailable(startupErrorCode(this.startupStage,error));}
  }
  async maintenance(){await this.initialize();this.app.shop.expire();await this.app.recovery.flush();await this.app.logistics.maintain();}
}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    const policy=legalRoute(path);
    if(policy&&['GET','HEAD'].includes(request.method))return new Response(request.method==='HEAD'?null:renderLegalPage(policy,sellerInfo(env)),{headers:{'Content-Type':'text/html; charset=utf-8','Content-Language':'pt-BR','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'self'"}});
    if(path.startsWith('/api/') || path.startsWith('/media/')){
      // Solo el dato del edge es fiable: no aceptar cabeceras de país del visitante.
      const headers=new Headers(request.headers),country=normalizeCountry(request.cf?.country);
      headers.delete('x-edg-country');
      if(country)headers.set('x-edg-country',country);
      try{return await env.STORE.getByName(commerceStoreName(env)).fetch(new Request(request,{headers}));}
      catch(error){console.error('No se ha podido acceder a la tienda:',error.message);return storeUnavailable('STORE_BINDING_UNAVAILABLE');}
    }
    const campaignVideo=campaignVideoPaths.has(path)&&['GET','HEAD'].includes(request.method);
    let assetRequest=request;
    if(campaignVideo){
      // The assets binding may ignore Range; obtain the complete small MP4 and
      // apply the requested range ourselves, including Safari's initial probe.
      const headers=new Headers(request.headers);
      headers.delete('Range');headers.delete('If-Range');
      headers.set('Accept-Encoding','identity');
      assetRequest=new Request(request,{method:'GET',headers});
    }
    let response=await env.ASSETS.fetch(assetRequest);
    if(campaignVideo&&response.status===200){
      const result=campaignVideoResponse(request,new Uint8Array(await response.arrayBuffer()),response.headers);
      response=new Response(result.body,{status:result.status,headers:result.headers});
    }
    const headers=new Headers(response.headers);
    headers.set('Content-Language','pt-BR');
    headers.set('Referrer-Policy','strict-origin-when-cross-origin');
    headers.set('X-Content-Type-Options','nosniff');headers.set('X-Frame-Options','DENY');
    headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://i.ytimg.com; media-src 'self' blob:; connect-src 'self'; frame-src https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    headers.set('Strict-Transport-Security','max-age=31536000');
    return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
  },
  async scheduled(controller,env,ctx){ctx.waitUntil(env.STORE.getByName(commerceStoreName(env)).maintenance());}
};
