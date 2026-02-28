import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getActiveSectionFromObserverEntries,
  getSectionKeyFromNode,
  getSectionNavItemClass,
  SECTION_FOCUS_OVERRIDE_MS,
  shouldRespectEditingOverride,
} from '../app/resume/ResumeEditor';
import type { SectionType } from '../app/resume/ResumeEditor';

test('IntersectionObserver entries activate the Skills section', () => {
  const contactEl = {} as Element;
  const skillsEl = {} as Element;
  const sectionMeta = new Map<Element, { type: SectionType; order: number }>([
    [contactEl, { type: 'contact', order: 0 }],
    [skillsEl, { type: 'skills', order: 1 }],
  ]);
  const entries = [
    {
      target: skillsEl,
      intersectionRatio: 0.6,
      isIntersecting: true,
    } as IntersectionObserverEntry,
    {
      target: contactEl,
      intersectionRatio: 0.8,
      isIntersecting: false,
    } as IntersectionObserverEntry,
  ];
  const next = getActiveSectionFromObserverEntries(entries, sectionMeta);
  assert.equal(next, 'skills');
});

test('navigator item receives active class when Skills is the active section', () => {
  const className = getSectionNavItemClass('skills', 'skills', true);
  assert.ok(className.includes(' active'));
});

test('focus override keeps Education active until blur', () => {
  const sectionContainer = {
    getAttribute: (key: string) => (key === 'data-section-id' ? 'education' : null),
    id: 'resume-section-education',
    parentElement: null,
  } as unknown as HTMLElement;
  const childControl = {
    getAttribute: () => null,
    id: '',
    parentElement: sectionContainer,
  } as unknown as HTMLElement;

  const sectionKey = getSectionKeyFromNode(childControl);
  assert.equal(sectionKey, 'education');

  const now = Date.now();
  const isBlocked = shouldRespectEditingOverride('education', now, SECTION_FOCUS_OVERRIDE_MS, true, now);
  assert.equal(isBlocked, true);

  const afterBlur = shouldRespectEditingOverride('education', now, SECTION_FOCUS_OVERRIDE_MS, false, now);
  assert.equal(afterBlur, false);
});
