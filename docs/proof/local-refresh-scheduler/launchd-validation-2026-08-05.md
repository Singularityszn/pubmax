# Launchd account validation - 2026-08-05

Generated from `fm/scheduler-fix-first` on the target macOS account. Initial `launchctl list` checks confirmed neither label was registered. Plists were generated in a temporary worktree directory, linted, loaded, listed, unloaded, checked absent, and deleted.

```text
Could not find service "com.pubmax.refresh-prices" in domain for port
Could not find service "com.pubmax.refresh-events" in domain for port
initial-status prices=113 events=113

proof-directory /Users/karanmanoharan/.treehouse/pubmax-4f650b/8/pubmax/.local-refresh-launchd-validation.JD1Ix9
/Users/karanmanoharan/.treehouse/pubmax-4f650b/8/pubmax/.local-refresh-launchd-validation.JD1Ix9/com.pubmax.refresh-prices.plist: OK
/Users/karanmanoharan/.treehouse/pubmax-4f650b/8/pubmax/.local-refresh-launchd-validation.JD1Ix9/com.pubmax.refresh-events.plist: OK
/Users/karanmanoharan/.treehouse/pubmax-4f650b/8/pubmax/.local-refresh-launchd-validation.JD1Ix9/com.pubmax.refresh-prices.plist
/Users/karanmanoharan/.treehouse/pubmax-4f650b/8/pubmax/.local-refresh-launchd-validation.JD1Ix9/com.pubmax.refresh-events.plist
/Users/karanmanoharan/.treehouse/pubmax-4f650b/8/pubmax/.local-refresh-launchd-validation.JD1Ix9/com.pubmax.refresh-prices.plist: OK
/Users/karanmanoharan/.treehouse/pubmax-4f650b/8/pubmax/.local-refresh-launchd-validation.JD1Ix9/com.pubmax.refresh-events.plist: OK
launchctl load /Users/karanmanoharan/.treehouse/pubmax-4f650b/8/pubmax/.local-refresh-launchd-validation.JD1Ix9/com.pubmax.refresh-prices.plist exit=0
launchctl load /Users/karanmanoharan/.treehouse/pubmax-4f650b/8/pubmax/.local-refresh-launchd-validation.JD1Ix9/com.pubmax.refresh-events.plist exit=0
{
	"StandardOutPath" = "/Users/karanmanoharan/karan-agent-workspace/data/refresh-logs/launchd-prices.log";
	"LimitLoadToSessionType" = "Aqua";
	"StandardErrorPath" = "/Users/karanmanoharan/karan-agent-workspace/data/refresh-logs/launchd-prices.log";
	"Label" = "com.pubmax.refresh-prices";
	"OnDemand" = true;
	"LastExitStatus" = 0;
	"Program" = "/Users/karanmanoharan/.vite-plus/js_runtime/node/24.19.0/bin/node";
	"ProgramArguments" = (
		"/Users/karanmanoharan/.vite-plus/js_runtime/node/24.19.0/bin/node";
		"/Users/karanmanoharan/.treehouse/pubmax-4f650b/8/pubmax/scripts/local-refresh/scheduler.mjs";
		"run";
		"prices";
	);
};
{
	"StandardOutPath" = "/Users/karanmanoharan/karan-agent-workspace/data/refresh-logs/launchd-events.log";
	"LimitLoadToSessionType" = "Aqua";
	"StandardErrorPath" = "/Users/karanmanoharan/karan-agent-workspace/data/refresh-logs/launchd-events.log";
	"Label" = "com.pubmax.refresh-events";
	"OnDemand" = true;
	"LastExitStatus" = 0;
	"Program" = "/Users/karanmanoharan/.vite-plus/js_runtime/node/24.19.0/bin/node";
	"ProgramArguments" = (
		"/Users/karanmanoharan/.vite-plus/js_runtime/node/24.19.0/bin/node";
		"/Users/karanmanoharan/.treehouse/pubmax-4f650b/8/pubmax/scripts/local-refresh/scheduler.mjs";
		"run";
		"events";
	);
};
launchctl unload /Users/karanmanoharan/.treehouse/pubmax-4f650b/8/pubmax/.local-refresh-launchd-validation.JD1Ix9/com.pubmax.refresh-events.plist exit=0
launchctl unload /Users/karanmanoharan/.treehouse/pubmax-4f650b/8/pubmax/.local-refresh-launchd-validation.JD1Ix9/com.pubmax.refresh-prices.plist exit=0
Could not find service "com.pubmax.refresh-prices" in domain for port
Could not find service "com.pubmax.refresh-events" in domain for port
post-cleanup-status prices=113 events=113 (113 means absent)
```
