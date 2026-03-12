import assert from 'node:assert/strict';
import test from 'node:test';
import type { AtsScoreResult } from '../src/lib/api';
import {
  buildReviewAtsAttentionItems,
  buildReviewAtsSuggestionSections,
  REVIEW_ATS_DEBOUNCE_MS,
} from '../src/lib/review-ats';

function mockScore(overrides: Partial<AtsScoreResult>): AtsScoreResult {
  return {
    resumeId: 'resume-1',
    atsScore: 72,
    roleLevel: 'MID',
    roleAdjustedScore: 74,
    rejectionReasons: [],
    improvementSuggestions: [],
    details: [],
    missingKeywords: [],
    ...overrides,
  };
}

test('/resume/review ATS guidance list shows key blockers and keyword gaps', () => {
  const score = mockScore({
    roleAdjustedScore: 61,
    rejectionReasons: ['Summary is too generic.'],
    improvementSuggestions: ['Add measurable impact to each role.'],
    missingKeywords: ['React', 'TypeScript', 'Node.js'],
  });
  const attention = buildReviewAtsAttentionItems(score);
  assert.ok(attention.includes('Summary is too generic.'));
  assert.ok(attention.includes('Add measurable impact to each role.'));
  assert.ok(
    attention.some((item) => item.includes('Show these target keywords in your Summary, Experience, or Skills: React, TypeScript, Node.js.')),
  );
  assert.ok(REVIEW_ATS_DEBOUNCE_MS >= 500 && REVIEW_ATS_DEBOUNCE_MS <= 800);
});

test('/resume/review ATS guidance updates when edited resume gets a new scoring response', () => {
  const beforeEdit = mockScore({
    roleAdjustedScore: 58,
    rejectionReasons: ['Missing contact information.'],
    improvementSuggestions: ['Add a stronger professional summary.'],
    missingKeywords: ['Leadership', 'Architecture'],
  });
  const afterEdit = mockScore({
    roleAdjustedScore: 83,
    rejectionReasons: [],
    improvementSuggestions: ['Tailor two experience bullets to the target role.'],
    missingKeywords: ['Architecture'],
  });

  const beforeAttention = buildReviewAtsAttentionItems(beforeEdit);
  const afterAttention = buildReviewAtsAttentionItems(afterEdit);

  assert.ok(beforeAttention.includes('Missing contact information.'));
  assert.ok(afterAttention.some((item) => item.includes('Tailor two experience bullets')));
  assert.ok(!afterAttention.includes('Missing contact information.'));
});

test('/resume/review ATS target-role guidance uses sectioned ATS wording and examples', () => {
  const score = mockScore({
    improvementSuggestions: [
      'Missing target-role signals: Manager, Lead, Technical Manager.',
      'Show these target keywords in your Summary, Experience, or Skills: Delivery, Planning.',
      'Shorten long bullets to 8-22 words each.',
    ],
    missingKeywords: ['manager', 'lead', 'technical', 'delivery', 'planning'],
  });

  const sections = buildReviewAtsSuggestionSections(score);
  const targetRoleSection = sections.find((section) => section.title === 'Missing target-role signals');
  const keywordSection = sections.find((section) => section.title === 'Missing keywords');

  assert.ok(targetRoleSection);
  assert.equal(
    targetRoleSection?.body,
    'Your target roles include Manager, Lead, or Technical Manager, but your resume does not clearly show those terms or equivalent leadership signals.',
  );
  assert.equal(targetRoleSection?.actionText, 'Add leadership examples in Summary or Experience if accurate.');
  assert.deepEqual(targetRoleSection?.examples, [
    'Led a team of 6 engineers to deliver customer-facing features',
    'Owned sprint planning, task delegation, and delivery tracking',
    'Mentored junior developers and coordinated with product and QA teams',
  ]);
  assert.ok(keywordSection?.body?.includes('Summary, Experience, or Skills'));
  assert.ok(!sections.some((section) => JSON.stringify(section).toLowerCase().includes('upload')));
  assert.ok(!sections.some((section) => JSON.stringify(section).toLowerCase().includes('evidence')));
});
