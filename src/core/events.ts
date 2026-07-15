/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-function-type */
import type {
  AgentManualEosEvent,
  AgentMetric,
  AgentTranscription,
  ChatMessageType,
  MessageReceipt,
  MessageSalStatusData,
  ModuleError,
  StateChangeEvent,
  TranscriptHelperItem,
  Turn,
  UserManualEosEvent,
  UserManualSosEvent,
  UserTranscription,
} from './types';

/**
 * Event types for the Agora Voice AI
 *
 * @since 0.1.0
 */
export enum AgoraVoiceAIEvents {
  /**
   * @deprecated This aggregate event remains supported. Use the independent
   * activity events when multiple flags are needed.
   */
  AGENT_STATE_CHANGED = 'agent-state-changed',
  AGENT_LISTENING_CHANGED = 'agent-listening-changed',
  AGENT_THINKING_CHANGED = 'agent-thinking-changed',
  AGENT_SPEAKING_CHANGED = 'agent-speaking-changed',
  AGENT_INTERRUPTED = 'agent-interrupted',
  AGENT_METRICS = 'agent-metrics',
  AGENT_TURN_FINISHED = 'agent-turn-finished',
  AGENT_ERROR = 'agent-error',
  TRANSCRIPT_UPDATED = 'transcript-updated',
  DEBUG_LOG = 'debug-log',
  MESSAGE_RECEIPT_UPDATED = 'message-receipt-updated',
  MESSAGE_ERROR = 'message-error',
  MESSAGE_SAL_STATUS = 'message-sal-status',
  USER_MANUAL_SOS = 'user-manual-sos',
  USER_MANUAL_EOS = 'user-manual-eos',
  AGENT_MANUAL_EOS = 'agent-manual-eos',
}

/**
 * Event handlers interface for the Agora Voice AI module.
 *
 * @since 0.1.0
 */
export interface AgoraVoiceAIEventHandlers {
  /**
   * Fired when the agent state changes via RTM presence event.
   * @deprecated This aggregate event remains supported. Use the independent
   * activity events when multiple flags are needed.
   * @remarks Only available when `rtmConfig` is provided to `init()`.
   */
  [AgoraVoiceAIEvents.AGENT_STATE_CHANGED]: (agentUserId: string, event: StateChangeEvent) => void;
  /**
   * Fired when the agent listening flag changes via RTM presence event.
   * @remarks Only available when `rtmConfig` is provided to `init()`.
   */
  [AgoraVoiceAIEvents.AGENT_LISTENING_CHANGED]: (agentUserId: string, isListening: boolean) => void;
  /**
   * Fired when the agent thinking flag changes via RTM presence event.
   * @remarks Only available when `rtmConfig` is provided to `init()`.
   */
  [AgoraVoiceAIEvents.AGENT_THINKING_CHANGED]: (agentUserId: string, isThinking: boolean) => void;
  /**
   * Fired when the agent speaking flag changes via RTM presence event.
   * @remarks Only available when `rtmConfig` is provided to `init()`.
   */
  [AgoraVoiceAIEvents.AGENT_SPEAKING_CHANGED]: (agentUserId: string, isSpeaking: boolean) => void;
  [AgoraVoiceAIEvents.AGENT_INTERRUPTED]: (
    agentUserId: string,
    event: {
      turnID: number;
      timestamp: number;
    }
  ) => void;
  [AgoraVoiceAIEvents.AGENT_METRICS]: (agentUserId: string, metrics: AgentMetric) => void;
  /**
   * Fired when the agent reports completed-turn latency metrics.
   * @remarks Only available when `rtmConfig` is provided to `init()`.
   */
  [AgoraVoiceAIEvents.AGENT_TURN_FINISHED]: (agentUserId: string, turn: Turn) => void;
  [AgoraVoiceAIEvents.AGENT_ERROR]: (agentUserId: string, error: ModuleError) => void;
  [AgoraVoiceAIEvents.TRANSCRIPT_UPDATED]: (
    transcription: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[]
  ) => void;
  [AgoraVoiceAIEvents.DEBUG_LOG]: (message: string) => void;
  /**
   * Fired when a message receipt is updated via RTM.
   * @remarks Only available when `rtmConfig` is provided to `init()`.
   */
  [AgoraVoiceAIEvents.MESSAGE_RECEIPT_UPDATED]: (
    agentUserId: string,
    messageReceipt: MessageReceipt
  ) => void;
  /**
   * Fired when a message error is received via RTM.
   * @remarks Only available when `rtmConfig` is provided to `init()`.
   */
  [AgoraVoiceAIEvents.MESSAGE_ERROR]: (
    agentUserId: string,
    error: {
      type: ChatMessageType;
      code: number;
      message: string;
      timestamp: number;
    }
  ) => void;
  /**
   * Fired when a SAL status update is received via RTM.
   * @remarks Only available when `rtmConfig` is provided to `init()`.
   */
  [AgoraVoiceAIEvents.MESSAGE_SAL_STATUS]: (
    agentUserId: string,
    salStatus: MessageSalStatusData
  ) => void;
  /**
   * Fired when the server returns the result for a user-triggered manual SOS request.
   * @remarks Only available when `rtmConfig` is provided to `init()`.
   */
  [AgoraVoiceAIEvents.USER_MANUAL_SOS]: (agentUserId: string, event: UserManualSosEvent) => void;
  /**
   * Fired when the server returns the result for a user-triggered manual EOS request.
   * @remarks Only available when `rtmConfig` is provided to `init()`.
   */
  [AgoraVoiceAIEvents.USER_MANUAL_EOS]: (agentUserId: string, event: UserManualEosEvent) => void;
  /**
   * Fired when the server reports an automatic EOS in manual mode.
   * @remarks Only available when `rtmConfig` is provided to `init()`.
   */
  [AgoraVoiceAIEvents.AGENT_MANUAL_EOS]: (agentUserId: string, event: AgentManualEosEvent) => void;
}

