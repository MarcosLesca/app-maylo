import { useRef, useState } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { clampSeek, formatClock, spokenTime } from '@/features/cast/time';

type Props = {
  position: number | null;
  duration: number | null;
  disabled: boolean;
  /** Called once, on release, with the clamped target in seconds. */
  onSeek: (seconds: number) => void;
  /** Screen-reader increment/decrement: ±10 s. */
  onSkip: (delta: number) => void;
};

/**
 * Draggable progress bar with current time / duration. While the finger is down
 * it shows the drag position, so polled values never fight the user.
 */
export function RemoteProgress({ position, duration, disabled, onSeek, onSkip }: Props) {
  const theme = useTheme();
  const [dragging, setDragging] = useState<number | null>(null);
  const width = useRef(0);
  // Page X of the track's left edge, taken at touch start so moves outside the bar still map.
  const trackLeft = useRef(0);
  const enabled = !disabled && duration != null;

  const valueAt = (event: GestureResponderEvent) => {
    const total = duration ?? 0;
    const x = event.nativeEvent.pageX - trackLeft.current;
    const ratio = width.current > 0 ? Math.min(1, Math.max(0, x / width.current)) : 0;
    return clampSeek(ratio * total, total);
  };

  const responder = {
    onStartShouldSetResponder: () => enabled,
    onMoveShouldSetResponder: () => enabled,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (event: GestureResponderEvent) => {
      trackLeft.current = event.nativeEvent.pageX - event.nativeEvent.locationX;
      setDragging(valueAt(event));
    },
    onResponderMove: (event: GestureResponderEvent) => setDragging(valueAt(event)),
    onResponderRelease: (event: GestureResponderEvent) => {
      const target = valueAt(event);
      setDragging(null);
      onSeek(target);
    },
    onResponderTerminate: () => setDragging(null),
  };

  const shown = dragging ?? position ?? 0;
  const ratio = duration ? Math.min(1, Math.max(0, shown / duration)) : 0;
  const onLayout = (event: LayoutChangeEvent) => {
    width.current = event.nativeEvent.layout.width;
  };

  return (
    <View style={styles.progress}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Posición del video"
        accessibilityState={{ disabled: disabled || duration == null }}
        accessibilityValue={
          duration != null
            ? { min: 0, max: duration, now: shown, text: `${spokenTime(shown)} de ${spokenTime(duration)}` }
            : { text: 'Duración desconocida' }
        }
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          if (disabled || duration == null) return;
          if (event.nativeEvent.actionName === 'increment') onSkip(10);
          if (event.nativeEvent.actionName === 'decrement') onSkip(-10);
        }}
        onLayout={onLayout}
        style={[styles.touch, { opacity: disabled ? 0.5 : 1 }]}
        {...responder}>
        <View pointerEvents="none" style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
          <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: theme.accent }]} />
        </View>
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            { left: `${ratio * 100}%`, backgroundColor: theme.accent, borderColor: theme.background },
            dragging != null && styles.thumbActive,
          ]}
        />
      </View>
      <View style={styles.times} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text style={[styles.time, { color: theme.textSecondary }]}>{formatClock(position == null ? null : shown)}</Text>
        <Text style={[styles.time, { color: theme.textSecondary }]}>{formatClock(duration)}</Text>
      </View>
    </View>
  );
}

const THUMB = 20;

const styles = StyleSheet.create({
  progress: { gap: 4 },
  touch: { height: 44, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%' },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 2,
    marginLeft: -THUMB / 2,
    top: (44 - THUMB) / 2,
  },
  thumbActive: { transform: [{ scale: 1.2 }] },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { fontSize: 13, fontVariant: ['tabular-nums'] },
});
