import {test as base,expect} from '@playwright/test';

// Each scenario starts from an isolated copy of the seeded database and fresh
// rate-limit buckets. This endpoint exists only in test/ui-server.mjs.
export const test=base.extend({
  resetStore:[async({request},use)=>{
    const response=await request.post('/__test/reset');
    expect(response.status()).toBe(204);
    await use();
  },{auto:true}],
});
export {expect};
