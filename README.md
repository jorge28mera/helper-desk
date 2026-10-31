# helper-desk

A Claude Code mod that shows what Claude and its helpers are doing.

- **Task band above the prompt.** The task title, one glass pill per step (done ones glow, the current one is a glass capsule) and "Now: …" for the step under way.
- **Helpers pane.** A card per subagent with a pixel crab dressed for its job (Explorer, Architect, Professor, Artist, Handyman, Butler), its type and model, tokens, estimated cost, time, current step, recent activity and a progress bar, grouped into Running and Finished. Tiles at the top total the chat cost, helper tokens and time.

Open the pane any time with `/helpers`. The mod makes no model calls and uses no tokens itself; costs shown are estimates at API prices.

## Install

At the prompt of a terminal session:

```
/plugin install helper-desk --marketplace jorge28mera/helper-desk
```

Answer `y` to add the marketplace, then press Enter to pick the user scope.

From a shell:

```
claude plugin install helper-desk --marketplace jorge28mera/helper-desk
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `jorge28mera/helper-desk`, then Add plugin.
