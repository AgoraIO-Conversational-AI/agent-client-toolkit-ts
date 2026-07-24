import type { AgoraVoiceAIConfig, RTCEngine, RTMEngine, RTCStreamMessagePublisher } from './config';

import {
  type AgentState,
  ChatMessagePriority,
  ChatMessageType,
  MessageType,
  RTCEventType,
  RTMEventType,
  TranscriptHelperMode,
  type AgentTranscription,
  type ChatMessageImage,
  type ChatMessageText,
  type AgentManualEosEvent,
  type MessageSalStatusData,
  type TranscriptHelperItem,
  type UserManualEosEvent,
  type UserManualSosEvent,
  type UserTranscription,
  type AgentMetric,
  type MessageReceipt,
  type ModuleError,
  type StateChangeEvent,
  type TranscriptionBase,
  type ChatMessageBase,
  type Turn,
  type AgoraVoiceAIState,
  type PresenceState,
  type RTMMessageEvent,
  type RTMPresenceEvent,
  type RTMStatusEvent,
  NotInitializedError,
  RTMRequiredError,
  ConversationalAIError,
} from './types';
import {
  AgoraVoiceAIEvents,
  EventHelper,
  EventLogLevel,
  type AgoraVoiceAIEventHandlers,
} from './events';
import { factoryFormatLog, ELoggerType, logger, genTraceID } from '../utils/debug';
import {
  type IMetricsReporter,
  AgoraMetricsReporter,
  ConsoleMetricsReporter,
} from '../utils/metrics';
import { CovSubRenderController } from '../rendering/sub-render';
import { ChunkedMessageAssembler } from '../messaging/chunked';

const TAG = 'AgoraVoiceAI';
const VERSION = '2.9.1';

const formatLog = factoryFormatLog({ tag: TAG });
const USER_MANUAL_SOS_CUSTOM_TYPE = 'user.manual_sos';
const USER_MANUAL_EOS_CUSTOM_TYPE = 'user.manual_eos';

export type { AgoraVoiceAIConfig } from './config';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildManualTurnRequestId(kind: 'sos' | 'eos'): string {
  return `${kind}-req-${Date.now()}-${genTraceID()}`;
}

function parseUserManualPayload(payload: UnknownRecord): UserManualSosEvent['payload'] {
  return {
    success: payload.success === true,
    requestId: asString(payload.request_id),
    turnId:
      typeof payload.turn_id === 'number' && Number.isFinite(payload.turn_id)
        ? payload.turn_id
        : null,
    errorMessage: typeof payload.error_message === 'string' ? payload.error_message : null,
  };
}

/**
 * A class that manages conversational AI interactions through Agora's RTC and RTM services.
 *
 * Provides functionality to handle real-time communication between users and AI agents,
 * including message processing, state management, and event handling. It integrates with
 * Agora's RTC client for audio streaming and RTM client for messaging.
 *
 * Key features
 * - Singleton instance management
 * - RTC and RTM event handling
 * - Chat history and transcription management
 * - Agent state monitoring
 * - Debug logging
 * - Event subscription and management through EventHelper
 *
 * @remarks
 * - Must be initialized with {@link AgoraVoiceAIConfig} before use
 * - Only one instance can exist at a time
 * - Requires both RTC and RTM engines to be properly configured
 * - Events are emitted for state changes, transcriptions, and errors
 * - Extends EventHelper to provide event subscription capabilities
 *
 * @example
 * Basic initialization and usage:
 * ```typescript
 * const api = AgoraVoiceAI.init({
 *   rtcEngine: rtcClient,
 *   rtmEngine: rtmClient,
 *   renderMode: TranscriptHelperMode.REALTIME
 * });
 *
 * // Subscribe to a channel
 * api.subscribeMessage('channel-id');
 * ```
 *
 * @example
 * Event handling with EventHelper methods:
 * ```typescript
 * const agoraVoiceAI = AgoraVoiceAI.getInstance();
 *
 * // Subscribe to all events using on() method
 * agoraVoiceAI.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (agentUserId, event) => {
 *   console.log(`Agent ${agentUserId} state changed to:`, event.state);
 * });
 *
 * agoraVoiceAI.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (transcription) => {
 *   console.log('Transcription updated:', transcription);
 * });
 *
 * agoraVoiceAI.on(AgoraVoiceAIEvents.AGENT_INTERRUPTED, (agentUserId, event) => {
 *   console.log(`Agent ${agentUserId} interrupted:`, event);
 * });
 *
 * agoraVoiceAI.on(AgoraVoiceAIEvents.AGENT_METRICS, (agentUserId, metrics) => {
 *   console.log(`Agent ${agentUserId} metrics:`, metrics);
 * });
 *
 * agoraVoiceAI.on(AgoraVoiceAIEvents.AGENT_ERROR, (agentUserId, error) => {
 *   console.error(`Agent ${agentUserId} error:`, error.message);
 * });
 *
 * agoraVoiceAI.on(AgoraVoiceAIEvents.DEBUG_LOG, (message) => {
 *   console.debug('Debug log:', message);
 * });
 *
 * agoraVoiceAI.on(AgoraVoiceAIEvents.MESSAGE_RECEIPT_UPDATED, (agentUserId, messageReceipt) => {
 *  console.log(`Message receipt updated for agent ${agentUserId}:`, messageReceipt);
 * });
 *
 * agoraVoiceAI.on(AgoraVoiceAIEvents.MESSAGE_ERROR, (agentUserId, error) => {
 *  console.error(`Message error for agent ${agentUserId}:`, error);
 * });
 *
 * // Unsubscribe from events using off() method
 * agoraVoiceAI.off(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, handleAgentStateChanged);
 * agoraVoiceAI.off(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, handleTranscriptionUpdated);
 * agoraVoiceAI.off(AgoraVoiceAIEvents.AGENT_INTERRUPTED, handleAgentInterrupted);
 * agoraVoiceAI.off(AgoraVoiceAIEvents.AGENT_METRICS, handleAgentMetrics);
 * agoraVoiceAI.off(AgoraVoiceAIEvents.AGENT_ERROR, handleAgentError);
 * agoraVoiceAI.off(AgoraVoiceAIEvents.DEBUG_LOG, handleDebugLog);
 * agoraVoiceAI.off(AgoraVoiceAIEvents.MESSAGE_RECEIPT_UPDATED, handleMessageReceiptUpdated);
 * agoraVoiceAI.off(AgoraVoiceAIEvents.MESSAGE_ERROR, handleMessageError);
 * ```
 *
 * @fires {@link AgoraVoiceAIEvents.TRANSCRIPT_UPDATED} When chat history is updated
 * @fires {@link AgoraVoiceAIEvents.AGENT_STATE_CHANGED} When agent state changes
 * @fires {@link AgoraVoiceAIEvents.AGENT_INTERRUPTED} When agent is interrupted
 * @fires {@link AgoraVoiceAIEvents.AGENT_METRICS} When agent metrics are received
 * @fires {@link AgoraVoiceAIEvents.AGENT_ERROR} When an error occurs
 * @fires {@link AgoraVoiceAIEvents.DEBUG_LOG} When debug logs are generated
 * @fires {@link AgoraVoiceAIEvents.MESSAGE_RECEIPT_UPDATED} When message receipt is updated
 * @fires {@link AgoraVoiceAIEvents.MESSAGE_ERROR} When message error occurs
 * @fires {@link AgoraVoiceAIEvents.MESSAGE_SAL_STATUS} When a SAL status update is received
 *
 * @since 0.1.0
 */
