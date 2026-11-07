// App entry. The background notification task must be defined before anything
// else runs, because Android can start the JS bundle headless (app closed) just
// to handle a push.
import './src/features/notifications/background';
import 'expo-router/entry';
