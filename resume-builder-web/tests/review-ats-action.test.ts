import assert from 'node:assert/strict';
import test from 'node:test';
import { checkAtsScore } from '../src/lib/review-ats-action';

const baseScore = {
  resumeId: 'resume-1',
  atsScore: 72,
  roleLevel: 'MID' as const,
  roleAdjustedScore: 74,
  rejectionReasons: ['Missing measurable impact in summary.'],
  improvementSuggestions: ['Add metrics to each role bullet.'],
  details: [],
  missingKeywords: ['TypeScript'],
};

test('/resume/review Check ATS Score calls endpoint and updates score state payload', async () => {
  const calls: Array<{ id: string; jdText?: string }> = [];
  const result = await checkAtsScore({
    resumeId: 'resume-1',
    jdText: 'Need React and TypeScript',
    previousScore: null,
    score: async (id, jdText) => {
      calls.push({ id, jdText });
      return {
        ...baseScore,
        resumeId: id,
        roleAdjustedScore: 88,
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'resume-1');
  assert.equal(calls[0].jdText, 'Need React and TypeScript');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.score.roleAdjustedScore, 88);
  }
});

test('/resume/review Check ATS Score keeps previous score on API error and returns inline error', async () => {
  const result = await checkAtsScore({
    resumeId: 'resume-1',
    jdText: '',
    previousScore: baseScore,
    score: async () => {
      throw new Error('ATS service unavailable');
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, 'ATS service unavailable');
    assert.equal(result.score?.roleAdjustedScore, 74);
  }
});

test('/resume/review ATS scoring sends undefined JD when field is blank', async () => {
  const calls: Array<{ id: string; jdText?: string }> = [];
  const result = await checkAtsScore({
    resumeId: 'resume-1',
    jdText: '',
    previousScore: null,
    score: async (id, jdText) => {
      calls.push({ id, jdText });
      return {
        ...baseScore,
        resumeId: id,
      };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].jdText, undefined);
});