export class AgoraVoiceAI extends EventHelper<AgoraVoiceAIEventHandlers> {
  private static NAME = TAG;
  private static VERSION = VERSION;
  private static _instance: AgoraVoiceAI | null = null;
  private static _initPromise: Promise<AgoraVoiceAI> | null = null;
  private callMessagePrint: (type: ELoggerType, ...args: unknown[]) => void;

  protected rtcEngine: RTCEngine | null = null;
  protected rtmEngine: RTMEngine | null = null;
  protected renderMode: TranscriptHelperMode = TranscriptHelperMode.UNKNOWN;
  protected enableRenderModeFallback: boolean = true;
  protected channel: string | null = null;
  protected covSubRenderController: CovSubRenderController;
  protected enableLog: boolean = false;
  private metricsReporter: IMetricsReporter = new ConsoleMetricsReporter();
  private chunkedAssembler = new ChunkedMessageAssembler();
  private _eventTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private _trackTranscriptHandler: ((...args: unknown[]) => void) | null = null;
  private _trackStateHandler: ((...args: unknown[]) => void) | null = null;

  // Pre-bound event handlers — stored so unbind uses the same reference as bind.
  private readonly _boundHandleRtcAudioPTS = this._handleRtcAudioPTS.bind(this);
  private readonly _boundHandleRtcStreamMessage = this._handleRtcStreamMessage.bind(this);
  private readonly _boundHandleRtmMessage = this._handleRtmMessage.bind(this);
  private readonly _boundHandleRtmPresence = this._handleRtmPresence.bind(this);
  private readonly _boundHandleRtmStatus = this._handleRtmStatus.bind(this);

  // ── Construction ───────────────────────────────────────────────────────────
  constructor() {
    super();

    this.callMessagePrint = (type: ELoggerType = ELoggerType.debug, ...args: unknown[]) => {
      if (!this.enableLog) {
        return;
      }
      logger[type](formatLog(...args));
      this.onDebugLog?.(`[${type}] ${formatLog(...args)}`);
    };
    this.callMessagePrint(
      ELoggerType.debug,
      `${AgoraVoiceAI.NAME} initialized, version: ${AgoraVoiceAI.VERSION}`
    );

    // Wraps each CovSubRenderController callback so an error in one cannot
    // bubble up and crash the RTC/RTM event handlers.
    const safe = <F extends (...args: never[]) => void>(fn: F, name: string): F =>
      ((...args: Parameters<F>) => {
        try {
          fn(...args);
        } catch (e) {
          this.callMessagePrint(ELoggerType.error, `Error in ${name} callback`, e);
        }
      }) as unknown as F;

    this.covSubRenderController = new CovSubRenderController({
      enableLog: this.enableLog,
      onChatHistoryUpdated: safe(this.onChatHistoryUpdated.bind(this), 'onChatHistoryUpdated'),
      onAgentStateChanged: safe(this.onAgentStateChanged.bind(this), 'onAgentStateChanged'),
      onAgentListeningChanged: safe(
        this.onAgentListeningChanged.bind(this),
        'onAgentListeningChanged'
      ),
      onAgentThinkingChanged: safe(
        this.onAgentThinkingChanged.bind(this),
        'onAgentThinkingChanged'
      ),
      onAgentSpeakingChanged: safe(
        this.onAgentSpeakingChanged.bind(this),
        'onAgentSpeakingChanged'
      ),
      onAgentInterrupted: safe(this.onAgentInterrupted.bind(this), 'onAgentInterrupted'),
      onDebugLog: safe(this.onDebugLog.bind(this), 'onDebugLog'),
      onAgentMetrics: safe(this.onAgentMetrics.bind(this), 'onAgentMetrics'),
      onAgentTurnFinished: safe(this.onAgentTurnFinished.bind(this), 'onAgentTurnFinished'),
      onAgentError: safe(this.onAgentError.bind(this), 'onAgentError'),
      onMessageReceipt: safe(this.onMessageReceiptUpdated.bind(this), 'onMessageReceipt'),
      onMessageError: safe(this.onMessageError.bind(this), 'onMessageError'),
      onMessageSalStatus: safe(this.onMessageSalStatus.bind(this), 'onMessageSalStatus'),
    });
  }

  // ── Public Static API ─────────────────────────────────────────────────────
  /**
   * Gets the singleton instance of AgoraVoiceAI.
   *
   * @returns The singleton instance of AgoraVoiceAI
   * @throws {@link NotInitializedError} When AgoraVoiceAI has not been initialized via {@link init}
   * @since 0.1.0
   */
  public static getInstance() {
    if (!AgoraVoiceAI._instance) {
      throw new NotInitializedError();
    }
    return AgoraVoiceAI._instance;
  }

