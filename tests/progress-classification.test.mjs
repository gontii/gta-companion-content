import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyProgressItem, classifyProgressContent, validateProgressContent } from '../scripts/progress-classification.mjs';
const fact = offer => ({ offer, confidence:'official', eligibility:'all', startsAt:'2026-10-01T09:00:00Z' });
test('verified rewards use actual guaranteed bonus, not sales target or item price', () => {
  assert.equal(classifyProgressItem(fact('FREE weapon; claim at Gun Van'), 'gun-van','2026-10-01').progressGroup,'primary');
  assert.equal(classifyProgressItem(fact('Place top 5 in a race to unlock a car'), 'free-vehicles','2026-10-01').progressGroup,'extra');
  assert.equal(classifyProgressItem(fact('Sell GTA$1,000,000 of product to receive an extra GTA$100,000 and a shirt'), 'challenge','2026-10-01').progressGroup,'extra');
  assert.equal(classifyProgressItem(fact('Sell GTA$1,000,000 of product to receive an extra GTA$250,000 and a shirt'), 'challenge','2026-10-01').progressGroup,'primary');
  assert.equal(classifyProgressItem(fact('Receive GTA$2,000,000 for completing all challenges'), 'challenge','2026-10-01').progressGroup,'primary');
  assert.equal(classifyProgressItem(fact('40% off GTA$2,200,000 property'), 'discounts','2026-10-01').progressGroup,'none');
});
test('GTA+ takes precedence but discounts and unconfirmed offers remain outside counters', () => {
  const member = {...fact('FREE gun at Gun Van'),eligibility:'gta-plus'};
  assert.deepEqual(classifyProgressItem(member,'gun-van','2026-10-01'),{progressGroup:'gta-plus',progressPeriodId:'2026-10-01'});
  assert.equal(classifyProgressItem({...member,offer:'50% off weapon'},'gun-van','2026-10-01').progressGroup,'none');
  assert.equal(classifyProgressItem({...fact('FREE gun'),confidence:'unconfirmed'},'gun-van','2026-10-01').progressGroup,'none');
});
test('linked Beginner tip gets the exact source group and one task identity', () => {
  const content={weekId:'2026-10-01',sections:[{id:'challenge',items:[{id:'reward',label:'Reward',...fact('Receive GTA$250,000 for completing a challenge')}]}],beginnerPath:[{id:'bp-reward',label:'Tip',itemIds:['reward']}]};
  classifyProgressContent(content);
  validateProgressContent(content);
  assert.equal(content.beginnerPath[0].progressGroup,'primary');
  assert.deepEqual(content.beginnerPath[0].itemIds,['reward']);
});
