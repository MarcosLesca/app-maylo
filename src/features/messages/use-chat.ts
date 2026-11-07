import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { showDialog } from '@/components/dialog';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/use-query';

import type { ChatMessage } from './chat-rows';

const COLUMNS = 'id, body, sender_id, created_at';
const HISTORY_LIMIT = 200;

const byDate = (a: ChatMessage, b: ChatMessage) => a.created_at.localeCompare(b.created_at);

async function listMessages(): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw error;
  return data.reverse();
}

/**
 * Chat state: loads the latest messages on focus and keeps them live through
 * Supabase Realtime. Messages are kept oldest first and never duplicated
 * (a sent message arrives both from the insert response and from Realtime).
 */
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const add = useCallback((message: ChatMessage) => {
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message].sort(byDate)));
  }, []);

  const removeLocal = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const reload = useCallback(async () => {
    try {
      setMessages(await listMessages());
    } catch (error) {
      showDialog('No se pudieron cargar los mensajes', errorMessage(error));
    }
  }, []);

  // Catch up on anything missed while the screen was away (sockets drop in background).
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  useEffect(() => {
    const channel = supabase
      .channel('messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) =>
        add(payload.new as ChatMessage),
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) =>
        removeLocal((payload.old as { id: string }).id),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [add, removeLocal]);

  /** Sends a message; resolves to false (keeping the draft) when it fails. */
  const send = useCallback(
    async (body: string) => {
      const { data, error } = await supabase.from('messages').insert({ body }).select(COLUMNS).single();
      if (error) {
        showDialog('No se pudo enviar el mensaje', errorMessage(error));
        return false;
      }
      add(data);
      return true;
    },
    [add],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('messages').delete().eq('id', id);
      if (error) showDialog('No se pudo borrar el mensaje', errorMessage(error));
      else removeLocal(id);
    },
    [removeLocal],
  );

  return { messages, send, remove };
}
