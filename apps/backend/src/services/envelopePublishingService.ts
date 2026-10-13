import { AppError } from '../utils/errors';
import {
  attachEnvelopeMessage,
  createEnvelope,
  refundUnpublishedEnvelope,
  type CreateEnvelopeInput
} from './envelopeService';
import { publishEnvelopeMessage } from './telegramService';

/** Create, fund, and publish an envelope as one compensated workflow. */
export async function createAndPublishEnvelope(senderId: string, input: CreateEnvelopeInput) {
  const created = await createEnvelope(senderId, input);
  let messageId: number;
  try {
    messageId = await publishEnvelopeMessage(created.envelope);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Telegram publication failed';
    await refundUnpublishedEnvelope(created.envelope.id, input.actorId, reason);
    console.error('[envelope-publication]', { envelopeId: created.envelope.id, error });
    throw new AppError(
      502,
      'Telegram could not post in that group. The envelope amount was refunded. Check that the bot is still in the group and can send messages.',
      'ENVELOPE_PUBLICATION_FAILED'
    );
  }

  // Once Telegram has accepted the message, its button may be clicked immediately.
  // A metadata-write failure must not refund an envelope that members can already see.
  try {
    await attachEnvelopeMessage(created.envelope.id, messageId);
  } catch (error) {
    console.error('[envelope-message-id]', { envelopeId: created.envelope.id, messageId, error });
  }
  return { ...created, envelope: { ...created.envelope, messageId } };
}
