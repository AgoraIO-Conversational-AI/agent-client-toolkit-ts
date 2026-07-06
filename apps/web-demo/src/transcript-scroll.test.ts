import { describe, expect, it } from 'vitest';

import { getTranscriptScrollKey, scrollElementToBottom } from './transcript-scroll';

describe('transcript scroll helpers', () => {
  it('changes the scroll key when the latest streamed text changes', () => {
    const firstKey = getTranscriptScrollKey([
      { uid: 'agent', turn_id: 1, text: 'Hello' },
    ]);
    const nextKey = getTranscriptScrollKey([
      { uid: 'agent', turn_id: 1, text: 'Hello there' },
    ]);

    expect(nextKey).not.toBe(firstKey);
  });

  it('scrolls the transcript element to its latest content', () => {
    const element = { scrollTop: 0, scrollHeight: 480 };

    scrollElementToBottom(element);

    expect(element.scrollTop).toBe(480);
  });
});
