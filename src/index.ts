// Public export surface for agora-convo-ai-toolkit
export { AgoraVoiceAI } from './core/conversational-ai';
export {
  type AgoraVoiceAIConfig,
  type RTMConfig,
  type RTCEngine,
  type RTMEngine,
  type RTCStreamMessagePublisher,
} from './core/config';
export { CovSubRenderController } from './rendering/sub-render';
export { ChunkedMessageAssembler } from './messaging/chunked';
export {
  type IMetricsReporter,
  ConsoleMetricsReporter,
  AgoraMetricsReporter,
} from './utils/metrics';

// --- Consumer-facing types from core/types ---
export {
  // Enums
  AgentState,
  TurnStatus,
  TranscriptHelperMode,
  MessageSalStatus,
  ModuleType,
  ChatMessageType,
  ChatMessagePriority,
  MessageType,
  LocalTranscriptStatus,
  // Error classes
  ConversationalAIError,
  NotInitializedError,
  RTMRequiredError,
  NotFoundError,
  // Type aliases & interfaces
  type AgoraVoiceAIState,
  type AgentMetric,
  type ModuleError,
  type StateChangeEvent,
  type MessageReceipt,
  type ChatMessageText,
  type ChatMessageImage,
  type ChatMessageBase,
  type UserTranscription,
  type AgentTranscription,
  type TranscriptionBase,
  type MessageInterrupt,
  type MessageError,
  type MessageMetrics,
  type MessageSalStatusData,
  type UserManualEventPayload,
  type UserManualSosEvent,
  type UserManualEosEvent,
  type AgentManualEosPayload,
  type AgentManualEosEvent,
  type TranscriptHelperItem,
  type TranscriptHelperObjectWord,
  type DataChunkMessageWord,
  type LocalTranscriptionBase,
  type LocalImageTranscription,
  type UserTracks,
} from './core/types';

// --- Consumer-facing types from core/events ---
export { AgoraVoiceAIEvents, EventLogLevel, type AgoraVoiceAIEventHandlers } from './core/events';
