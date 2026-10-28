import { timingSafeEqual } from 'node:crypto';
import { HttpError,requireThat,hash,safeLink,allocateCents,text,integer } from './security.mjs';
const base='https://api.checkout.infinitepay.io';
export function infinitepay(config,fetcher=fetch){
  async function request(path,payload){
    let response;
    try{response=await fetcher(base+path,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});}catch{throw new HttpError(502,'InfinitePay indisponível. Tente novamente.');}
    requireThat(response.ok,502,`InfinitePay recusou a solicitação (${response.status}). Confira o Checkout Integrado e a InfiniteTag.`);
    try{return await response.json();}catch{throw new HttpError(502,'Resposta inválida da InfinitePay.');}
  }
  function configured(){requireThat(config.infiniteHandle && config.infiniteWebhookToken?.length>=32,503,'Configure INFINITEPAY_HANDLE e INFINITEPAY_WEBHOOK_TOKEN.');}
  return {
    async preference(order,items,customer){
      configured();
      const discounts=allocateCents(order.discount||0,items.map(p=>p.price*p.quantity));
      // Group quantities into one line to allocate every cent of a coupon exactly.
      const lines=items.map((p,i)=>({quantity:1,price:p.price*p.quantity-discounts[i],description:`${p.quantity} × ${[p.name,p.selected_color,p.selected_size].filter(Boolean).join(' · ')}`})).filter(p=>p.price>0);
      if(order.shipping)lines.push({quantity:1,price:order.shipping,description:'Frete'});
      requireThat(lines.reduce((sum,p)=>sum+p.price*p.quantity,0)===order.total,409,'Total do checkout divergente.');
      const address=typeof order.address==='string'?JSON.parse(order.address):order.address;
      const data=await request('/links',{handle:config.infiniteHandle,order_nsu:order.id,redirect_url:`${config.url}/?infinitepay_return=1`,webhook_url:`${config.url}/api/webhooks/infinitepay?token=${encodeURIComponent(config.infiniteWebhookToken)}`,items:lines,customer:{name:customer.name,email:customer.email},address:{cep:address.postal_code,number:address.number,complement:address.complement||''}});
      const url=safeLink(data.url);requireThat(url,502,'InfinitePay não retornou o checkout.');
      const host=new URL(url).hostname;
      requireThat(['infinitepay.io','infinitepay.com.br'].some(domain=>host===domain||host.endsWith('.'+domain)),502,'URL do checkout InfinitePay inválida.');
      return {id:`infinitepay-${order.id}`,url};
    },
    verifyNotification(url){
      configured();const incoming=String(url.searchParams.get('token')||'');
      requireThat(timingSafeEqual(Buffer.from(hash(incoming),'hex'),Buffer.from(hash(config.infiniteWebhookToken),'hex')),401,'Notificação de pagamento não autorizada.');
    },
    async check(order,input){
      configured();
      const transaction=text(input.transaction_nsu,'Transação',1,150),slug=text(input.slug??input.invoice_slug,'Fatura',1,250);
      const result=await request('/payment_check',{handle:config.infiniteHandle,order_nsu:order.id,transaction_nsu:transaction,slug});
      requireThat(result.success===true && result.paid===true,409,'Pagamento ainda não confirmado pela InfinitePay.');
      integer(result.amount,'Total confirmado',1);integer(result.paid_amount,'Total pago',1);
      requireThat(result.amount===order.total && result.paid_amount>=result.amount,409,'Valor confirmado pela InfinitePay diverge do pedido.');
      requireThat(['pix','credit_card'].includes(result.capture_method),502,'Meio de pagamento InfinitePay não reconhecido.');
      return {provider:'infinitepay',id:transaction,external_reference:order.id,currency_id:'BRL',transaction_amount:result.amount/100,status:'approved',metadata:{transaction_nsu:transaction,slug,capture_method:result.capture_method,installments:result.installments}};
    },
    async refund(){throw new HttpError(409,'Solicite o estorno no aplicativo InfinitePay. O checkout integrado não oferece estorno automático nesta integração.');}
  };
}
