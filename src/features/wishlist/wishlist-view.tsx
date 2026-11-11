import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { showDialog } from '@/components/dialog';
import { Icon } from '@/components/icon';
import { MonthPicker } from '@/components/month-picker';
import { QuickAddField } from '@/components/quick-add-field';
import { CheckRow, Muted, SectionTitle } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatPeriod } from '@/lib/period';
import { mutate } from '@/lib/use-query';

import { groupWishlist, type WishItem } from './wishlist';
import { addWish, deleteWish, setEaten, setPlannedMonth } from './wishlist-api';

type WishlistViewProps = { items: WishItem[]; refresh: () => Promise<void> };

/** Everything we want to eat: pending ones grouped by planned month, eaten ones crossed out. */
export function WishlistView({ items, refresh }: WishlistViewProps) {
  const [planning, setPlanning] = useState<WishItem | null>(null);
  const { pending, eaten } = groupWishlist(items);
  const pendingCount = items.length - eaten.length;

  const confirmDelete = (item: WishItem) =>
    showDialog(`¿Eliminar "${item.name}"?`, undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: () => mutate(() => deleteWish(item), refresh) },
    ]);

  const row = (item: WishItem) => (
    <CheckRow
      key={item.id}
      checked={item.eaten}
      title={item.name}
      onToggle={() => mutate(() => setEaten(item, !item.eaten), refresh)}
      onLongPress={() => confirmDelete(item)}
      right={item.eaten ? undefined : <MonthChip month={item.planned_month} onPress={() => setPlanning(item)} />}
    />
  );

  return (
    <>
      <Muted>
        {items.length === 0
          ? 'Anotá todo lo que quieran comer. Tocá para tacharlo cuando lo coman.'
          : `${eaten.length} de ${items.length} comidas · ${pendingCount} pendientes`}
      </Muted>
      <QuickAddField placeholder="Agregar algo para comer" onAdd={(name) => mutate(() => addWish(name), refresh)} />

      {pending.map((section) => (
        <View key={section.month ?? 'none'} style={styles.section}>
          <SectionTitle icon="calendar">{section.month ? formatPeriod(section.month) : 'Sin mes'}</SectionTitle>
          {section.items.map(row)}
        </View>
      ))}

      {eaten.length > 0 ? (
        <View style={styles.section}>
          <SectionTitle icon="check">Ya comimos ({eaten.length})</SectionTitle>
          {eaten.map(row)}
        </View>
      ) : null}

      {items.length > 0 ? <Muted>Tocá el mes para organizarlo. Mantené presionado para eliminar.</Muted> : null}

      {planning ? (
        <MonthPicker
          title={`¿En qué mes comemos "${planning.name}"?`}
          value={planning.planned_month}
          onClose={() => setPlanning(null)}
          onSelect={(month) => mutate(() => setPlannedMonth(planning, month), refresh)}
        />
      ) : null}
    </>
  );
}

function MonthChip({ month, onPress }: { month: string | null; onPress: () => void }) {
  const theme = useTheme();
  const label = month ? formatPeriod(month).replace(/^(\w{3})\w*/, '$1') : 'Mes';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={month ? `Planeado para ${formatPeriod(month)}` : 'Elegir mes'}
      hitSlop={8}
      onPress={onPress}
      style={[styles.chip, month ? { backgroundColor: theme.accentSoft } : { borderColor: theme.accent, borderWidth: 1 }]}>
      <Icon name="calendar" color={theme.accentText} size={14} />
      <Text style={[styles.chipText, { color: theme.accentText }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
  chipText: { fontSize: 13, fontWeight: '600' },
});
