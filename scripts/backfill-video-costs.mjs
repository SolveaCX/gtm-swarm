#!/usr/bin/env node
import { jobs } from '../lib/store.js';
import { calculateAndWriteVideoCost } from '../lib/video-cost.js';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

const brandId = arg('brand');
const date = arg('date');
const list = jobs.all().filter((job) => {
  if (job.status !== 'done') return false;
  if (brandId && job.brandId !== brandId) return false;
  if (date && String(job.doneAt || job.createdAt || '').slice(0, 10) !== date) return false;
  return true;
});

let updated = 0;
let unavailable = 0;
for (const job of list) {
  const cost = calculateAndWriteVideoCost(job);
  if (!cost) {
    unavailable += 1;
    console.log(`${job.id}\tunavailable`);
    continue;
  }
  jobs.update(job.id, { cost });
  updated += 1;
  console.log(`${job.id}\t${cost.totalTokens}\tCNY ${cost.estimatedCny.toFixed(2)}`);
}

console.log(JSON.stringify({ ok: true, matched: list.length, updated, unavailable }));
