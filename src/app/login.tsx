import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { Button, Danger, Field, Muted } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/auth-provider';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

export default function LoginScreen() {
  const theme = useTheme();
  const { accessError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    // Generic message on purpose: do not reveal whether the email exists.
    if (signInError) setError('Wrong email or password.');
    setLoading(false);
  };

  const message = error ?? accessError;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.form}>
        <Text style={[styles.title, { color: theme.text }]}>Pagos Casa</Text>
        <Muted>Bills, tasks, groceries and plans for the two of us.</Muted>
        <Field
          placeholder="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <Field
          placeholder="Password"
          secureTextEntry
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={signIn}
        />
        {message ? <Text style={{ color: Danger }}>{message}</Text> : null}
        <Button label="Sign in" onPress={signIn} loading={loading} disabled={!email || !password} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: Spacing.four },
  form: { gap: Spacing.three, width: '100%', maxWidth: 420, alignSelf: 'center' },
  title: { fontSize: 32, fontWeight: '700' },
});
