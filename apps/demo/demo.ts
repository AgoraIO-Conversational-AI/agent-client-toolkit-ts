/**
 * Demo: How to use agora-agent-client-toolkit
 *
 * This demo demonstrates the complete workflow:
 * 1. Create RTC + RTM clients
 * 2. Initialize AgoraVoiceAI (async)
 * 3. Register event listeners
 * 4. Join channel, publish audio, subscribe to AI messages
 */

import AgoraRTC from 'agora-rtc-sdk-ng';
import AgoraRTM from 'agora-rtm';
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  ChatMessageType,
  ChatMessagePriority,
  ThinkListeningAction,
  TranscriptHelperMode,
  AgentState,
} from 'agora-agent-client-toolkit';
// ========================================
// Configuration - Replace with your values
// ========================================
const CONFIG = {
  appId: 'YOUR_AGORA_APP_ID', // Get from Agora Console
  rtcToken: 'YOUR_RTC_TOKEN', // Generate from your backend or Agora Console
  rtmToken: 'YOUR_RTM_TOKEN', // Generate from your backend or Agora Console
  channelName: 'voice-ai-demo', // Your channel name
  userId: 'user_' + Math.floor(Math.random() * 10000), // Unique user ID
  agentUserId: '46307123', // The AI agent's user ID
};

// ========================================
// Step 1: Initialize RTC Client
// ========================================

// Enable PTS metadata for word-level transcription timestamps.
// Must be called before createClient().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(AgoraRTC as any).setParameter('ENABLE_AUDIO_PTS_METADATA', true);

const rtcClient = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

console.log('✓ RTC Client created');

// ========================================
// Step 2: Initialize RTM Client
// ========================================

const rtmClient = new AgoraRTM.RTM(CONFIG.appId, CONFIG.userId);

console.log('✓ RTM Client created');

// ========================================
// Step 3: Initialize AgoraVoiceAI (async)
// ========================================

/**
 * AgoraVoiceAI.init() is async — it awaits the optional metrics reporter.
 * Call it inside an async function (shown in main() below).
 *
 * Options:
 * - rtcEngine: Your RTC client instance (required)
 * - rtmEngine: Optional RTM client — omit to run RTC-only
 *   (sendText, sendImage, speak, think, and interrupt will throw if RTM is absent)
 * - renderMode: Transcript rendering mode (TEXT, WORD, CHUNK, AUTO, UNKNOWN)
 * - enableLog:  Enable debug logging
 * - enableAgoraMetrics: Load @agora-js/report dynamically (default: false)
 */
async function initVoiceAI() {
  const voiceAI = await AgoraVoiceAI.init({
    rtcEngine: rtcClient,
    rtmEngine: rtmClient,
    renderMode: TranscriptHelperMode.TEXT,
    enableLog: true,
  });

  console.log('✓ AgoraVoiceAI initialized');
  return voiceAI;
}

// ========================================
// Step 4: Register Event Listeners
// ========================================

function registerListeners(voiceAI: AgoraVoiceAI) {
  /**
   * TRANSCRIPT_UPDATED: returns COMPLETE conversation list each time.
   * Replace your entire UI list — do not append.
   */
  voiceAI.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (transcripts) => {
    console.log('📝 Transcript updated:', transcripts);
    transcripts.forEach((item) => {
      console.log(`  [${item.uid}]: ${item.text || '...'}`);
    });
  });

  voiceAI.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (agentUserId, event) => {
    console.log(`🤖 Agent ${agentUserId} state changed:`, event.state);
    switch (event.state) {
      case AgentState.IDLE:
        console.log('  Agent is idle');
        break;
      case AgentState.LISTENING:
        console.log('  Agent is listening...');
        break;
      case AgentState.THINKING:
        console.log('  Agent is thinking...');
        break;
      case AgentState.SPEAKING:
        console.log('  Agent is speaking...');
        break;
      case AgentState.SILENT:
        console.log('  Agent is silent');
        break;
    }
  });

  voiceAI.on(AgoraVoiceAIEvents.AGENT_METRICS, (agentUserId, metrics) => {
    console.log(`📊 Agent ${agentUserId} metrics:`, metrics);
  });

  voiceAI.on(AgoraVoiceAIEvents.AGENT_ERROR, (agentUserId, error) => {
    console.error(`❌ Agent ${agentUserId} error:`, error);
  });

  voiceAI.on(AgoraVoiceAIEvents.AGENT_INTERRUPTED, (agentUserId, event) => {
    console.log(`⏸️ Agent ${agentUserId} interrupted:`, event);
  });

  voiceAI.on(AgoraVoiceAIEvents.MESSAGE_RECEIPT_UPDATED, (agentUserId, receipt) => {
    console.log(`✅ Message receipt from ${agentUserId}:`, receipt);
  });

  voiceAI.on(AgoraVoiceAIEvents.MESSAGE_ERROR, (agentUserId, error) => {
    console.error(`❌ Message error for ${agentUserId}:`, error);
  });

  voiceAI.on(AgoraVoiceAIEvents.DEBUG_LOG, (message) => {
    console.debug('🔍 Debug:', message);
  });

  console.log('✓ Event listeners registered');
}

