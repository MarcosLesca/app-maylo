import type { ReceiverReport } from '../receiver/receiver-state';

/**
 * What the TV browser receiver is showing, whoever cast it (S8): the cast browser
 * shows a bar for it and opens the remote bound to the receiver. Pure, tested in Node.
 */
export type NowPlaying = { address: string; title: string; from: string };

const ACTIVE: readonly string[] = ['loading', 'playing', 'paused'];

/** The member's name from a "MayLo de <name>" label, else the label itself. */
function senderName(from: string): string {
  const text = from.trim();
  const match = /^MayLo de\s+(.+)$/i.exec(text);
  return match ? match[1].trim() : text;
}

/** Non-null while the connected TV loads, plays or pauses a video; null when idle, ended, failed or gone. */
export function nowPlaying(report: ReceiverReport | null): NowPlaying | null {
  const playback = report?.playback;
  if (!report?.connected || !playback || !ACTIVE.includes(playback.status)) return null;
  return { address: report.address, title: playback.title.trim(), from: senderName(playback.from) };
}

/** "Ahora en la tele: <título> · lo mandó <nombre>" (no sender part when unknown). */
export function nowPlayingText(playing: NowPlaying): string {
  const text = `Ahora en la tele: ${playing.title || 'un video'}`;
  return playing.from ? `${text} · lo mandó ${playing.from}` : text;
}

/** "Lo mandó <nombre>", or '' when unknown. */
export function sentByText(from: string): string {
  const name = senderName(from);
  return name ? `Lo mandó ${name}` : '';
}

/** The remote's line under the title: the video kind and who sent it, whichever are known. */
export function remoteSubtitle(kind: string, from: string): string {
  return [kind, sentByText(from)].filter(Boolean).join(' · ');
}
