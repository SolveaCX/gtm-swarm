import assert from 'node:assert/strict';
import test from 'node:test';

const fixture = {
  builtAt: new Date().toISOString(),
  cards: [
    { source: 'x', score: 88, tier: 'must' },
    { source: 'podcast', score: 74, tier: 'strong' },
    { source: 'youtube', score: 52, tier: 'watch' },
  ],
};

test('inspiration cards obey score tiers and supported sources', () => {
  const allowed = new Set(['x', 'podcast', 'youtube']);
  for (const card of fixture.cards) {
    assert.equal(allowed.has(card.source), true);
    assert.equal(card.score >= 0 && card.score <= 100, true);
    const tier = card.score >= 85 ? 'must' : card.score >= 70 ? 'strong' : card.score >= 50 ? 'watch' : 'skip';
    assert.equal(card.tier, tier);
  }
});

test('inspiration cache payload is JSON serializable', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(fixture)), fixture);
});