  /**
   * Returns a snapshot of SDK state for debugging, or null if not initialized.
   * Does not throw — safe to call at any point.
   */
  public static getState(): AgoraVoiceAIState | null {
    return AgoraVoiceAI._instance?.getState() ?? null;
  }

  // ── Public Instance State API ─────────────────────────────────────────────
  /**
   * Returns a snapshot of the current SDK state for debugging.
   * The returned object is a plain copy — no references to internal state.
   */
  public getState(): AgoraVoiceAIState {
    return {
      initialized: !!this.rtcEngine,
      channel: this.channel,
      hasRtm: !!this.rtmEngine,
      renderMode: this.renderMode,
      listenerCounts: this.getListenerCounts(),
    };
  }

  public getCfg() {
    if (!this.rtcEngine) {
      throw new NotInitializedError();
    }
    return {
      rtcEngine: this.rtcEngine,
      renderMode: this.renderMode,
      channel: this.channel,
      enableLog: this.enableLog,
      rtmEngine: this.rtmEngine,
      enableRenderModeFallback: this.enableRenderModeFallback,
    };
  }

  /**
   * Requires RTM to be configured. Throws a descriptive error when called
   * without rtmEngine. Used internally by sendText, sendImage, and interrupt.
   */
  private requireRTM(method = 'requireRTM'): RTMEngine {
    if (!this.rtmEngine) {
      throw new RTMRequiredError(method);
    }
    return this.rtmEngine;
  }

  // ── Initialization Lifecycle ──────────────────────────────────────────────
  /**
   * Initializes the AgoraVoiceAI singleton instance.
   *
   * This method sets up the RTC and RTM engines, render mode, and logging options.
   * It must be called before any other methods of AgoraVoiceAI can be used.
   *
   * If an instance already exists, its event bindings and state are cleaned up
   * before reinitializing with the new configuration.
   *
   * @param cfg - Configuration object for initializing the API
   * @returns The initialized instance of AgoraVoiceAI
   * @since 0.1.0
   */
  public static async init(cfg: AgoraVoiceAIConfig): Promise<AgoraVoiceAI> {
    if (AgoraVoiceAI._initPromise) {
      // Another init() is in-flight — wait for it, then re-init with our config
      try {
        await AgoraVoiceAI._initPromise;
      } catch {
        /* swallow — we'll re-init */
      }
    }

    AgoraVoiceAI._initPromise = AgoraVoiceAI._doInit(cfg);
    try {
      return await AgoraVoiceAI._initPromise;
    } finally {
      AgoraVoiceAI._initPromise = null;
    }
  }

  private static _validateEngines(cfg: AgoraVoiceAIConfig): void {
    const isDev = typeof process === 'undefined' || process?.env?.NODE_ENV !== 'production';
    if (!isDev) {
      return;
    }

    const assertFunction = (owner: string, key: string, value: unknown): void => {
      if (typeof value !== 'function') {
        throw new ConversationalAIError(
          `[AgoraVoiceAI] Invalid ${owner}: expected \`${key}\` to be a function.`
        );
      }
    };

    const rtcEngine = cfg.rtcEngine as unknown as
      | { on?: unknown; off?: unknown }
      | null
      | undefined;
    assertFunction('rtcEngine', 'rtcEngine.on(eventName, listener)', rtcEngine?.on);
    assertFunction('rtcEngine', 'rtcEngine.off(eventName, listener)', rtcEngine?.off);

    const rtmEngine = cfg.rtmEngine as unknown as
      | {
          publish?: unknown;
          addEventListener?: unknown;
          removeEventListener?: unknown;
        }
      | null
      | undefined;
    if (rtmEngine) {
      assertFunction(
        'rtmEngine',
        'rtmEngine.publish(channelName, message, options?)',
        rtmEngine.publish
      );
      assertFunction(
        'rtmEngine',
        'rtmEngine.addEventListener(eventName, listener)',
        rtmEngine.addEventListener
      );
      assertFunction(
        'rtmEngine',
        'rtmEngine.removeEventListener(eventName, listener)',
        rtmEngine.removeEventListener
      );
    }
  }

  private static async _doInit(cfg: AgoraVoiceAIConfig): Promise<AgoraVoiceAI> {
    AgoraVoiceAI._validateEngines(cfg);

    // 1. Prepare reporter (may throw) — before any _instance mutation
    const reporter: IMetricsReporter = cfg.enableAgoraMetrics
      ? new AgoraMetricsReporter()
      : new ConsoleMetricsReporter();

    if (reporter instanceof AgoraMetricsReporter) {
      await reporter.init(); // If this throws, _instance is untouched
    }

    // 2. Only now mutate _instance
    if (AgoraVoiceAI._instance?.rtcEngine) {
      // Re-init: clean up old controller timers and event bindings
      AgoraVoiceAI._instance.covSubRenderController.cleanup();
      AgoraVoiceAI._instance.unsubscribe();
      AgoraVoiceAI._instance.removeAllEventListeners();
    } else if (!AgoraVoiceAI._instance) {
      AgoraVoiceAI._instance = new AgoraVoiceAI();
    }

    AgoraVoiceAI._instance.rtcEngine = cfg.rtcEngine;
    AgoraVoiceAI._instance.rtmEngine = cfg.rtmEngine ?? null;
    AgoraVoiceAI._instance.renderMode = cfg.renderMode ?? TranscriptHelperMode.UNKNOWN;
    AgoraVoiceAI._instance.enableRenderModeFallback = cfg.enableRenderModeFallback ?? true;
    AgoraVoiceAI._instance.enableLog = cfg.enableLog ?? false;
    AgoraVoiceAI._instance.setLogLevel(cfg.enableLog ? EventLogLevel.DEBUG : EventLogLevel.NONE);
    AgoraVoiceAI._instance.metricsReporter = reporter;

    return AgoraVoiceAI._instance;
  }

