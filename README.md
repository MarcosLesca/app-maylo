# Pagos Casa

A private Android app for two people to keep the household in order:

- **Bills**: the same monthly checklist every month, with payment receipts (photo or PDF) per payment.
- **Tasks**: shared to-do list.
- **Shopping**: monthly grocery list, with "copy from last month".
- **Anniversary**: meal plan for the day (breakfast, lunch, afternoon snack, dinner).

## Architecture

| Layer | Choice | Why |
|---|---|---|
| App | Expo (React Native + TypeScript), Expo Router | Native Android app, no hosting needed |
| Backend | Supabase (Postgres + Auth + Storage), free plan | Sync between both phones, no server to maintain |
| OTA updates | `expo-updates` + `eas update` | JS/UI changes reach the phones without reinstalling |
| APK updates | GitHub Releases | The app detects a newer APK and offers to download it |
| Keep-alive | GitHub Action every 3 days | Free Supabase projects pause after 7 idle days |

```
src/
  app/                 # Routes (Expo Router): login, tabs, bills modal
  features/
    auth/              # Session + members allowlist check
    payments/          # Bills, monthly checklist, receipts upload
    updates/           # OTA + APK update checks
  components/          # Shared UI primitives
  lib/                 # Supabase client, month helpers, data loader
supabase/migrations/   # Schema, RLS policies, storage bucket
```

## Security model

- **No open ports, no own server.** Everything goes over HTTPS to Supabase.
- **Public sign-up disabled.** Only the two accounts created by hand exist.
- **Row Level Security on every table**, plus an allowlist (`app_members`): an account that is not a member sees nothing, even if it manages to sign in.
- **Private storage bucket.** Receipts are only reachable through signed URLs that expire after 60 seconds.
- The anon key ships inside the app; that is expected and safe because RLS enforces access. **Never** put the `service_role` key in the app.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) (free plan).
2. **SQL Editor** → paste and run every file in [`supabase/migrations/`](supabase/migrations/) in order (`0001_init.sql`, then `0002_member_avatar.sql`).
3. **Authentication → Sign In / Providers**: disable "Allow new users to sign up".
4. **Authentication → Users → Add user**: create both accounts (email + strong password, "Auto confirm").
5. Add both users to the allowlist (SQL Editor). `avatar` is the mark shown at the top-left after signing in: `mustache` or `dumbbell`.

   ```sql
   insert into public.app_members (user_id, display_name, avatar)
   select id, 'Marcos', 'mustache' from auth.users where email = 'you@example.com';
   insert into public.app_members (user_id, display_name, avatar)
   select id, 'Partner', 'dumbbell' from auth.users where email = 'partner@example.com';
   ```

   To change it later: `update public.app_members set avatar = 'dumbbell' where display_name = 'Partner';`

### 2. Local environment (only for running on your machine)

CI reads these values from GitHub secrets (see [CI and secrets](#ci-and-secrets)). For local development, create a `.env` file in the project root (it is git-ignored):

```bash
# Supabase > Project Settings > API
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-or-publishable-key
# Public GitHub repo where release APKs are published ("owner/repo"); empty disables the check
EXPO_PUBLIC_RELEASES_REPO=
```

### 3. Run in development

```bash
npm install
npx expo start
```

The app uses native modules (camera, updates), so use a development build rather than Expo Go:

```bash
npx eas-cli@latest build --profile development --platform android
```

## CI and secrets

GitHub → repo → **Settings → Secrets and variables → Actions**.

| Kind | Name | Value | Used by |
|---|---|---|---|
| Secret | `EXPO_TOKEN` | expo.dev → Account settings → Access tokens | OTA update, Release APK |
| Secret | `EXPO_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | all workflows |
| Secret | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon / publishable key | all workflows |
| Variable | `RELEASES_REPO` | `owner/repo` of a **public** repo with the APK releases (optional) | OTA update, Release APK |

> `EXPO_PUBLIC_*` values end up inside the app bundle, so they are not secret from whoever has the APK; secrets just keep them out of the repo. That is fine because RLS protects the data. **Never** add the `service_role` key anywhere.

| Workflow | Trigger | What it does |
|---|---|---|
| `ota-update.yml` | push to `main` (code changes) | `eas update --branch production`: phones get it on next launch |
| `release-apk.yml` | tag `v*` matching `app.json` version | builds the APK on the runner and creates a GitHub Release with it |
| `supabase-keep-alive.yml` | every 3 days | pings Supabase so the free project is never paused |

## Releasing

**JS/UI change** (most changes): merge to `main`. The OTA workflow publishes it.

**Native change** (new native library, permission, Expo SDK upgrade):

1. Bump `version` in `app.json` (e.g. `1.1.0`). With `runtimeVersion.policy = appVersion`, OTA updates only reach phones running that same version. `versionCode` is incremented by EAS.
2. Commit, then tag and push: `git tag v1.1.0 && git push origin main v1.1.0`.
3. The Release APK workflow builds the APK and publishes the GitHub Release.
4. The app shows "New app version" and opens the download; Android asks to confirm the install.

> The in-app APK check reads the GitHub API without a token, so `RELEASES_REPO` must be **public**. If this repo is private, leave the variable empty and install new APKs by hand from the Releases page.

First-time EAS setup (once, on your machine): `npx eas-cli@latest login`, then `npx eas-cli@latest init` and `npx eas-cli@latest update:configure`, and commit the changes they make to `app.json`.

## Checks

```bash
npm run typecheck
npm run lint
npm test
```
