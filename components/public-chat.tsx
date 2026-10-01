"use client";

import { useState } from "react";
import { Bot, MessageCircle, X } from "lucide-react";
import { publicCopy, usePublicLanguage } from "@/components/public-language";
import { clientApi } from "@/lib/api-client";
import { PUBLIC_CONTACT_EMAIL } from "@/lib/public-organization";

export default function PublicChat() {
  const { language } = usePublicLanguage();
  const copy = publicCopy[language];
  const [open, setOpen] = useState(false), [text, setText] = useState("");
  const greeting = language === "nl"
    ? "Hallo! Ik ben de PCF Battle informatie-assistent. Vraag me over wedstrijden, standen, inschrijving of praktische informatie."
    : "Hi! I’m the PCF Battle information assistant. Ask me about matches, standings, registration or practical information.";
  const [msgs, setMsgs] = useState<string[]>([]);
  async function send(q = text) {
    if (!q) return;
    setMsgs((v) => [...(v.length ? v : [greeting]), q]); setText("");
    try {
      const out = await clientApi<{ answer?: string }>("/chat", { method: "POST", body: JSON.stringify({ message: q, language }) });
      setMsgs((v) => [...v, out.answer || ""]);
    } catch {
      setMsgs((v) => [...v, `I couldn’t reach the tournament data. Please contact the organisation at ${PUBLIC_CONTACT_EMAIL} for further assistance.`]);
    }
  }
  return <><button className="chatfab" onClick={() => setOpen(!open)} aria-label={open ? "Close tournament assistant" : "Open tournament assistant"}>{open ? <X /> : <MessageCircle />}</button>{open && <aside className="chat"><div><Bot /> {copy.tournamentAssistant} <small>{copy.liveData}</small></div><section>{(msgs.length ? msgs : [greeting]).map((x, i) => <p className={i % 2 ? "you" : "bot"} key={`${i}-${x}`}>{x}</p>)}</section><nav><button onClick={() => send("Live matches")}>{copy.liveMatches}</button><button onClick={() => send("Standings")}>{copy.standings}</button></nav><form onSubmit={(e) => { e.preventDefault(); send(); }}><input value={text} onChange={(e) => setText(e.target.value)} placeholder={`${copy.question}…`} aria-label={copy.question} /><button>{copy.send}</button></form></aside>}</>;
}
