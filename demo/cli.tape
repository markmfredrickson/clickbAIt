# clickbAIt CLI Demo
# Rendered with VHS: https://github.com/charmbracelet/vhs

Output demo/output/cli-demo.gif
Output demo/output/cli-demo.mp4

Set Shell "zsh"
Set FontSize 16
Set Width 1280
Set Height 720
Set Theme "Catppuccin Mocha"
Set TypingSpeed 50ms
Set Padding 20

# ── Title card ──
Type "# clickbAIt — AI-powered click, cue & backing tracks"
Enter
Sleep 1.5s
Type "clear"
Enter
Sleep 500ms

# ── Show help ──
Type "clickbait-audio --help"
Enter
Sleep 3s

# ── Analyze a track ──
Type "# Analyze BPM, key, and beat positions from audio"
Enter
Sleep 1s
Type "clickbait-audio analyze tests/fixtures/click-120bpm-4bars.wav"
Enter
Sleep 4s

# ── Speak a cue ──
Type "# Generate spoken vocal cues for section changes"
Enter
Sleep 1s
Type 'clickbait-audio speak "Chorus" --output /tmp/demo-cue.wav'
Enter
Sleep 3s

# ── Start the teleprompter ──
Type "# Launch the live teleprompter (syncs with REAPER via OSC)"
Enter
Sleep 1s
Type "npx tsx scripts/teleprompter.ts --songs-dir ./output/songs"
Enter
Sleep 4s

# Show QR code output
Sleep 2s
Ctrl+C
Sleep 500ms

# ── Wrap up ──
Type "# That's clickbAIt! AI-powered tools for cover bands."
Enter
Sleep 3s
