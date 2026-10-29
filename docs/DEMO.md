# Offline demo

## The recorded demo

`docs/demo/tabibu-demo.mp4` was made by `scripts/demo/`, on Linux as root:

```bash
unshare -n sh scripts/demo/inside.sh   # no network inside: brings up loopback, starts Tabibu, records
node scripts/demo/cut.cjs              # joins the frames into scripts/demo/out/tabibu-demo.mp4
```

`inside.sh` captures the network checks shown in the opening frame from inside the same sandbox. `record.cjs` drives the real app with Playwright and grabs still frames. It pauses while the models run, so recording doesn't slow them down, and the captions state how long each wait was.

## Recording on your own laptop (about 3 minutes)

The rules ask for a recording that shows the core AI feature working with the internet disconnected. This script makes that visible on screen, so the video still makes sense with the sound off.

## Before recording (while online)

1. `npm install` and `npm run setup`. Setup downloads about 6.1 GB of models and the WHO manual.
2. Start the app once with `npm start` and open `http://localhost:4317`. Wait until the Device tab says the models are loaded.
3. Close everything else that uses a lot of memory.

## Recording

| Time | Do | Caption |
|---|---|---|
| 0:00 | Show the Windows Wi-Fi panel (or macOS menu bar) and switch on airplane mode. In a browser tab, try to open `example.com` and show it fail. | Internet is off. |
| 0:12 | In a terminal, run `npm start`. Open `http://localhost:4317`. Click the chip at top right. It reads "No internet · running offline". | Tabibu runs on this laptop through QVAC. |
| 0:25 | Click the Kiswahili example: *Mtoto wangu wa miaka 3 ana kikohozi na anapumua haraka. Nimpe dawa gani?* Let the stage list fill in. | A health promoter asks in Kiswahili. Each step runs on the device. |
| 1:05 | Click a page chip, for example `p. 87`. Scroll to the highlighted dose. | Every step cites the WHO/UNICEF page it came from. |
| 1:20 | Ask: *A 2 year old has had fever for 8 days and now has convulsions.* | Danger signs are checked by fixed rules before the model runs. |
| 1:40 | Point at the red banner and its `p. 39` citations. | Urgent referral, with the page that says so. |
| 1:50 | Ask: *How do I treat high blood pressure in an adult?* | Questions outside the loaded guideline are refused, not guessed. |
| 2:05 | Open the Evidence tab. | Same questions on the device and in the cloud: accuracy, speed, data sent, cost. |
| 2:25 | Open the Device tab. | Models from the QVAC registry, loaded from local files, and the memory they use. |
| 2:40 | Switch airplane mode off only after the recording ends. | |

## Notes

- Keep airplane mode on for the whole recording. Nothing in the answer path uses the network.
- On a CPU-only laptop a Kiswahili answer takes about a minute. Leave the waits in or cut them, but say so in the caption, for example "40 s of waiting cut".
- If memory is tight (8 GB), set `TABIBU_CHAT=qwen3.5-2b` before `npm start`. The Evidence tab shows what that costs in accuracy.
