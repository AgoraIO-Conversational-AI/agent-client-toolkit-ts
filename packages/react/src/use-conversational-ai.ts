declare const process: { env?: { NODE_ENV?: string } } | undefined;

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRTCClient } from 'agora-rtc-react';
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  ChatMessageType,
  ChatMessagePriority,
  ModuleType,
  type AgoraVoiceAIConfig,
  type TranscriptHelperItem,
  type UserTranscription,
  type AgentTranscription,
  type AgentState,
  type StateChangeEvent,
  type AgentMetric,
  type ModuleError,
  type MessageReceipt,
} from 'agora-agent-client-toolkit';
import { AgoraVoiceAIContext } from './context';

export interface UseConversationalAIConfig extends Omit<AgoraVoiceAIConfig, 'rtcEngine'> {
  /**
   * The Agora channel name to subscribe to.
   * Changing this value triggers a full re-subscribe cycle.
   */
  channel: string;
}

export interface UseConversationalAIReturn {
  /** Full transcript history. Updates on every TRANSCRIPT_UPDATED event. */
  transcript: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[];
  /** Current agent state. Null until the first AGENT_STATE_CHANGED event. */
  agentState: AgentState | null;
  /** True when subscribeMessage has been called and the session is active. */
  isConnected: boolean;
  /** The most recent error from AGENT_ERROR, or null. */
  error: ModuleError | null;
  /**
   * Send an interrupt signal to the agent.
   * @remarks Requires `rtmConfig` to be present in the hook config.
   * Throws `[AgoraVoiceAI] This method requires RTM.` when called without RTM.
   */
  interrupt: (agentUserId: string) => Promise<void>;
  /**
   * Trigger a manual start-of-speech marker.
   * @returns The request ID used to correlate the later USER_MANUAL_SOS event.
   * @remarks Requires `rtmConfig` to be present in the hook config.
   */
  manualSOS: (agentUserId: string, requestId?: string) => Promise<string>;
  /**
   * Trigger a manual end-of-speech marker.
   * @returns The request ID used to correlate the later USER_MANUAL_EOS event.
   * @remarks Requires `rtmConfig` to be present in the hook config.
   */
  manualEOS: (agentUserId: string, requestId?: string) => Promise<string>;
  /**
   * Send a plain-text message to the agent.
   * @remarks Requires `rtmConfig` to be present in the hook config.
   * Throws `[AgoraVoiceAI] This method requires RTM.` when called without RTM.
   */
  sendMessage: (agentUserId: string, text: string) => Promise<void>;
  /** Latest agent metrics. Null until the first AGENT_METRICS event. */
  metrics: AgentMetric | null;
  /** Latest message receipt. Null until the first MESSAGE_RECEIPT_UPDATED event. */
  messageReceipt: MessageReceipt | null;
}

/** Internal return type that includes the AI instance for context provision. */
interface UseConversationalAICoreReturn extends UseConversationalAIReturn {
  aiInstance: AgoraVoiceAI | null;
}

function requireReadyInstance(instance: AgoraVoiceAI | null): AgoraVoiceAI {
  if (!instance) {
    throw new Error('[ConversationalAI] AgoraVoiceAI instance is not initialized yet.');
  }
  return instance;
}

/**
 * Internal hook containing all lifecycle logic. Used by both the public
 * `useConversationalAI` hook and the `ConversationalAIProvider` component.
 */
