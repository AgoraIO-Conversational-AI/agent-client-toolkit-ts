import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AgoraRTC, {
  AgoraRTCProvider,
  type IAgoraRTCClient,
  type IAgoraRTCRemoteUser,
  type ILocalAudioTrack,
} from 'agora-rtc-react';
import AgoraRTM, { type RTMClient } from 'agora-rtm';
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  ChatMessagePriority,
  ChatMessageType,
  TranscriptHelperMode,
  type AgentManualEosEvent,
  type AgentMetric,
  type ModuleError,
  type StateChangeEvent,
  type TranscriptHelperItem,
  type Turn,
  type UserManualEosEvent,
  type UserManualSosEvent,
} from 'agora-agent-client-toolkit';
import {
  generateToken,
  startAgent,
  stopAgent,
  type DemoConfig,
  type TurnDetectionMode,
} from './demo-api';
import demoPackageRaw from '../package.json?raw';
import toolkitPackageRaw from '../../../packages/conversational-ai/package.json?raw';

const STORAGE_KEY = 'agora-web-demo-config';

type LogEntry = {
  time: number;
  level: 'info' | 'error';
  message: string;
  detail?: unknown;
};

type SessionStatus = 'idle' | 'connecting' | 'connected' | 'failed';
type ConnectionState = 'connecting' | 'connected' | 'failed';
type RemoteMediaType = 'audio' | 'video' | 'datachannel';
type LogTone = 'default' | 'error' | 'progress' | 'success';
type ModeLabel = 'VAD' | 'Semantic' | 'Manual';
type ChatMode = 'text' | 'image';
type AgentActivityState = {
  listening: boolean | null;
  thinking: boolean | null;
  speaking: boolean | null;
};

type MessageLatencyInfo = {
  turnId: number;
  e2eLatencyMs: number;
  rtcTransportMs: number;
  algorithmProcessingMs: number;
  asrTtlwMs: number;
  llmTtftMs: number;
  ttsTtfbMs: number;
};

const randomUid = () => String(Math.floor(100000 + Math.random() * 900000));

function createSessionIds() {
  const userId = randomUid();
  let agentUserId = randomUid();
  while (agentUserId === userId) {
    agentUserId = randomUid();
  }

  return {
    channel: `channel_web_${randomUid()}`,
    userId,
    agentUserId,
  };
}

function createMessageUuid(): string {
  return crypto.randomUUID();
}

const defaultConfig: DemoConfig = {
  appId: import.meta.env.VITE_AGORA_APP_ID ?? '',
  ...createSessionIds(),
  sosDetectionMode: 'vad',
  eosDetectionMode: 'semantic',
};

const TURN_MODES: TurnDetectionMode[] = ['vad', 'semantic', 'manual'];

function normalizeTurnMode(value: unknown, fallback: TurnDetectionMode): TurnDetectionMode {
  return TURN_MODES.includes(value as TurnDetectionMode) ? (value as TurnDetectionMode) : fallback;
}

function normalizeConfig(config: DemoConfig): DemoConfig {
  return {
    ...defaultConfig,
    sosDetectionMode: normalizeTurnMode(config.sosDetectionMode, defaultConfig.sosDetectionMode),
    eosDetectionMode: normalizeTurnMode(config.eosDetectionMode, defaultConfig.eosDetectionMode),
    ...createSessionIds(),
  };
}

function loadConfig(): DemoConfig {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return defaultConfig;
  try {
    return normalizeConfig({ ...defaultConfig, ...(JSON.parse(stored) as Partial<DemoConfig>) });
  } catch {
    return defaultConfig;
  }
}

const setAgoraParameter = (
  AgoraRTC as unknown as { setParameter: (key: string, value: boolean) => void }
).setParameter;

const TURN_MODE_OPTIONS: Array<{ value: TurnDetectionMode; label: string }> = [
  { value: 'vad', label: 'VAD' },
  { value: 'semantic', label: 'Semantic' },
  { value: 'manual', label: 'Manual' },
];

const TURN_MODE_LABELS: Record<TurnDetectionMode, ModeLabel> = {
  vad: 'VAD',
  semantic: 'Semantic',
  manual: 'Manual',
};

function readPackageVersion(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : 'local';
  } catch {
    return 'local';
  }
}

const DEMO_VERSION = readPackageVersion(demoPackageRaw);
const TOOLKIT_VERSION = readPackageVersion(toolkitPackageRaw);

function createAgentActivityState(): AgentActivityState {
  return {
    listening: null,
    thinking: null,
    speaking: null,
  };
}

