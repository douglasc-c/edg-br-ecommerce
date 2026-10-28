import { randomUUID } from 'node:crypto';
import { transaction } from './db.mjs';
import { requireThat,text,hash,now } from './security.mjs';

export function customerRequests(db,shop) {
  const get=(sql,...args)=>db.prepare(sql).get(...args);
  return {
    list(user,manage=false){return db.prepare(`SELECT r.*,u.name customer_name,u.email customer_email,o.number order_number FROM customer_requests r JOIN users u ON u.id=r.user_id LEFT JOIN orders o ON o.id=r.order_id ${manage?'':'WHERE r.user_id=?'} ORDER BY r.created_at DESC LIMIT 200`).all(...(manage?[]:[user.id])).map(({request_hash,idempotency_key,...row})=>row);},
    create(user,input,key){
      requireThat(['withdrawal','defect','privacy','question'].includes(input.type),400,'Tipo de solicitação inválido.');
      const message=text(input.message,'Mensagem',3,3000),orderId=input.order_id?text(input.order_id,'Pedido',1,100):null;
      const requestKey=text(key,'Chave de confirmação',10,100),requestHash=hash(JSON.stringify({type:input.type,message,orderId}));
      if(orderId)shop.order(orderId,user);
      requireThat(!['withdrawal','defect'].includes(input.type)||orderId,400,'Selecione o pedido para solicitar devolução.');
      return transaction(db,()=>{
        const previous=get('SELECT * FROM customer_requests WHERE user_id=? AND idempotency_key=?',user.id,requestKey);
        if(previous){requireThat(previous.request_hash===requestHash,409,'A chave já foi usada para outra solicitação.');return {id:previous.id,protocol:previous.protocol,status:previous.status,created_at:previous.created_at};}
        const id=randomUUID(),time=now(),protocol=`EDG-BR-${time.slice(0,10).replaceAll('-','')}-${id.slice(0,8).toUpperCase()}`;
        db.prepare("INSERT INTO customer_requests(id,protocol,user_id,order_id,type,message,status,idempotency_key,request_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,'open',?,?,?,?)").run(id,protocol,user.id,orderId,input.type,message,requestKey,requestHash,time,time);
        if(orderId)db.prepare('INSERT INTO order_events(order_id,status,message,created_at) VALUES(?,?,?,?)').run(orderId,shop.order(orderId,user).status,`Solicitação recebida: ${protocol}. Acompanhe em Atendimento e devoluções.`,time);
        shop.audit(user.id,'customer_request.create',id,{type:input.type,order_id:orderId});
        return {id,protocol,status:'open',created_at:time};
      });
    },
    update(user,id,input){
      requireThat(['open','in_progress','resolved'].includes(input.status),400,'Status de atendimento inválido.');
      const response=text(input.response,'Resposta ao cliente',3,3000);
      requireThat(get('SELECT id FROM customer_requests WHERE id=?',id),404,'Solicitação não encontrada.');
      db.prepare('UPDATE customer_requests SET status=?,response=?,updated_at=? WHERE id=?').run(input.status,response,now(),id);
      shop.audit(user.id,'customer_request.update',id,{status:input.status});return {ok:true};
    },
  };
}
