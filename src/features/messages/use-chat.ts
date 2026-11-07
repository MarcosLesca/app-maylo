import { File } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { showDialog } from '@/components/dialog';
import { randomId, type Photo } from '@/lib/photos';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/use-query';

import type { ChatMessage } from './chat-rows';

export const CHAT_IMAGES_BUCKET = 'chat-images';

const COLUMNS = 'id, body, sender_id, created_at, image_path, image_width, image_height, delivered_at';
const HISTORY_LIMIT = 200;
const SIGNED_URL_SECONDS = 60 * 60;

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

async function uploadPhoto(userId: string, photo: Photo): Promise<string> {
  // One folder per sender: storage policies only allow writing in your own.
  const path = `${userId}/${randomId()}.${photo.extension}`;
  const bytes = await new File(photo.uri).arrayBuffer();
  const { error } = await supabase.storage
    .from(CHAT_IMAGES_BUCKET)
    .upload(path, bytes, { contentType: photo.mimeType, upsert: false });
  if (error) throw error;
  return path;
}

/**
 * Chat state: loads the latest messages on focus and keeps them live through
 * Supabase Realtime. Messages are kept oldest first and never duplicated
 * (a sent message arrives both from the insert response and from Realtime).
 * Photos are private, so their signed URLs are fetched in batches and cached.
 */
export function useChat(userId: string | undefined) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const add = useCallback((message: ChatMessage) => {
    setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message].sort(byDate)));
  }, []);

  // Delivery stamps arrive as UPDATEs: merge them into the message we already have.
  const update = useCallback((changed: ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === changed.id ? { ...m, ...changed } : m)));
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
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) =>
        update(payload.new as ChatMessage),
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, (payload) =>
        removeLocal((payload.old as { id: string }).id),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [add, update, removeLocal]);

  // Sign URLs for photos we have not signed yet, in one request.
  useEffect(() => {
    const missing = messages.map((m) => m.image_path).filter((p): p is string => !!p && !imageUrls[p]);
    if (missing.length === 0) return;
    supabase.storage
      .from(CHAT_IMAGES_BUCKET)
      .createSignedUrls(missing, SIGNED_URL_SECONDS)
      .then(({ data }) => {
        const signed: Record<string, string> = {};
        for (const item of data ?? []) if (item.path && item.signedUrl) signed[item.path] = item.signedUrl;
        if (Object.keys(signed).length > 0) setImageUrls((prev) => ({ ...prev, ...signed }));
      });
  }, [messages, imageUrls]);

  /** Sends text, a photo, or both; resolves to false (keeping the draft) when it fails. */
  const send = useCallback(
    async (body: string | null, photo?: Photo) => {
      if (!userId) return false;
      let imagePath: string | null = null;
      try {
        if (photo) imagePath = await uploadPhoto(userId, photo);
        const { data, error } = await supabase
          .from('messages')
          .insert({
            body,
            image_path: imagePath,
            image_width: photo?.width ?? null,
            image_height: photo?.height ?? null,
          })
          .select(COLUMNS)
          .single();
        if (error) throw error;
        add(data);
        return true;
      } catch (error) {
        // Do not leave an orphan photo if the message could not be saved.
        if (imagePath) await supabase.storage.from(CHAT_IMAGES_BUCKET).remove([imagePath]);
        showDialog('No se pudo enviar el mensaje', errorMessage(error));
        return false;
      }
    },
    [add, userId],
  );

  const remove = useCallback(
    async (message: ChatMessage) => {
      const { error } = await supabase.from('messages').delete().eq('id', message.id);
      if (error) {
        showDialog('No se pudo borrar el mensaje', errorMessage(error));
        return;
      }
      if (message.image_path) await supabase.storage.from(CHAT_IMAGES_BUCKET).remove([message.image_path]);
      removeLocal(message.id);
    },
    [removeLocal],
  );

  return { messages, imageUrls, send, remove };
}
