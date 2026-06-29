import type {
  AgentState,
  AgentTranscription,
  MessageError,
  MessageInterrupt,
  MessageMetrics,
  MessageSalStatusData,
  PresenceState,
  RTMMessageEvent,
  Turn,
  TurnFinishedMessage,
  TranscriptHelperItem,
  TranscriptionBase,
  UserTranscription,
} from '../core/types';
import { AgoraVoiceAIEvents } from '../core/events';
import {
  ChatMessageType,
  MessageType,
  ModuleType,
  TranscriptHelperMode,
  TurnStatus,
} from '../core/types';
import type { AgoraVoiceAIEventHandlers } from '../core/events';
import { ELoggerType, factoryFormatLog, logger } from '../utils/debug';
import { SubRenderPTS } from './sub-render-pts';
import { SubRenderQueue } from './sub-render-queue';

const TAG = 'CovSubRenderController';
const SELF_USER_ID = 0;

const DEFAULT_INTERVAL = 200; // milliseconds
const DEFAULT_CHUNK_INTERVAL = 100; // milliseconds, 10 char/s
const TURN_FINISHED_SEGMENT_KEYS = [
  'algorithm_processing',
  'asr_ttlw',
  'llm_ttft',
  'transport',
  'tts_ttfb',
] as const;

const formatLog = factoryFormatLog({ tag: TAG });

