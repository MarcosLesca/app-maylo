import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandMark, SunsetHero } from '@/components/brand';
import { Button, Field, Muted } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/auth-provider';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

export default function LoginScreen() {
  const theme = useTheme();
  const { accessError, retry } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    // Generic message on purpose: do not reveal whether the email exists.
    if (signInError) setError('Correo o contraseña incorrectos.');
    setLoading(false);
  };

  const message = error ?? accessError?.message;
  // Only a transient failure (offline, server error) is worth retrying with the stored session.
  const canRetry = !error && accessError?.kind === 'error';

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
        <SunsetHero height={220} />
        <View style={styles.form}>
          <BrandMark size={40} />
          <Text style={[styles.title, { color: theme.text }]}>Pagos Casa</Text>
          <Muted>Pagos, tareas, compras y planes para los dos.</Muted>
          <Field
            placeholder="Correo electrónico"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <Field
            placeholder="Contraseña"
            secureTextEntry
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={signIn}
          />
          {message ? <Text style={{ color: theme.danger }}>{message}</Text> : null}
          {canRetry ? <Button label="Reintentar" variant="secondary" onPress={retry} /> : null}
          <Button label="Ingresar" onPress={signIn} loading={loading} disabled={!email || !password} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1 },
  form: {
    gap: Spacing.three,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    padding: Spacing.four,
  },
  title: { fontSize: 32, fontWeight: '700' },
});