function buildLatencySummary(turn: Turn): MessageLatencyInfo {
  return {
    turnId: turn.turnId,
    e2eLatencyMs: turn.e2eLatencyMs,
    rtcTransportMs: turn.segmentedLatency.transportMs,
    algorithmProcessingMs: turn.segmentedLatency.algorithmProcessingMs,
    asrTtlwMs: turn.segmentedLatency.asrTtlwMs,
    llmTtftMs: turn.segmentedLatency.llmTtftMs,
    ttsTtfbMs: turn.segmentedLatency.ttsTtfbMs,
  };
}

function isConfigReady(config: DemoConfig): boolean {
  return Boolean(config.appId.trim());
}

function rtcUidFromUserId(userId: string): number {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0 || uid > 2_147_483_647) {
    throw new Error(`Invalid numeric RTC uid: ${userId}`);
  }
  return uid;
}

function formatLogTime(time: number): string {
  return new Date(time).toLocaleTimeString();
}

function logTone(log: LogEntry): LogTone {
  const message = log.message.toLowerCase();
  if (log.level === 'error' || message.includes('failed') || message.includes('error')) {
    return 'error';
  }
  if (message.includes('successfully') || message.includes('success')) {
    return 'success';
  }
  if (
    message.includes('connecting') ||
    message.includes('starting') ||
    message.includes('generating') ||
    message.includes('joining')
  ) {
    return 'progress';
  }
  return 'default';
}

function formatLogDetail(detail: unknown): string {
  if (detail === undefined || detail === null) return '';
  if (typeof detail === 'string') return ` ${detail}`;
  return ` ${JSON.stringify(detail)}`;
}

function activityBadgeClassName(value: boolean | null): string {
  return value === true ? 'agent-activity-badge active' : 'agent-activity-badge';
}

