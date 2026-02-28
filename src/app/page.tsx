"use client";

import { useSocket } from "@/hooks/useSocket";
import Header from "@/components/header/Header";
import SessionList from "@/components/sidebar/SessionList";
import ChatArea from "@/components/chat/ChatArea";
import MessageInput from "@/components/chat/MessageInput";

export default function Home() {
  const { sendMessage, abort, rewind } = useSocket();

  return (
    <div className="h-screen flex flex-col">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <SessionList />
        <main className="flex-1 flex flex-col overflow-hidden">
          <ChatArea onRewind={rewind} onSendMessage={sendMessage} />
          <MessageInput onSend={sendMessage} onAbort={abort} />
        </main>
      </div>
    </div>
  );
}
