import { QuickAddField } from '@/components/quick-add-field';
import { Screen } from '@/components/screen';
import { CheckRow, Muted, SectionTitle } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { mutate, useQuery } from '@/lib/use-query';
import { showDialog } from '@/components/dialog';

type Task = { id: string; title: string; done: boolean; created_at: string };

async function listTasks(): Promise<Task[]> {
  const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export default function TasksScreen() {
  const { data: tasks, refreshing, refresh } = useQuery(null, listTasks, []);
  const add = (title: string) => mutate(() => supabase.from('tasks').insert({ title }), refresh);

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
    showDialog(`¿Eliminar "${task.title}"?`, undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => mutate(() => supabase.from('tasks').delete().eq('id', task.id), refresh) },
    ]);

  const pending = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <QuickAddField placeholder="Nueva tarea" onAdd={add} />

      <SectionTitle>Pendientes ({pending.length})</SectionTitle>
      {pending.length === 0 ? <Muted>Nada pendiente. Todo al día.</Muted> : null}
      {pending.map((task) => (
        <CheckRow key={task.id} checked={false} title={task.title} onToggle={() => toggle(task)} onLongPress={() => remove(task)} />
      ))}

      {done.length > 0 ? <SectionTitle>Hechas ({done.length})</SectionTitle> : null}
      {done.map((task) => (
        <CheckRow key={task.id} checked title={task.title} onToggle={() => toggle(task)} onLongPress={() => remove(task)} />
      ))}
      <Muted>Mantener presionada una tarea para eliminarla.</Muted>
    </Screen>
  );
}