  // ── Public Subscription Lifecycle ─────────────────────────────────────────
  /**
   * Subscribes to a message channel for real-time updates.
   *
   * This method binds the necessary RTC and RTM events, sets the channel,
   * and starts the CovSubRenderController to handle incoming messages.
   *
   * @remarks
   * - Must call {@link init} before using this method
   * - Throws error if not initialized
   *
   * @param channel - The channel to subscribe to for messages
   * @since 0.1.0
   */
  public subscribeMessage(channel: string) {
    this.bindRtcEvents();
    if (this.rtmEngine) {
      this.bindRtmEvents();
    }

    this.channel = channel;
    this.covSubRenderController.setMode(this.renderMode, {
      enableRenderModeFallback: this.enableRenderModeFallback,
    });
    this.covSubRenderController.run();
    this._startEventTimeoutWarnings();
  }

  /**
   * Unsubscribes from the message channel and cleans up resources.
   * Safe to call even if {@link subscribeMessage} was not called — unbind
   * operations are guarded against null engines.
   *
   * @since 0.1.0
   */
  public unsubscribe() {
    this._clearEventTimeout();
    this.unbindRtcEvents();
    if (this.rtmEngine) {
      this.unbindRtmEvents();
    }

    this.channel = null;
    this.covSubRenderController.cleanup();
    this.chunkedAssembler.clear();
  }

  /**
   * Destroys the AgoraVoiceAI instance and cleans up resources.
   * Safe to call multiple times — no-op if not initialized or already destroyed.
   * Only removes the toolkit's own event listeners from the RTC/RTM engines;
   * consumer-registered listeners are preserved.
   *
   * @since 0.1.0
   */
  public destroy() {
    const instance = AgoraVoiceAI._instance; // Direct field access, no throw
    if (!instance) return; // Already destroyed or never initialized

    instance.callMessagePrint(ELoggerType.debug, `${AgoraVoiceAI.NAME} destroyed`);
    instance._clearEventTimeout();
    instance.covSubRenderController.cleanup();
    instance.chunkedAssembler.clear();
    instance.unbindRtcEvents();
    instance.rtcEngine = null;
    instance.unbindRtmEvents();
    instance.rtmEngine = null;
    instance.renderMode = TranscriptHelperMode.UNKNOWN;
    instance.enableRenderModeFallback = true;
    instance.channel = null;
    instance.removeAllEventListeners();
    AgoraVoiceAI._instance = null;
  }

  // ── Public Chat API ───────────────────────────────────────────────────────
  /**
   * Sends a chat message to the conversational AI agent.
   *
   * @param agentUserId - The unique identifier of the agent user
   * @param message - The chat message to send, can be either text or image type
   * @returns A promise that resolves with the result of sending the message
   * @throws {Error} When an unsupported chat message type is provided
   *
   * @since 0.1.0
   *
   * @example
   * ```typescript
   * // Send a text message
   * const textMessage: IChatMessageText = {
   *   messageType: ChatMessageType.TEXT,
   *   priority: ChatMessagePriority.HIGH,
   *   responseInterruptable: true,
   *   text: "Hello, how are you?"
   * };
   * await api.chat("user123", textMessage);
   *
   * // Send an image message
   * const imageMessage: IChatMessageImage = {
   *   messageType: ChatMessageType.IMAGE,
   *   uuid: "msg-456",
   *   url: "https://example.com/image.jpg"
   * };
   * await api.chat("user123", imageMessage);
   * ```
   */
  public async chat(agentUserId: string, message: ChatMessageText | ChatMessageImage) {
    switch (message.messageType) {
      case ChatMessageType.TEXT:
        return this.sendText(agentUserId, message as ChatMessageText);
      case ChatMessageType.IMAGE:
        return this.sendImage(agentUserId, message as ChatMessageImage);
      default:
        throw new ConversationalAIError(
          `Unsupported chat message type: ${(message as ChatMessageBase).messageType}. Supported types: TEXT, IMAGE.`
        );
    }
  }

  /**
   * Sends a text message to the specified agent user through RTM engine.
   *
   * @param agentUserId - The unique identifier of the agent user to send the message to
   * @param message - The chat message object containing text content and optional settings
   * @param message.priority - Optional priority level for the message (defaults to INTERRUPTED)
   * @param message.responseInterruptable - Optional flag indicating if the response can be interrupted (defaults to true)
   * @param message.text - The actual text content of the message
   *
   * @returns Promise that resolves when the message is successfully sent
   *
   * @throws {Error} Throws an error with message "failed to send chat message" if the RTM publish operation fails
   *
   * @since 0.1.0
   *
   * @example
   * ```typescript
   * await api.sendText('user123', {
   *   text: 'Hello, how can I help you?',
   *   priority: ChatMessagePriority.HIGH,
   *   responseInterruptable: false
   * });
   * ```
   */
  public async sendText(agentUserId: string, message: ChatMessageText) {
    const traceId = genTraceID();
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> [traceID:${traceId}] [chat] ${agentUserId}`,
      message
    );

    const rtmEngine = this.requireRTM('sendText');

    const payload = {
      priority: message.priority ?? ChatMessagePriority.INTERRUPTED,
      interruptable: message.responseInterruptable ?? true,
      message: message.text ?? '',
    };

    try {
      const payloadStr = JSON.stringify(payload);
      const options = {
        channelType: 'USER',
        customType: MessageType.USER_TRANSCRIPTION,
      };

      this.callMessagePrint(
        ELoggerType.debug,
        `msg: [traceID: ${traceId}] rtm publish`,
        payloadStr
      );

      const result = await rtmEngine.publish(agentUserId, payloadStr, options);

      this.callMessagePrint(
        ELoggerType.debug,
        `>>> [traceID:${traceId}] [chat]`,
        'successfully sent chat message',
        result
      );
    } catch (error: unknown) {
      this.callMessagePrint(
        ELoggerType.error,
        `>>> [traceID:${traceId}] [chat]`,
        'failed to send chat message',
        error
      );
      throw new ConversationalAIError(
        `Failed to send chat message: ${(error as Error).message ?? error}`,
        { cause: error }
      );
    }
  }

  /**
   * Sends an image message to a specific agent user through RTM (Real-Time Messaging).
   *
   * @param agentUserId - The unique identifier of the agent user to send the image to
   * @param message - The image message object containing UUID and either URL or base64 data
   * @param message.uuid - Unique identifier for the message
   * @param message.url - Optional URL of the image to send
   * @param message.base64 - Optional base64 encoded image data
   *
   * @throws {Error} Throws an error with message "failed to send chat message" if the RTM publish operation fails
   *
   * @returns Promise that resolves when the image message is successfully sent
   *
   * @since 0.1.0
   *
   * @example
   * ```typescript
   * await sendImage('user123', {
   *   uuid: 'msg-456',
   *   url: 'https://example.com/image.jpg'
   * });
   * ```
   */
  public async sendImage(agentUserId: string, message: ChatMessageImage) {
    const traceId = genTraceID();
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> [traceID:${traceId}] [chat] ${agentUserId}`,
      message
    );