// ========================================
// Step 5: Join RTC Channel and Login to RTM
// ========================================

async function setupConnection() {
  await rtmClient.login({ token: CONFIG.rtmToken });
  console.log('✓ RTM login successful');

  await rtcClient.join(CONFIG.appId, CONFIG.channelName, CONFIG.rtcToken, CONFIG.userId);
  console.log('✓ RTC channel joined');

  const localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
  await rtcClient.publish([localAudioTrack]);
  console.log('✓ Local audio published');

  rtcClient.on('user-published', async (user, mediaType) => {
    if (mediaType === 'audio') {
      await rtcClient.subscribe(user, mediaType);
      user.audioTrack?.play();
      console.log(`✓ Subscribed to ${user.uid}'s audio`);
    }
  });
}

// ========================================
// Step 6-8: Voice AI start / send / cleanup
// ========================================

function startVoiceAI(voiceAI: AgoraVoiceAI) {
  voiceAI.subscribeMessage(CONFIG.channelName);
  console.log('✓ Subscribed to voice AI messages');
}

async function sendTextMessage(voiceAI: AgoraVoiceAI, text: string) {
  console.log(`💬 Sending text: "${text}"`);
  await voiceAI.chat(CONFIG.agentUserId, {
    messageType: ChatMessageType.TEXT,
    text,
    priority: ChatMessagePriority.INTERRUPTED,
    responseInterruptable: true,
  });
  console.log('✓ Text message sent');
}

async function sendImageMessage(voiceAI: AgoraVoiceAI, imageUrl: string) {
  console.log(`🖼️ Sending image: ${imageUrl}`);
  await voiceAI.chat(CONFIG.agentUserId, {
    messageType: ChatMessageType.IMAGE,
    uuid: 'img_' + Date.now(),
    url: imageUrl,
  });
  console.log('✓ Image message sent');
}

async function speakMessage(voiceAI: AgoraVoiceAI, text: string) {
  await voiceAI.speak(CONFIG.agentUserId, {
    text,
    priority: ChatMessagePriority.INTERRUPTED,
    interruptable: true,
  });
  console.log('✓ Speak message sent');
}

async function thinkMessage(voiceAI: AgoraVoiceAI, text: string) {
  await voiceAI.think(CONFIG.agentUserId, {
    text,
    onListeningAction: ThinkListeningAction.INTERRUPT,
    metadata: { source: 'vanilla-demo' },
  });
  console.log('✓ Think message sent');
}

async function interruptAgent(voiceAI: AgoraVoiceAI) {
  console.log('⏸️ Interrupting agent...');
  await voiceAI.interrupt(CONFIG.agentUserId);
  console.log('✓ Interrupt sent');
}

async function cleanup(voiceAI: AgoraVoiceAI) {
  voiceAI.unsubscribe();
  await rtcClient.leave();
  await rtmClient.logout();
  voiceAI.destroy();
  console.log('✓ Cleanup complete');
}

// ========================================
// Main Demo Flow
// ========================================

async function main() {
  try {
    console.log('🚀 Starting Agora Conversational AI Toolkit Demo...\n');

    const voiceAI = await initVoiceAI();
    registerListeners(voiceAI);
    await setupConnection();
    startVoiceAI(voiceAI);

    console.log('\n✅ Demo setup complete!\n');

    setTimeout(() => sendTextMessage(voiceAI, 'Hello! Can you introduce yourself?'), 2000);
    setTimeout(() => sendTextMessage(voiceAI, 'What can you help me with?'), 10000);
    setTimeout(() => interruptAgent(voiceAI), 15000);
    setTimeout(() => sendImageMessage(voiceAI, 'https://example.com/sample-image.jpg'), 20000);
    setTimeout(async () => {
      await cleanup(voiceAI);
      console.log('\n👋 Demo ended');
    }, 30000);
  } catch (error) {
    console.error('❌ Demo failed:', error);
  }
}

export {
  main,
  sendTextMessage,
  sendImageMessage,
  speakMessage,
  thinkMessage,
  interruptAgent,
  cleanup,
};

// Uncomment to run automatically:
// main();
