import {test,expect} from './fixtures.mjs';

test('a CSP bloqueia análise opcional e origens externas por padrão',async({page})=>{
  let beaconRequests=0,metricRequests=0,untrustedRequests=0;
  await page.route('https://static.cloudflareinsights.com/**',route=>{
    beaconRequests++;return route.fulfill({contentType:'application/javascript',body:'window.cloudflareBeaconLoaded = true;'});
  });
  await page.route('https://cloudflareinsights.com/**',route=>{
    metricRequests++;return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.route('https://untrusted.example.test/**',route=>{
    untrustedRequests++;return route.fulfill({contentType:'application/javascript',body:'window.untrustedScriptLoaded = true;'});
  });
  await page.goto('/');
  const loaded=await page.evaluate(async()=>{
    const load=src=>new Promise(resolve=>{
      const script=document.createElement('script');script.src=src;
      script.onload=()=>resolve(true);script.onerror=()=>resolve(false);document.head.append(script);
    });
    // La inyección automática de Cloudflare incluye una versión después de beacon.min.js.
    const beacon=await load('https://static.cloudflareinsights.com/beacon.min.js/version-for-test');
    const untrusted=await load('https://untrusted.example.test/analytics.js');
    let metricStatus=null;try{metricStatus=(await fetch('https://cloudflareinsights.com/cdn-cgi/rum',{method:'POST',body:'{}'})).status;}catch{}
    let blockedConnection=false;
    try{await fetch('https://untrusted.example.test/collect',{mode:'no-cors'});}catch{blockedConnection=true;}
    return {beacon,untrusted,metricStatus,blockedConnection,beaconExecuted:window.cloudflareBeaconLoaded===true,untrustedExecuted:window.untrustedScriptLoaded===true};
  });
  expect(loaded).toEqual({beacon:false,untrusted:false,metricStatus:null,blockedConnection:true,beaconExecuted:false,untrustedExecuted:false});
  expect(beaconRequests).toBe(0);expect(metricRequests).toBe(0);expect(untrustedRequests).toBe(0);
});
