// Pure rules for reactions (S4): what can be sent and which ones float on this phone.
// No React Native imports so node:test can run them.

/** The six quick reactions in the bar. */
export const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '🔥', '👏'] as const;

/** Limits enforced by the reactions table (char_length in Postgres). */
export const MAX_EMOJI_LENGTH = 16;
export const MAX_MESSAGE_LENGTH = 80;

export type Reaction = {
  id: string;
  created_by: string;
  emoji: string | null;
  message: string | null;
  created_at: string;
};

export type ReactionInput = { emoji?: string | null; message?: string | null };

export type ValidReaction = { emoji: string; message: null } | { emoji: null; message: string };

export type ReactionValidation = { ok: true; value: ValidReaction } | { ok: false; error: string };

/** Characters as Postgres counts them (code points), not UTF-16 units. */
export const charLength = (text: string) => [...text].length;

/** Exactly one of emoji or message; the message is trimmed and at most 80 characters. */
export function validateReaction(input: ReactionInput): ReactionValidation {
  const emoji = input.emoji?.trim() ?? '';
  const message = input.message?.trim() ?? '';

  if (emoji && message) return { ok: false, error: 'Mandá un emoji o un mensaje, no los dos.' };
  if (emoji) {
    if (charLength(emoji) > MAX_EMOJI_LENGTH) return { ok: false, error: 'Elegí un emoji.' };
    return { ok: true, value: { emoji, message: null } };
  }
  if (message) {
    if (charLength(message) > MAX_MESSAGE_LENGTH) {
      return { ok: false, error: `El mensaje puede tener hasta ${MAX_MESSAGE_LENGTH} caracteres.` };
    }
    return { ok: true, value: { emoji: null, message } };
  }
  return { ok: false, error: 'Elegí un emoji o escribí un mensaje.' };
}

/** Only the other member's reactions float here; never my own, and nothing while signed out. */
export function isFromOtherMember(reaction: Pick<Reaction, 'created_by'>, myId: string | undefined): boolean {
  return !!myId && reaction.created_by !== myId;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** Reads a realtime INSERT row; anything malformed resolves to null. */
export function parseReactionRow(row: unknown): Reaction | null {
  if (!isRecord(row)) return null;
  const { id, created_by, emoji, message, created_at } = row;
  if (!isText(id) || !isText(created_by) || !isText(created_at)) return null;
  const hasEmoji = isText(emoji);
  const hasMessage = isText(message);
  if (hasEmoji === hasMessage) return null;
  return {
    id,
    created_by,
    emoji: hasEmoji ? emoji : null,
    message: hasMessage ? message : null,
    created_at,
  };
}

/** What the overlay (and the push body) shows. */
export function reactionText(reaction: Pick<Reaction, 'emoji' | 'message'>): string {
  return reaction.emoji ?? reaction.message ?? '';
}
