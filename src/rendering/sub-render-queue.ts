import type {
  AgentTranscription,
  DataChunkMessageWord,
  QueueItem,
  TranscriptHelperItem,
  TranscriptHelperObjectWord,
  UserTranscription,
} from '../core/types';
import { TurnStatus } from '../core/types';
import { ELoggerType } from '../utils/debug';

type CallMessagePrint = (type: ELoggerType, ...args: unknown[]) => void;
type MutateChatHistoryFn = () => void;

const SELF_USER_ID = 0;

/**
 * SubRenderQueue manages the queue data structure, chatHistory, and all methods
 * that operate on transcript queue state — including text/word/chunk message handling.
 *
 * Extracted from CovSubRenderController to isolate queue processing logic.
 */
export class SubRenderQueue {
  public static self_uid = SELF_USER_ID;

  public queue: QueueItem[] = [];
  public lastPoppedQueueItem: QueueItem | null | undefined = null;
  public chatHistory: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[] = [];

  // Chunk mode state — owned here because it is pending queue content
  public transcriptChunk: {
    index: number;
    data: AgentTranscription;
    uid: string;
  } | null = null;

  private callMessagePrint: CallMessagePrint;
  private mutateChatHistory: MutateChatHistoryFn;

  constructor(callMessagePrint: CallMessagePrint, mutateChatHistory: MutateChatHistoryFn) {
    this.callMessagePrint = callMessagePrint;
    this.mutateChatHistory = mutateChatHistory;
  }

  // -----------------------------------------------------------------------
  // Queue processing (called from SubRenderPTS interval)
  // -----------------------------------------------------------------------

  public processQueue(curPTS: number) {
    const queueLength = this.queue.length;
    if (queueLength === 0) {
      return;
    }
    if (queueLength === 1) {
      const queueItem = this.queue[0];
      this._handleTurnObj(queueItem, curPTS);
      this.mutateChatHistory();
      return;
    }
    if (queueLength > 2) {
      this.callMessagePrint(
        ELoggerType.error,
        'Queue length is greater than 2, but it should not happen'
      );
    }
    if (queueLength > 1) {
      this.queue = this.queue.sort((a, b) => a.turn_id - b.turn_id);
      const nextItem = this.queue[this.queue.length - 1];
      const lastItem = this.queue[this.queue.length - 2];
      if (!nextItem.words.length) {
        // No words to compare PTS against — process lastItem only
        this._handleTurnObj(lastItem, curPTS);
        this.mutateChatHistory();
        return;
      }
      const firstWordOfNextItem = nextItem.words[0];
      if (firstWordOfNextItem.start_ms > curPTS) {
        this._handleTurnObj(lastItem, curPTS);
        this.mutateChatHistory();
        return;
      }
      // nextItem has started (start_ms <= curPTS) — mark lastItem as interrupted and drop it
      const lastItemCorrespondingChatHistoryItem = this.chatHistory.find(
        (item) => item.turn_id === lastItem.turn_id && item.stream_id === lastItem.stream_id
      );
      if (!lastItemCorrespondingChatHistoryItem) {
        this.callMessagePrint(
          ELoggerType.warn,
          'No corresponding chatHistory item found',
          lastItem
        );
        return;
      }
      lastItemCorrespondingChatHistoryItem.status = TurnStatus.INTERRUPTED;
      this.lastPoppedQueueItem = this.queue.shift();
      this._handleTurnObj(nextItem, curPTS);
      this.mutateChatHistory();
      return;
    }
  }

  public clearPendingItems() {
    this.queue = [];
    this.lastPoppedQueueItem = null;
  }

  private _handleTurnObj(queueItem: QueueItem, curPTS: number) {
    let correspondingChatHistoryItem = this.chatHistory.find(
      (item) => item.turn_id === queueItem.turn_id && item.stream_id === queueItem.stream_id
    );
    this.callMessagePrint(
      ELoggerType.debug,
      'handleTurnObj',
      queueItem,
      'correspondingChatHistoryItem',
      correspondingChatHistoryItem
    );
    if (!correspondingChatHistoryItem) {
      this.callMessagePrint(
        ELoggerType.debug,
        'handleTurnObj',
        'No corresponding chatHistory item found',
        'push to chatHistory'
      );
      correspondingChatHistoryItem = {
        turn_id: queueItem.turn_id,
        uid: queueItem.uid,
        stream_id: queueItem.stream_id,
        _time: new Date().getTime(),
        text: '',
        status: queueItem.status,
        metadata: queueItem,
      };
      this.appendChatHistory(correspondingChatHistoryItem);
    }
    correspondingChatHistoryItem._time = new Date().getTime();
    correspondingChatHistoryItem.metadata = queueItem;
    if (queueItem.status === TurnStatus.INTERRUPTED) {
      correspondingChatHistoryItem.status = TurnStatus.INTERRUPTED;
    }
    // Partition words by PTS: valid (renderable now) vs rest (future)
    const validWords: TranscriptHelperObjectWord[] = [];
    const restWords: TranscriptHelperObjectWord[] = [];
    for (const word of queueItem.words) {
      if (word.start_ms <= curPTS) {
        validWords.push(word);
      } else {
        restWords.push(word);
      }
    }
    const isRestWordsEmpty = restWords.length === 0;
    const isLastWordFinal =
      validWords.length > 0 &&
      validWords[validWords.length - 1].word_status !== TurnStatus.IN_PROGRESS;
    // All words rendered and final — turn is complete
    if (isRestWordsEmpty && isLastWordFinal) {
      correspondingChatHistoryItem.text = queueItem.text;
      correspondingChatHistoryItem.status = queueItem.status;
      this.lastPoppedQueueItem = this.queue.shift();
      return;
    }
    const validWordsText = validWords
      .filter((word) => word.start_ms <= curPTS)
      .map((word) => word.word)
      .join('');
    correspondingChatHistoryItem.text = validWordsText;
    const isLastWordInterrupted =
      validWords.length > 0 &&
      validWords[validWords.length - 1].word_status === TurnStatus.INTERRUPTED;
    if (isLastWordInterrupted) {
      this.lastPoppedQueueItem = this.queue.shift();
      return;
    }
    return;
  }