// --- EventHelper ---

/**
 * Log verbosity for EventHelper and all subclasses (AgoraVoiceAI, etc.).
 *
 * - `NONE`   — no console output (default, suitable for production)
 * - `ERRORS` — only handler exceptions logged via `console.error`
 * - `DEBUG`  — all event lifecycle calls (on/off/emit) logged via `console.debug`
 */
export enum EventLogLevel {
  NONE = 0,
  ERRORS = 1,
  DEBUG = 2,
}

type EventHandler<T extends any[]> = (...data: T) => void;

export class EventHelper<T extends Record<keyof T, (...args: any[]) => void>> {
  private _eventMap: Map<keyof T, EventHandler<any[]>[]> = new Map();
  private _onceWrappers: Map<Function, Function> = new Map();
  private _logLevel: EventLogLevel = EventLogLevel.NONE;
  private _maxListeners = 10;
  private _warnedEvents: Set<keyof T> = new Set();

  /**
   * Set the maximum number of listeners per event before a warning is logged.
   * Defaults to 10 (matches Node.js convention). Set to 0 to disable.
   */
  public setMaxListeners(n: number): this {
    this._maxListeners = n;
    return this;
  }

  /**
   * Set the log verbosity for this instance.
   * Defaults to `EventLogLevel.NONE` (silent).
   */
  setLogLevel(level: EventLogLevel): this {
    this._logLevel = level;
    return this;
  }

  /** Read-only access to the current log level for subclasses. */
  protected get logLevel(): EventLogLevel {
    return this._logLevel;
  }

  /** Returns the number of listeners registered for each event. */
  public getListenerCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [key, cbs] of this._eventMap) {
      counts[String(key)] = cbs.length;
    }
    return counts;
  }

  /**
   * Registers a one-time handler that is automatically removed after the first invocation.
   * The handler can also be removed before it fires via `off(evt, cb)`.
   */
  once<Key extends keyof T>(evt: Key, cb: T[Key]) {
    const wrapper = (...args: any[]) => {
      this.off(evt, wrapper as any);
      this._onceWrappers.delete(cb as Function);
      (cb as any)(...args);
    };
    this._onceWrappers.set(cb as Function, wrapper);
    this.on(evt, wrapper as any);
    return this;
  }

  on<Key extends keyof T>(evt: Key, cb: T[Key]) {
    const cbs = this._eventMap.get(evt) ?? [];
    cbs.push(cb as any);
    this._eventMap.set(evt, cbs);

    if (this._maxListeners > 0 && cbs.length > this._maxListeners && !this._warnedEvents.has(evt)) {
      this._warnedEvents.add(evt);
      console.warn(
        `[ConversationalAI] Possible listener leak: ${String(evt)} has ${cbs.length} listeners ` +
          `(max: ${this._maxListeners}). Use setMaxListeners() to increase if intentional.`
      );
    }

    if (this._logLevel >= EventLogLevel.DEBUG) {
      console.debug(`Subscribed to event: ${String(evt)}`);
    }
    return this;
  }

  off<Key extends keyof T>(evt: Key, cb: T[Key]) {
    const cbs = this._eventMap.get(evt);
    if (cbs) {
      const actual = this._onceWrappers.get(cb as Function) ?? cb;
      this._eventMap.set(
        evt,
        cbs.filter((it) => it !== actual)
      );
      this._onceWrappers.delete(cb as Function);
      if (this._logLevel >= EventLogLevel.DEBUG) {
        console.debug(`Unsubscribed from event: ${String(evt)}`);
      }
    }
    return this;
  }

  removeAllEventListeners(): void {
    this._eventMap.clear();
    this._onceWrappers.clear();
    if (this._logLevel >= EventLogLevel.DEBUG) {
      console.debug('Removed all event listeners');
    }
  }

  emit<Key extends keyof T>(evt: Key, ...args: Parameters<T[Key]>) {
    const cbs = this._eventMap.get(evt) ?? [];
    for (const cb of cbs) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        cb && cb(...args);
      } catch (e) {
        if (this._logLevel >= EventLogLevel.ERRORS) {
          const error = e as Error;
          const details = error.stack || error.message;
          console.error(`Error handling event ${String(evt)}: ${details}`);
        }
      }
    }
    if (this._logLevel >= EventLogLevel.DEBUG) {
      console.debug({ args }, `Emitted event: ${String(evt)}`);
    }
    return this;
  }
}
