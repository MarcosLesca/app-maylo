import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

type IconProps = { size?: number; color?: string };

/** Handlebar mustache, a nod to the dev half of the house. */
export function Mustache({ size = 40, color }: IconProps) {
  const theme = useTheme();
  return (
    <Svg width={size} height={size * 0.4} viewBox="0 0 100 40" accessibilityLabel="Bigote">
      <Path
        fill={color ?? theme.text}
        d="M50 14 C44 6 34 4 26 10 C20 15 14 20 6 16 C3 15 1 12 2 9 C0 14 2 22 10 26 C20 31 34 28 42 22 C46 19 49 18 50 18 C51 18 54 19 58 22 C66 28 80 31 90 26 C98 22 100 14 98 9 C99 12 97 15 94 16 C86 20 80 15 74 10 C66 4 56 6 50 14 Z"
      />
    </Svg>
  );
}

/** Dumbbell, a nod to the gym half of the house. */
export function Dumbbell({ size = 40, color }: IconProps) {
  const theme = useTheme();
  const fill = color ?? theme.success;
  return (
    <Svg width={size} height={size * 0.5} viewBox="0 0 64 32" accessibilityLabel="Mancuerna">
      <Rect x={14} y={14} width={36} height={4} rx={2} fill={fill} />
      <Rect x={10} y={5} width={6} height={22} rx={2} fill={fill} />
      <Rect x={48} y={5} width={6} height={22} rx={2} fill={fill} />
      <Rect x={3} y={9} width={6} height={14} rx={2} fill={fill} />
      <Rect x={55} y={9} width={6} height={14} rx={2} fill={fill} />
    </Svg>
  );
}

/** Mustache + dumbbell side by side: the two of us. */
export function BrandMark({ size = 36 }: { size?: number }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size / 3 }}>
      <Mustache size={size * 1.2} color={theme.accent} />
      <Dumbbell size={size} color={theme.success} />
    </View>
  );
}

/** Sunset sky over a grass hill: her green, his orange. */
export function SunsetHero({ height = 180 }: { height?: number }) {
  const theme = useTheme();
  return (
    <Svg width="100%" height={height} viewBox="0 0 360 180" preserveAspectRatio="xMidYMid slice">
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={theme.sunsetTop} />
          <Stop offset="1" stopColor={theme.sunsetBottom} />
        </LinearGradient>
      </Defs>
      <Rect width="360" height="180" fill="url(#sky)" />
      <Circle cx="180" cy="128" r="46" fill="#FFE08A" opacity={0.9} />
      <Path d="M0 140 Q90 105 190 132 T360 122 V180 H0 Z" fill={theme.success} />
      <Path d="M0 158 Q120 136 240 156 T360 150 V180 H0 Z" fill={theme.successText} />
    </Svg>
  );
}
