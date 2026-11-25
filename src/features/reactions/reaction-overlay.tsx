import { useEffect } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/auth-provider';
import { useTheme } from '@/hooks/use-theme';

import { reactionText, type Reaction } from './rules';
import { REACTION_VISIBLE_MS, useIncomingReactions } from './use-incoming-reactions';

const RISE = 160;
const FADE_MS = 400;
// Spread bursts horizontally so consecutive reactions do not stack on each other.
// The lane comes from the id so it stays put while other reactions come and go.
const LANES = [-0.22, 0.18, -0.05, 0.28, -0.3, 0.06];
const laneFor = (id: string) => [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % LANES.length;

function FloatingReaction({ reaction, bottom }: { reaction: Reaction; bottom: number }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0);
  const rise = useSharedValue(0);

  useEffect(() => {
    const hold = REACTION_VISIBLE_MS - FADE_MS * 2;
    if (reduceMotion) {
      // No movement: appear, stay, disappear.
      opacity.value = withSequence(withTiming(1, { duration: 0 }), withDelay(hold + FADE_MS, withTiming(0, { duration: FADE_MS })));
      return;
    }
    opacity.value = withSequence(
      withTiming(1, { duration: FADE_MS }),
      withDelay(hold, withTiming(0, { duration: FADE_MS })),
    );
    rise.value = withTiming(-RISE, { duration: REACTION_VISIBLE_MS, easing: Easing.out(Easing.cubic) });
  }, [opacity, rise, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: rise.value }],
  }));

  const text = reactionText(reaction);
  return (
    <Animated.View
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={reaction.emoji ? `Reacción: ${text}` : `Mensaje: ${text}`}
      style={[styles.item, { bottom, transform: [{ translateX: LANES[laneFor(reaction.id)] * width }] }]}>
      <Animated.View style={animatedStyle}>
        {reaction.emoji ? (
          <Text style={styles.emoji}>{text}</Text>
        ) : (
          <View style={[styles.bubble, { backgroundColor: theme.accentSoft }]}>
            <Text style={[styles.message, { color: theme.accentText }]}>{text}</Text>
          </View>
        )}
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Floats the other member's reactions over any screen for ~4 s. Mounted once
 * in the root layout; it never captures touches and never shows my own.
 */
export function ReactionOverlay() {
  const { session } = useAuth();
  const reactions = useIncomingReactions(session?.user.id);
  const insets = useSafeAreaInsets();
  if (reactions.length === 0) return null;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.layer]}>
      {reactions.map((reaction) => (
        <FloatingReaction key={reaction.id} reaction={reaction} bottom={insets.bottom + 120} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { alignItems: 'center' },
  item: { position: 'absolute', alignItems: 'center', maxWidth: '70%' },
  emoji: { fontSize: 64 },
  bubble: { borderRadius: 12, paddingVertical: Spacing.two + 2, paddingHorizontal: Spacing.three },
  message: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
});
