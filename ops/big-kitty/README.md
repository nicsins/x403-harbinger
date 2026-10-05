# big-kitty pump timer

Vercel Hobby only allows a daily cron, so `vercel.json` keeps a daily cleanup run
(`0 13 * * *`). The every-minute pump runs from big-kitty as a systemd **user** timer.

Files live on the AI disk, never the main disk:

```
/mnt/nvme0-ai/ai-workspace/harbinger-pump/
  .env.local                 # chmod 600: CRON_SECRET, HOOK_SIGNING_SECRET (not in git)
  pump.sh                    # copy of ops/big-kitty/pump.sh
  harbinger-pump.service     # copy of ops/big-kitty/harbinger-pump.service
  harbinger-pump.timer       # copy of ops/big-kitty/harbinger-pump.timer
```

Install (linger is on for the user):

```sh
cd /mnt/nvme0-ai/ai-workspace/harbinger-pump
systemctl --user link "$PWD/harbinger-pump.service" "$PWD/harbinger-pump.timer"
systemctl --user daemon-reload
systemctl --user enable --now harbinger-pump.timer
journalctl --user -u harbinger-pump.service -n 5 --no-pager
```

`PUMP_URL` points at the PR #8 preview branch alias. Pointing it at production needs
Nic's go and the prod `CRON_SECRET` set in Vercel first.