    const rtmEngine = this.requireRTM('sendImage');

    const payload = {
      uuid: message.uuid,
      image_url: message?.url || '',
      image_base64: message?.base64 || '',
    };

    try {
      const payloadStr = JSON.stringify(payload);
      const options = {
        channelType: 'USER',
        customType: MessageType.IMAGE_UPLOAD,
      };

      this.callMessagePrint(
        ELoggerType.debug,
        `msg: [traceID: ${traceId}] rtm publish`,
        payloadStr
      );

      const result = await rtmEngine.publish(agentUserId, payloadStr, options);

      this.callMessagePrint(
        ELoggerType.debug,
        `>>> [traceID:${traceId}] [chat]`,
        'successfully sent image message',
        result
      );
    } catch (error: unknown) {
      this.callMessagePrint(
        ELoggerType.error,
        `>>> [traceID:${traceId}] [chat]`,
        'failed to send image message',
        error
      );
      throw new ConversationalAIError(
        `Failed to send image message: ${(error as Error).message ?? error}`,
        { cause: error }
      );
    }
  }

  /**
   * Sends an interrupt message to the specified agent user.
   *
   * This method publishes an interrupt message to the RTM channel of the specified agent user.
   * It is used to signal that the current interaction should be interrupted.
   *
   * @remarks
   * - Must call {@link init} before using this method
   * - Throws error if not initialized or if sending fails
   *
   * @param agentUserId - The user ID of the agent to interrupt
   * @since 0.1.0
   */
  public async interrupt(agentUserId: string) {
    const traceId = genTraceID();
    this.callMessagePrint(ELoggerType.debug, `>>> [traceID:${traceId}] [interrupt]`, agentUserId);

    const rtmEngine = this.requireRTM('interrupt');

    const options = {
      channelType: 'USER',
      customType: MessageType.MSG_INTERRUPTED,
    };
    const messageStr = JSON.stringify({
      customType: MessageType.MSG_INTERRUPTED,
    });

    try {
      const result = await rtmEngine.publish(agentUserId, messageStr, options);
      this.callMessagePrint(
        ELoggerType.debug,
        `>>> [traceID:${traceId}] [interrupt]`,
        'successfully sent interrupt message',
        result
      );
    } catch (error: unknown) {
      this.callMessagePrint(
        ELoggerType.error,
        `>>> [traceID:${traceId}] [interrupt]`,
        'failed to send interrupt message',
        error
      );
      throw new ConversationalAIError(
        `Failed to send interrupt: ${(error as Error).message ?? error}`,
        { cause: error }
      );
    }
  }

  /**
   * Triggers a user-side manual start-of-speech marker through RTM.
   *
   * The returned `requestId` correlates this publish with the later
   * `USER_MANUAL_SOS` server result event. A resolved promise only means RTM
   * publish succeeded; server-side validation is reported asynchronously.
   *
   * @param agentUserId - The user ID of the agent to send the marker to
   * @param requestId - Optional non-empty request ID. Generated when omitted.
   * @returns The request ID used in the RTM payload
   * @remarks Requires `rtmEngine` to be present in `init()`.
   */
  public async manualSOS(agentUserId: string, requestId?: string): Promise<string> {
    return this.publishManualTurn(
      agentUserId,
      USER_MANUAL_SOS_CUSTOM_TYPE,
      requestId ?? buildManualTurnRequestId('sos'),
      'manualSOS'
    );
  }

  /**
   * Triggers a user-side manual end-of-speech marker through RTM.
   *
   * The returned `requestId` correlates this publish with the later
   * `USER_MANUAL_EOS` server result event. A resolved promise only means RTM
   * publish succeeded; server-side validation is reported asynchronously.
   *
   * @param agentUserId - The user ID of the agent to send the marker to
   * @param requestId - Optional non-empty request ID. Generated when omitted.
   * @returns The request ID used in the RTM payload
   * @remarks Requires `rtmEngine` to be present in `init()`.
   */
  public async manualEOS(agentUserId: string, requestId?: string): Promise<string> {
    return this.publishManualTurn(
      agentUserId,
      USER_MANUAL_EOS_CUSTOM_TYPE,
      requestId ?? buildManualTurnRequestId('eos'),
      'manualEOS'
    );
  }

  private async publishManualTurn(
    agentUserId: string,
    customType: typeof USER_MANUAL_SOS_CUSTOM_TYPE | typeof USER_MANUAL_EOS_CUSTOM_TYPE,
    requestId: string,
    method: 'manualSOS' | 'manualEOS'
  ): Promise<string> {
    const traceId = requestId;
    this.callMessagePrint(ELoggerType.debug, `>>> [traceID:${traceId}] [${method}]`, agentUserId);

    if (typeof requestId !== 'string' || requestId.length === 0) {
      throw new ConversationalAIError(`[AgoraVoiceAI] ${method}() requires a non-empty requestId.`);
    }

    const rtmEngine = this.requireRTM(method);

    const payload = JSON.stringify({ request_id: requestId });
    const options = {
      channelType: 'USER',
      customType,
    };

    try {
      const result = await rtmEngine.publish(agentUserId, payload, options);
      this.callMessagePrint(
        ELoggerType.debug,
        `>>> [traceID:${traceId}] [${method}]`,
        'successfully sent manual turn message',
        result
      );
      return requestId;
    } catch (error: unknown) {
      this.callMessagePrint(
        ELoggerType.error,
        `>>> [traceID:${traceId}] [${method}]`,
        'failed to send manual turn message',
        error
      );
      throw new ConversationalAIError(
        `Failed to send ${method}: ${(error as Error).message ?? error}`,
        { cause: error }
      );
    }
  }

  // ── Internal Event Emitters (Render Controller -> Public API) ────────────
  private onChatHistoryUpdated(
    chatHistory: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[]
  ) {
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> ${AgoraVoiceAIEvents.TRANSCRIPT_UPDATED}`,
      chatHistory
    );
    this.emit(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, chatHistory);
  }
  private onAgentStateChanged(agentUserId: string, event: StateChangeEvent) {
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> ${AgoraVoiceAIEvents.AGENT_STATE_CHANGED}`,
      agentUserId,
      event
    );
    this.emit(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, agentUserId, event);
  }
  private onAgentListeningChanged(agentUserId: string, isListening: boolean) {
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> ${AgoraVoiceAIEvents.AGENT_LISTENING_CHANGED}`,
      agentUserId,
      isListening
    );
    this.emit(AgoraVoiceAIEvents.AGENT_LISTENING_CHANGED, agentUserId, isListening);
  }
  private onAgentThinkingChanged(agentUserId: string, isThinking: boolean) {
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> ${AgoraVoiceAIEvents.AGENT_THINKING_CHANGED}`,
      agentUserId,
      isThinking
    );
    this.emit(AgoraVoiceAIEvents.AGENT_THINKING_CHANGED, agentUserId, isThinking);
  }
  private onAgentSpeakingChanged(agentUserId: string, isSpeaking: boolean) {
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> ${AgoraVoiceAIEvents.AGENT_SPEAKING_CHANGED}`,
      agentUserId,
      isSpeaking
    );
    this.emit(AgoraVoiceAIEvents.AGENT_SPEAKING_CHANGED, agentUserId, isSpeaking);
  }
  private onAgentInterrupted(agentUserId: string, event: { turnID: number; timestamp: number }) {
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> ${AgoraVoiceAIEvents.AGENT_INTERRUPTED}`,
      agentUserId,
      event
    );
    this.emit(AgoraVoiceAIEvents.AGENT_INTERRUPTED, agentUserId, event);
  }
  private onDebugLog(message: string) {
    this.emit(AgoraVoiceAIEvents.DEBUG_LOG, message);
  }
  private onAgentMetrics(agentUserId: string, metrics: AgentMetric) {
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> ${AgoraVoiceAIEvents.AGENT_METRICS}`,
      agentUserId,
      metrics
    );
    this.emit(AgoraVoiceAIEvents.AGENT_METRICS, agentUserId, metrics);
  }
  private onAgentTurnFinished(agentUserId: string, turn: Turn) {
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> ${AgoraVoiceAIEvents.AGENT_TURN_FINISHED}`,
      agentUserId,
      turn
    );
    this.emit(AgoraVoiceAIEvents.AGENT_TURN_FINISHED, agentUserId, turn);
  }
  private onAgentError(agentUserId: string, error: ModuleError) {
    this.callMessagePrint(
      ELoggerType.error,
      `>>> ${AgoraVoiceAIEvents.AGENT_ERROR}`,
      agentUserId,
      error
    );
    this.emit(AgoraVoiceAIEvents.AGENT_ERROR, agentUserId, error);
  }
  private onMessageReceiptUpdated(agentUserId: string, messageReceipt: MessageReceipt) {
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> ${AgoraVoiceAIEvents.MESSAGE_RECEIPT_UPDATED}`,
      agentUserId,
      messageReceipt
    );
    this.emit(AgoraVoiceAIEvents.MESSAGE_RECEIPT_UPDATED, agentUserId, messageReceipt);
  }
  private onMessageError(
    agentUserId: string,
    error: {
      type: ChatMessageType;
      code: number;
      message: string;
      timestamp: number;
    }
  ) {
    this.callMessagePrint(
      ELoggerType.error,
      `>>> ${AgoraVoiceAIEvents.MESSAGE_ERROR}`,
      agentUserId,
      error
    );
    this.emit(AgoraVoiceAIEvents.MESSAGE_ERROR, agentUserId, error);
  }

  private onMessageSalStatus(agentUserId: string, message: MessageSalStatusData) {
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> ${AgoraVoiceAIEvents.MESSAGE_SAL_STATUS}`,
      agentUserId,
      message
    );
    this.emit(AgoraVoiceAIEvents.MESSAGE_SAL_STATUS, agentUserId, message);
  }

  private onUserManualSos(agentUserId: string, event: UserManualSosEvent) {
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> ${AgoraVoiceAIEvents.USER_MANUAL_SOS}`,
      agentUserId,
      event
    );
    this.emit(AgoraVoiceAIEvents.USER_MANUAL_SOS, agentUserId, event);
  }

  private onUserManualEos(agentUserId: string, event: UserManualEosEvent) {
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> ${AgoraVoiceAIEvents.USER_MANUAL_EOS}`,
      agentUserId,
      event
    );
    this.emit(AgoraVoiceAIEvents.USER_MANUAL_EOS, agentUserId, event);
  }

  private onAgentManualEos(agentUserId: string, event: AgentManualEosEvent) {
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> ${AgoraVoiceAIEvents.AGENT_MANUAL_EOS}`,
      agentUserId,
      event
    );
    this.emit(AgoraVoiceAIEvents.AGENT_MANUAL_EOS, agentUserId, event);
  }

  private handleManualTurnEvent(agentUserId: string, message: UnknownRecord): boolean {
    const rawMessageType = message.event_type ?? message.object;
    if (typeof rawMessageType !== 'string') {
      return false;
    }

    if (
      rawMessageType !== MessageType.USER_MANUAL_SOS_RESULT &&
      rawMessageType !== MessageType.USER_MANUAL_EOS_RESULT &&
      rawMessageType !== MessageType.AGENT_MANUAL_EOS_RESULT
    ) {
      return false;
    }

    const payload = isRecord(message.payload) ? message.payload : null;
    if (!payload) {
      this.callMessagePrint(ELoggerType.warn, 'Invalid manual turn event payload', message);
      return true;
    }

    const eventId = asString(message.event_id);
    const timestamp = asNumber(message.event_ms);

    switch (rawMessageType) {
      case MessageType.USER_MANUAL_SOS_RESULT:
        this.onUserManualSos(agentUserId, {
          eventId,
          timestamp,
          payload: parseUserManualPayload(payload),
        });
        return true;
      case MessageType.USER_MANUAL_EOS_RESULT:
        this.onUserManualEos(agentUserId, {
          eventId,
          timestamp,
          payload: parseUserManualPayload(payload),
        });
        return true;
      case MessageType.AGENT_MANUAL_EOS_RESULT:
        this.onAgentManualEos(agentUserId, {
          eventId,
          timestamp,
          payload: {
            reason: asString(payload.reason),
            maxDurationMs: asNullableNumber(payload.max_duration_ms),
            turnId: asNullableNumber(payload.turn_id),
          },
        });
        return true;
      default:
        return false;
    }
  }

  // ── Internal Diagnostics (Dev-only warnings) ─────────────────────────────
  private _clearEventTimeout() {
    if (this._eventTimeoutId !== null) {
      clearTimeout(this._eventTimeoutId);
      this._eventTimeoutId = null;
    }
    if (this._trackTranscriptHandler) {
      this.off(
        AgoraVoiceAIEvents.TRANSCRIPT_UPDATED,
        this
          ._trackTranscriptHandler as AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.TRANSCRIPT_UPDATED]
      );
      this._trackTranscriptHandler = null;
    }
    if (this._trackStateHandler) {
      this.off(
        AgoraVoiceAIEvents.AGENT_STATE_CHANGED,
        this._trackStateHandler as AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_STATE_CHANGED]
      );
      this._trackStateHandler = null;
    }
  }

  // Dev-only: warns after 15s if no TRANSCRIPT_UPDATED or AGENT_STATE_CHANGED
  // events arrive. Helps diagnose misconfigured channels or missing RTM setup.
  private _startEventTimeoutWarnings() {
    if (process.env.NODE_ENV === 'production') return;
    this._clearEventTimeout();

    const receivedEvents = new Set<string>();
    const trackEvent = (event: string) => () => {
      receivedEvents.add(event);
    };

    const trackTranscript = trackEvent('TRANSCRIPT_UPDATED');
    const trackState = trackEvent('AGENT_STATE_CHANGED');

    this._trackTranscriptHandler = trackTranscript;
    this._trackStateHandler = trackState;

    this.on(
      AgoraVoiceAIEvents.TRANSCRIPT_UPDATED,
      trackTranscript as AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.TRANSCRIPT_UPDATED]
    );
    this.on(
      AgoraVoiceAIEvents.AGENT_STATE_CHANGED,
      trackState as AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_STATE_CHANGED]
    );

    this._eventTimeoutId = setTimeout(() => {
      // Clean up tracking listeners
      this.off(
        AgoraVoiceAIEvents.TRANSCRIPT_UPDATED,
        trackTranscript as AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.TRANSCRIPT_UPDATED]
      );
      this.off(
        AgoraVoiceAIEvents.AGENT_STATE_CHANGED,
        trackState as AgoraVoiceAIEventHandlers[AgoraVoiceAIEvents.AGENT_STATE_CHANGED]
      );
      this._trackTranscriptHandler = null;
      this._trackStateHandler = null;
      this._eventTimeoutId = null;

      if (!receivedEvents.has('TRANSCRIPT_UPDATED')) {
        console.warn(
          '[ConversationalAI] No TRANSCRIPT_UPDATED events received after 15s. ' +
            'Ensure the agent is running and connected to the same channel. ' +
            'If using WORD mode, verify ENABLE_AUDIO_PTS_METADATA is set before creating the RTC client.'
        );
      }
      if (this.rtmEngine && !receivedEvents.has('AGENT_STATE_CHANGED')) {
        console.warn(
          '[ConversationalAI] No AGENT_STATE_CHANGED events received after 15s (RTM is configured). ' +
            'Ensure the agent was started with advanced_features.enable_rtm: true ' +
            'and parameters.data_channel: "rtm".'
        );
      }
    }, 15_000);
  }

  // ── Engine Event Binding ──────────────────────────────────────────────────
  private bindRtcEvents() {
    this.getCfg().rtcEngine.on(RTCEventType.AUDIO_PTS, this._boundHandleRtcAudioPTS);
    this.getCfg().rtcEngine.on(RTCEventType.STREAM_MESSAGE, this._boundHandleRtcStreamMessage);
  }
  private unbindRtcEvents() {
    this.rtcEngine?.off(RTCEventType.AUDIO_PTS, this._boundHandleRtcAudioPTS);
    this.rtcEngine?.off(RTCEventType.STREAM_MESSAGE, this._boundHandleRtcStreamMessage);
  }
  private bindRtmEvents() {
    this.rtmEngine!.addEventListener(RTMEventType.MESSAGE, this._boundHandleRtmMessage);
    this.rtmEngine!.addEventListener(RTMEventType.PRESENCE, this._boundHandleRtmPresence);
    this.rtmEngine!.addEventListener(RTMEventType.STATUS, this._boundHandleRtmStatus);
  }
  private unbindRtmEvents() {
    const events = [RTMEventType.MESSAGE, RTMEventType.PRESENCE, RTMEventType.STATUS] as const;
    const handlers = [
      this._boundHandleRtmMessage,
      this._boundHandleRtmPresence,
      this._boundHandleRtmStatus,
    ] as const;
    for (let i = 0; i < events.length; i++) {
      try {
        this.rtmEngine?.removeEventListener(events[i], handlers[i]);
      } catch (e) {
        this.callMessagePrint(ELoggerType.warn, 'Failed to unbind RTM event', events[i], e);
      }
    }
  }

  // ── Low-level Engine Handlers ─────────────────────────────────────────────
  private _handleRtcAudioPTS(pts: number) {
    try {
      this.callMessagePrint(ELoggerType.debug, `<<< ${RTCEventType.AUDIO_PTS}`, pts);
      this.covSubRenderController.setPts(pts);
    } catch (error) {
      this.callMessagePrint(ELoggerType.error, `<<< ${RTCEventType.AUDIO_PTS}`, pts, error);
    }
  }

  private _handleRtcStreamMessage(uid: RTCStreamMessagePublisher, stream: Uint8Array) {
    try {
      const decoder = new TextDecoder('utf-8');
      const text = decoder.decode(stream);

      this.callMessagePrint(
        ELoggerType.debug,
        `<<< ${RTCEventType.STREAM_MESSAGE}`,
        `uid: ${uid}, length: ${text.length}`
      );

      // Chunked format detection: exactly 3 pipe characters → message_id|part_idx|part_sum|data
      if ((text.match(/\|/g) || []).length === 3) {
        const assembled = this.chunkedAssembler.assemble(text);
        if (assembled !== null) {
          this.covSubRenderController.handleMessage(assembled as TranscriptionBase, {
            publisher: String(uid),
          });
        }
        return;
      }

      // Non-chunked: direct JSON parse
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        this.callMessagePrint(
          ELoggerType.warn,
          `<<< ${RTCEventType.STREAM_MESSAGE}`,
          'Failed to parse stream message',
          text
        );
        return;
      }

      try {
        this.covSubRenderController.handleMessage(parsed as TranscriptionBase, {
          publisher: String(uid),
        });
      } catch (e) {
        this.callMessagePrint(
          ELoggerType.error,
          `<<< ${RTCEventType.STREAM_MESSAGE}`,
          'Error handling stream message',
          e
        );
      }
    } catch (error) {
      this.callMessagePrint(ELoggerType.error, `<<< ${RTCEventType.STREAM_MESSAGE}`, error);
    }
  }

  private _handleRtmMessage(message: RTMMessageEvent) {
    const traceId = genTraceID();
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> [traceID:${traceId}] ${RTMEventType.MESSAGE}`,
      `Publisher: ${message.publisher}, type: ${message.messageType}`
    );
    const messageData = message.message;
    let parsedMessage: unknown;

    if (typeof messageData === 'string') {
      try {
        parsedMessage = JSON.parse(messageData);
      } catch {
        this.callMessagePrint(
          ELoggerType.warn,
          `>>> [traceID:${traceId}] ${RTMEventType.MESSAGE}`,
          'Failed to parse RTM message',
          messageData
        );
        return;
      }
    } else if (messageData instanceof Uint8Array) {
      try {
        const decoder = new TextDecoder('utf-8');
        const messageString = decoder.decode(messageData);
        parsedMessage = JSON.parse(messageString);
      } catch {
        this.callMessagePrint(
          ELoggerType.warn,
          `>>> [traceID:${traceId}] ${RTMEventType.MESSAGE}`,
          'Failed to parse RTM binary message'
        );
        return;
      }
    } else {
      this.callMessagePrint(
        ELoggerType.warn,
        `>>> [traceID:${traceId}] ${RTMEventType.MESSAGE}`,
        'Unsupported message type received'
      );
      return;
    }

    this.callMessagePrint(
      ELoggerType.debug,
      `>>> [traceID:${traceId}] ${RTMEventType.MESSAGE}`,
      parsedMessage
    );

    if (isRecord(parsedMessage) && this.handleManualTurnEvent(message.publisher, parsedMessage)) {
      return;
    }

    try {
      this.covSubRenderController.handleMessage(parsedMessage as TranscriptionBase, {
        publisher: message.publisher,
      });
    } catch (e) {
      this.callMessagePrint(
        ELoggerType.error,
        `>>> [traceID:${traceId}] ${RTMEventType.MESSAGE}`,
        'Error handling RTM message',
        e
      );
    }
  }
  private _handleRtmPresence(presence: RTMPresenceEvent) {
    const traceId = genTraceID();
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> [traceID:${traceId}] ${RTMEventType.PRESENCE}`,
      `Publisher: ${presence.publisher}`
    );
    const stateChanged = presence.stateChanged;
    if (stateChanged) {
      const hasAgentState = typeof stateChanged.state === 'string';
      const hasActivityState =
        typeof stateChanged.listening !== 'undefined' ||
        typeof stateChanged.thinking !== 'undefined' ||
        typeof stateChanged.speaking !== 'undefined';

      if (!hasAgentState && !hasActivityState) {
        this.callMessagePrint(
          ELoggerType.debug,
          `>>> [traceID:${traceId}] ${RTMEventType.PRESENCE}`,
          'No supported state change detected, skipping handling presence event'
        );
        return;
      }

      this.callMessagePrint(
        ELoggerType.debug,
        `>>> [traceID:${traceId}] ${RTMEventType.PRESENCE}`,
        `State changed: ${stateChanged.state}, Turn ID: ${stateChanged.turn_id}, timestamp: ${presence.timestamp}`
      );
      this.covSubRenderController.handleAgentStatus({
        ...presence,
        stateChanged: {
          ...stateChanged,
          state:
            typeof stateChanged.state === 'string' ? (stateChanged.state as AgentState) : undefined,
          turn_id:
            typeof stateChanged.turn_id !== 'undefined' ? String(stateChanged.turn_id) : undefined,
        },
      } as PresenceState);
    } else {
      this.callMessagePrint(
        ELoggerType.debug,
        `>>> [traceID:${traceId}] ${RTMEventType.PRESENCE}`,
        'No state change detected, skipping handling presence event'
      );
    }
  }
  private _handleRtmStatus(status: RTMStatusEvent) {
    const traceId = genTraceID();
    this.callMessagePrint(
      ELoggerType.debug,
      `>>> [traceID:${traceId}] ${RTMEventType.STATUS}`,
      status
    );
  }
}
