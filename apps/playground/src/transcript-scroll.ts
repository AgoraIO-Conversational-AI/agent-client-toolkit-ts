export type TranscriptScrollItem = {
  uid: unknown;
  turn_id: unknown;
  text: unknown;
};

export function getTranscriptScrollKey(items: readonly TranscriptScrollItem[]): string {
  const lastItem = items[items.length - 1];
  if (!lastItem) return '0';

  return JSON.stringify([items.length, lastItem.uid, lastItem.turn_id, lastItem.text]);
}

export function scrollElementToBottom(element: { scrollTop: number; scrollHeight: number } | null) {
  if (!element) return;
  element.scrollTop = element.scrollHeight;
}
