# Shared Bulk notebook and TV receiver for both phones

Two requests after v1.5.0: Bulk becomes one notebook shared by both members, and either phone can cast to the TV browser receiver without depending on the other phone.

## Specs

- **S1 One shared Bulk notebook.** User: "en el bulk los dos deberiamos vver lo mismo pero yo no veo lo mismo que ella...."; chose "Un solo cuaderno compartido". Both members see and edit the same foods (training/rest) and the same per-day totals and meal notes.
  - Foods: `bulk_foods` RLS becomes members-shared (`public.is_member()`, like the food wishlist); every existing row of both members stays, now visible to both (the lists are merged by union; `user_id` stays as the author).
  - Day totals and notes: a new table with one row per `day_type` (shared). Its initial content merges the two members' existing `bulk_day_totals` rows per day type: each numeric field takes the value from the row that has more filled fields (ties: the most recently created member row is unknown, so the first member by `app_members` order), filling nulls from the other row; breakfast/lunch/dinner notes are concatenated (distinct non-empty texts joined with a blank line).
  - Nothing is deleted: the old `bulk_day_totals` table and its rows are left untouched (no longer used by the app) so the merge can be redone or reverted by hand.
  - Push notifications on changes keep working for the new table like they do for the old one (see 0012).
  - The app, README and any "Personal" copy reflect the shared notebook.
  - Migration `supabase/migrations/0014_shared_bulk.sql`, re-runnable or guarded so running it twice does not duplicate or overwrite edits made after the first run; the user runs it in the SQL Editor before installing the APK.
- **S2 Either phone casts to the TV.** User: "como hacemos si yo no estoy y ella quiere transmitir?? cambia la ip y es muy engorroso"; chose "B: A + la tele escucha a los dos (recomendado)".
  - Each phone publishes its current receiver address (`http://<ip>:<port>/tv/<key>`) to a shared Supabase table `cast_receivers` (one row per member, RLS `is_member()`, migration `0015_cast_receivers.sql`) whenever its receiver starts or its address changes.
  - The receiver page served by either phone embeds the known receivers of both members and polls the commands of every one of them; a `load` from either phone plays; state is reported to every phone it can reach, so each app sees "Tele conectada".
  - Native: receiver and proxy routes answer CORS (`Access-Control-Allow-Origin: *`, OPTIONS preflight) so a page served by one phone can talk to the other phone and play its proxied HLS; the key still gates every `/tv` route and the proxy session token every `/s` route.
  - The connect screen shows both addresses with names ("MayLo de <nombre>") and explains: reserve both phones' IPs in the router once, save one favorite per phone on the TV; any open favorite accepts videos from both phones while the phone that served it is home.

## Tasks

- [x] T1 — S1 — worker A: migration 0014, bulk API/screen, README Bulk line — commit: 21900a5 (verified by reading; SQL not executed: no Postgres here)
- [ ] T2 — S2 — worker B: migration 0015, receivers registry, multi-phone page, CORS in tv-cast, connect screen — commit:
- [ ] T3 — integrate with the stronger ad blocking (odd/tasks/tv-cast-discovery-adblock.md T6), verify, version 1.6.0, PR, release — commit:

## Log

- L1 (user, verbatim): "otra cosa, en el bulk los dos deberiamos vver lo mismo pero yo no veo lo mismo que ella.... otra cosa como hacemos si yo no estoy y ella quiere transmitir?? cambia la ip y es muy engorroso"
- L2 (user): Bulk → "Un solo cuaderno compartido"; casting → "B: A + la tele escucha a los dos (recomendado)".
- L3 (decision): Bulk was personal by design (0010 RLS "own rows only"). The merge keeps the old totals table untouched as the safety net instead of rewriting it.
- L4 (verify mwskw9vx): 0014 has no blockers by reading (merge ranking, dedup of notes via GROUP BY, on conflict do nothing, triggers after merge, revoke last, no DML on old tables). Not executed (no Postgres). Install the new APK on both phones right after running 0014: old APKs keep writing to bulk_day_totals.
