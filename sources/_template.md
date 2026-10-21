---
tool: <tool>                 # e.g. slack, github, drive, notion — read by .agents/skills/ingest-<tool>/ (created on first use)
defaults:                    # apply to every source below unless the source overrides them
  trust: review              # review: candidates go to memory/inbox.md · auto: low-risk items written directly
  schedule: on-demand        # on-demand | on-session-start | cron "0 9 * * 1-5" (needs an app scheduled task)
  first_run: last 7 days     # how far back the first run reads
  max_items: 200             # cap per run (the cursor makes the next run continue)
  keep_digest: true          # write ingest/digests/YYYY-MM-DD-<id>.md
---
# <Tool> sources

> Template for `sources/<tool>.md`: one file per platform, one `##` section per source.
> The platform skill applies the rules for every source first, then the source's own `process` list (which wins on conflict).
> `cursor` and `last_run` are updated by each run; edit everything else freely, or just ask ("follow … for …").

## Rules for every <tool> source
- <e.g. Skip bots and emoji-only replies. Weigh messages from my manager higher.>

## <Human name of the source>
- id: <tool>-<short-name>            # unique, kebab-case; used by "/ingest run <id>", logs and digests
- target: <kind> <name>              # e.g. channel #channel-a · person @ana · repo owner/repo · doc "Q4 plan" · folder "Launch"
- ref: —                             # resolved id/url, filled in when the source is created
- aliases: <other names I use for it>
- project: <slug>                    # projects/<slug>.md this feeds, or —
- goal: —
- routes: tasks, context, ecosystem, playbook, decisions, open-questions
- trust: review                      # optional: overrides the default
- schedule: on-demand                # optional: overrides the default
- status: active                     # active | paused
- scheduled_task: —
- process:
  - <What to get from this source and what to ignore, in my words.>
- cursor: —
- last_run: —

<!--
EXAMPLE of a filled-in sources/slack.md (illustration only — not shipped as a real file):

## Rules for every Slack source
- Skip joins, bot posts, emoji-only replies and greetings.

## #channel-a
- id: slack-channel-a
- target: channel #channel-a
- project: launch
- routes: tasks, decisions, open-questions
- process:
  - Only decisions, blockers, dates and who owns what.
  - Follow threads with 3+ replies; that's where decisions land.

## #channel-b
- id: slack-channel-b
- target: channel #channel-b
- schedule: on-session-start
- process:
  - Take everything into account: announcements, process changes, new people and roles, deadlines that affect me.
  - Anything addressed to me becomes a task candidate.
-->
