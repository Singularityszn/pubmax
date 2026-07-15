"use client";

import { useState } from "react";
import { ConversationProvider, useConversationControls, useConversationStatus } from "@elevenlabs/react";
import { Mic, MicOff, Send } from "lucide-react";
import { authedFetch } from "@/lib/authedFetch";

function VoiceControls() {
  const { startSession, endSession, sendUserMessage } = useConversationControls();
  const { status } = useConversationStatus();
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const start = async () => {
    setError(null);
    try {
      const response = await authedFetch("/api/pub-pal/voice-token", { method: "POST" });
      const body = await response.json() as { signedUrl?: string; error?: string };
      if (!response.ok || !body.signedUrl) { setError(body.error ?? "Voice is unavailable. Use text instead."); return; }
      startSession({ signedUrl: body.signedUrl, connectionType: "websocket", onError: (message) => setError(String(message)) });
    } catch { setError("Voice is unavailable. Use text instead."); }
  };
  const send = () => { const value = text.trim(); if (!value) return; sendUserMessage(value); setText(""); };
  return <div className="palVoice"><div className="palVoiceStatus" role="status"><i className={status === "connected" ? "isLive" : ""}/>{status === "connected" ? "Pal is listening" : "Voice ready when you are"}</div><div className="palVoiceActions">{status === "connected" ? <button onClick={endSession}><MicOff size={18}/> End</button> : <button onClick={start}><Mic size={18}/> Push to talk</button>}<label><span className="srOnly">Message your Pub Pal</span><input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") send(); }} placeholder="Or type the night you want…"/><button onClick={send} aria-label="Send message"><Send size={17}/></button></label></div>{error && <p className="palVoiceError" role="alert">{error}</p>}<p className="palVoicePrivacy">No audio or transcript becomes memory. The Pal proposes facts for you to approve separately.</p></div>;
}

export default function PubPalVoice() { return <ConversationProvider><VoiceControls/></ConversationProvider>; }