  /**
   * Appends an item to chatHistory.
   * @remarks Items with `turn_id === 0` (greeting messages) are prepended.
   */
  public appendChatHistory(
    item: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>
  ) {
    if (item.turn_id === 0) {
      this.chatHistory = [item, ...this.chatHistory];
    } else {
      this.chatHistory.push(item);
    }
  }

  /**
   * Marks a queued turn as interrupted by splitting its words at `start_ms`.
   * Words at or before the split point keep their text; the last rendered word
   * and all subsequent words are marked INTERRUPTED so the PTS loop stops emitting them.
   */
  public interruptQueue(options: { turn_id: number; start_ms: number }) {
    const turn_id = options.turn_id;
    const start_ms = options.start_ms;
    const correspondingQueueItem = this.queue.find((item) => item.turn_id === turn_id);
    this.callMessagePrint(
      ELoggerType.debug,
      'interruptQueue',
      `turn_id: ${turn_id}, start_ms: ${start_ms}, correspondingQueueItem: ${correspondingQueueItem}`
    );
    if (!correspondingQueueItem) {
      return;
    }
    correspondingQueueItem.status = TurnStatus.INTERRUPTED;
    const leftWords = correspondingQueueItem.words.filter((word) => word.start_ms <= start_ms);
    const rightWords = correspondingQueueItem.words.filter((word) => word.start_ms > start_ms);
    if (leftWords.length === 0) {
      correspondingQueueItem.words.forEach((word) => {
        word.word_status = TurnStatus.INTERRUPTED;
      });
    } else {
      leftWords[leftWords.length - 1].word_status = TurnStatus.INTERRUPTED;
      // Workaround: if current PTS lags behind the interrupt's start_ms, mark
      // the penultimate word too so the interrupt is not silently discarded.
      if (leftWords?.[leftWords.length - 2]) {
        leftWords[leftWords.length - 2].word_status = TurnStatus.INTERRUPTED;
      }
      rightWords.forEach((word) => {
        word.word_status = TurnStatus.INTERRUPTED;
      });
      correspondingQueueItem.words = [...leftWords, ...rightWords];
    }
  }

  public pushToQueue(data: {
    turn_id: number;
    words: TranscriptHelperObjectWord[];
    text: string;
    status: TurnStatus;
    stream_id: number;
    uid: string;
  }) {
    const targetQueueItem = this.queue.find((item) => item.turn_id === data.turn_id);
    const latestTurnId = this.queue.reduce((max, item) => {
      return Math.max(max, item.turn_id);
    }, 0);
    if (!targetQueueItem) {
      if (data.turn_id < latestTurnId) {
        this.callMessagePrint(
          ELoggerType.debug,
          `[Word Mode]`,
          `[${data.uid}]`,
          'Drop message with turn_id less than latestTurnId',
          `turn_id: ${data.turn_id}, latest turn_id: ${latestTurnId}`,
          data
        );
        return;
      }
      const newQueueItem = {
        turn_id: data.turn_id,
        text: data.text,
        words: this.sortWordsWithStatus(data.words, data.status),
        status: data.status,
        stream_id: data.stream_id,
        uid: data.uid,
      };
      this.callMessagePrint(
        ELoggerType.debug,
        `[Word Mode]`,
        `[${data.uid}]`,
        'push to queue',
        newQueueItem
      );
      this.queue.push(newQueueItem);
      return;
    }
    this.callMessagePrint(
      ELoggerType.debug,
      `[Word Mode]`,
      `[${data.uid}]`,
      'update queue item',
      targetQueueItem,
      data
    );
    targetQueueItem.text = data.text;
    targetQueueItem.words = this.sortWordsWithStatus(
      [...targetQueueItem.words, ...data.words],
      data.status
    );
    // if targetQueueItem.status is end, and data.status is in_progress, skip status update (unexpected case)
    if (
      targetQueueItem.status !== TurnStatus.IN_PROGRESS &&
      data.status === TurnStatus.IN_PROGRESS
    ) {
      return;
    }
    targetQueueItem.status = data.status;
  }

  /**
   * Sorts words by `start_ms`, deduplicates by `start_ms`, and stamps the
   * final word with `turn_status` when the turn is complete or interrupted.
   */
  public sortWordsWithStatus(words: DataChunkMessageWord[], turn_status: TurnStatus) {
    if (words.length === 0) {
      return words;
    }
    const sortedWords: TranscriptHelperObjectWord[] = words
      .map((word) => ({
        ...word,
        word_status: TurnStatus.IN_PROGRESS,
      }))
      .sort((a, b) => a.start_ms - b.start_ms)
      .reduce((acc, curr) => {
        // Only add if start_ms is unique
        if (!acc.find((word) => word.start_ms === curr.start_ms)) {
          acc.push(curr);
        }
        return acc;
      }, [] as TranscriptHelperObjectWord[]);
    const isMessageFinal = turn_status !== TurnStatus.IN_PROGRESS;
    if (isMessageFinal && sortedWords.length > 0) {
      sortedWords[sortedWords.length - 1].word_status = turn_status;
    }
    return sortedWords;
  }

  public reset() {
    this.queue = [];
    this.lastPoppedQueueItem = null;
    this.chatHistory = [];
    this.transcriptChunk = null;
  }
}
