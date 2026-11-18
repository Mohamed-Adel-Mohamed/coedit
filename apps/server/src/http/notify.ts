import type { ServerControlMessage } from '@coedit/shared';
import type { AppDeps } from './context.js';

/**
 * Sends a control hint to every live peer of a document, regardless of which
 * instance hosts the room. Called after REST-side changes (comments, titles).
 */
export async function notifyDocument(
  deps: AppDeps,
  documentId: string,
  message: ServerControlMessage,
): Promise<void> {
  const room = deps.rooms.peek(documentId);
  if (room) {
    room.broadcastControl(message);
    return;
  }
  try {
    await deps.pubsub.publish(
      `coedit:room:${documentId}`,
      JSON.stringify({
        origin: deps.instanceId,
        kind: 'control',
        payload: JSON.stringify(message),
      }),
    );
  } catch (error) {
    deps.logger.warn({ err: error, documentId }, 'failed to broadcast control message');
  }
}