function ModeControl({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: TurnDetectionMode;
  disabled: boolean;
  onChange?: (value: TurnDetectionMode) => void;
}) {
  return (
    <div className="mode-control">
      <span>{label}</span>
      <div className="segments" role="group" aria-label={label}>
        {TURN_MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.value === value ? 'segment selected' : 'segment'}
            aria-pressed={option.value === value}
            disabled={disabled}
            onClick={() => onChange?.(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 14.5C14.21 14.5 16 12.71 16 10.5V6C16 3.79 14.21 2 12 2C9.79 2 8 3.79 8 6V10.5C8 12.71 9.79 14.5 12 14.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
      <path
        d="M5 10.5C5 14.37 8.13 17.5 12 17.5C15.87 17.5 19 14.37 19 10.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
      <path
        d="M12 17.5V22"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
      <path
        d="M8.5 22H15.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
      {muted ? (
        <path
          d="M4 4L20 20"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.2"
        />
      ) : null}
    </svg>
  );
}

function AgentPanel({
  status,
  canStart,
  micMuted,
  canToggleMic,
  onStart,
  onStop,
  onToggleMic,
}: {
  status: SessionStatus;
  canStart: boolean;
  micMuted?: boolean;
  canToggleMic?: boolean;
  onStart?: () => void;
  onStop?: () => void | Promise<void>;
  onToggleMic?: () => void | Promise<void>;
}) {
  const connected = status === 'connected';
  const connecting = status === 'connecting';
  const failed = status === 'failed';
  const buttonLabel = connecting
    ? 'Connecting...'
    : connected || failed
      ? 'Stop agent'
      : 'Start agent';
  const buttonDisabled = connecting || (!connected && !failed && !canStart);

  const handleClick = () => {
    if (connected || failed) {
      void onStop?.();
      return;
    }
    if (!connecting && canStart) onStart?.();
  };

  return (
    <section
      className={connected ? 'agent-actions connected' : 'agent-actions'}
      aria-label="Agent controls"
    >
      {connected ? (
        <button
          className={micMuted ? 'mic-toggle muted' : 'mic-toggle'}
          type="button"
          disabled={!canToggleMic}
          aria-pressed={Boolean(micMuted)}
          aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
          title={micMuted ? 'Unmute microphone' : 'Mute microphone'}
          onClick={() => void onToggleMic?.()}
        >
          <MicIcon muted={Boolean(micMuted)} />
        </button>
      ) : null}
      <button
        className={connected || failed ? 'agent-toggle danger' : 'agent-toggle'}
        type="button"
        disabled={buttonDisabled}
        onClick={handleClick}
      >
        {buttonLabel}
      </button>
    </section>
  );
}

function SettingsSheet({
  open,
  config,
  disabled,
  onClose,
  onUpdate,
}: {
  open: boolean;
  config: DemoConfig;
  disabled: boolean;
  onClose: () => void;
  onUpdate?: (key: keyof DemoConfig, value: string | number) => void;
}) {
  if (!open) return null;

  const controlsDisabled = disabled || !onUpdate;
  const update = (key: keyof DemoConfig, value: string | number) => {
    if (!controlsDisabled) onUpdate?.(key, value);
  };

  return (
    <div
      className="settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="settings-header">
          <div>
            <h2 id="settings-title">Settings</h2>
            <p>
              Demo v{DEMO_VERSION} | Component v{TOOLKIT_VERSION}
            </p>
          </div>
          <button className="settings-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="turn-settings">
          <ModeControl
            label="SOS"
            value={config.sosDetectionMode}
            disabled={controlsDisabled}
            onChange={(value) => update('sosDetectionMode', value)}
          />
          <ModeControl
            label="EOS"
            value={config.eosDetectionMode}
            disabled={controlsDisabled}
            onChange={(value) => update('eosDetectionMode', value)}
          />
        </div>
      </section>
    </div>
  );
}

function TranscriptPanel({
  config,
  status,
  transcript,
  agentState,
  agentActivity,
  latencyByTurnId,
  showLatencyMetrics,
  onToggleLatencyMetrics,
}: {
  config: DemoConfig;
  status: SessionStatus;
  transcript: TranscriptHelperItem<unknown>[];
  agentState: StateChangeEvent | null;
  agentActivity: AgentActivityState;
  latencyByTurnId: Map<number, MessageLatencyInfo>;
  showLatencyMetrics: boolean;
  onToggleLatencyMetrics: () => void;
}) {
  const hasLatencyMetrics = latencyByTurnId.size > 0;

  return (
    <section className="transcript-panel panel">
      <div className="panel-title">
        <div>
          <h2>Transcript</h2>
          <p>{status === 'connected' ? config.channel : 'Ready for a generated web session'}</p>
        </div>
        <div className="agent-live-state" aria-label="Agent realtime state">
          <span className="agent-state-pill">State {agentState?.state ?? 'idle'}</span>
          <span className={activityBadgeClassName(agentActivity.listening)}>Listening</span>
          <span className={activityBadgeClassName(agentActivity.thinking)}>Thinking</span>
          <span className={activityBadgeClassName(agentActivity.speaking)}>Speaking</span>
          {hasLatencyMetrics ? (
            <button
              className={showLatencyMetrics ? 'latency-toggle active' : 'latency-toggle'}
              type="button"
              aria-pressed={showLatencyMetrics}
              onClick={onToggleLatencyMetrics}
            >
              Latency
              <span className="latency-toggle-dot" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <div className="transcript-stream">
        {transcript.length === 0 ? (
          <div className="empty-transcript">
            <h3>{status === 'idle' ? 'Session standby' : 'Waiting for conversation'}</h3>
          </div>
        ) : (
          transcript.map((item: TranscriptHelperItem<unknown>, index) => {
            const uid = String(item.uid);
            const speaker =
              uid === config.userId || uid === '0'
                ? 'user'
                : uid === config.agentUserId
                  ? 'agent'
                  : 'system';
            const latencyMetrics =
              showLatencyMetrics && speaker === 'agent'
                ? latencyByTurnId.get(item.turn_id)
                : undefined;
            return (
              <article key={`${uid}-${index}`} className={`transcript-item ${speaker}`}>
                <strong>{speaker === 'user' ? 'User' : speaker === 'agent' ? 'Agent' : uid}</strong>
                <p>{item.text || '...'}</p>
                {latencyMetrics ? <ChatLatencyMetrics metrics={latencyMetrics} /> : null}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function ChatLatencyMetrics({ metrics }: { metrics: MessageLatencyInfo }) {
  const items = [
    ['E2E', metrics.e2eLatencyMs],
    ['RTC', metrics.rtcTransportMs],
    ['ASR', metrics.asrTtlwMs],
    ['LLM', metrics.llmTtftMs],
    ['TTS', metrics.ttsTtfbMs],
  ] as const;

  return (
    <div className="latency-metrics" aria-label={`Turn ${metrics.turnId} latency metrics`}>
      <span className="latency-turn">#{metrics.turnId}</span>
      {items.map(([label, value]) => (
        <span key={label} className="latency-metric">
          <span>{label}:</span>
          <strong>{value}ms</strong>
        </span>
      ))}
    </div>
  );
}

function LogPanel({ logs }: { logs: LogEntry[] }) {
  const logContentRef = useRef<HTMLDivElement | null>(null);
  const visibleLogs = logs.slice(-30);

  useEffect(() => {
    const logContent = logContentRef.current;
    if (!logContent) return;
    logContent.scrollTop = logContent.scrollHeight;
  }, [logs.length]);

  return (
    <section className="log-panel panel">
      <div className="log-content" aria-label="Log" ref={logContentRef}>
        {visibleLogs.length === 0 ? (
          <p className="log-placeholder">log</p>
        ) : (
          visibleLogs.map((log, index) => (
            <p key={`${log.time}-${index}`} className={`log-line ${logTone(log)}`}>
              <time>{formatLogTime(log.time)}</time>
              <span>
                {log.message}
                {formatLogDetail(log.detail)}
              </span>
            </p>
          ))
        )}
      </div>
    </section>
  );
}

function ManualControls({
  config,
  status,
  chatMode,
  chatInput,
  onChatModeChange,
  onChatInputChange,
  onSendChat,
  onInterrupt,
  onManualSOS,
  onManualEOS,
}: {
  config: DemoConfig;
  status: SessionStatus;
  chatMode: ChatMode;
  chatInput: string;
  onChatModeChange?: (mode: ChatMode) => void;
  onChatInputChange?: (value: string) => void;
  onSendChat?: () => void;
  onInterrupt?: () => void;
  onManualSOS?: () => void;
  onManualEOS?: () => void;
}) {
  const connected = status === 'connected';
  const canSendChat = connected && Boolean(chatInput.trim());
  const canManualSOS = connected && config.sosDetectionMode === 'manual';
  const canManualEOS = connected && config.eosDetectionMode === 'manual';

  return (
    <section className="control-panel panel">
      <div className="panel-title">
        <div>
          <h2>Controls</h2>
        </div>
      </div>

      <div className="composer chat-composer">
        <div className="composer-header">
          <label htmlFor="chat-message">Chat</label>
          <div className="segments chat-mode-segments" role="group" aria-label="Chat message type">
            {(['text', 'image'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={chatMode === mode ? 'segment selected' : 'segment'}
                onClick={() => {
                  if (chatMode !== mode) {
                    onChatModeChange?.(mode);
                  }
                }}
                disabled={!connected}
              >
                {mode === 'text' ? 'Text' : 'Image'}
              </button>
            ))}
          </div>
        </div>
        <div className="composer-row chat-input-row">
          {chatMode === 'text' ? (
            <textarea
              id="chat-message"
              value={chatInput}
              onChange={(event) => onChatInputChange?.(event.target.value)}
              disabled={!connected}
            />
          ) : (
            <input
              id="chat-message"
              value={chatInput}
              onChange={(event) => onChatInputChange?.(event.target.value)}
              disabled={!connected}
              placeholder="https://example.com/image.png"
            />
          )}
          <button type="button" onClick={onSendChat} disabled={!canSendChat}>
            Send
          </button>
        </div>
      </div>

      <div className="turn-controls">
        <button type="button" onClick={onInterrupt} disabled={!connected}>
          Interrupt
        </button>
        <button
          className="turn-action"
          type="button"
          onClick={onManualSOS}
          disabled={!canManualSOS}
        >
          SOS
        </button>
        <button
          className="turn-action"
          type="button"
          onClick={onManualEOS}
          disabled={!canManualEOS}
        >
          EOS
        </button>
      </div>
    </section>
  );
}

function Workspace({
  config,
  status,
  logs,
  transcript = [],
  chatMode,
  chatInput,
  agentState,
  agentActivity,
  turns,
  setupDisabled,
  canStart,
  micMuted,
  canToggleMic,
  onUpdateConfig,
  onStart,
  onStop,
  onToggleMic,
  onChatModeChange,
  onChatInputChange,
  onSendChat,
  onInterrupt,
  onManualSOS,
  onManualEOS,
}: {
  config: DemoConfig;
  status: SessionStatus;
  logs: LogEntry[];
  transcript?: TranscriptHelperItem<unknown>[];
  chatMode: ChatMode;
  chatInput: string;
  agentState?: StateChangeEvent | null;
  agentActivity?: AgentActivityState;
  turns?: Turn[];
  setupDisabled: boolean;
  canStart: boolean;
  micMuted?: boolean;
  canToggleMic?: boolean;
  onUpdateConfig?: (key: keyof DemoConfig, value: string | number) => void;
  onStart?: () => void;
  onStop?: () => void | Promise<void>;
  onToggleMic?: () => void | Promise<void>;
  onChatModeChange?: (mode: ChatMode) => void;
  onChatInputChange?: (value: string) => void;
  onSendChat?: () => void;
  onInterrupt?: () => void;
  onManualSOS?: () => void;
  onManualEOS?: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showLatencyMetrics, setShowLatencyMetrics] = useState(true);
  const latencyByTurnId = useMemo(() => {
    return new Map((turns ?? []).map((turn) => [turn.turnId, buildLatencySummary(turn)]));
  }, [turns]);

  useEffect(() => {
    if (!settingsOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settingsOpen]);

  return (
    <main className="demo-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">AI</span>
          <div>
            <h1>Real-time Voice Conversation Demo</h1>
            <p>
              SOS: {TURN_MODE_LABELS[config.sosDetectionMode]} | EOS:{' '}
              {TURN_MODE_LABELS[config.eosDetectionMode]}
            </p>
          </div>
        </div>
        <button
          className="settings-button"
          type="button"
          aria-label="Settings"
          title="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 15.5A3.5 3.5 0 1 0 12 8.5A3.5 3.5 0 0 0 12 15.5Z"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
            <path
              d="M19.4 15A1.65 1.65 0 0 0 19.73 16.82L19.79 16.88A2 2 0 1 1 16.96 19.71L16.9 19.65A1.65 1.65 0 0 0 15.08 19.32A1.65 1.65 0 0 0 14.08 20.84V21A2 2 0 1 1 10.08 21V20.91A1.65 1.65 0 0 0 9 19.39A1.65 1.65 0 0 0 7.18 19.72L7.12 19.78A2 2 0 1 1 4.29 16.95L4.35 16.89A1.65 1.65 0 0 0 4.68 15.07A1.65 1.65 0 0 0 3.16 14.07H3A2 2 0 1 1 3 10.07H3.09A1.65 1.65 0 0 0 4.61 9A1.65 1.65 0 0 0 4.28 7.18L4.22 7.12A2 2 0 1 1 7.05 4.29L7.11 4.35A1.65 1.65 0 0 0 8.93 4.68H9A1.65 1.65 0 0 0 10 3.16V3A2 2 0 1 1 14 3V3.09A1.65 1.65 0 0 0 15 4.61A1.65 1.65 0 0 0 16.82 4.28L16.88 4.22A2 2 0 1 1 19.71 7.05L19.65 7.11A1.65 1.65 0 0 0 19.32 8.93V9A1.65 1.65 0 0 0 20.84 10H21A2 2 0 1 1 21 14H20.91A1.65 1.65 0 0 0 19.4 15Z"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
        </button>
      </header>

      <div className="workspace-grid">
        <div className="center-stack">
          <TranscriptPanel
            config={config}
            status={status}
            transcript={transcript}
            agentState={agentState ?? null}
            agentActivity={agentActivity ?? createAgentActivityState()}
            latencyByTurnId={latencyByTurnId}
            showLatencyMetrics={showLatencyMetrics}
            onToggleLatencyMetrics={() => setShowLatencyMetrics((current) => !current)}
          />
          <AgentPanel
            status={status}
            canStart={canStart}
            micMuted={micMuted}
            canToggleMic={canToggleMic}
            onStart={onStart}
            onStop={onStop}
            onToggleMic={onToggleMic}
          />
        </div>

        <div className="right-stack">
          <LogPanel logs={logs} />
          <ManualControls
            config={config}
            status={status}
            chatMode={chatMode}
            chatInput={chatInput}
            onChatModeChange={onChatModeChange}
            onChatInputChange={onChatInputChange}
            onSendChat={onSendChat}
            onInterrupt={onInterrupt}
            onManualSOS={onManualSOS}
            onManualEOS={onManualEOS}
          />
        </div>
      </div>

      <SettingsSheet
        open={settingsOpen}
        config={config}
        disabled={setupDisabled}
        onClose={() => setSettingsOpen(false)}
        onUpdate={onUpdateConfig}
      />
    </main>
  );
}

type StartSessionOptions = {
  isCancelled: () => boolean;
};

function Session({
  config,
  rtcClient,
  rtmClient,
  onDisconnect,
}: {
  config: DemoConfig;
  rtcClient: IAgoraRTCClient;
  rtmClient: RTMClient;
  onDisconnect: () => void;
}) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [toolkitReady, setToolkitReady] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptHelperItem<unknown>[]>([]);
  const [agentState, setAgentState] = useState<StateChangeEvent | null>(null);
  const [agentActivity, setAgentActivity] = useState<AgentActivityState>(createAgentActivityState);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [chatMode, setChatMode] = useState<ChatMode>('text');
  const [chatInput, setChatInput] = useState('Hello, can you hear me?');
  const [micMuted, setMicMuted] = useState(false);
  const localAudioTrackRef = useRef<ILocalAudioTrack | null>(null);
  const micMonitorTimerRef = useRef<number | null>(null);
  const aiRef = useRef<AgoraVoiceAI | null>(null);
  const agentIdRef = useRef<string | null>(null);
  const subscribedRtmChannelRef = useRef<string | null>(null);

  const addLog = useCallback((entry: Omit<LogEntry, 'time'>) => {
    setLogs((current) => [...current.slice(-99), { ...entry, time: Date.now() }]);
  }, []);

  const updateChatMode = useCallback((mode: ChatMode) => {
    setChatMode(mode);
    setChatInput('');
  }, []);

  const stopStartedAgent = useCallback(async () => {
    const agentId = agentIdRef.current;
    agentIdRef.current = null;

    if (agentId) {
      await stopAgent(config, agentId);
      addLog({ level: 'info', message: 'Agent stopped successfully' });
    }
  }, [addLog, config]);

  const cleanupMedia = useCallback(async () => {
    if (micMonitorTimerRef.current !== null) {
      window.clearInterval(micMonitorTimerRef.current);
      micMonitorTimerRef.current = null;
    }

    const localAudioTrack = localAudioTrackRef.current;
    localAudioTrackRef.current = null;
    setMicMuted(false);

    if (localAudioTrack) {
      await rtcClient.unpublish([localAudioTrack]).catch(() => undefined);
      localAudioTrack.close();
    }

    const subscribedChannel = subscribedRtmChannelRef.current;
    subscribedRtmChannelRef.current = null;
    if (subscribedChannel) {
      await rtmClient.unsubscribe(subscribedChannel).catch(() => undefined);
    }

    const ai = aiRef.current;
    aiRef.current = null;
    setToolkitReady(false);
    if (ai) {
      try {
        if (AgoraVoiceAI.getInstance() === ai) {
          ai.unsubscribe();
          ai.destroy();
        }
      } catch {
        // Already destroyed by a later session cleanup.
      }
    }

    await Promise.allSettled([rtcClient.leave(), rtmClient.logout()]);
  }, [rtcClient, rtmClient]);

  const disconnect = useCallback(async () => {
    try {
      await stopStartedAgent().catch((error) => {
        addLog({ level: 'error', message: 'Agent stop failed', detail: String(error) });
      });
      await cleanupMedia();
    } finally {
      onDisconnect();
    }
  }, [addLog, cleanupMedia, onDisconnect, stopStartedAgent]);

  const toggleMic = useCallback(async () => {
    const localAudioTrack = localAudioTrackRef.current;
    if (!localAudioTrack) return;

    const nextMuted = !micMuted;
    await localAudioTrack.setEnabled(!nextMuted);
    setMicMuted(nextMuted);
    addLog({ level: 'info', message: nextMuted ? 'Microphone muted' : 'Microphone unmuted' });
  }, [addLog, micMuted]);

  const startMicMonitor = useCallback(
    (audioTrack: ILocalAudioTrack) => {
      let lastBucket = -1;
      if (micMonitorTimerRef.current !== null) {
        window.clearInterval(micMonitorTimerRef.current);
      }

      micMonitorTimerRef.current = window.setInterval(() => {
        const getVolumeLevel = (audioTrack as unknown as { getVolumeLevel?: () => number })
          .getVolumeLevel;
        if (!getVolumeLevel) return;

        const volume = getVolumeLevel.call(audioTrack);
        const bucket = Math.min(10, Math.floor(volume * 10));
        if (bucket !== lastBucket && (bucket > 0 || lastBucket > 0)) {
          lastBucket = bucket;
          addLog({ level: 'info', message: 'Microphone input level', detail: { volume } });
        }
      }, 1000);
    },
    [addLog]
  );

  const startSession = useCallback(
    async ({ isCancelled }: StartSessionOptions) => {
      addLog({ level: 'info', message: 'Generating user token...' });
      const userToken = await generateToken(config, config.userId);

      addLog({ level: 'info', message: 'Joining RTC and logging in RTM...' });
      const rtcUid = rtcUidFromUserId(config.userId);
      const joinedUid = await rtcClient.join(config.appId, config.channel, userToken, rtcUid);
      const audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      localAudioTrackRef.current = audioTrack;
      setMicMuted(false);
      await rtcClient.publish([audioTrack]);
      startMicMonitor(audioTrack);
      addLog({
        level: 'info',
        message: 'Local audio published',
        detail: { rtcUid: joinedUid },
      });
      await rtmClient.login({ token: userToken });
      await rtmClient.subscribe(config.channel);
      subscribedRtmChannelRef.current = config.channel;
      addLog({ level: 'info', message: 'RTM channel subscribed' });

      const ai = await AgoraVoiceAI.init({
        rtcEngine: rtcClient,
        rtmConfig: { rtmEngine: rtmClient },
        renderMode: TranscriptHelperMode.TEXT,
        enableLog: true,
      });
      aiRef.current = ai;

      const onTranscript = (items: TranscriptHelperItem<unknown>[]) => {
        setTranscript(items);
      };
      const onState = (agentUserId: string, event: StateChangeEvent) => {
        setAgentState(event);
        addLog({ level: 'info', message: `Agent state from ${agentUserId}: ${event.state}` });
      };
      const onListening = (agentUserId: string, isListening: boolean) => {
        setAgentActivity((current) => ({ ...current, listening: isListening }));
        addLog({
          level: 'info',
          message: `Agent listening from ${agentUserId}: ${isListening}`,
        });
      };
      const onThinking = (agentUserId: string, isThinking: boolean) => {
        setAgentActivity((current) => ({ ...current, thinking: isThinking }));
        addLog({
          level: 'info',
          message: `Agent thinking from ${agentUserId}: ${isThinking}`,
        });
      };
      const onSpeaking = (agentUserId: string, isSpeaking: boolean) => {
        setAgentActivity((current) => ({ ...current, speaking: isSpeaking }));
        addLog({
          level: 'info',
          message: `Agent speaking from ${agentUserId}: ${isSpeaking}`,
        });
      };
      const onTurnFinished = (agentUserId: string, turn: Turn) => {
        setTurns((current) => {
          const next = current.filter((item) => item.turnId !== turn.turnId);
          next.push(turn);
          next.sort((a, b) => a.turnId - b.turnId);
          return next;
        });
        addLog({
          level: 'info',
          message: `Turn finished from ${agentUserId}: #${turn.turnId}`,
          detail: { e2eLatencyMs: turn.e2eLatencyMs },
        });
      };
      const onError = (agentUserId: string, error: ModuleError) =>
        addLog({ level: 'error', message: `Agent error from ${agentUserId}`, detail: error });
      const onMetrics = (agentUserId: string, metrics: AgentMetric) =>
        addLog({ level: 'info', message: `Metrics from ${agentUserId}`, detail: metrics });
      const onSos = (agentUserId: string, event: UserManualSosEvent) =>
        addLog({ level: 'info', message: `Manual SOS result from ${agentUserId}`, detail: event });
      const onEos = (agentUserId: string, event: UserManualEosEvent) =>
        addLog({ level: 'info', message: `Manual EOS result from ${agentUserId}`, detail: event });
      const onAgentEos = (agentUserId: string, event: AgentManualEosEvent) =>
        addLog({ level: 'info', message: `Agent manual EOS from ${agentUserId}`, detail: event });

      ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, onTranscript);
      ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, onState);
      ai.on(AgoraVoiceAIEvents.AGENT_LISTENING_CHANGED, onListening);
      ai.on(AgoraVoiceAIEvents.AGENT_THINKING_CHANGED, onThinking);
      ai.on(AgoraVoiceAIEvents.AGENT_SPEAKING_CHANGED, onSpeaking);
      ai.on(AgoraVoiceAIEvents.AGENT_TURN_FINISHED, onTurnFinished);
      ai.on(AgoraVoiceAIEvents.AGENT_ERROR, onError);
      ai.on(AgoraVoiceAIEvents.AGENT_METRICS, onMetrics);
      ai.on(AgoraVoiceAIEvents.USER_MANUAL_SOS, onSos);
      ai.on(AgoraVoiceAIEvents.USER_MANUAL_EOS, onEos);
      ai.on(AgoraVoiceAIEvents.AGENT_MANUAL_EOS, onAgentEos);
      ai.subscribeMessage(config.channel);
      setToolkitReady(true);
      addLog({ level: 'info', message: 'Toolkit message subscription ready' });
      addLog({ level: 'info', message: 'RTC/RTM connected. Starting agent...' });

      const result = await startAgent({
        config,
        remoteRtcUid: String(joinedUid),
      });

      if (isCancelled()) {
        await stopAgent(config, result.agentId).catch(() => undefined);
        return;
      }

      agentIdRef.current = result.agentId;
      setConnectionState('connected');
      addLog({ level: 'info', message: 'Agent started successfully', detail: result });
    },
    [addLog, config, rtcClient, rtmClient, startMicMonitor]
  );

  useEffect(() => {
    let cancelled = false;

    const handleUserPublished = async (user: IAgoraRTCRemoteUser, mediaType: RemoteMediaType) => {
      addLog({
        level: 'info',
        message: 'Remote media published',
        detail: { uid: user.uid, mediaType },
      });
      if (mediaType === 'audio') {
        await rtcClient.subscribe(user, mediaType);
        user.audioTrack?.play();
        addLog({ level: 'info', message: 'Remote audio subscribed', detail: { uid: user.uid } });
      }
    };
    const handleUserJoined = (user: IAgoraRTCRemoteUser) => {
      addLog({ level: 'info', message: 'Remote user joined', detail: { uid: user.uid } });
    };
    const handleUserLeft = (user: IAgoraRTCRemoteUser) => {
      addLog({ level: 'info', message: 'Remote user left', detail: { uid: user.uid } });
    };

    rtcClient.on('user-joined', handleUserJoined);
    rtcClient.on('user-left', handleUserLeft);
    rtcClient.on('user-published', handleUserPublished);

    void startSession({ isCancelled: () => cancelled }).catch((error) => {
      if (cancelled) return;
      addLog({ level: 'error', message: 'Connection failed', detail: String(error) });
      setConnectionState('failed');
      void stopStartedAgent().catch((stopError) => {
        addLog({ level: 'error', message: 'Agent stop failed', detail: String(stopError) });
      });
      void cleanupMedia();
    });

    return () => {
      cancelled = true;
      rtcClient.off('user-joined', handleUserJoined);
      rtcClient.off('user-left', handleUserLeft);
      rtcClient.off('user-published', handleUserPublished);
      void cleanupMedia();
    };
  }, [addLog, cleanupMedia, rtcClient, startSession, stopStartedAgent]);

  if (connectionState !== 'connected') {
    return (
      <Workspace
        config={config}
        status={connectionState}
        logs={logs}
        transcript={transcript}
        chatMode={chatMode}
        chatInput={chatInput}
        agentState={agentState}
        agentActivity={agentActivity}
        turns={turns}
        setupDisabled
        canStart={false}
        micMuted={micMuted}
        canToggleMic={false}
        onStop={disconnect}
        onToggleMic={toggleMic}
        onChatModeChange={updateChatMode}
        onChatInputChange={setChatInput}
      />
    );
  }

  const safeRun = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      addLog({ level: 'info', message: label, detail: result });
    } catch (error) {
      addLog({ level: 'error', message: `${label} failed`, detail: String(error) });
    }
  };

  return (
    <Workspace
      config={config}
      status="connected"
      logs={logs}
      transcript={transcript}
      chatMode={chatMode}
      chatInput={chatInput}
      agentState={agentState}
      agentActivity={agentActivity}
      turns={turns}
      setupDisabled
      canStart={false}
      micMuted={micMuted}
      canToggleMic={toolkitReady}
      onStop={disconnect}
      onToggleMic={toggleMic}
      onChatModeChange={updateChatMode}
      onChatInputChange={setChatInput}
      onSendChat={() =>
        void safeRun('Chat sent', async () => {
          const value = chatInput.trim();
          if (chatMode === 'text') {
            await aiRef.current?.chat(config.agentUserId, {
              messageType: ChatMessageType.TEXT,
              priority: ChatMessagePriority.INTERRUPTED,
              responseInterruptable: true,
              text: value,
            });
            return { type: chatMode, text: value };
          }

          const uuid = createMessageUuid();
          await aiRef.current?.chat(config.agentUserId, {
            messageType: ChatMessageType.IMAGE,
            uuid,
            url: value,
          });
          return { type: chatMode, uuid, url: value };
        })
      }
      onInterrupt={() =>
        void safeRun('Interrupt sent', async () => aiRef.current?.interrupt(config.agentUserId))
      }
      onManualSOS={() =>
        void safeRun('Manual SOS sent', async () => aiRef.current?.manualSOS(config.agentUserId))
      }
      onManualEOS={() =>
        void safeRun('Manual EOS sent', async () => aiRef.current?.manualEOS(config.agentUserId))
      }
    />
  );
}

export function App() {
  const [draftConfig, setDraftConfig] = useState<DemoConfig>(loadConfig);
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const rtcRef = useRef<IAgoraRTCClient | null>(null);
  const rtmRef = useRef<RTMClient | null>(null);

  const onConnect = () => {
    const nextConfig = normalizeConfig(draftConfig);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConfig));
    setDraftConfig(nextConfig);
    setAgoraParameter('ENABLE_AUDIO_PTS_METADATA', true);
    rtcRef.current = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    rtmRef.current = new AgoraRTM.RTM(nextConfig.appId, nextConfig.userId);
    setConfig(nextConfig);
  };

  const onDisconnect = () => {
    rtcRef.current = null;
    rtmRef.current = null;
    setConfig(null);
  };

  const updateDraftConfig = (key: keyof DemoConfig, value: string | number) => {
    setDraftConfig((current) => ({ ...current, [key]: value }));
  };

  if (!config || !rtcRef.current || !rtmRef.current) {
    return (
      <Workspace
        config={draftConfig}
        status="idle"
        logs={[]}
        chatMode="text"
        chatInput="Hello, can you hear me?"
        setupDisabled={false}
        canStart={isConfigReady(draftConfig)}
        onUpdateConfig={updateDraftConfig}
        onStart={onConnect}
      />
    );
  }

  return (
    <AgoraRTCProvider client={rtcRef.current}>
      <Session
        config={config}
        rtcClient={rtcRef.current}
        rtmClient={rtmRef.current}
        onDisconnect={onDisconnect}
      />
    </AgoraRTCProvider>
  );
}
