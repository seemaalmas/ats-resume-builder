import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countWords,
  findFirstTooLongHighlight,
  focusHighlightById,
  getHighlightLengthState,
  shouldShowBulletLengthWarning,
} from '../app/resume/ResumeEditor';

test('countWords ignores extra whitespace', () => {
  assert.equal(countWords('  one   two three  '), 3);
  assert.equal(countWords(''), 0);
});

test('long highlights show helper text when warning is active', () => {
  const longBullet = new Array(29).fill('word').join(' ');
  const warningActive = shouldShowBulletLengthWarning('Experience bullets must be 28 words or fewer.');
  const state = getHighlightLengthState(longBullet, warningActive);
  assert.equal(state.words, 29);
  assert.equal(state.showError, true);
  assert.equal(state.helperText, 'Too long: 29 words (max 28).');
});

test('short highlights remain quiet even if warning is active', () => {
  const warningActive = shouldShowBulletLengthWarning('Experience bullets must be 28 words or fewer.');
  const state = getHighlightLengthState('Deliver results fast', warningActive);
  assert.equal(state.showError, false);
  assert.equal(state.helperText, '');
});

test('focusHighlightById scrolls the first invalid bullet', () => {
  const calls: ScrollIntoViewOptions[] = [];
  const fakeElement = {
    scrollIntoView(options?: ScrollIntoViewOptions) {
      calls.push(options ?? {});
    },
  } as HTMLElement;
  const originalDocument = globalThis.document;
  globalThis.document = {
    querySelector: (selector: string) =>
      selector === '[data-highlight-id="experience-highlight-0-1"]' ? (fakeElement as unknown as Element) : null,
  } as unknown as Document;
  try {
    assert.equal(focusHighlightById('experience-highlight-0-1'), true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.behavior, 'smooth');
  } finally {
    if (originalDocument) {
      globalThis.document = originalDocument;
    } else {
      // @ts-expect-error
      delete (globalThis as any).document;
    }
  }
});

test('findFirstTooLongHighlight prefers the earliest long bullet', () => {
  const experience = [
    { highlights: ['ok bullet', 'word '.repeat(25).trim()] },
    { highlights: ['word '.repeat(29).trim()] },
  ];
  const result = findFirstTooLongHighlight(experience as any);
  assert.deepEqual(result, { expIndex: 1, highlightIndex: 0 });
});
