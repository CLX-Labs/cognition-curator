import {
  generationAcceptResponseSchema,
  generationJobSchema,
  type CardInput,
  type DeckInput,
  type GenerationCandidate,
  type GenerationJob,
  type GenerationRequest,
} from '@recollect/contracts';
import { api } from './api';
import { cardContent, type Repository } from './repository';

export type GenerationWorkflow = {
  newDeck?: DeckInput;
  sourceQuestion?: string;
  request: GenerationRequest;
  job: GenerationJob | null;
  drafts: Record<string, GenerationCandidate>;
  selectedIds: string[];
  acceptance: {
    operationId: string;
    candidateIds: string[];
    edits: Record<string, GenerationCandidate>;
  } | null;
  accepted: boolean;
};
export const GENERATION_KEY = 'generation';

export function answerRequestLabel(pending: boolean, busy: boolean, error: string | null) {
  if (busy || (pending && !error)) return 'Generating answer…';
  return pending ? 'Answer request paused' : 'Generate answer';
}

/** Save the destination before networking; retries reuse its persisted ID. */
export async function prepareGeneration(
  repo: Repository,
  state: GenerationWorkflow,
  sync: () => Promise<unknown>,
) {
  let local = await repo.snapshot();
  if (state.newDeck && !local.decks.some((deck) => deck.id === state.request.deckId)) {
    await repo.saveDeck(state.newDeck);
  }
  await sync();
  local = await repo.snapshot();
  const deck = local.decks.find((deck) => deck.id === state.request.deckId);
  if (
    !deck ||
    deck.version < 1 ||
    local.issues.some(
      (issue) =>
        issue.operation.type.startsWith('deck.') &&
        'id' in issue.operation.payload &&
        issue.operation.payload.id === state.request.deckId,
    )
  )
    throw new Error(
      'Connect and synchronize this deck before generating. Your request is saved for retry.',
    );
}

export function answerForQuestion(state: GenerationWorkflow | null, question: string) {
  if (state?.sourceQuestion !== question.trim() || state?.job?.status !== 'succeeded')
    return null;
  return state.job.candidates[0]?.back ?? null;
}

export async function fetchGeneration(
  repo: Repository,
  state: GenerationWorkflow,
  storageKey = GENERATION_KEY,
): Promise<GenerationWorkflow> {
  const job = generationJobSchema.parse(
    await api.request(state.job ? '/v1/generations/' + state.job.id : '/v1/generations', {
      ...(state.job ? {} : { method: 'POST', body: state.request }),
      ownerId: repo.ownerId,
    }),
  );
  const drafts = { ...state.drafts };
  for (const candidate of job.candidates)
    if (!drafts[candidate.id]) drafts[candidate.id] = candidate;
  const selectedIds = state.job?.candidates.length
    ? state.selectedIds
    : job.candidates.filter((c) => !job.acceptedCandidateIds.includes(c.id)).map((c) => c.id);
  const next = { ...state, job, drafts, selectedIds };
  await repo.setState(storageKey, next);
  return next;
}

export async function acceptGeneration(
  repo: Repository,
  state: GenerationWorkflow,
): Promise<GenerationWorkflow> {
  const saved = await repo.getState<GenerationWorkflow>(GENERATION_KEY);
  if (saved?.accepted && saved.request.operationId === state.request.operationId) return saved;
  if (!state.job || state.job.status !== 'succeeded')
    throw new Error('Wait for the draft cards to finish.');
  // Persist the exact receipt key and reviewed edits before starting a request.
  const acceptance = state.acceptance ?? {
    operationId: repo.newId(),
    candidateIds: state.selectedIds,
    edits: state.drafts,
  };
  if (!acceptance.candidateIds.length) throw new Error('Choose at least one card to keep.');
  const pending = { ...state, acceptance };
  await repo.setState(GENERATION_KEY, pending);
  const result = generationAcceptResponseSchema.parse(
    await api.request('/v1/generations/' + state.job.id + '/accept', {
      method: 'POST',
      body: { operationId: acceptance.operationId, candidateIds: acceptance.candidateIds },
      ownerId: repo.ownerId,
    }),
  );
  const edits: CardInput[] = [];
  for (const card of result.cards) {
    const edit = acceptance.edits[card.id];
    if (
      edit &&
      JSON.stringify({
        front: edit.front,
        back: edit.back,
        hint: edit.hint,
        explanation: edit.explanation,
        tags: edit.tags,
      }) !==
        JSON.stringify({
          front: card.front,
          back: card.back,
          hint: card.hint,
          explanation: card.explanation,
          tags: card.tags,
        })
    ) {
      edits.push({
        ...cardContent(card),
        front: edit.front.trim(),
        back: edit.back.trim(),
        hint: edit.hint,
        explanation: edit.explanation,
        tags: edit.tags,
      });
    }
  }
  const complete = {
    ...pending,
    accepted: true,
    job: {
      ...state.job,
      acceptedCandidateIds: [
        ...new Set([...state.job.acceptedCandidateIds, ...result.cards.map((c) => c.id)]),
      ],
    },
  };
  // One transaction prevents a crash from replaying an already queued edit.
  // Do not advance the pull cursor: earlier account changes may be missing.
  return repo.completeGeneration(
    result.cards,
    edits,
    GENERATION_KEY,
    acceptance.operationId,
    complete,
  );
}