function useConversationalAICore(config: UseConversationalAIConfig): UseConversationalAICoreReturn {
  const rtcClient = useRTCClient();

  // Dev-mode warning: detect unstable config objects that cause unnecessary re-init
  const configRef = useRef(config);
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      configRef.current = config;
      return;
    }
    if (typeof process !== 'undefined' && process?.env?.NODE_ENV !== 'production') {
      if (configRef.current !== config && configRef.current.channel === config.channel) {
        console.warn(
          '[useConversationalAI] Config object changed identity but channel is the same. ' +
            'Wrap your config in useMemo() to avoid unnecessary re-initialization. ' +
            'See: https://react.dev/reference/react/useMemo'
        );
      }
    }
    configRef.current = config;
  }, [config]);

  const [transcript, setTranscript] = useState<
    TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[]
  >([]);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<ModuleError | null>(null);
  const [metrics, setMetrics] = useState<AgentMetric | null>(null);
  const [messageReceipt, setMessageReceipt] = useState<MessageReceipt | null>(null);
  const [aiInstance, setAiInstance] = useState<AgoraVoiceAI | null>(null);

  // Stable ref to the AgoraVoiceAI instance so callbacks can access it without
  // being re-created on each render.
  const aiRef = useRef<AgoraVoiceAI | null>(null);

  useEffect(() => {
    if (!rtcClient) return;

    // Track whether the effect was cleaned up before init() resolved (e.g.
    // during React StrictMode double-invoke or a fast channel change).
    let cancelled = false;

    // --- event handlers defined here so both the async setup and cleanup
    //     can reference the same stable function objects. ---

    const handleTranscript = (
      t: TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[]
    ) => setTranscript(t);

    const handleStateChange = (_agentUserId: string, event: StateChangeEvent) =>
      setAgentState(event.state);

    const handleError = (_agentUserId: string, err: ModuleError) => setError(err);

    const handleMetrics = (_agentUserId: string, m: AgentMetric) => setMetrics(m);

    const handleReceipt = (_agentUserId: string, receipt: MessageReceipt) =>
      setMessageReceipt(receipt);

    // AgoraVoiceAI.init() is async — use an IIFE so the effect callback
    // itself remains synchronous (returns a cleanup fn, not a Promise).
    (async () => {
      try {
        // Initialize with the RTC client obtained from AgoraRTCProvider.
        const ai = await AgoraVoiceAI.init({
          ...config,
          rtcEngine: rtcClient,
        });

        if (cancelled) {
          // Component unmounted before init resolved — only tear down if
          // this effect's instance is still the active singleton. In
          // StrictMode, the second mount may have already replaced it.
          try {
            if (AgoraVoiceAI.getInstance() === ai) {
              ai.unsubscribe();
              ai.destroy();
            }
          } catch {
            // getInstance() throws if already destroyed — nothing to clean up
          }
          return;
        }

        aiRef.current = ai;
        setAiInstance(ai);

        ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, handleTranscript);
        ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, handleStateChange);
        ai.on(AgoraVoiceAIEvents.AGENT_ERROR, handleError);
        ai.on(AgoraVoiceAIEvents.AGENT_METRICS, handleMetrics);
        ai.on(AgoraVoiceAIEvents.MESSAGE_RECEIPT_UPDATED, handleReceipt);
        // AGENT_INTERRUPTED, DEBUG_LOG, MESSAGE_ERROR, MESSAGE_SAL_STATUS are not
        // exposed in the hook return value. Consumers who need them can call
        // AgoraVoiceAI.getInstance().on(...) directly.

        ai.subscribeMessage(config.channel);
        setIsConnected(true);
      } catch (err) {
        if (!cancelled) {
          setError({
            type: ModuleType.UNKNOWN,
            code: -1,
            message: `AgoraVoiceAI.init() failed: ${err instanceof Error ? err.message : String(err)}. Check that your rtcEngine is a valid Agora RTC client instance.`,
            timestamp: Date.now(),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      const ai = aiRef.current;
      if (ai) {
        // Only tear down if this effect's instance is still the active
        // singleton. In StrictMode, the second mount may have already replaced it.
        try {
          if (AgoraVoiceAI.getInstance() === ai) {
            ai.off(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, handleTranscript);
            ai.off(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, handleStateChange);
            ai.off(AgoraVoiceAIEvents.AGENT_ERROR, handleError);
            ai.off(AgoraVoiceAIEvents.AGENT_METRICS, handleMetrics);
            ai.off(AgoraVoiceAIEvents.MESSAGE_RECEIPT_UPDATED, handleReceipt);
            ai.unsubscribe();
            ai.destroy();
          }
        } catch {
          // getInstance() throws if already destroyed — nothing to clean up
        }
        aiRef.current = null;
      }
      setAiInstance(null);
      setIsConnected(false);
    };
  }, [rtcClient, config.channel]);

  const interrupt = useCallback(async (agentUserId: string) => {
    await aiRef.current?.interrupt(agentUserId);
  }, []);

  const manualSOS = useCallback(async (agentUserId: string, requestId?: string) => {
    return requireReadyInstance(aiRef.current).manualSOS(agentUserId, requestId);
  }, []);

  const manualEOS = useCallback(async (agentUserId: string, requestId?: string) => {
    return requireReadyInstance(aiRef.current).manualEOS(agentUserId, requestId);
  }, []);

  const sendMessage = useCallback(async (agentUserId: string, text: string) => {
    await aiRef.current?.sendText(agentUserId, {
      messageType: ChatMessageType.TEXT,
      priority: ChatMessagePriority.INTERRUPTED,
      responseInterruptable: true,
      text,
    });
  }, []);

  return {
    transcript,
    agentState,
    isConnected,
    error,
    interrupt,
    manualSOS,
    manualEOS,
    sendMessage,
    metrics,
    messageReceipt,
    aiInstance,
  };
}

/**
 * Flagship hook for Agora Conversational AI sessions.
 *
 * Manages the full connection lifecycle (init → subscribeMessage on mount,
 * unsubscribe → destroy on unmount) and exposes transcript, agent state,
 * and controls in a single hook.
 *
 * Must be rendered inside an `AgoraRTCProvider` (from `agora-rtc-react`)
 * so that `useRTCClient()` can resolve the Agora client.
 *
 * @remarks
 * **Dependency array:** This hook depends on `rtcClient` (from the provider)
 * and `config.channel`. The full `config` object is intentionally excluded
 * from the dependency array — wrap `config` in `useMemo` if it is constructed
 * inline to prevent unnecessary re-subscribe cycles.
 *
 * @example
 * function ConversationalApp() {
 *   const config = useMemo(() => ({
 *     channel: 'my-channel',
 *     rtmConfig: { rtmEngine: myRtmClient },
 *     renderMode: TranscriptHelperMode.WORD,
 *   }), []);
 *
 *   const { transcript, agentState, interrupt } = useConversationalAI(config);
 *   // ...
 * }
 */
export function useConversationalAI(config: UseConversationalAIConfig): UseConversationalAIReturn {
  const { aiInstance: _, ...hookReturn } = useConversationalAICore(config);
  return hookReturn;
}

/**
 * Provider component that manages the AgoraVoiceAI lifecycle and exposes
 * the AI instance via React context to standalone hooks (`useTranscript`,
 * `useAgentState`, `useAgentError`, `useAgentMetrics`).
 *
 * Use this instead of `useConversationalAI` when you have standalone hooks
 * in child components that need access to the AI instance.
 *
 * Must be rendered inside an `AgoraRTCProvider` (from `agora-rtc-react`).
 *
 * @example
 * function App() {
 *   const config = useMemo(() => ({ channel: 'my-channel' }), []);
 *   return (
 *     <AgoraRTCProvider client={rtcClient}>
 *       <ConversationalAIProvider config={config}>
 *         <TranscriptPanel />
 *         <StatusBar />
 *       </ConversationalAIProvider>
 *     </AgoraRTCProvider>
 *   );
 * }
 */
export function ConversationalAIProvider({
  config,
  children,
}: {
  /** Hook config forwarded to `useConversationalAI` core lifecycle logic. */
  config: UseConversationalAIConfig;
  /** React subtree that can consume standalone hooks via context. */
  children: React.ReactNode;
}): React.ReactElement {
  const { aiInstance } = useConversationalAICore(config);

  return React.createElement(AgoraVoiceAIContext.Provider, { value: aiInstance }, children);
}