function parseBooleanState(value: unknown): boolean | null {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return null;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseTurnFinishedMessage(message: unknown): Turn | null {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const raw = message as TurnFinishedMessage & {
    turn_id?: number;
    agent_id?: string;
    start?: {
      start_at?: number;
    };
    metrics?: {
      e2e_latency_ms?: number;
      segmented_latency_ms?: Array<{
        name?: string;
        latency?: number;
      }>;
    };
  };
  const messageType = raw.event_type ?? raw.object;
  if (messageType !== MessageType.TURN_FINISHED) {
    return null;
  }

  const payload = raw.payload ?? raw;
  if (typeof payload.agent_id !== 'string' || typeof payload.turn_id !== 'number') {
    return null;
  }

  const segmentMap = new Map<string, number>();
  for (const segment of payload.metrics?.segmented_latency_ms ?? []) {
    if (segment?.name) {
      segmentMap.set(segment.name, numberOrZero(segment.latency));
    }
  }

  return {
    agentId: payload.agent_id,
    turnId: payload.turn_id,
    timestamp: numberOrZero(payload.start?.start_at),
    e2eLatencyMs: numberOrZero(payload.metrics?.e2e_latency_ms),
    segmentedLatency: {
      algorithmProcessingMs: segmentMap.get(TURN_FINISHED_SEGMENT_KEYS[0]) ?? 0,
      asrTtlwMs: segmentMap.get(TURN_FINISHED_SEGMENT_KEYS[1]) ?? 0,
      llmTtftMs: segmentMap.get(TURN_FINISHED_SEGMENT_KEYS[2]) ?? 0,
      transportMs: segmentMap.get(TURN_FINISHED_SEGMENT_KEYS[3]) ?? 0,
      ttsTtfbMs: segmentMap.get(TURN_FINISHED_SEGMENT_KEYS[4]) ?? 0,
    },
  };
}

/**
 * CovSubRenderController is a service that manages the transcript messages from RTM messages.
 *
 * Best practices:
 *
 * 1. Bind `onChatHistoryUpdated` and `onAgentStateChanged` callbacks to handle chat history updates and agent state changes when initializing the service.
 *
 * 2. Call `run` method to start the service. One common use case is to call it after the user joins a channel.
 *
 * 3. Call `setPts` method to update the current PTS (Presentation Time Stamp) when receiving new media data. This is crucial for synchronizing the transcripts with the media playback.
 *
 * 4. [Cleanup] Call `cleanup` method to reset the service state when leaving a channel or when the service is no longer needed. This will clear the chat history, queue, and other internal states.
 */
export class CovSubRenderController {
  private static NAME = TAG;
  private callMessagePrint: (type: ELoggerType, ...args: unknown[]) => void;
  public static self_uid = SELF_USER_ID;

  private _enableLog: boolean;
  private _mode: TranscriptHelperMode = TranscriptHelperMode.UNKNOWN;
  private _agentMessageState: {
    state: AgentState;
    turn_id: string | number;
    timestamp: number;
  } | null = null;
  private _transcriptChunk: {
    index: number;
    data: AgentTranscription;
    uid: string;
  } | null = null;

  private _queue: SubRenderQueue;
  private _pts: SubRenderPTS;

  public get chatHistory(): TranscriptHelperItem<
    Partial<UserTranscription | AgentTranscription>
  >[] {
    return this._queue.chatHistory;
  }

  public onChatHistoryUpdated:
    | AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.TRANSCRIPT_UPDATED]
    | null = null;
  public onAgentStateChanged:
    | AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_STATE_CHANGED]
    | null;
  public onAgentListeningChanged:
    | AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_LISTENING_CHANGED]
    | null = null;
  public onAgentThinkingChanged:
    | AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_THINKING_CHANGED]
    | null = null;
  public onAgentSpeakingChanged:
    | AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_SPEAKING_CHANGED]
    | null = null;
  public onAgentInterrupted:
    | AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_INTERRUPTED]
    | null = null;
  public onDebugLog: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.DEBUG_LOG] | null = null;
  public onAgentMetrics: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_METRICS] | null = null;
  public onAgentTurnFinished:
    | AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_TURN_FINISHED]
    | null = null;
  public onAgentError: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_ERROR] | null = null;
  public onMessageReceipt:
    | AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.MESSAGE_RECEIPT_UPDATED]
    | null = null;
  public onMessageError: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.MESSAGE_ERROR] | null = null;
  public onMessageSalStatus:
    | AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.MESSAGE_SAL_STATUS]
    | null = null;

  constructor(
    options: {
      messageCacheTimeout?: number;
      interval?: number;
      enableLog?: boolean;
      onChatHistoryUpdated?: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.TRANSCRIPT_UPDATED];
      onAgentStateChanged?: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_STATE_CHANGED];
      onAgentListeningChanged?: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_LISTENING_CHANGED];
      onAgentThinkingChanged?: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_THINKING_CHANGED];
      onAgentSpeakingChanged?: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_SPEAKING_CHANGED];
      onAgentInterrupted?: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_INTERRUPTED];
      onDebugLog?: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.DEBUG_LOG];
      onAgentMetrics?: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_METRICS];
      onAgentTurnFinished?: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_TURN_FINISHED];
      onAgentError?: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_ERROR];
      onMessageReceipt?: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.MESSAGE_RECEIPT_UPDATED];
      onMessageError?: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.MESSAGE_ERROR];
      onMessageSalStatus?: AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.MESSAGE_SAL_STATUS];
    } = {}
  ) {
    this._enableLog = options.enableLog ?? false;
    this.callMessagePrint = (type: ELoggerType = ELoggerType.debug, ...args: unknown[]) => {
      if (!this._enableLog) return;
      logger[type](formatLog(...args));
      this.onDebugLog?.(`[${type}] ${formatLog(...args)}`);
    };
    this.callMessagePrint(ELoggerType.debug, `${CovSubRenderController.NAME} initialized`);

    const interval = options.interval ?? DEFAULT_INTERVAL;

    this._queue = new SubRenderQueue(this.callMessagePrint, this._mutateChatHistory.bind(this));
    this._pts = new SubRenderPTS(
      interval,
      this.callMessagePrint,
      this._queue.processQueue.bind(this._queue)
    );

    this.onChatHistoryUpdated = options.onChatHistoryUpdated ?? null;
    this.onAgentStateChanged = options.onAgentStateChanged ?? null;
    this.onAgentListeningChanged = options.onAgentListeningChanged ?? null;
    this.onAgentThinkingChanged = options.onAgentThinkingChanged ?? null;
    this.onAgentSpeakingChanged = options.onAgentSpeakingChanged ?? null;
    this.onAgentInterrupted = options.onAgentInterrupted ?? null;
    this.onDebugLog = options.onDebugLog ?? null;
    this.onAgentMetrics = options.onAgentMetrics ?? null;
    this.onAgentTurnFinished = options.onAgentTurnFinished ?? null;
    this.onAgentError = options.onAgentError ?? null;
    this.onMessageReceipt = options.onMessageReceipt ?? null;
    this.onMessageError = options.onMessageError ?? null;
    this.onMessageSalStatus = options.onMessageSalStatus ?? null;
  }

  private _mutateChatHistory() {
    this.callMessagePrint(
      ELoggerType.debug,
      '>>> onChatHistoryUpdated',
      `pts: ${this._pts.pts}, chatHistory length: ${this._queue.chatHistory.length}`,
      this._queue.chatHistory
        .map((item) => `${item.uid}:${item.text}[status: ${item.status}]`)
        .join('\n')
    );
    this.onChatHistoryUpdated?.(this._queue.chatHistory);
  }

  protected handleTextMessage(uid: string, message: UserTranscription | AgentTranscription) {
    const turn_id = message.turn_id;
    const text = message.text || '';
    const stream_id = message.stream_id;
    const turn_status = TurnStatus.END;

    // Determine uid: user.transcription → self_uid, assistant.transcription → publisher uid
    const isUserTranscription =
      (message as unknown as TranscriptionBase).object === MessageType.USER_TRANSCRIPTION;
    const resolvedUid = isUserTranscription ? `${CovSubRenderController.self_uid}` : `${uid}`;

    const targetChatHistoryItem = this._queue.chatHistory.find(
      (item) => item.turn_id === turn_id && item.stream_id === stream_id && item.uid === resolvedUid
    );
    if (!targetChatHistoryItem) {
      this.callMessagePrint(ELoggerType.debug, `[Text Mode]`, `[${uid}]`, 'new item', message);
      this._queue.appendChatHistory({
        turn_id,
        uid: resolvedUid,
        stream_id,
        _time: new Date().getTime(),
        text,
        status: turn_status,
        metadata: message,
      });
    } else {
      targetChatHistoryItem.text = text;
      targetChatHistoryItem.status = turn_status;
      targetChatHistoryItem.metadata = message;
      targetChatHistoryItem._time = new Date().getTime();
      this.callMessagePrint(ELoggerType.debug, `[Text Mode]`, `[${uid}]`, targetChatHistoryItem);
    }
    this._mutateChatHistory();
  }

  private _handleTranscriptChunk() {
    if (!this._transcriptChunk) {
      this.callMessagePrint(
        ELoggerType.warn,
        `[${TranscriptHelperMode.CHUNK} Mode]`,
        '_handleTranscriptChunk',
        'missing _transcriptChunk'
      );
      return;
    }
    const currentIdx = this._transcriptChunk.index;
    const currentTranscript = this._transcriptChunk.data;
    const currentMaxLength = currentTranscript.text.length;
    const uid = this._transcriptChunk.uid;

    const nextIdx = currentIdx + 1 >= currentMaxLength ? currentMaxLength : currentIdx + 1;
    this._transcriptChunk.index = nextIdx;
    const validTranscriptString = currentTranscript.text.substring(0, nextIdx);
    const isValidTranscriptStringEnded =
      validTranscriptString.length > 0 &&
      currentTranscript.turn_status !== TurnStatus.IN_PROGRESS &&
      validTranscriptString.length === currentTranscript.text.length;

    const resolvedUid =
      (currentTranscript as TranscriptionBase).object === MessageType.USER_TRANSCRIPTION
        ? `${CovSubRenderController.self_uid}`
        : `${uid}`;
    const targetChatHistoryItem = this._queue.chatHistory.find(
      (item) =>
        item.turn_id === currentTranscript.turn_id &&
        item.stream_id === currentTranscript.stream_id &&
        item.uid === resolvedUid
    );
    if (!targetChatHistoryItem) {
      this.callMessagePrint(
        ELoggerType.debug,
        `[${TranscriptHelperMode.CHUNK} Mode]`,
        `[${uid}]`,
        'new transcriptChunk',
        this._transcriptChunk
      );
      this._queue.appendChatHistory({
        turn_id: currentTranscript.turn_id,
        uid: resolvedUid,
        stream_id: currentTranscript.stream_id,
        _time: Date.now(),
        text: validTranscriptString,
        status: currentTranscript.turn_status,
        metadata: currentTranscript,
      });
    } else {
      targetChatHistoryItem.text = validTranscriptString;
      targetChatHistoryItem.status = isValidTranscriptStringEnded
        ? currentTranscript.turn_status
        : targetChatHistoryItem.status;
      targetChatHistoryItem.metadata = currentTranscript;
      targetChatHistoryItem._time = Date.now();
      this.callMessagePrint(
        ELoggerType.debug,
        `[${TranscriptHelperMode.CHUNK} Mode]`,
        `[${uid}]`,
        'update transcriptChunk',
        targetChatHistoryItem
      );
    }
    this._mutateChatHistory();
  }

  protected handleChunkTextMessage(uid: string, message: AgentTranscription) {
    this.callMessagePrint(
      ELoggerType.debug,
      `[${TranscriptHelperMode.CHUNK} Mode]`,
      `[${uid}]`,
      'new item',
      message
    );
    // New turn detected — finalize the previous chunk's chatHistory entry
    if (this._transcriptChunk && this._transcriptChunk.data.turn_id < message.turn_id) {
      this._pts.teardownInterval();
      const lastChatHistory = this._queue.chatHistory.find(
        (item) => item.turn_id === this._transcriptChunk?.data.turn_id && item.uid === uid
      );
      if (lastChatHistory) {
        lastChatHistory.status = TurnStatus.END;
      }
      this._transcriptChunk = null;
    }
    this._transcriptChunk = {
      index: this._transcriptChunk?.index ?? 0,
      data: message,
      uid,
    };
    if (!this._pts.intervalRef) {
      this._pts.setIntervalRef(
        setInterval(this._handleTranscriptChunk.bind(this), DEFAULT_CHUNK_INTERVAL)
      );
    }
  }

  protected handleMessageInterrupt(uid: string, message: MessageInterrupt) {
    this.callMessagePrint(
      ELoggerType.debug,
      '<<< [onInterrupted]',
      `pts: ${this._pts.pts}, uid: ${uid}`,
      message
    );
    const turn_id = message.turn_id;
    // Workaround: if current PTS lags behind the interrupt's start_ms, use the
    // lower value so the interrupt is not silently discarded by the queue.
    const start_ms = Math.min(message.start_ms, this._pts.pts) || message.start_ms;
    this._queue.interruptQueue({
      turn_id,
      start_ms,
    });
    if (this._transcriptChunk) {
      this._pts.teardownInterval();
      const lastChatHistory = this._queue.chatHistory.find(
        (item) => item.turn_id === this._transcriptChunk?.data.turn_id && item.uid === uid
      );
      if (lastChatHistory) {
        lastChatHistory.status = TurnStatus.INTERRUPTED;
      }
      this._transcriptChunk = null;
    }
    this._mutateChatHistory();
    this.onAgentInterrupted?.(`${uid}`, {
      turnID: turn_id,
      timestamp: start_ms,
    });
  }

  protected handleMessageMetrics(uid: string, message: MessageMetrics) {
    const latency_ms = message.latency_ms;
    const messageModule = message.module;
    const metric_name = message.metric_name;

    if (!Object.values(ModuleType).includes(messageModule)) {
      this.callMessagePrint(ELoggerType.warn, 'Unknown metric module:', message);
      return;
    }

    this.onAgentMetrics?.(`${uid}`, {
      type: messageModule,
      name: metric_name,
      value: latency_ms,
      timestamp: message.send_ts,
    });
  }

  protected handleMessageSalStatus(uid: string, message: MessageSalStatusData) {
    this.callMessagePrint(ELoggerType.debug, 'handleMessageSalStatus', message);
    this.onMessageSalStatus?.(`${uid}`, message);
  }

  protected handleMessageError(uid: string, message: MessageError) {
    const errorCode = message.code || -1;
    const errorMessage = message.message;
    const messageModule = message.module;

    if (!Object.values(ModuleType).includes(messageModule)) {
      this.callMessagePrint(ELoggerType.warn, 'Unknown error module:', message);
      return;
    }

    if (messageModule === ModuleType.CONTEXT) {
      try {
        const messageData = JSON.parse(errorMessage);
        const errorPayload = {
          type: messageData?.module === 'picture' ? ChatMessageType.IMAGE : ChatMessageType.UNKNOWN,
          code: errorCode,
          message: errorMessage,
          timestamp: (message?.send_ts as number) || Date.now(),
        };
        this.onMessageError?.(`${uid}`, errorPayload);
      } catch (error: unknown) {
        this.callMessagePrint(
          ELoggerType.error,
          'Failed to parse context error message',
          error,
          message
        );
      }
      return;
    }

    this.onAgentError?.(`${uid}`, {
      type: messageModule,
      code: errorCode,
      message: errorMessage,
      timestamp: (message?.send_ts as number) || Date.now(),
    });
  }

  // current only used for image messages
  protected handleMessageInfo(uid: string, message: Record<string, unknown>) {
    try {
      const messageStr = (message?.message as string) || '';
      const messageObj = JSON.parse(messageStr);
      const moduleType = message?.module as ModuleType;
      const turnId = message?.turn_id as number;
      if (!messageStr || !messageObj || !moduleType || !turnId) {
        this.callMessagePrint(
          ELoggerType.error,
          'handleMessageInfo',
          'Invalid message object',
          message
        );
        return;
      }
      const messageType =
        message?.resource_type === 'picture' ? ChatMessageType.IMAGE : ChatMessageType.UNKNOWN;
      this.onMessageReceipt?.(uid, {
        moduleType,
        messageType,
        message: messageStr,
        turnId,
      });
    } catch (error: unknown) {
      this.callMessagePrint(
        ELoggerType.debug,
        'handleMessageInfo',
        'Failed to parse message string from image info message',
        error,
        message
      );
    }
  }

  public handleAgentStatus(metadata: PresenceState) {
    const message = metadata.stateChanged;
    const listening = parseBooleanState(message.listening);
    const thinking = parseBooleanState(message.thinking);
    const speaking = parseBooleanState(message.speaking);
    const hasActivityState = listening !== null || thinking !== null || speaking !== null;
    const currentMsgTs = metadata.timestamp;

    if (typeof message.state === 'undefined') {
      if (!hasActivityState) {
        return;
      }

      this.emitAgentActivity(metadata.publisher, listening, thinking, speaking);
      return;
    }

    const parsedTurnId = Number(message.turn_id);
    const currentTurnId = Number.isFinite(parsedTurnId) ? parsedTurnId : 0;
    const lastTurnId = Number(this._agentMessageState?.turn_id ?? 0);
    const lastTurnIdSafe = Number.isFinite(lastTurnId) ? lastTurnId : -1;
    let shouldNotifyStateChange = true;
    if (lastTurnIdSafe > currentTurnId) {
      this.callMessagePrint(
        ELoggerType.debug,
        'handleAgentStatus',
        'ignore older message(turn_id)'
      );
      shouldNotifyStateChange = false;
    }
    if (shouldNotifyStateChange) {
      this.callMessagePrint(
        ELoggerType.debug,
        '>>> handleAgentStatus',
        `pts: ${this._pts.pts}, uid: ${metadata.publisher}`,
        `prev-state: ${this._agentMessageState?.state}, prev-turn_id: ${this._agentMessageState?.turn_id}, prev-timestamp: ${this._agentMessageState?.timestamp}`,
        `current-state: ${metadata.stateChanged.state}, turn_id: ${metadata.stateChanged.turn_id}, timestamp: ${metadata.timestamp}`
      );
      // set current message state
      this._agentMessageState = {
        state: message.state,
        turn_id: currentTurnId,
        timestamp: currentMsgTs,
      };
      this.onAgentStateChanged?.(metadata.publisher, {
        state: message.state,
        turnID: currentTurnId,
        timestamp: currentMsgTs,
        reason: '',
      });
    }
    if (hasActivityState) {
      this.emitAgentActivity(metadata.publisher, listening, thinking, speaking);
    }
  }

  private emitAgentActivity(
    agentUserId: string,
    listening: boolean | null,
    thinking: boolean | null,
    speaking: boolean | null
  ) {
    if (listening !== null) {
      this.onAgentListeningChanged?.(agentUserId, listening);
    }
    if (thinking !== null) {
      this.onAgentThinkingChanged?.(agentUserId, thinking);
    }
    if (speaking !== null) {
      this.onAgentSpeakingChanged?.(agentUserId, speaking);
    }
  }

  protected handleWordAgentMessage(uid: string, message: AgentTranscription) {
    // drop message if turn_status is undefined
    if (typeof message.turn_status === 'undefined') {
      this.callMessagePrint(
        ELoggerType.debug,
        `[Word Mode]`,
        `[${uid}]`,
        'Drop message with undefined turn_status',
        message.turn_id
      );
      return;
    }

    const turn_id = message.turn_id;
    const text = message.text || '';
    const words = message.words || [];
    const stream_id = message.stream_id;
    const lastPoppedQueueItemTurnId = this._queue.lastPoppedQueueItem?.turn_id;
    // drop message if turn_id is less than last popped queue item
    // except for the first turn(greeting message, turn_id is 0)
    if (lastPoppedQueueItemTurnId && turn_id !== 0 && turn_id <= lastPoppedQueueItemTurnId) {
      this.callMessagePrint(
        ELoggerType.debug,
        `[Word Mode]`,
        `[${uid}]`,
        'Drop message with turn_id less than last popped queue item',
        `turn_id: ${turn_id}, last popped queue item turn_id: ${lastPoppedQueueItemTurnId}`
      );
      return;
    }
    this._queue.pushToQueue({
      uid:
        (message as TranscriptionBase).object === MessageType.USER_TRANSCRIPTION
          ? `${CovSubRenderController.self_uid}`
          : `${uid}`,
      turn_id,
      words,
      text,
      status: message.turn_status,
      stream_id,
    });
  }

  /**
   * Sets the transcript rendering mode. Can only be called once — subsequent
   * calls after mode is locked (not UNKNOWN or AUTO) are ignored with a warning.
   */
  public setMode(mode: TranscriptHelperMode) {
    // Allow setting from UNKNOWN (initial) or AUTO (transitioning to detected mode).
    // Any other existing mode is considered already locked.
    if (this._mode !== TranscriptHelperMode.UNKNOWN && this._mode !== TranscriptHelperMode.AUTO) {
      this.callMessagePrint(
        ELoggerType.warn,
        `setMode ignored: mode already locked to ${this._mode}, cannot change to ${mode}`
      );
      return;
    }
    if (mode === TranscriptHelperMode.UNKNOWN) {
      this.callMessagePrint(ELoggerType.warn, 'Unknown mode should not be set');
      return;
    }
    if (mode === TranscriptHelperMode.CHUNK) {
      // set interval to chunk interval
      this._pts.setInterval(DEFAULT_CHUNK_INTERVAL);
    } else if (mode !== TranscriptHelperMode.AUTO) {
      // set interval to default interval (not needed for AUTO — interval starts lazily)
      this._pts.setInterval(DEFAULT_INTERVAL);
    }
    this.callMessagePrint(ELoggerType.debug, `setMode`, mode);
    this._mode = mode;
  }

  public handleMessage<T extends TranscriptionBase>(
    message: T,
    options: {
      publisher: RTMMessageEvent['publisher'];
    }
  ) {
    const turnFinished = parseTurnFinishedMessage(message);
    if (turnFinished) {
      this.onAgentTurnFinished?.(options.publisher, turnFinished);
      return;
    }

    const messageObject = message?.object;
    if (!Object.values(MessageType).includes(messageObject)) {
      this.callMessagePrint(ELoggerType.info, `<<< [unknown message]`, options, message);
      return;
    }

    const isAgentMessage = message.object === MessageType.AGENT_TRANSCRIPTION;
    const isUserMessage = message.object === MessageType.USER_TRANSCRIPTION;
    const isMessageInterrupt = message.object === MessageType.MSG_INTERRUPTED;
    const isMessageMetrics = message.object === MessageType.MSG_METRICS;
    const isMessageError = message.object === MessageType.MSG_ERROR;
    // const isMessageState = message.object === MessageType.MSG_STATE
    const isMessageInfo = message.object === MessageType.MESSAGE_INFO;
    const isMessageSalStatus = message.object === MessageType.MESSAGE_SAL_STATUS;

    // set mode (only once) — handles UNKNOWN (not explicitly set) and AUTO (consumer-requested detection)
    if (
      isAgentMessage &&
      (this._mode === TranscriptHelperMode.UNKNOWN || this._mode === TranscriptHelperMode.AUTO)
    ) {
      // detect from first agent message: empty/absent words → TEXT, populated words → WORD
      if (!message.words || (Array.isArray(message.words) && message.words.length === 0)) {
        this.setMode(TranscriptHelperMode.TEXT);
      } else {
        this._pts.setupIntervalForWords({ isForce: true });
        this.setMode(TranscriptHelperMode.WORD);
      }
    }

    if (isAgentMessage && this._mode === TranscriptHelperMode.WORD) {
      this._pts.setupIntervalForWords({ isForce: false });
      this.handleWordAgentMessage(options.publisher, message as unknown as AgentTranscription);
      return;
    }
    if (isAgentMessage && this._mode === TranscriptHelperMode.TEXT) {
      this.handleTextMessage(options.publisher, message as unknown as AgentTranscription);
      return;
    }
    if (isAgentMessage && this._mode === TranscriptHelperMode.CHUNK) {
      this.handleChunkTextMessage(options.publisher, message as unknown as AgentTranscription);
      return;
    }
    if (isUserMessage) {
      this.handleTextMessage(options.publisher, message as unknown as UserTranscription);
      return;
    }
    if (isMessageInterrupt) {
      this.handleMessageInterrupt(options.publisher, message as unknown as MessageInterrupt);
      return;
    }
    if (isMessageInfo) {
      this.handleMessageInfo(options.publisher, message as unknown as Record<string, unknown>);
      return;
    }
    if (isMessageMetrics) {
      this.handleMessageMetrics(options.publisher, message as unknown as MessageMetrics);
      return;
    }
    if (isMessageError) {
      this.handleMessageError(options.publisher, message as unknown as MessageError);
      return;
    }

    if (isMessageSalStatus) {
      this.handleMessageSalStatus(options.publisher, message as unknown as MessageSalStatusData);
      return;
    }
  }

  public run() {
    this._pts.setRunning(true);
  }

  public setPts(pts: number) {
    this._pts.setPts(pts);
  }

  public cleanup() {
    this.callMessagePrint(ELoggerType.debug, 'cleanup');
    this._pts.reset();
    // cleanup queue
    this._queue.reset();
    // cleanup mode
    this._mode = TranscriptHelperMode.UNKNOWN;
    this._agentMessageState = null;
    this._transcriptChunk = null;
  }
}
