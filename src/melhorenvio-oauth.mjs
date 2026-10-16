import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {transaction} from './db.mjs';
import {HttpError,requireThat,hash,token,now,text} from './security.mjs';
export const shippingScopes=['cart-read','cart-write','shipping-calculate','shipping-checkout','shipping-generate','shipping-print','shipping-tracking'];
export const shippingCallback='/api/integrations/melhorenvio/callback';
export function melhorEnvioOAuth(db,config,fetcher=fetch){
  const environment=config.meSandbox?'sandbox':'production';
  const base=config.meSandbox?'https://sandbox.melhorenvio.com.br':'https://melhorenvio.com.br';
  const callback=config.url+shippingCallback;
  const key=config.integrationsKey?Buffer.from(config.integrationsKey,'hex'):null;
  let busy=false,refreshing=null;
  const get=()=>db.prepare("SELECT * FROM integration_connections WHERE provider='melhorenvio' AND environment=?").get(environment);
  const missing=()=>[['MELHOR_ENVIO_CLIENT_ID',config.meClientId],['MELHOR_ENVIO_CLIENT_SECRET',config.meClientSecret],['INTEGRATIONS_ENCRYPTION_KEY',key],['SUPPORT_EMAIL',config.supportEmail]].filter(([,v])=>!v).map(([name])=>name);
  function configured(){requireThat(!missing().length,503,'Configure as credenciais OAuth, a chave de criptografia e o e-mail de suporte no Cloudflare.');}
  const aad=()=>Buffer.from(`melhorenvio:${environment}:${config.meClientId}`);
  function encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad());const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return JSON.stringify({iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:data.toString('hex')});}
  function decrypt(value){try{const encoded=JSON.parse(value),cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(encoded.iv,'hex'));cipher.setAAD(aad());cipher.setAuthTag(Buffer.from(encoded.tag,'hex'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(encoded.data,'hex')),cipher.final()]).toString());}catch{throw new HttpError(503,'Não foi possível ler a conexão. Confira a chave de criptografia e reconecte o Melhor Envio.');}}
  async function exchange(parameters,previousRefresh=null){
    let response;
    try{response=await fetcher(base+'/oauth/token',{method:'POST',redirect:'manual',headers:{Accept:'application/json','Content-Type':'application/json','User-Agent':`EDG Brasil (${config.supportEmail})`},body:JSON.stringify({client_id:config.meClientId,client_secret:config.meClientSecret,...parameters}),signal:AbortSignal.timeout(15000)});}catch{throw new HttpError(502,'Melhor Envio indisponível. Tente conectar novamente.');}
    if(!response.ok){const error=new HttpError(502,'O Melhor Envio recusou a autorização. Confira as credenciais e reconecte.');error.reauthorize=[400,401,403].includes(response.status);throw error;}
    let data;try{data=await response.json();}catch{throw new HttpError(502,'Resposta de autorização inválida.');}
    requireThat(data && typeof data.access_token==='string' && data.access_token.length>0 && data.access_token.length<=16000,502,'Token de acesso inválido.');
    const refresh=data.refresh_token||previousRefresh;
    requireThat(typeof refresh==='string' && refresh.length>0 && refresh.length<=16000,502,'Token de renovação inválido.');
    requireThat(Number.isSafeInteger(data.expires_in) && data.expires_in>0 && data.expires_in<=31536000,502,'Validade do token inválida.');
    if(data.token_type)requireThat(data.token_type.toLowerCase()==='bearer',502,'Tipo de token inválido.');
    if(data.scope){const granted=Array.isArray(data.scope)?data.scope:String(data.scope).split(/[ ,]+/);requireThat(shippingScopes.every(scope=>granted.includes(scope)),502,'Autorize todas as permissões de frete solicitadas.');}
    return {access_token:data.access_token,refresh_token:refresh,expires_at:new Date(Date.now()+data.expires_in*1000).toISOString()};
  }
  function cookie(value,maxAge=600){return `edg_me_oauth=${value}; HttpOnly; SameSite=Lax; Path=${shippingCallback}; Max-Age=${maxAge}${config.production?'; Secure':''}`;}
  function status(){
    const row=get(),valid=row?.status==='connected' && row.client_id===String(config.meClientId||'');
    const direct=!row && Boolean(config.meToken);
    return {environment,configured:!missing().length,missing:missing(),connected:Boolean(valid),method:valid?'oauth':direct?'personal_token':'disconnected',expires_at:valid?row.expires_at:null,connected_at:valid?row.connected_at:null,last_error:row?.last_error||null,callback_url:callback,webhook_url:config.url+'/api/webhooks/melhorenvio',webhook_secret_configured:Boolean(config.meSecret),last_webhook_at:db.prepare("SELECT MAX(received_at) value FROM integration_webhooks WHERE provider='melhorenvio' AND environment=?").get(environment).value};
  }
  function begin(user){
    configured();const state=token(),browser=token(),expires=new Date(Date.now()+600000).toISOString();
    transaction(db,()=>{db.prepare('DELETE FROM integration_oauth_states WHERE expires_at<=? OR actor_id=?').run(now(),user.id);db.prepare('INSERT INTO integration_oauth_states VALUES(?,?,?,?,?,?,?,?,?)').run(hash(state),hash(browser),user.token,user.id,expires,environment,String(config.meClientId),callback,now());});
    const url=new URL(base+'/oauth/authorize');url.search=new URLSearchParams({client_id:config.meClientId,redirect_uri:callback,response_type:'code',state,scope:shippingScopes.join(' ')});
    return {url:url.href,cookie:cookie(browser)};
  }
  async function finish(parameters,browser){
    configured();requireThat(!busy,409,'A conexão está sendo atualizada. Tente novamente.');
    const state=parameters.get('state');requireThat(typeof state==='string' && /^[a-f0-9]{64}$/.test(state) && typeof browser==='string' && /^[a-f0-9]{64}$/.test(browser),400,'Autorização inválida ou expirada. Conecte novamente pelo painel.');
    busy=true;
    try{
      const actor=transaction(db,()=>{
        const row=db.prepare("SELECT o.*,u.role,u.active FROM integration_oauth_states o JOIN sessions s ON s.token=o.session_token AND s.user_id=o.actor_id JOIN users u ON u.id=o.actor_id WHERE o.state_hash=? AND o.expires_at>? AND s.expires_at>?").get(hash(state),now(),now());
        requireThat(row && row.browser_hash===hash(browser) && row.active && row.role==='admin' && row.environment===environment && row.client_id===String(config.meClientId) && row.redirect_uri===callback,400,'Autorização inválida ou expirada. Conecte novamente pelo painel.');
        db.prepare('DELETE FROM integration_oauth_states WHERE state_hash=?').run(hash(state));return row.actor_id;
      });
      if(parameters.has('error'))return {actor,denied:true};
      const code=text(parameters.get('code'),'Código de autorização',1,4096);
      const tokens=await exchange({grant_type:'authorization_code',redirect_uri:callback,code});
      db.prepare("INSERT INTO integration_connections(provider,environment,client_id,encrypted,expires_at,connected_at,updated_at,actor_id,status,last_error) VALUES('melhorenvio',?,?,?,?,?,?,?,'connected',NULL) ON CONFLICT(provider,environment) DO UPDATE SET client_id=excluded.client_id,encrypted=excluded.encrypted,expires_at=excluded.expires_at,connected_at=excluded.connected_at,updated_at=excluded.updated_at,actor_id=excluded.actor_id,status='connected',last_error=NULL").run(environment,String(config.meClientId),encrypt(tokens),tokens.expires_at,now(),now(),actor);
      return {actor,denied:false};
    }finally{busy=false;}
  }
  async function accessToken(){
    const row=get();
    if(!row){requireThat(config.meToken,503,'Conecte sua conta Melhor Envio em Integrações.');return config.meToken;}
    configured();requireThat(row.status==='connected' && row.client_id===String(config.meClientId),503,'Reconecte sua conta Melhor Envio em Integrações.');
    const tokens=decrypt(row.encrypted);
    if(Date.parse(row.expires_at)>Date.now()+300000)return tokens.access_token;
    if(refreshing)return refreshing;
    requireThat(!busy,409,'A conexão Melhor Envio está sendo atualizada. Tente novamente.');busy=true;
    refreshing=(async()=>{
      try{
        const renewed=await exchange({grant_type:'refresh_token',refresh_token:tokens.refresh_token},tokens.refresh_token);
        db.prepare("UPDATE integration_connections SET encrypted=?,expires_at=?,updated_at=?,last_error=NULL WHERE provider='melhorenvio' AND environment=?").run(encrypt(renewed),renewed.expires_at,now(),environment);
        return renewed.access_token;
      }catch(error){db.prepare("UPDATE integration_connections SET status=?,last_error=?,updated_at=? WHERE provider='melhorenvio' AND environment=?").run(error.reauthorize?'reauthorize':'connected',error.reauthorize?'Reconecte a conta para renovar a autorização.':'Não foi possível renovar a conexão. Tente novamente.',now(),environment);if(!error.reauthorize && Date.parse(row.expires_at)>Date.now())return tokens.access_token;throw error;}
      finally{busy=false;refreshing=null;}
    })();
    return refreshing;
  }
  function disconnect(user){
    requireThat(!busy,409,'A conexão está sendo atualizada. Tente novamente.');
    transaction(db,()=>{
      db.prepare("INSERT INTO integration_connections(provider,environment,client_id,encrypted,expires_at,connected_at,updated_at,actor_id,status) VALUES('melhorenvio',?,?, '',?,?,?,?, 'disconnected') ON CONFLICT(provider,environment) DO UPDATE SET encrypted='',status='disconnected',last_error=NULL,updated_at=excluded.updated_at").run(environment,String(config.meClientId||''),now(),now(),now(),user.id);
      db.prepare('DELETE FROM integration_oauth_states WHERE environment=?').run(environment);
    });
  }
  async function maintain(){
    db.prepare('DELETE FROM integration_oauth_states WHERE expires_at<=?').run(now());
    db.prepare('DELETE FROM integration_webhooks WHERE received_at<?').run(new Date(Date.now()-90*86400000).toISOString());
    const row=get();if(row?.status==='connected' && row.client_id===String(config.meClientId) && Date.parse(row.expires_at)<=Date.now()+600000)await accessToken();
  }
  return {status,begin,finish,accessToken,disconnect,maintain,clearCookie:()=>cookie('',0),available:()=>{const row=get();return row?row.status==='connected' && row.client_id===String(config.meClientId):Boolean(config.meToken);}};
}
