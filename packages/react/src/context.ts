import { createContext, useCallback, useContext } from 'react';
import {
  type AgoraVoiceAI,
  ChatMessageType,
  ChatMessagePriority,
} from 'agora-agent-client-toolkit';

export const AgoraVoiceAIContext = createContext<AgoraVoiceAI | null>(null);

/**
 * Returns the AgoraVoiceAI instance from the nearest provider,
 * or null if useConversationalAI hasn't initialized yet.
 *
 * Internal — used by standalone hooks (useTranscript, useAgentState, etc.).
 */
export function useAgoraVoiceAIInstance(): AgoraVoiceAI | null {
  return useContext(AgoraVoiceAIContext);
}

/**
 * Controls returned by `useConversationalAIContext`.
 */
export interface ConversationalAIContextValue {
  /** Send an interrupt signal to the agent. Requires RTM. */
  interrupt: (agentUserId: string) => Promise<void>;
  /** Trigger a manual start-of-speech marker. Requires RTM. */
  manualSOS: (agentUserId: string, requestId?: string) => Promise<string>;
  /** Trigger a manual end-of-speech marker. Requires RTM. */
  manualEOS: (agentUserId: string, requestId?: string) => Promise<string>;
  /** Send a plain-text message to the agent. Requires RTM. */
  sendMessage: (agentUserId: string, text: string) => Promise<void>;
  /** The underlying AgoraVoiceAI instance, or null if not yet initialized. */
  instance: AgoraVoiceAI | null;
}

function requireReadyInstance(instance: AgoraVoiceAI | null): AgoraVoiceAI {
  if (!instance) {
    throw new Error('[ConversationalAI] AgoraVoiceAI instance is not initialized yet.');
  }
  return instance;
}

/**
 * Context-consuming hook for components inside a `ConversationalAIProvider`.
 *
 * Returns `sendMessage` and `interrupt` without requiring config — the
 * provider already manages the AgoraVoiceAI lifecycle.
 *
 * This is the recommended way for child components to access controls.
 * For transcript and state data, use the standalone hooks (`useTranscript`,
 * `useAgentState`, etc.) instead.
 *
 * @throws Error if used outside a ConversationalAIProvider
 *
 * @example
 * ```tsx
 * function ChatInput({ agentUid }: { agentUid: string }) {
 *   const { sendMessage, interrupt } = useConversationalAIContext();
 *   // ...
 * }
 * ```
 */
export function useConversationalAIContext(): ConversationalAIContextValue {
  const instance = useContext(AgoraVoiceAIContext);

  const interrupt = useCallback(
    async (agentUserId: string) => {
      await instance?.interrupt(agentUserId);
    },
    [instance]
  );

  const manualSOS = useCallback(
    async (agentUserId: string, requestId?: string) => {
      return requireReadyInstance(instance).manualSOS(agentUserId, requestId);
    },
    [instance]
  );

  const manualEOS = useCallback(
    async (agentUserId: string, requestId?: string) => {
      return requireReadyInstance(instance).manualEOS(agentUserId, requestId);
    },
    [instance]
  );

  const sendMessage = useCallback(
    async (agentUserId: string, text: string) => {
      await instance?.sendText(agentUserId, {
        messageType: ChatMessageType.TEXT,
        priority: ChatMessagePriority.INTERRUPTED,
        responseInterruptable: true,
        text,
      });
    },
    [instance]
  );

  return { interrupt, manualSOS, manualEOS, sendMessage, instance };
}
