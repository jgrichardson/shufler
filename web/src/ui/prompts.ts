/** Canned prompts for the palette and the dispatch box. `{pr}` is filled with the selected PR, else "this". */
export interface Prompt {
  group: string;
  label: string;
  text: string;
}

export const PROMPTS: Prompt[] = [
  { group: 'Status', label: 'Status', text: 'What is the status of {pr}? Tell me what is left before it can merge and what you need from me.' },
  { group: 'Status', label: 'Plain speak', text: 'Explain in plain words where we are and what you need from me to unblock.' },
  { group: 'Drive to ready', label: 'Drive to ready', text: 'Get {pr} ready to merge: resolve conflicts, address the review comments, push, and watch CI until it is green. Tell me when I can merge.' },
  { group: 'Drive to ready', label: 'Keep going', text: 'Keep going until it is ready. Watch every PR in this session and stay on top of review, CI and conflicts.' },
  { group: 'Fix conflicts', label: 'Fix conflicts', text: 'Fix the conflicts in {pr} and tell me when I can merge.' },
  { group: 'Review findings', label: 'Review fix', text: 'Review asked for changes on {pr}. Fix them, push, and tell me when to request another review.' },
  { group: 'Review findings', label: 'Watch the review', text: 'I asked for a review of {pr}. Watch it and fix any requested changes until it is approved with green CI.' },
  { group: 'Tests', label: 'Run the tests', text: 'Run the tests that cover {pr}, fix what fails, and tell me what you changed.' },
  { group: 'Tests', label: 'Add tests', text: 'Add tests for the behaviour {pr} changes, including the edge cases, and make sure they pass.' },
  { group: 'Post-merge close-out', label: 'Close-out message', text: '{pr} is merged. Write a short message for the person who reported it saying what changed.' },
  { group: 'Plan', label: 'Plan first', text: 'Before writing code, write a short plan for {pr}: the files you will touch, the approach, and the risks. Wait for my go-ahead.' },
  { group: 'Walk me through', label: 'Step by step', text: 'Walk me through the steps one block at a time. Wait for my output before the next block.' },
  { group: 'Browser check', label: 'Browser check', text: 'Check {pr} in the browser, save screenshots, and tell me what does not work.' },
  { group: 'Draft to person', label: 'Draft to person', text: 'Write a short message I can send to {person} about {topic}. No opening line, no sign-off.' },
  { group: 'Read link', label: 'Read link', text: 'Read this and tell me what to do: {url}' },
  { group: 'Wrap up', label: 'Wrap up', text: 'Summarise what changed in this session, what is still open, and the next step.' },
];

export const SUFFIX_PLAIN = ' Plain speak.';
export const SUFFIX_SHORT = ' Short, no opening line.';

export function fillPrompt(text: string, pr: number | null | undefined): string {
  return pr != null ? text.replaceAll('{pr}', `#${pr}`) : text.replaceAll('{pr}', 'this');
}
