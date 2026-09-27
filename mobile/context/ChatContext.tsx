import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./AuthContext";
import axiosClient from "../lib/axiosClient";

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  // Only set on assistant messages - identifies the InquiryLog this reply
  // came from, needed to submit thumbs up/down feedback on it.
  logId?: number;
  feedback?: "up" | "down" | null;
};

export type Office = { office_id: number; name: string };

export type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
};

const TITLE_MAX_LENGTH = 40;

function makeTitle(messages: ChatMessage[]) {
  const firstUserMessage = messages.find((item) => item.role === "user")?.text ?? "New chat";
  return firstUserMessage.length > TITLE_MAX_LENGTH
    ? `${firstUserMessage.slice(0, TITLE_MAX_LENGTH)}...`
    : firstUserMessage;
}

type ChatContextValue = {
  messages: ChatMessage[];
  history: ChatSession[];
  isSending: boolean;
  offices: Office[];
  selectedOffice: Office | null;
  setSelectedOffice: (office: Office | null) => void;
  sendMessage: (text: string) => Promise<void>;
  submitFeedback: (logId: number, feedback: "up" | "down") => Promise<void>;
  startNewChat: () => void;
  resumeSession: (sessionId: string) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<ChatSession[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [offices, setOffices] = useState<Office[]>([]);
  const [selectedOffice, setSelectedOffice] = useState<Office | null>(null);

  // The category/office picker on the chat screen - fetched once per
  // logged-in session. Any authenticated role (including students) can read
  // this list per offices/permissions.py.
  useEffect(() => {
    if (!currentUser) {
      setOffices([]);
      return;
    }
    (async () => {
      try {
        const { data } = await axiosClient.get("/offices/");
        setOffices(data.results ?? data);
      } catch {
        setOffices([]);
      }
    })();
  }, [currentUser]);

  // Keyed per-user so one student's chat history never shows up for
  // another student logging into the same device.
  const storageKey = currentUser ? `chatdesk_chat_history_${currentUser.user_id}` : null;

  useEffect(() => {
    setMessages([]);
    setHistory([]);
    if (!storageKey) return;
    (async () => {
      const stored = await AsyncStorage.getItem(storageKey);
      if (!stored) return;
      try {
        setHistory(JSON.parse(stored));
      } catch {
        // Corrupted local cache - ignore and start fresh.
      }
    })();
  }, [storageKey]);

  const persistHistory = async (next: ChatSession[]) => {
    setHistory(next);
    if (storageKey) {
      await AsyncStorage.setItem(storageKey, JSON.stringify(next));
    }
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setIsSending(true);
    try {
      const { data } = await axiosClient.post("/chat/ask/", {
        message: trimmed,
        ...(selectedOffice ? { office: selectedOffice.office_id } : {}),
      });
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.reply, logId: data.log_id, feedback: null },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Chat isn't available yet - please check back soon." },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const submitFeedback = async (logId: number, feedback: "up" | "down") => {
    // Optimistic update - the vote UI shouldn't wait on the network round
    // trip, and a failure here isn't worth surfacing to the student.
    setMessages((prev) =>
      prev.map((m) => (m.logId === logId ? { ...m, feedback } : m))
    );
    try {
      await axiosClient.patch(`/chat/logs/${logId}/feedback/`, { feedback });
    } catch {
      // Non-critical - the student's vote just won't be recorded server-side.
    }
  };

  const startNewChat = () => {
    if (messages.length > 0) {
      const session: ChatSession = {
        id: Date.now().toString(),
        title: makeTitle(messages),
        messages,
        updatedAt: new Date().toISOString(),
      };
      persistHistory([session, ...history]);
    }
    setMessages([]);
    setSelectedOffice(null);
  };

  const resumeSession = (sessionId: string) => {
    const session = history.find((item) => item.id === sessionId);
    if (!session) return;

    let nextHistory = history.filter((item) => item.id !== sessionId);
    if (messages.length > 0) {
      const currentSession: ChatSession = {
        id: Date.now().toString(),
        title: makeTitle(messages),
        messages,
        updatedAt: new Date().toISOString(),
      };
      nextHistory = [currentSession, ...nextHistory];
    }

    persistHistory(nextHistory);
    setMessages(session.messages);
  };

  return (
    <ChatContext.Provider
      value={{
        messages,
        history,
        isSending,
        offices,
        selectedOffice,
        setSelectedOffice,
        sendMessage,
        submitFeedback,
        startNewChat,
        resumeSession,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}
