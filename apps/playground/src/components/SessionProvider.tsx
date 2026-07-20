import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react';
import type { IAgoraRTCClient } from 'agora-rtc-sdk-ng';
import type { RTMClient } from 'agora-rtm';
import AgoraRTC from 'agora-rtc-sdk-ng';
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  ChatMessageType,
  ChatMessagePriority,
  type AgoraVoiceAIState,
} from 'agent-client-toolkit-ts';
import { ConversationalAIProvider } from 'agent-client-toolkit-react';
import type { Credentials } from './ConfigForm';
import { StatusBar } from './StatusBar';
import { TranscriptPanel } from './TranscriptPanel';
import { ChatInput } from './ChatInput';
import { MetricsPanel } from './MetricsPanel';
import { ErrorToast } from './ErrorToast';
import { DebugPanel } from './DebugPanel';

export interface DebugLogEntry {
  timestamp: number;
  event: string;
  data: unknown;
}

interface SessionContextValue {
  credentials: Credentials;
  debugLog: DebugLogEntry[];
  sdkState: AgoraVoiceAIState | null;
  clearDebugLog: () => void;
  hasRtm: boolean;
  isConnected: boolean;
  sendMessage: (agentUserId: string, text: string) => Promise<void>;
  interrupt: (agentUserId: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be inside SessionProvider');
  return ctx;
}

interface Props {
  credentials: Credentials;
  rtcClient: IAgoraRTCClient;
  rtmClient: RTMClient | null;
  onDisconnect: () => void;
}

/**
 * Session provider that wraps children in ConversationalAIProvider for
 * React context, then handles the RTC/RTM connection lifecycle and
 * debug logging in SessionInner.
 */
export function SessionProvider({ credentials, rtcClient, rtmClient, onDisconnect }: Props) {
  const config = useMemo(
    () => ({
      rtmEngine: rtmClient ?? undefined,
      renderMode: credentials.renderMode,
      enableLog: credentials.enableLog,
      channel: credentials.channelName,
    }),
    [rtmClient, credentials.renderMode, credentials.enableLog, credentials.channelName]
  );

  return (
    <ConversationalAIProvider config={config}>
      <SessionInner
        credentials={credentials}
        rtcClient={rtcClient}
        rtmClient={rtmClient}
        onDisconnect={onDisconnect}
      />
    </ConversationalAIProvider>
  );
}

/**
 * Inner session component that handles RTC/RTM connection lifecycle,
 * debug logging, SDK state polling, and provides SessionContext.
 * Standalone hooks in children connect via ConversationalAIProvider context.
 */
function SessionInner({ credentials, rtcClient, rtmClient, onDisconnect }: Props) {
  const [debugLog, setDebugLog] = useState<DebugLogEntry[]>([]);
  const [sdkState, setSdkState] = useState<AgoraVoiceAIState | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const cleanupRef = useRef(false);

  const pushLog = useCallback((event: string, data: unknown) => {
    setDebugLog((prev) => {
      const next = [...prev, { timestamp: Date.now(), event, data }];
      return next.length > 100 ? next.slice(-100) : next;
    });
  }, []);

  const clearDebugLog = useCallback(() => setDebugLog([]), []);

  // RTC join + audio publish + RTM login
  useEffect(() => {
    cleanupRef.current = false;
    let localAudioTrack: Awaited<ReturnType<typeof AgoraRTC.createMicrophoneAudioTrack>>;

    const connect = async () => {
      try {
        if (rtmClient) {
          await rtmClient.login({ token: credentials.rtmToken });
        }

        await rtcClient.join(
          credentials.appId,
          credentials.channelName,
          credentials.rtcToken || null,
          credentials.userId
        );

        if (cleanupRef.current) return;

        localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
        await rtcClient.publish([localAudioTrack]);
        setIsConnected(true);
      } catch (err) {
        if (!cleanupRef.current) {
          setConnectionError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    const handleUserPublished = async (
      user: { uid: string | number; audioTrack?: { play: () => void } },
      mediaType: string
    ) => {
      if (mediaType === 'audio') {
        await rtcClient.subscribe(user as Parameters<typeof rtcClient.subscribe>[0], 'audio');
        user.audioTrack?.play();
      }
    };

    rtcClient.on('user-published', handleUserPublished as Parameters<typeof rtcClient.on>[1]);
    connect();

    return () => {
      cleanupRef.current = true;
      setIsConnected(false);
      rtcClient.off('user-published', handleUserPublished as Parameters<typeof rtcClient.off>[1]);

      (async () => {
        try {
          if (localAudioTrack) {
            (localAudioTrack as { close?: () => void }).close?.();
            await rtcClient.unpublish();
          }
          await rtcClient.leave();
        } catch {
          /* best-effort */
        }
        try {
          if (rtmClient) await rtmClient.logout();
        } catch {
          /* best-effort */
        }
      })();
    };
  }, [rtcClient, rtmClient, credentials]);

  // Subscribe to all events for debug panel
  useEffect(() => {
    let ai: AgoraVoiceAI;
    try {
      ai = AgoraVoiceAI.getInstance();
    } catch {
      return;
    }

    const onInterrupted = (agentUserId: string, event: unknown) =>
      pushLog('AGENT_INTERRUPTED', { agentUserId, event });

    const onDebug = (message: string) => pushLog('DEBUG_LOG', { message });

    const onSalStatus = (agentUserId: string, status: unknown) =>
      pushLog('MESSAGE_SAL_STATUS', { agentUserId, status });

    const onStateChanged = (agentUserId: string, event: unknown) =>
      pushLog('AGENT_STATE_CHANGED', { agentUserId, event });

    const onTranscript = (transcripts: unknown) =>
      pushLog('TRANSCRIPT_UPDATED', {
        count: Array.isArray(transcripts) ? transcripts.length : 0,
      });

    const onMetrics = (agentUserId: string, metrics: unknown) =>
      pushLog('AGENT_METRICS', { agentUserId, metrics });

    const onAgentError = (agentUserId: string, error: unknown) =>
      pushLog('AGENT_ERROR', { agentUserId, error });

    const onReceipt = (agentUserId: string, receipt: unknown) =>
      pushLog('MESSAGE_RECEIPT_UPDATED', { agentUserId, receipt });

    const onMsgError = (agentUserId: string, error: unknown) =>
      pushLog('MESSAGE_ERROR', { agentUserId, error });

    ai.on(AgoraVoiceAIEvents.AGENT_INTERRUPTED, onInterrupted);
    ai.on(AgoraVoiceAIEvents.DEBUG_LOG, onDebug);
    ai.on(AgoraVoiceAIEvents.MESSAGE_SAL_STATUS, onSalStatus);
    ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, onStateChanged);
    ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, onTranscript);
    ai.on(AgoraVoiceAIEvents.AGENT_METRICS, onMetrics);
    ai.on(AgoraVoiceAIEvents.AGENT_ERROR, onAgentError);
    ai.on(AgoraVoiceAIEvents.MESSAGE_RECEIPT_UPDATED, onReceipt);
    ai.on(AgoraVoiceAIEvents.MESSAGE_ERROR, onMsgError);

    return () => {
      ai.off(AgoraVoiceAIEvents.AGENT_INTERRUPTED, onInterrupted);
      ai.off(AgoraVoiceAIEvents.DEBUG_LOG, onDebug);
      ai.off(AgoraVoiceAIEvents.MESSAGE_SAL_STATUS, onSalStatus);
      ai.off(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, onStateChanged);
      ai.off(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, onTranscript);
      ai.off(AgoraVoiceAIEvents.AGENT_METRICS, onMetrics);
      ai.off(AgoraVoiceAIEvents.AGENT_ERROR, onAgentError);
      ai.off(AgoraVoiceAIEvents.MESSAGE_RECEIPT_UPDATED, onReceipt);
      ai.off(AgoraVoiceAIEvents.MESSAGE_ERROR, onMsgError);
    };
  }, [isConnected, pushLog]);

  // Poll getState() every 2s
  useEffect(() => {
    const id = setInterval(() => {
      setSdkState(AgoraVoiceAI.getState());
    }, 2000);
    setSdkState(AgoraVoiceAI.getState());
    return () => clearInterval(id);
  }, []);

  const sendMessage = useCallback(async (agentUserId: string, text: string) => {
    const ai = AgoraVoiceAI.getInstance();
    await ai.sendText(agentUserId, {
      messageType: ChatMessageType.TEXT,
      priority: ChatMessagePriority.INTERRUPTED,
      responseInterruptable: true,
      text,
    });
  }, []);

  const interrupt = useCallback(async (agentUserId: string) => {
    const ai = AgoraVoiceAI.getInstance();
    await ai.interrupt(agentUserId);
  }, []);

  const handleDisconnect = useCallback(() => {
    try {
      AgoraVoiceAI.getInstance().destroy();
    } catch {
      /* not initialized */
    }
    onDisconnect();
  }, [onDisconnect]);

  const contextValue = useMemo<SessionContextValue>(
    () => ({
      credentials,
      debugLog,
      sdkState,
      clearDebugLog,
      hasRtm: !!rtmClient,
      isConnected,
      sendMessage,
      interrupt,
    }),
    [credentials, debugLog, sdkState, clearDebugLog, rtmClient, isConnected, sendMessage, interrupt]
  );

  return (
    <SessionContext.Provider value={contextValue}>
      <div className="pg-session">
        {connectionError && (
          <div className="pg-connection-error">
            Connection error: {connectionError}
            <button onClick={() => setConnectionError(null)}>Dismiss</button>
          </div>
        )}
        <header className="pg-header">
          <StatusBar />
          <button className="pg-disconnect-btn" onClick={handleDisconnect}>
            Disconnect
          </button>
        </header>
        <div className="pg-main">
          <div className="pg-left">
            <TranscriptPanel />
            <ChatInput />
          </div>
          <div className="pg-right">
            <MetricsPanel />
            <DebugPanel />
          </div>
        </div>
        <ErrorToast />
      </div>
    </SessionContext.Provider>
  );
}
