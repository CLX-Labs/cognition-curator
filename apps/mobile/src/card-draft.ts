import type { Card, CardInput } from '@recollect/contracts';
import type { GenerationWorkflow } from './generation';
import type { Repository } from './repository';

export async function saveCardDraft(
  repo: Pick<Repository, 'saveCard' | 'getState' | 'setState'>,
  input: CardInput,
  baseline: Card | undefined,
  answerDraftId: string,
) {
  const sourceKey = 'answer:' + input.deckId + ':' + answerDraftId;
  const destinationKey = 'answer:' + input.deckId + ':' + input.id;
  const answer = await repo.getState<GenerationWorkflow>(sourceKey);
  // A running request can still write to its original key. Keep it in place until
  // completed or explicitly archived by the learner through Set aside.
  if (answer && (!answer.job || ['queued', 'running'].includes(answer.job.status)))
    throw new Error('Wait for the answer, or set its request aside before saving.');
  await repo.saveCard(input, baseline);
  if (answer && sourceKey !== destinationKey) {
    // Clear the old draft only after both the card and its answer are durable.
    // A failed copy/clear leaves the same stable card ID available for retry.
    await repo.setState(destinationKey, answer);
    await repo.setState(sourceKey, null);
  }
}
