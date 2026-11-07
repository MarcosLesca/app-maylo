import Svg, { Path } from 'react-native-svg';

/**
 * Line icons on a 24px grid (stroke 2, round caps), drawn as paths so they
 * inherit any color and match the rest of the UI. No emoji anywhere.
 */
const ICONS = {
  cash: [
    'M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
    'M12 9.5a2.5 2.5 0 1 1 0 5a2.5 2.5 0 1 1 0-5z',
  ],
  checklist: ['M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z', 'M8 12l3 3 5-6'],
  cart: [
    'M2 3h3l2.5 12h11L21 7H6',
    'M9 18.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3z',
    'M18 18.5a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3z',
  ],
  heart: ['M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z'],
  receipt: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'],
  file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'],
  coffee: ['M4 10h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z', 'M17 11h1.5a2.5 2.5 0 0 1 0 5H17', 'M8 3v3', 'M12 3v3'],
  bowl: ['M3 11h18a9 9 0 0 1-18 0z', 'M7 7c1-2 3-2 4 0', 'M13 7c1-2 3-2 4 0'],
  cake: ['M4 20h16v-7H4z', 'M4 13c2-3 14-3 16 0', 'M12 6v4'],
  glass: ['M8 3h8l-1 7a3 3 0 0 1-6 0z', 'M12 13v7', 'M9 21h6'],
  check: ['M5 12l5 5 9-10'],
  plus: ['M12 5v14', 'M5 12h14'],
  chat: ['M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
  send: ['M21 3L10 14', 'M21 3l-7 18-4-7-7-4z'],
  image: [
    'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    'M8.5 7a1.5 1.5 0 1 1 0 3a1.5 1.5 0 1 1 0-3z',
    'M21 15l-5-5L5 20',
  ],
  calendar: ['M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M8 3v4', 'M16 3v4', 'M3 10h18'],
  chevronLeft: ['M15 6l-6 6 6 6'],
  chevronRight: ['M9 6l6 6-6 6'],
} as const;

export type IconName = keyof typeof ICONS;

type IconProps = {
  name: IconName;
  color: string;
  size?: number;
  strokeWidth?: number;
};

export function Icon({ name, color, size = 22, strokeWidth = 2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
      {ICONS[name].map((d) => (
        <Path key={d} d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}
