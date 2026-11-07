export type ChatMessage = {
  id: string;
  body: string;
  sender_id: string;
  created_at: string;
};

export type ChatRow =
  | { type: 'day'; key: string; label: string }
  | { type: 'message'; key: string; message: ChatMessage; mine: boolean; time: string };

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const pad = (n: number) => String(n).padStart(2, '0');

const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** "Hoy", "Ayer", "1 nov", or "31 dic 2025" for other years, in local time. */
export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(date) === dayKey(now)) return 'Hoy';
  if (dayKey(date) === dayKey(yesterday)) return 'Ayer';
  const label = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? label : `${label} ${date.getFullYear()}`;
}

/**
 * Turns messages (oldest first) into chat rows with a day separator before
 * each new day, flagging which messages belong to the current user.
 */
export function buildChatRows(messages: ChatMessage[], myId: string, now = new Date()): ChatRow[] {
  const rows: ChatRow[] = [];
  let currentDay: string | null = null;

  for (const message of messages) {
    const date = new Date(message.created_at);
    const day = dayKey(date);
    if (day !== currentDay) {
      currentDay = day;
      rows.push({ type: 'day', key: `day-${day}`, label: dayLabel(message.created_at, now) });
    }
    rows.push({
      type: 'message',
      key: message.id,
      message,
      mine: message.sender_id === myId,
      time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    });
  }
  return rows;
}
