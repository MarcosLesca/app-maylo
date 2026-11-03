import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Button, CheckRow, Field, Muted, SectionTitle } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { mutate, useQuery } from '@/lib/use-query';

type Task = { id: string; title: string; done: boolean; created_at: string };

async function listTasks(): Promise<Task[]> {
  const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export default function TasksScreen() {
  const { data: tasks, refreshing, refresh } = useQuery(null, listTasks, []);
  const [title, setTitle] = useState('');

  const add = async () => {
    await mutate(() => supabase.from('tasks').insert({ title: title.trim() }), refresh);
    setTitle('');
  };

  const toggle = (task: Task) =>
    mutate(
      () =>
        supabase
          .from('tasks')
          .update({ done: !task.done, done_at: task.done ? null : new Date().toISOString() })
          .eq('id', task.id),
      refresh,
    );

  const remove = (task: Task) =>
    Alert.alert(`Delete "${task.title}"?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => mutate(() => supabase.from('tasks').delete().eq('id', task.id), refresh) },
    ]);

  const pending = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={styles.row}>
        <Field style={styles.flex} placeholder="New task" value={title} onChangeText={setTitle} onSubmitEditing={add} />
        <Button label="Add" onPress={add} disabled={!title.trim()} />
      </View>

      <SectionTitle>To do ({pending.length})</SectionTitle>
      {pending.length === 0 ? <Muted>Nothing pending 🎉</Muted> : null}
      {pending.map((task) => (
        <CheckRow key={task.id} checked={false} title={task.title} onToggle={() => toggle(task)} onLongPress={() => remove(task)} />
      ))}

      {done.length > 0 ? <SectionTitle>Done ({done.length})</SectionTitle> : null}
      {done.map((task) => (
        <CheckRow key={task.id} checked title={task.title} onToggle={() => toggle(task)} onLongPress={() => remove(task)} />
      ))}
      <Muted>Long-press a task to delete it.</Muted>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  flex: { flex: 1 },
});
