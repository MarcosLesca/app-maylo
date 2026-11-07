import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { useTheme } from '@/hooks/use-theme';

import { weightChart, type WeightPoint } from './plan';

const HEIGHT = 160;
const PADDING = 14;

const kg = (value: number) => `${value.toLocaleString('es-AR', { maximumFractionDigits: 1 })} kg`;

/** Weight over time: a line with a dot per entry, highest and lowest weight labelled. */
export function WeightChart({ points }: { points: WeightPoint[] }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);

  if (points.length === 0) return null;
  const chart = width > 0 ? weightChart(points, width, HEIGHT, PADDING) : null;
  const first = points[0].kg;
  const last = points[points.length - 1].kg;
  const delta = last - first;

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.header}>
        <Text style={[styles.current, { color: theme.text }]}>{kg(last)}</Text>
        {points.length > 1 ? (
          <Text style={{ color: theme.textSecondary }}>
            {delta === 0 ? 'Sin cambios' : `${delta > 0 ? '+' : ''}${kg(delta)}`} desde el inicio
          </Text>
        ) : null}
      </View>
      <View
        style={{ height: HEIGHT }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessibilityLabel={`Gráfico de peso: de ${kg(first)} a ${kg(last)}`}>
        {chart ? (
          <Svg width={width} height={HEIGHT}>
            <Path d={chart.path} stroke={theme.accent} strokeWidth={3} fill="none" strokeLinejoin="round" />
            {chart.points.map((p) => (
              <Circle key={p.day} cx={p.x} cy={p.y} r={4} fill={theme.accent} />
            ))}
          </Svg>
        ) : null}
      </View>
      {chart && chart.max !== chart.min ? (
        <View style={styles.range}>
          <Text style={[styles.rangeText, { color: theme.textSecondary }]}>Máx. {kg(chart.max)}</Text>
          <Text style={[styles.rangeText, { color: theme.textSecondary }]}>Mín. {kg(chart.min)}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 14, gap: 8 },
  header: { gap: 2 },
  current: { fontSize: 24, fontWeight: '700' },
  range: { flexDirection: 'row', justifyContent: 'space-between' },
  rangeText: { fontSize: 12 },
});
