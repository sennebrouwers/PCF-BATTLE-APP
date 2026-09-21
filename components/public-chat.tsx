"use client";

import { useState } from "react";
import { Bot, MessageCircle, X } from "lucide-react";
import { publicCopy, usePublicLanguage } from "@/components/public-language";

export default function PublicChat() {
  const { language } = usePublicLanguage();
  const copy = publicCopy[language];
  const [open, setOpen] = useState(false), [text, setText] = useState("");
  const [msgs, setMsgs] = useState<string[]>(["Hi! Ask me about live matches, standings, the schedule or rules."]);
  async function send(q = text) {
    if (!q) return;
    setMsgs((v) => [...v, q]); setText("");
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: q, language }) });
      const out = await response.json();
      if (!response.ok) throw new Error();
      setMsgs((v) => [...v, out.answer]);
    } catch {
      setMsgs((v) => [...v, "I couldn’t reach the tournament data. Please contact the organisation at hello@pcfbattle.be for further assistance."]);
    }
  }
  return <><button className="chatfab" onClick={() => setOpen(!open)} aria-label={open ? "Close tournament assistant" : "Open tournament assistant"}>{open ? <X /> : <MessageCircle />}</button>{open && <aside className="chat"><div><Bot /> {copy.tournamentAssistant} <small>{copy.liveData}</small></div><section>{msgs.map((x, i) => <p className={i % 2 ? "you" : "bot"} key={`${i}-${x}`}>{x}</p>)}</section><nav><button onClick={() => send("Live matches")}>{copy.liveMatches}</button><button onClick={() => send("Standings")}>{copy.standings}</button></nav><form onSubmit={(e) => { e.preventDefault(); send(); }}><input value={text} onChange={(e) => setText(e.target.value)} placeholder={`${copy.question}…`} aria-label={copy.question} /><button>{copy.send}</button></form></aside>}</>;
}
