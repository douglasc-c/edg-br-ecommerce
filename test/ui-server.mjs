import { mkdtempSync,rmSync,copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
const dir=mkdtempSync(join(tmpdir(),'edg-ui-'));
Object.assign(process.env,{STORE_DEFAULT_LANGUAGE:'es',NODE_ENV:'test',COMMERCE_MODE:'demo',APP_URL:'http://localhost:3100',DB_PATH:join(dir,'commerce.db'),ADMIN_EMAIL:'admin@example.com',ADMIN_PASSWORD:'UI-exclusive-fixture-2026',PORT:'3100',HOST:'127.0.0.1'});
const result=spawnSync(process.execPath,['src/seed.mjs'],{env:process.env,stdio:'inherit'});if(result.status!==0)process.exit(1);
const {createApp,configuration}=await import('../src/server.mjs');
const {database}=await import('../src/db.mjs');const config=configuration();
const seedPath=join(dir,'seed.db');copyFileSync(process.env.DB_PATH,seedPath);let db=database();
let app=createApp({db,config,runtime:'worker'});
const server=createServer((req,res)=>{
  if(req.url==='/__test/reset'&&req.method==='POST'){
    db.close();copyFileSync(seedPath,process.env.DB_PATH);db=database();
    app=createApp({db,config,runtime:'worker'});res.writeHead(204);return res.end();
  }
  return app.handler(req,res);
});
server.listen(3100,'127.0.0.1');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();rmSync(dir,{recursive:true,force:true});process.exit(0);}));
