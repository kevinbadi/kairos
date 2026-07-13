/**
 * The interview is resumable: every answer lands on disk the moment it's
 * given. Kill the process mid-interview, re-run `npm start creatoros kairos`,
 * and it picks up exactly where it left off.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const INTERVIEW_STEPS = [
  'key',
  'brand',
  'profiles',
  'funnel',
  'autoReplies',
  'pathway',
  'finish',
] as const;

export type InterviewStep = (typeof INTERVIEW_STEPS)[number];

export interface BrandAnswers {
  about: string;
  selling: string;
  voiceAdjectives: string[];
  voiceNever: string;
  emojiPolicy: string;
  hashtagPolicy: string;
  exampleCaption: string;
  productLinks: string[];
  audience: string;
  competitors: string[];
}

export interface InterviewState {
  /** Steps already completed, in order. */
  completed: InterviewStep[];
  answers: {
    brand?: BrandAnswers;
    profiles?: Array<{ accountId: string; platform: string; username: string }>;
    funnel?: {
      enabled: boolean;
      keywords?: string[];
      dmMessage?: string;
      link?: string;
      accountIds?: string[];
      scope?: 'account-wide' | 'per-post';
    };
    autoReplies?: {
      comments: { enabled: boolean; platforms: string[]; tone: string; escalate: string[] };
      messages: { enabled: boolean; platforms: string[]; tone: string; escalate: string[] };
    };
    pathway?: { automationTarget: 'local' | 'railway'; timezone: string };
  };
}

export function emptyState(): InterviewState {
  return { completed: [], answers: {} };
}

export function isStepDone(state: InterviewState, step: InterviewStep): boolean {
  return state.completed.includes(step);
}

export function markStepDone(state: InterviewState, step: InterviewStep): InterviewState {
  if (!state.completed.includes(step)) state.completed.push(step);
  return state;
}

/** The first step that still needs doing, or null when the interview is done. */
export function nextStep(state: InterviewState): InterviewStep | null {
  return INTERVIEW_STEPS.find((step) => !isStepDone(state, step)) ?? null;
}

export function isInterviewComplete(state: InterviewState): boolean {
  return nextStep(state) === null;
}

export async function loadState(path: string): Promise<InterviewState> {
  if (!existsSync(path)) return emptyState();
  try {
    return JSON.parse(await readFile(path, 'utf8')) as InterviewState;
  } catch {
    return emptyState();
  }
}

export async function saveState(path: string, state: InterviewState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function clearState(path: string): Promise<void> {
  if (existsSync(path)) await rm(path);
}
